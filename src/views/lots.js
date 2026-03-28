import { state } from '../state.js';
import { hasRole } from '../utils/access.js';
import { $, $$ } from '../utils/dom.js';
import {
  downloadBlob,
  escapeHtml,
  formatCurrency,
  formatDate,
  slugify
} from '../utils/format.js';
import { buildVariantTitle, findVariant, getProductVariants } from '../utils/products.js';
import { confirmModal, openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import {
  addLotItem,
  createLot,
  deleteLot,
  deleteLotItem,
  pushLotToInventory,
  updateLotItem
} from '../services/lots.service.js';

function getLotTotal(lot) {
  return (lot.lot_items || []).reduce((total, item) => total + Number(item.qty || 0), 0);
}

function getDisplayedLotStatus(lot) {
  if (lot.status === 'pushed') return 'pushed';
  return getLotTotal(lot) >= Number(lot.max_items || 0) ? 'full' : 'open';
}

function buildLotItemPayload(lot, product, variant, bodyTarget, existingItem = null) {
  const qty = Number($('#lot-item-qty', bodyTarget).value);
  const buyPrice = Number($('#lot-item-buy-price', bodyTarget).value || 0);
  const variantTitle = buildVariantTitle(variant);

  const currentTotal = getLotTotal(lot);
  const availableCapacity = existingItem
    ? currentTotal - Number(existingItem.qty || 0)
    : currentTotal;

  if (availableCapacity + qty > Number(lot.max_items || 0)) {
    throw new Error('This exceeds the lot capacity.');
  }

  return {
    lot_id: lot.id,
    product_id: product.id,
    shopify_product_id: product.shopify_product_id,
    product_title: product.title,
    variant_title: variantTitle,
    variant_id: variant.id ? String(variant.id) : null,
    color: variant.color || null,
    size: variant.size || null,
    sku: variant.sku || null,
    qty,
    buy_price: buyPrice
  };
}

function openCreateLotModal() {
  const body = document.createElement('div');
  const footer = document.createElement('div');

  body.innerHTML = `
    <form class="modal-form" id="lot-form">
      <div class="field-grid">
        <label class="field full">
          <span>Lot Name</span>
          <input id="lot-name" placeholder="Spring drop batch 01" required />
        </label>
        <label class="field">
          <span>Max Items</span>
          <input id="lot-capacity" type="number" min="1" value="100" required />
        </label>
      </div>
    </form>
  `;

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="lot-form">Create Lot</button>
  `;

  openModal({
    title: 'Create Lot',
    description: 'Lots start open and become full automatically when capacity is reached.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      $('#lot-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          await createLot(
            {
              name: $('#lot-name', bodyTarget).value.trim(),
              max_items: Number($('#lot-capacity', bodyTarget).value)
            },
            state.currentUser.id
          );

          close('saved');
          showToast('Lot created.', 'success');
          renderLotsView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to create lot.', 'error');
        }
      });
    }
  });
}

function openLotItemModal(lot, existingItem = null) {
  if (!state.products.length) {
    showToast('Sync or add products before adding lot items.', 'warning');
    return;
  }

  const initialProduct =
    state.products.find((product) => product.id === existingItem?.product_id) ?? state.products[0];
  const initialVariant =
    findVariant(initialProduct, existingItem?.variant_title) ?? getProductVariants(initialProduct)[0];

  const body = document.createElement('div');
  const footer = document.createElement('div');

  body.innerHTML = `
    <form class="modal-form" id="lot-item-form">
      <div class="field-grid">
        <label class="field full">
          <span>Product</span>
          <select id="lot-item-product">
            ${state.products
              .map(
                (product) => `
                  <option value="${product.id}" ${product.id === initialProduct.id ? 'selected' : ''}>
                    ${escapeHtml(product.title)}
                  </option>
                `
              )
              .join('')}
          </select>
        </label>
        <label class="field full">
          <span>Variant</span>
          <select id="lot-item-variant"></select>
        </label>
        <label class="field">
          <span>Quantity</span>
          <input id="lot-item-qty" type="number" min="1" value="${existingItem?.qty || 1}" required />
        </label>
        <label class="field">
          <span>Buy Price</span>
          <input id="lot-item-buy-price" type="number" min="0" step="0.01" value="${existingItem?.buy_price || ''}" />
        </label>
      </div>
    </form>
  `;

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="lot-item-form">${existingItem ? 'Update Item' : 'Add Item'}</button>
  `;

  openModal({
    title: existingItem ? 'Edit Lot Item' : 'Add Lot Item',
    description: `Remaining capacity: ${Math.max(0, Number(lot.max_items || 0) - getLotTotal(lot))}`,
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      const productSelect = $('#lot-item-product', bodyTarget);
      const variantSelect = $('#lot-item-variant', bodyTarget);

      const syncVariants = () => {
        const product = state.products.find((entry) => entry.id === productSelect.value) ?? initialProduct;
        const variants = getProductVariants(product);
        variantSelect.innerHTML = variants
          .map(
            (variant) => `
              <option value="${escapeHtml(buildVariantTitle(variant))}">
                ${escapeHtml(buildVariantTitle(variant))}
              </option>
            `
          )
          .join('');

        variantSelect.value = buildVariantTitle(
          product.id === initialProduct.id ? initialVariant : variants[0]
        );
      };

      syncVariants();
      productSelect.addEventListener('change', syncVariants);

      $('#lot-item-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          const product =
            state.products.find((entry) => entry.id === productSelect.value) ?? initialProduct;
          const variant = findVariant(product, variantSelect.value) ?? getProductVariants(product)[0];
          const payload = buildLotItemPayload(lot, product, variant, bodyTarget, existingItem);

          if (existingItem) {
            await updateLotItem(existingItem.id, payload, state.currentUser.id);
            showToast('Lot item updated.', 'success');
          } else {
            await addLotItem(payload, state.currentUser.id);
            showToast('Lot item added.', 'success');
          }

          close('saved');
          renderLotsView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to save lot item.', 'error');
        }
      });
    }
  });
}

async function exportLotSummary(lot) {
  if (typeof window.html2canvas === 'undefined') {
    showToast('html2canvas is not available in this session.', 'error');
    return;
  }

  const grouped = new Map();
  (lot.lot_items || []).forEach((item) => {
    const key = item.product_title;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  });

  const node = document.createElement('div');
  node.className = 'export-sheet';
  node.innerHTML = `
    <div class="export-sheet-card">
      <div class="export-sheet-head">
        <p>Raptile Studio</p>
        <h2>${escapeHtml(lot.name)}</h2>
        <span>${formatDate(new Date())}</span>
      </div>
      <div class="export-sheet-summary">
        <div><span>Total Items</span><strong>${getLotTotal(lot)}</strong></div>
        <div><span>Capacity</span><strong>${lot.max_items}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(getDisplayedLotStatus(lot))}</strong></div>
      </div>
      ${Array.from(grouped.entries())
        .map(
          ([productTitle, items]) => `
            <section class="export-sheet-group">
              <h3>${escapeHtml(productTitle)}</h3>
              ${items
                .map(
                  (item) => `
                    <div class="export-sheet-row">
                      <span>${escapeHtml(item.variant_title)}</span>
                      <strong>${item.qty}</strong>
                    </div>
                  `
                )
                .join('')}
            </section>
          `
        )
        .join('')}
    </div>
  `;

  node.style.position = 'fixed';
  node.style.left = '-9999px';
  node.style.top = '0';
  document.body.append(node);

  try {
    const canvas = await window.html2canvas(node, {
      backgroundColor: '#0a0a0a',
      scale: 2
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create PNG export.');

    downloadBlob(blob, `lot-${slugify(lot.name)}-${new Date().toISOString().slice(0, 10)}.png`);
    showToast('Lot summary exported.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to export lot summary.', 'error');
  } finally {
    node.remove();
  }
}

function renderLotCard(lot) {
  const total = getLotTotal(lot);
  const progress = Math.min(100, (total / Number(lot.max_items || 1)) * 100);
  const displayedStatus = getDisplayedLotStatus(lot);
  const canWrite = hasRole(['admin', 'manager', 'ops']) && lot.status !== 'pushed';
  const canPush = hasRole(['admin', 'manager']) && total > 0;

  return `
    <article class="lot-card">
      <div class="card-row-between">
        <div>
          <h3>${escapeHtml(lot.name)}</h3>
          <p class="muted-copy">${total} / ${lot.max_items} items</p>
        </div>
        <span class="status-badge status-${displayedStatus}">${escapeHtml(displayedStatus)}</span>
      </div>
      <div class="lot-progress">
        <div class="lot-progress-bar"><span style="width:${progress}%"></span></div>
      </div>
      <div class="lot-items-list">
        ${
          lot.lot_items?.length
            ? lot.lot_items
                .map(
                  (item) => `
                    <div class="lot-item-row">
                      <div>
                        <strong>${escapeHtml(item.product_title)}</strong>
                        <span>${escapeHtml(item.variant_title)}</span>
                      </div>
                      <div class="lot-item-meta">
                        <span>${item.qty} pcs</span>
                        <span>${formatCurrency(item.buy_price || 0)}</span>
                        ${
                          canWrite
                            ? `
                              <button class="button button-ghost button-small" type="button" data-edit-lot-item="${item.id}" data-lot-id="${lot.id}">Edit</button>
                              <button class="button button-ghost button-small" type="button" data-delete-lot-item="${item.id}" data-lot-id="${lot.id}">Remove</button>
                            `
                            : ''
                        }
                      </div>
                    </div>
                  `
                )
                .join('')
            : '<p class="muted-copy">No items added yet.</p>'
        }
      </div>
      <div class="card-actions">
        ${
          canWrite
            ? `<button class="button button-primary button-small" type="button" data-add-lot-item="${lot.id}">Add Item</button>`
            : ''
        }
        <button class="button button-secondary button-small" type="button" data-export-lot="${lot.id}">Export PNG</button>
        ${
          canPush
            ? `
              <button
                class="button ${lot.status === 'pushed' ? 'button-secondary' : 'button-primary'} button-small"
                type="button"
                data-push-lot="${lot.id}"
                ${lot.status === 'pushed' ? 'disabled' : ''}
              >
                ${lot.status === 'pushed' ? 'Already Pushed' : 'Push to Inventory'}
              </button>
            `
            : hasRole(['admin', 'manager'])
              ? '<button class="button button-secondary button-small" type="button" disabled>Empty Lot</button>'
              : ''
        }
        ${
          canWrite
            ? `<button class="button button-danger button-small" type="button" data-delete-lot="${lot.id}">Delete</button>`
            : ''
        }
      </div>
    </article>
  `;
}

export async function renderLotsView(container) {
  const canWriteLots = hasRole(['admin', 'manager', 'ops']);

  container.innerHTML = `
    <section class="page-section">
      <div class="page-header-block page-header-inline">
        <div>
          <p class="eyebrow">Production Lots</p>
          <h2>Lots</h2>
          <p class="page-copy">Build batches, track capacity, and push merged stock into live inventory.</p>
        </div>
        ${canWriteLots ? '<button class="button button-primary" id="create-lot-button" type="button">Create Lot</button>' : ''}
      </div>

      ${
        state.lots.length
          ? `<div class="lot-grid">${state.lots.map(renderLotCard).join('')}</div>`
          : `
            <div class="empty-state-card">
              <h3>No lots yet</h3>
              <p>Create your first lot to start grouping incoming units before they hit inventory.</p>
            </div>
          `
      }
    </section>
  `;

  $('#create-lot-button', container)?.addEventListener('click', openCreateLotModal);

  $$('[data-add-lot-item]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.addLotItem);
      if (lot) {
        openLotItemModal(lot);
      }
    });
  });

  $$('[data-edit-lot-item]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.lotId);
      const item = lot?.lot_items?.find((entry) => entry.id === button.dataset.editLotItem);
      if (lot && item) {
        openLotItemModal(lot, item);
      }
    });
  });

  $$('[data-delete-lot-item]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.lotId);
      const item = lot?.lot_items?.find((entry) => entry.id === button.dataset.deleteLotItem);
      if (!item) return;

      const confirmed = await confirmModal({
        title: 'Remove Lot Item',
        body: `<p>Remove <strong>${escapeHtml(item.product_title)}</strong> (${escapeHtml(item.variant_title)}) from this lot?</p>`,
        confirmLabel: 'Remove',
        tone: 'danger'
      });

      if (!confirmed) return;

      try {
        await deleteLotItem(item.id, state.currentUser.id);
        showToast('Lot item removed.', 'success');
        renderLotsView(container);
      } catch (error) {
        showToast(error.message || 'Unable to remove lot item.', 'error');
      }
    });
  });

  $$('[data-delete-lot]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.deleteLot);
      if (!lot) return;

      const confirmed = await confirmModal({
        title: 'Delete Lot',
        body: `<p>Delete <strong>${escapeHtml(lot.name)}</strong> and all of its lot items?</p>`,
        confirmLabel: 'Delete Lot',
        tone: 'danger'
      });

      if (!confirmed) return;

      try {
        await deleteLot(lot.id, state.currentUser.id);
        showToast('Lot deleted.', 'success');
        renderLotsView(container);
      } catch (error) {
        showToast(error.message || 'Unable to delete lot.', 'error');
      }
    });
  });

  $$('[data-push-lot]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.pushLot);
      if (!lot || lot.status === 'pushed') return;

      const confirmed = await confirmModal({
        title: 'Push Lot to Inventory',
        body: `<p>This action is irreversible from the UI. Push <strong>${escapeHtml(lot.name)}</strong> into inventory now?</p>`,
        confirmLabel: 'Push Lot',
        tone: 'primary'
      });

      if (!confirmed) return;

      try {
        const result = await pushLotToInventory(lot.id, state.currentUser.id);
        showToast(`Pushed ${result.pushed} inventory rows.`, 'success');
        renderLotsView(container);
      } catch (error) {
        showToast(error.message || 'Unable to push lot.', 'error');
      }
    });
  });

  $$('[data-export-lot]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.exportLot);
      if (lot) {
        exportLotSummary(lot);
      }
    });
  });

  return {
    shortcutNew: canWriteLots ? openCreateLotModal : null
  };
}
