import { state } from '../state.js';
import { hasRole } from '../utils/access.js';
import { $, $$ } from '../utils/dom.js';
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  inputDateToIso,
  toInputDate
} from '../utils/format.js';
import { SALE_PLATFORMS, INVENTORY_STATUS_LABELS } from '../utils/constants.js';
import { buildVariantTitle, findVariant, getProductVariants } from '../utils/products.js';
import { confirmModal, openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import {
  createInventoryItem,
  deleteInventoryItem,
  deleteInventoryItems,
  updateInventoryItem,
  markDefected,
  revertDefected
} from '../services/inventory.service.js';
import { recordSale } from '../services/sales.service.js';

let searchTerm = '';
let inventoryTab = 'all';
const selectedInventoryIds = new Set();
let popoverListenerBound = false;

function closeAllPopovers() {
  document.querySelectorAll('.inline-popover').forEach((popover) => popover.remove());
}

function ensurePopoverDismissal() {
  if (popoverListenerBound) return;

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.inline-popover') && !event.target.closest('[data-popover-trigger]')) {
      closeAllPopovers();
    }
  });

  popoverListenerBound = true;
}

function pruneSelectedInventoryIds() {
  const visibleIds = new Set(state.inventory.map((item) => item.id));

  for (const inventoryId of [...selectedInventoryIds]) {
    if (!visibleIds.has(inventoryId)) {
      selectedInventoryIds.delete(inventoryId);
    }
  }
}

function renderSelectedInventoryCountBar(selectedCount) {
  if (!selectedCount) return '';

  return `
    <div class="batch-bar">
      <div class="batch-bar-label">${selectedCount} item${selectedCount === 1 ? '' : 's'} selected</div>
      <div class="batch-bar-actions">
        <button class="button button-danger button-small" type="button" id="delete-selected-inv">Delete Selected</button>
        <button class="button button-secondary button-small" type="button" id="clear-selected-inv">Clear</button>
      </div>
    </div>
  `;
}

function showDeleteConfirmModal({ count, label, danger = false, onConfirm }) {
  openModal({
    title: `Delete ${label}?`,
    body: `
      <div class="migration-copy">
        <p class="delete-warn-text">
          This will permanently remove ${count} item${count === 1 ? '' : 's'} from inventory.
          This cannot be undone.
        </p>
        ${
          danger
            ? `
              <div class="field-group" style="margin-top:12px">
                <label class="field-label" for="delete-confirm-input">Type DELETE to confirm</label>
                <input
                  type="text"
                  id="delete-confirm-input"
                  autocomplete="off"
                  placeholder="DELETE"
                >
              </div>
            `
            : ''
        }
      </div>
    `,
    footer: `
      <button class="button button-secondary button-small" type="button" data-close-modal>Cancel</button>
      <button class="button button-danger button-small" type="button" id="confirm-delete-btn" ${danger ? 'disabled' : ''}>
        Delete
      </button>
    `,
    onOpen({ body: bodyTarget, footer: footerTarget, close }) {
      const confirmButton = $('#confirm-delete-btn', footerTarget);
      const confirmInput = $('#delete-confirm-input', bodyTarget);

      if (danger && confirmButton && confirmInput) {
        confirmInput.addEventListener('input', () => {
          confirmButton.disabled = confirmInput.value !== 'DELETE';
        });
      }

      confirmButton?.addEventListener('click', async () => {
        if (confirmButton.disabled) return;
        close('confirm');
        await onConfirm?.();
      });
    }
  });
}

function openInventoryModal(item = null) {
  const body = document.createElement('div');
  const footer = document.createElement('div');
  const selectedProduct =
    state.products.find((product) => product.id === item?.product_id) ?? null;
  const selectedVariants = selectedProduct ? getProductVariants(selectedProduct) : [];
  const selectedVariant =
    (selectedProduct && findVariant(selectedProduct, item?.variant_title)) || selectedVariants[0] || null;

  body.innerHTML = `
    <form class="modal-form" id="inventory-form">
      <div class="field-grid">
        <label class="field full">
          <span>Product Source</span>
          <select id="inventory-product-source">
            <option value="__manual">Manual entry</option>
            ${state.products
              .map(
                (product) => `
                  <option value="${product.id}" ${product.id === selectedProduct?.id ? 'selected' : ''}>
                    ${escapeHtml(product.title)}
                  </option>
                `
              )
              .join('')}
          </select>
        </label>
        <label class="field full">
          <span>Variant</span>
          <select id="inventory-variant-select"></select>
        </label>
        <label class="field full">
          <span>Product Title</span>
          <input id="inventory-title" value="${escapeHtml(item?.product_title || selectedProduct?.title || '')}" required />
        </label>
        <label class="field full">
          <span>Variant Title</span>
          <input id="inventory-variant-title" value="${escapeHtml(item?.variant_title || selectedVariant?.title || '')}" required />
        </label>
        <label class="field">
          <span>Color</span>
          <input id="inventory-color" value="${escapeHtml(item?.color || selectedVariant?.color || '')}" />
        </label>
        <label class="field">
          <span>Size</span>
          <input id="inventory-size" value="${escapeHtml(item?.size || selectedVariant?.size || '')}" />
        </label>
        <label class="field">
          <span>SKU</span>
          <input id="inventory-sku" value="${escapeHtml(item?.sku || selectedVariant?.sku || '')}" />
        </label>
        <label class="field">
          <span>Quantity</span>
          <input id="inventory-qty" type="number" min="0" value="${item?.quantity ?? 1}" required />
        </label>
        <label class="field">
          <span>Buy Price</span>
          <input id="inventory-buy-price" type="number" min="0" step="0.01" value="${item?.buy_price ?? ''}" required />
        </label>
        <label class="field">
          <span>Date Added</span>
          <input id="inventory-date" type="date" value="${toInputDate(item?.date_added || new Date())}" required />
        </label>
        <label class="field full">
          <span>Notes</span>
          <textarea id="inventory-notes" placeholder="Optional notes">${escapeHtml(item?.notes || '')}</textarea>
        </label>
      </div>
    </form>
  `;

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="inventory-form">${item ? 'Update Item' : 'Add Item'}</button>
  `;

  openModal({
    title: item ? 'Edit Inventory Item' : 'Add Inventory Item',
    description: 'Manual inventory lines can exist alongside lot-pushed rows.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      const sourceSelect = $('#inventory-product-source', bodyTarget);
      const variantSelect = $('#inventory-variant-select', bodyTarget);
      const titleInput = $('#inventory-title', bodyTarget);
      const variantTitleInput = $('#inventory-variant-title', bodyTarget);
      const colorInput = $('#inventory-color', bodyTarget);
      const sizeInput = $('#inventory-size', bodyTarget);
      const skuInput = $('#inventory-sku', bodyTarget);

      const syncVariantFields = () => {
        const product =
          state.products.find((entry) => entry.id === sourceSelect.value) ?? null;
        const variant =
          product && variantSelect.value !== '__manual'
            ? findVariant(product, variantSelect.value)
            : null;

        if (product && !item) {
          titleInput.value = product.title;
        }

        if (variant) {
          variantTitleInput.value = buildVariantTitle(variant);
          colorInput.value = variant.color || '';
          sizeInput.value = variant.size || '';
          skuInput.value = variant.sku || '';
        }
      };

      const syncVariantOptions = () => {
        const product =
          state.products.find((entry) => entry.id === sourceSelect.value) ?? null;
        const variants = product ? getProductVariants(product) : [];

        variantSelect.innerHTML = `
          <option value="__manual">${product ? 'Manual override' : 'Manual entry'}</option>
          ${variants
            .map(
              (variant) => `
                <option value="${escapeHtml(buildVariantTitle(variant))}">
                  ${escapeHtml(buildVariantTitle(variant))}
                </option>
              `
            )
            .join('')}
        `;

        const nextValue = product && selectedVariant ? buildVariantTitle(selectedVariant) : '__manual';
        variantSelect.value = variants.some((variant) => buildVariantTitle(variant) === nextValue)
          ? nextValue
          : '__manual';

        syncVariantFields();
      };

      syncVariantOptions();
      sourceSelect.addEventListener('change', syncVariantOptions);
      variantSelect.addEventListener('change', syncVariantFields);

      $('#inventory-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          const product =
            state.products.find((entry) => entry.id === sourceSelect.value) ?? null;

          const payload = {
            lot_id: item?.lot_id ?? null,
            lot_item_id: item?.lot_item_id ?? null,
            product_id: product?.id ?? item?.product_id ?? null,
            shopify_product_id: product?.shopify_product_id ?? item?.shopify_product_id ?? null,
            product_title: titleInput.value.trim(),
            variant_title: variantTitleInput.value.trim(),
            color: colorInput.value.trim() || null,
            size: sizeInput.value.trim() || null,
            sku: skuInput.value.trim() || null,
            buy_price: Number($('#inventory-buy-price', bodyTarget).value),
            quantity: Number($('#inventory-qty', bodyTarget).value),
            notes: $('#inventory-notes', bodyTarget).value.trim() || null,
            date_added: inputDateToIso($('#inventory-date', bodyTarget).value)
          };

          if (!payload.product_title || !payload.variant_title) {
            throw new Error('Product and variant titles are required.');
          }

          if (item) {
            await updateInventoryItem(item.id, payload, state.currentUser.id);
            showToast('Inventory item updated.', 'success');
          } else {
            await createInventoryItem(payload, state.currentUser.id);
            showToast('Inventory item added.', 'success');
          }

          close('saved');
          renderInventoryView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to save inventory item.', 'error');
        }
      });
    }
  });
}

function openSellModal(item) {
  const body = document.createElement('div');
  const footer = document.createElement('div');
  const cancelButton = document.createElement('button');
  const submitButton = document.createElement('button');

  body.innerHTML = `
    <form class="modal-form" id="inventory-sell-form">
      <div class="field-grid">
        <label class="field full">
          <span>Product</span>
          <input value="${escapeHtml(item.product_title)}" disabled />
        </label>
        <label class="field">
          <span>Variant</span>
          <input value="${escapeHtml(item.variant_title)}" disabled />
        </label>
        <label class="field">
          <span>Available</span>
          <input value="${item.quantity}" disabled />
        </label>
        <label class="field">
          <span>Qty Sold</span>
          <input id="inventory-sell-qty" type="number" min="1" max="${item.quantity}" value="1" required />
        </label>
        <label class="field">
          <span>Sale Price</span>
          <input id="inventory-sell-price" type="number" min="0" step="0.01" required />
        </label>
        <label class="field">
          <span>Platform</span>
          <select id="inventory-sell-platform">
            ${SALE_PLATFORMS.map((platform) => `<option value="${platform}">${platform}</option>`).join('')}
          </select>
        </label>
        <label class="field full">
          <span>
            Buyer Name
            <span class="field-optional">optional</span>
          </span>
          <input id="inventory-sell-buyer-name" autocomplete="off" placeholder="e.g. Rahul S." />
        </label>
        <label class="field">
          <span>Date Sold</span>
          <input id="inventory-sell-date" type="date" value="${toInputDate()}" required />
        </label>
        <label class="field full">
          <span>Notes</span>
          <textarea id="inventory-sell-notes"></textarea>
        </label>
      </div>
    </form>
  `;

  cancelButton.className = 'button button-secondary';
  cancelButton.type = 'button';
  cancelButton.dataset.closeModal = '';
  cancelButton.textContent = 'Cancel';

  submitButton.className = 'button button-primary';
  submitButton.type = 'button';
  submitButton.textContent = 'Record Sale';

  footer.append(cancelButton, submitButton);

  openModal({
    title: 'Sell Inventory Item',
    description: 'This will immediately reduce the current stock count.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      const form = $('#inventory-sell-form', bodyTarget);

      const handleSubmit = async () => {
        try {
          const qtySold = Number($('#inventory-sell-qty', bodyTarget).value);
          const salePrice = Number($('#inventory-sell-price', bodyTarget).value);
          const dateValue = $('#inventory-sell-date', bodyTarget).value;

          if (!qtySold || qtySold < 1) {
            throw new Error('Enter a valid sold quantity.');
          }

          if (Number.isNaN(salePrice) || salePrice < 0) {
            throw new Error('Enter a valid sale price.');
          }

          if (!dateValue) {
            throw new Error('Select a sale date.');
          }

          if (submitButton) {
            submitButton.disabled = true;
          }

          await recordSale(
            {
              inventoryId: item.id,
              salePrice,
              qtySold,
              platform: $('#inventory-sell-platform', bodyTarget).value,
              dateSold: inputDateToIso(dateValue),
              notes: $('#inventory-sell-notes', bodyTarget).value.trim(),
              buyerName: $('#inventory-sell-buyer-name', bodyTarget).value.trim()
            },
            state.currentUser.id
          );

          close('saved');
          showToast('Sale recorded.', 'success');
          renderInventoryView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to record sale.', 'error');
        } finally {
          if (submitButton) {
            submitButton.disabled = false;
          }
        }
      };

      submitButton.addEventListener('click', handleSubmit);

      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleSubmit();
      });
    }
  });
}

function openDefectPopover(trigger, item) {
  closeAllPopovers();

  const wrap = trigger.closest('.action-wrap');
  if (!wrap) return;

  const popover = document.createElement('div');
  popover.className = 'inline-popover';
  popover.dataset.inventoryPopover = item.id;
  popover.innerHTML = `
    <div class="popover-title">Mark as defected?</div>
    <div class="popover-desc">Reason is optional. Defected items will be excluded from active inventory and sales.</div>
    <div class="field-group" style="margin-bottom: 12px;">
      <label class="field-label" for="defect-reason-${item.id}">Reason (optional)</label>
      <input id="defect-reason-${item.id}" type="text" autocomplete="off" placeholder="e.g. print misaligned" />
    </div>
    <div class="popover-actions">
      <button class="button button-secondary button-small" type="button" data-defect-cancel>Cancel</button>
      <button class="button button-danger button-small" type="button" data-defect-confirm>Mark Defected</button>
    </div>
  `;

  popover.addEventListener('click', async (event) => {
    if (event.target.closest('[data-defect-cancel]')) {
      popover.remove();
      return;
    }

    if (!event.target.closest('[data-defect-confirm]')) {
      return;
    }

    try {
      const reason = $(`#defect-reason-${item.id}`, popover)?.value.trim() || '';
      await markDefected(item.id, state.currentUser.id, reason);
      popover.remove();
      showToast('Item marked as defected.', 'success');
      renderInventoryView(document.getElementById('view-root'));
    } catch (error) {
      showToast(error.message || 'Unable to mark item as defected.', 'error');
    }
  });

  wrap.append(popover);
}

function getTabCounts() {
  return state.inventory.reduce(
    (counts, item) => {
      counts.all += 1;
      if (item.status === 'in_stock') counts.in_stock += 1;
      if (item.status === 'low_stock') counts.low_stock += 1;
      if (item.status === 'sold_out') counts.sold_out += 1;
      if (item.status === 'defected') counts.defected += 1;
      return counts;
    },
    { all: 0, in_stock: 0, low_stock: 0, sold_out: 0, defected: 0 }
  );
}

function getFilteredInventory() {
  const baseRows =
    inventoryTab === 'all'
      ? state.inventory
      : state.inventory.filter((item) => item.status === inventoryTab);

  return baseRows.filter((item) => {
    const haystack = `${item.product_title} ${item.variant_title} ${item.sku || ''} ${item.status || ''} ${item.defect_reason || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });
}

function renderInventoryTabs(counts) {
  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'in_stock', label: INVENTORY_STATUS_LABELS.in_stock, count: counts.in_stock },
    { key: 'low_stock', label: INVENTORY_STATUS_LABELS.low_stock, count: counts.low_stock },
    { key: 'sold_out', label: INVENTORY_STATUS_LABELS.sold_out, count: counts.sold_out },
    { key: 'defected', label: INVENTORY_STATUS_LABELS.defected, count: counts.defected }
  ];

  return `
    <div class="tab-row">
      ${tabs
        .map(
          (tab) => `
            <button class="tab-button ${inventoryTab === tab.key ? 'is-active' : ''}" data-inventory-tab="${tab.key}">
              ${tab.label}
              <span class="tab-badge ${tab.key === 'defected' && tab.count ? 'tab-badge-defected' : ''}">${tab.count}</span>
            </button>
          `
        )
        .join('')}
    </div>
  `;
}

function renderStandardRows(rows, canWrite) {
  const allVisibleSelected = rows.length > 0 && rows.every((item) => selectedInventoryIds.has(item.id));

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>
            ${
              canWrite
                ? `
                  <th class="col-check">
                    <input type="checkbox" id="select-all-inv" class="row-check" title="Select all" ${allVisibleSelected ? 'checked' : ''} />
                  </th>
                `
                : ''
            }
            <th>Product</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Buy</th>
            <th>Status</th>
            <th>Date Added</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => `
                <tr>
                  ${
                    canWrite
                      ? `
                        <td class="col-check">
                          <input type="checkbox" class="row-check inv-row-check" data-inv-id="${item.id}" ${selectedInventoryIds.has(item.id) ? 'checked' : ''} />
                        </td>
                      `
                      : ''
                  }
                  <td>
                    <div>
                      <div>${escapeHtml(item.product_title)}</div>
                      ${
                        item.status === 'defected'
                          ? '<div><span class="badge-defected">Defected</span></div>'
                          : ''
                      }
                    </div>
                  </td>
                  <td>${escapeHtml(item.variant_title)}</td>
                  <td>${item.sku ? escapeHtml(item.sku) : '&mdash;'}</td>
                  <td>${item.quantity}</td>
                  <td>${formatCurrency(item.buy_price)}</td>
                  <td><span class="status-badge status-${item.status}">${escapeHtml(item.status.replace('_', ' '))}</span></td>
                  <td>${formatDate(item.date_added)}</td>
                  <td class="col-actions">
                    ${
                      canWrite
                      ? `
                          <div class="table-actions row-actions">
                            <button class="btn btn-primary btn-sm btn-sell" type="button" data-id="${item.id}" data-sell-inventory="${item.id}" ${
                              item.status === 'sold_out' || item.status === 'defected' ? 'disabled' : ''
                            }>Sell</button>
                            <button class="btn btn-ghost btn-sm btn-edit-inv" type="button" data-id="${item.id}" data-edit-inventory="${item.id}">Edit</button>
                            ${
                              item.status !== 'defected'
                                ? `<div class="action-wrap"><button class="btn btn-ghost btn-sm btn-defect" type="button" data-id="${item.id}" data-product="${escapeHtml(item.product_title)}" data-variant="${escapeHtml(item.variant_title)}" data-popover-trigger data-defect-inventory="${item.id}">&#9873; Defect</button></div>`
                                : `<button class="btn btn-ghost btn-sm btn-restore-defect" type="button" data-id="${item.id}" data-restore-defected="${item.id}">Restore</button>`
                            }
                            <button class="btn btn-ghost btn-sm btn-delete-inv" type="button" data-id="${item.id}" data-delete-inventory="${item.id}">Delete</button>
                          </div>
                        `
                        : '&mdash;'
                    }
                  </td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
    ${renderSelectedInventoryCountBar(canWrite ? selectedInventoryIds.size : 0)}
  `;
}

function renderDefectedRows(rows, canWrite) {
  const allVisibleSelected = rows.length > 0 && rows.every((item) => selectedInventoryIds.has(item.id));

  if (!rows.length) {
    return `
      <div class="empty-state-card">
        <h3>No defected inventory</h3>
        <p>Items marked as defected will appear here until they are restored back to stock.</p>
      </div>
    `;
  }

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>
            ${
              canWrite
                ? `
                  <th class="col-check">
                    <input type="checkbox" id="select-all-inv" class="row-check" title="Select all" ${allVisibleSelected ? 'checked' : ''} />
                  </th>
                `
                : ''
            }
            <th>Product</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Defected</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((item) => {
              const defectDate = item.defected_at ? formatDate(item.defected_at) : '&mdash;';
              const defectReason = item.defect_reason?.trim();

              return `
                <tr>
                  ${
                    canWrite
                      ? `
                        <td class="col-check">
                          <input type="checkbox" class="row-check inv-row-check" data-inv-id="${item.id}" ${selectedInventoryIds.has(item.id) ? 'checked' : ''} />
                        </td>
                      `
                      : ''
                  }
                  <td>
                    <div>
                      <div>${escapeHtml(item.product_title)}</div>
                      <div><span class="badge-defected">Defected</span></div>
                    </div>
                  </td>
                  <td>${escapeHtml(item.variant_title)}</td>
                  <td>${item.sku ? escapeHtml(item.sku) : '&mdash;'}</td>
                  <td>${item.quantity}</td>
                  <td class="buyer-name-cell ${defectReason ? '' : 'empty'}">
                    Defected ${defectDate}${defectReason ? ` &bull; ${escapeHtml(defectReason)}` : ''}
                  </td>
                  <td class="col-actions">
                    <button class="btn btn-ghost btn-sm btn-restore-defect" type="button" data-id="${item.id}" data-restore-defected="${item.id}">
                      Restore to Inventory
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    ${renderSelectedInventoryCountBar(canWrite ? selectedInventoryIds.size : 0)}
  `;
}

export async function renderInventoryView(container) {
  ensurePopoverDismissal();
  pruneSelectedInventoryIds();

  const canWrite = hasRole(['admin', 'manager', 'ops']);
  const counts = getTabCounts();
  const rows = getFilteredInventory();
  const defectedRows = rows.filter((item) => item.status === 'defected');

  container.innerHTML = `
    <section class="page-section inventory-view">
      <div class="page-header-block page-header-inline">
        <div>
          <p class="eyebrow">Stock On Hand</p>
          <h2>Inventory</h2>
          <p class="page-copy">Live units available for sale, manual stock corrections, and low-stock monitoring.</p>
        </div>
        <div class="toolbar-actions">
          <label class="toolbar-search">
            <span>Search</span>
            <input id="inventory-search" value="${escapeHtml(searchTerm)}" placeholder="Search product, variant, SKU" />
          </label>
          ${
            canWrite
              ? `
                <button class="button button-danger button-small" id="btn-delete-all-inv" type="button">
                  Delete All
                </button>
                <button class="button button-primary" id="inventory-add-button" type="button">Add Inventory</button>
              `
              : ''
          }
        </div>
      </div>

      ${renderInventoryTabs(counts)}

      ${
        rows.length
          ? inventoryTab === 'defected'
            ? renderDefectedRows(defectedRows, canWrite)
            : renderStandardRows(rows, canWrite)
          : `
            <div class="empty-state-card">
              <h3>No inventory found</h3>
              <p>Try another search or add a new inventory row to begin tracking stock.</p>
            </div>
          `
      }
    </section>
  `;

  $('#inventory-search', container)?.addEventListener('input', (event) => {
    searchTerm = event.target.value;
    renderInventoryView(container);
  });

  $('#inventory-add-button', container)?.addEventListener('click', () => openInventoryModal());

  $('#btn-delete-all-inv', container)?.addEventListener('click', () => {
    closeAllPopovers();

    const allIds = [...container.querySelectorAll('.inv-row-check')].map((checkbox) => checkbox.dataset.invId);
    if (!allIds.length) {
      showToast('No inventory items to delete.', 'info');
      return;
    }

    showDeleteConfirmModal({
      count: allIds.length,
      label: `ALL ${allIds.length} inventory item${allIds.length === 1 ? '' : 's'}`,
      danger: true,
      onConfirm: async () => {
        try {
          await deleteInventoryItems(allIds, state.currentUser.id);
          selectedInventoryIds.clear();
          showToast(`All ${allIds.length} items deleted.`, 'success');
          renderInventoryView(container);
        } catch (error) {
          showToast(error.message || 'Unable to delete inventory items.', 'error');
        }
      }
    });
  });

  const selectAll = $('#select-all-inv', container);
  if (selectAll) {
    selectAll.indeterminate =
      rows.some((item) => selectedInventoryIds.has(item.id)) &&
      !rows.every((item) => selectedInventoryIds.has(item.id));
  }

  $$('[data-inventory-tab]', container).forEach((button) => {
    button.addEventListener('click', () => {
      inventoryTab = button.dataset.inventoryTab;
      selectedInventoryIds.clear();
      closeAllPopovers();
      renderInventoryView(container);
    });
  });

  $('#select-all-inv', container)?.addEventListener('change', (event) => {
    const visibleIds = [...container.querySelectorAll('.inv-row-check')].map((checkbox) => checkbox.dataset.invId);

    if (event.target.checked) {
      visibleIds.forEach((inventoryId) => selectedInventoryIds.add(inventoryId));
    } else {
      visibleIds.forEach((inventoryId) => selectedInventoryIds.delete(inventoryId));
    }

    renderInventoryView(container);
  });

  $$('[data-inv-id]', container).forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedInventoryIds.add(checkbox.dataset.invId);
      } else {
        selectedInventoryIds.delete(checkbox.dataset.invId);
      }

      renderInventoryView(container);
    });
  });

  $$('[data-edit-inventory]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.inventory.find((entry) => entry.id === button.dataset.editInventory);
      if (item) {
        openInventoryModal(item);
      }
    });
  });

  $$('[data-sell-inventory]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.inventory.find((entry) => entry.id === button.dataset.sellInventory);
      if (item) {
        openSellModal(item);
      }
    });
  });

  $$('[data-defect-inventory]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.inventory.find((entry) => entry.id === button.dataset.defectInventory);
      if (item) {
        openDefectPopover(button, item);
      }
    });
  });

  $$('[data-restore-defected]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const item = state.inventory.find((entry) => entry.id === button.dataset.restoreDefected);
      if (!item) return;

      try {
        await revertDefected(item.id, state.currentUser.id);
        showToast('Item restored to inventory.', 'success');
        renderInventoryView(container);
      } catch (error) {
        showToast(error.message || 'Unable to restore defected item.', 'error');
      }
    });
  });

  $$('[data-delete-inventory]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const item = state.inventory.find((entry) => entry.id === button.dataset.deleteInventory);
      if (!item) return;

      const confirmed = await confirmModal({
        title: 'Delete Inventory Item',
        body: `<p>Delete <strong>${escapeHtml(item.product_title)}</strong> (${escapeHtml(item.variant_title)})?</p>`,
        confirmLabel: 'Delete Item',
        tone: 'danger'
      });

      if (!confirmed) return;

      try {
        await deleteInventoryItem(item.id, state.currentUser.id);
        showToast('Inventory item deleted.', 'success');
        renderInventoryView(container);
      } catch (error) {
        showToast(error.message || 'Unable to delete inventory item.', 'error');
      }
    });
  });

  $('#delete-selected-inv', container)?.addEventListener('click', () => {
    const selectedIds = [...selectedInventoryIds];
    if (!selectedIds.length) {
      showToast('Select one or more inventory items first.', 'warning');
      return;
    }

    showDeleteConfirmModal({
      count: selectedIds.length,
      label: `${selectedIds.length} selected item${selectedIds.length === 1 ? '' : 's'}`,
      onConfirm: async () => {
        try {
          await deleteInventoryItems(selectedIds, state.currentUser.id);
          selectedInventoryIds.clear();
          showToast(`${selectedIds.length} items deleted.`, 'success');
          renderInventoryView(container);
        } catch (error) {
          showToast(error.message || 'Unable to delete inventory items.', 'error');
        }
      }
    });
  });

  $('#clear-selected-inv', container)?.addEventListener('click', () => {
    selectedInventoryIds.clear();
    closeAllPopovers();
    renderInventoryView(container);
  });

  return {
    shortcutNew: canWrite ? () => openInventoryModal() : null
  };
}
