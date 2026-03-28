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
import { SALE_PLATFORMS } from '../utils/constants.js';
import { buildVariantTitle, findVariant, getProductVariants } from '../utils/products.js';
import { confirmModal, openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import {
  createInventoryItem,
  deleteInventoryItem,
  updateInventoryItem
} from '../services/inventory.service.js';
import { recordSale } from '../services/sales.service.js';

let searchTerm = '';

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

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="inventory-sell-form">Record Sale</button>
  `;

  openModal({
    title: 'Sell Inventory Item',
    description: 'This will immediately reduce the current stock count.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      $('#inventory-sell-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          await recordSale(
            {
              inventoryId: item.id,
              salePrice: Number($('#inventory-sell-price', bodyTarget).value),
              qtySold: Number($('#inventory-sell-qty', bodyTarget).value),
              platform: $('#inventory-sell-platform', bodyTarget).value,
              dateSold: inputDateToIso($('#inventory-sell-date', bodyTarget).value),
              notes: $('#inventory-sell-notes', bodyTarget).value.trim()
            },
            state.currentUser.id
          );

          close('saved');
          showToast('Sale recorded.', 'success');
          renderInventoryView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to record sale.', 'error');
        }
      });
    }
  });
}

export async function renderInventoryView(container) {
  const canWrite = hasRole(['admin', 'manager']);
  const rows = state.inventory.filter((item) => {
    const haystack = `${item.product_title} ${item.variant_title} ${item.sku || ''} ${item.status || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  container.innerHTML = `
    <section class="page-section">
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
          ${canWrite ? '<button class="button button-primary" id="inventory-add-button" type="button">Add Inventory</button>' : ''}
        </div>
      </div>

      ${
        rows.length
          ? `
            <div class="table-card">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>Buy</th>
                    <th>Status</th>
                    <th>Date Added</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(
                      (item) => `
                        <tr>
                          <td>${escapeHtml(item.product_title)}</td>
                          <td>${escapeHtml(item.variant_title)}</td>
                          <td>${escapeHtml(item.sku || '—')}</td>
                          <td>${item.quantity}</td>
                          <td>${formatCurrency(item.buy_price)}</td>
                          <td><span class="status-badge status-${item.status}">${escapeHtml(item.status.replace('_', ' '))}</span></td>
                          <td>${formatDate(item.date_added)}</td>
                          <td>
                            ${
                              canWrite
                                ? `
                                  <div class="table-actions">
                                    <button class="button button-ghost button-small" type="button" data-edit-inventory="${item.id}">Edit</button>
                                    <button class="button button-ghost button-small" type="button" data-sell-inventory="${item.id}" ${
                                      item.status === 'sold_out' ? 'disabled' : ''
                                    }>Sell</button>
                                    <button class="button button-danger button-small" type="button" data-delete-inventory="${item.id}">Delete</button>
                                  </div>
                                `
                                : '—'
                            }
                          </td>
                        </tr>
                      `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `
          : `
            <div class="empty-state-card">
              <h3>No inventory yet</h3>
              <p>Push a lot or add a manual inventory row to start tracking stock.</p>
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

  return {
    shortcutNew: canWrite ? () => openInventoryModal() : null
  };
}
