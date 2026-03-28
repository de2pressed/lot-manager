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
  repushLot,
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

function getRemainingCapacity(lot) {
  return Math.max(0, Number(lot.max_items || 0) - getLotTotal(lot));
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

function openLegacyLotItemModal(lot, existingItem = null) {
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

function openStagedLotItemModal(lot) {
  if (!state.products.length) {
    showToast('Sync or add products before adding lot items.', 'warning');
    return;
  }

  const body = document.createElement('div');
  const footer = document.createElement('div');
  const remainingCapacity = getRemainingCapacity(lot);

  body.innerHTML = `
    <form class="modal-form" id="lot-item-form">
      <div class="modal-meta">
        Remaining capacity: <span class="capacity-count" id="lot-capacity-count">${remainingCapacity}</span>
      </div>
      <div class="field-group">
        <label class="field-label" for="lot-product-select">Product</label>
        <select id="lot-product-select">
          <option value="">Select a product...</option>
          ${state.products
            .map(
              (product) => `
                <option value="${product.id}">
                  ${escapeHtml(product.title)}
                </option>
              `
            )
            .join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label" for="lot-buy-price">Buy Price</label>
        <input id="lot-buy-price" type="number" min="0" step="0.01" placeholder="0.00" value="" />
      </div>
      <div id="variant-list" class="variant-list" hidden>
        <div class="field-label" style="margin-bottom:10px">Variants - tap + to stage</div>
        <div id="variant-rows" class="variant-rows"></div>
      </div>
      <div id="staged-wrap" class="staged-wrap" hidden>
        <div class="field-label" style="margin-bottom:10px">Staged items</div>
        <div id="staged-list" class="staged-list"></div>
      </div>
    </form>
  `;

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" id="confirm-add-lot" type="button" disabled>Add to Lot</button>
  `;

  openModal({
    title: 'Add Lot Item',
    description: 'Pick a product, stage one or more variants, then add them together.',
    className: 'modal-lot-add',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      const staged = new Map();
      const productSelect = $('#lot-product-select', bodyTarget);
      const variantList = $('#variant-list', bodyTarget);
      const variantRows = $('#variant-rows', bodyTarget);
      const stagedWrap = $('#staged-wrap', bodyTarget);
      const stagedList = $('#staged-list', bodyTarget);
      const capacityCount = $('#lot-capacity-count', bodyTarget);
      const buyPriceInput = $('#lot-buy-price', bodyTarget);
      const confirmButton = $('#confirm-add-lot', footer);

      const stagedUnits = () => Array.from(staged.values()).reduce((total, item) => total + item.qty, 0);
      const capacityLeft = () => Math.max(0, remainingCapacity - stagedUnits());
      const variantKeyFor = (product, variant) => String(variant.id ?? `${product.id}::${buildVariantTitle(variant)}`);

      const shakeStepper = (vid) => {
        const incBtn = Array.from(bodyTarget.querySelectorAll('.stepper-inc')).find(
          (button) => button.dataset.variantId === vid
        );

        if (!incBtn) return;

        incBtn.classList.remove('btn-shake');
        void incBtn.offsetWidth;
        incBtn.classList.add('btn-shake');
        setTimeout(() => incBtn.classList.remove('btn-shake'), 380);
      };

      const updateVariantStepper = (vid) => {
        const qty = staged.has(vid) ? staged.get(vid).qty : 0;
        const stepper = Array.from(bodyTarget.querySelectorAll('.variant-stepper')).find(
          (node) => node.dataset.variantId === vid
        );
        if (!stepper) return;

        const dec = stepper.querySelector('.stepper-dec');
        const count = stepper.querySelector('.stepper-count');
        const inc = stepper.querySelector('.stepper-inc');

        if (qty === 0) {
          dec.classList.add('stepper-hidden');
          count.classList.add('stepper-hidden');
          inc.classList.remove('stepper-active');
          count.textContent = '';
        } else {
          dec.classList.remove('stepper-hidden');
          count.classList.remove('stepper-hidden');
          inc.classList.add('stepper-active');
          count.textContent = qty;
        }
      };

      const renderVariantRow = (variant, product, stagedQty) => {
        const vid = variantKeyFor(product, variant);
        return `
          <div class="variant-row" data-variant-id="${vid}">
            <div class="variant-info">
              <span class="variant-title">${escapeHtml(buildVariantTitle(variant))}</span>
              ${variant.sku ? `<span class="variant-sku">${escapeHtml(variant.sku)}</span>` : ''}
            </div>
            <div class="variant-stepper" data-variant-id="${vid}">
              <button
                class="stepper-btn stepper-dec ${stagedQty === 0 ? 'stepper-hidden' : ''}"
                type="button"
                data-action="dec"
                data-variant-id="${vid}"
              >−</button>
              <span class="stepper-count ${stagedQty === 0 ? 'stepper-hidden' : ''}">
                ${stagedQty || ''}
              </span>
              <button
                class="stepper-btn stepper-inc ${stagedQty > 0 ? 'stepper-active' : ''}"
                type="button"
                data-action="inc"
                data-variant-id="${vid}"
                data-variant-real-id="${variant.id ?? ''}"
                data-variant-title="${escapeHtml(buildVariantTitle(variant))}"
                data-product-title="${escapeHtml(product.title)}"
                data-product-id="${product.id}"
                data-sku="${escapeHtml(variant.sku || '')}"
                data-color="${escapeHtml(variant.color || '')}"
                data-size="${escapeHtml(variant.size || '')}"
                data-shopify-product-id="${escapeHtml(product.shopify_product_id || '')}"
              >+</button>
            </div>
          </div>
        `;
      };

      const renderVariants = (productId) => {
        const product = state.products.find((entry) => entry.id === productId);
        if (!product) {
          variantList.hidden = true;
          variantRows.innerHTML = '';
          return;
        }

        const variants = getProductVariants(product);
        variantRows.innerHTML = variants
          .map((variant) => renderVariantRow(variant, product, staged.get(variantKeyFor(product, variant))?.qty ?? 0))
          .join('');
        variantList.hidden = false;
      };

      const renderStaged = () => {
        if (!staged.size) {
          stagedWrap.style.display = 'none';
          stagedWrap.hidden = true;
          confirmButton.disabled = true;
          confirmButton.textContent = 'Add to Lot';
          capacityCount.textContent = `${capacityLeft()}`;
          return;
        }

        stagedWrap.hidden = false;
        stagedWrap.style.display = 'block';
        confirmButton.disabled = false;

        const totalQty = Array.from(staged.values()).reduce((sum, item) => sum + item.qty, 0);
        confirmButton.textContent = `Add ${totalQty} item${totalQty !== 1 ? 's' : ''} to Lot`;
        capacityCount.textContent = `${capacityLeft()}`;

        stagedList.innerHTML = [...staged.entries()]
          .map(
            ([vid, item]) => `
              <div class="staged-row" data-vid="${vid}">
                <div class="staged-info">
                  <span class="staged-product">${escapeHtml(item.productTitle)}</span>
                  <span class="staged-variant">${escapeHtml(item.variantTitle)}</span>
                </div>
                <div class="staged-right">
                  <span class="staged-qty">× ${item.qty}</span>
                  <button class="staged-remove" type="button" data-vid="${vid}" title="Remove">✕</button>
                </div>
              </div>
            `
          )
          .join('');
      };

      const syncCapacity = () => {
        capacityCount.textContent = `${capacityLeft()}`;
      };

      productSelect.addEventListener('change', () => {
        if (productSelect.value) {
          renderVariants(productSelect.value);
        } else {
          variantList.hidden = true;
          variantRows.innerHTML = '';
        }
      });

      bodyTarget.addEventListener('click', async (event) => {
        const stepperBtn = event.target.closest('.stepper-btn');
        if (stepperBtn) {
          const action = stepperBtn.dataset.action;
          const vid = stepperBtn.dataset.variantId;
          const existing = staged.get(vid);

          if (action === 'inc') {
            if (!existing && capacityLeft() <= 0) {
              showToast('This lot is at capacity.', 'warning');
              return;
            }

            if (existing) {
              if (capacityLeft() <= 0) {
                showToast('This lot is at capacity.', 'warning');
                return;
              }

              existing.qty += 1;
            } else {
              staged.set(vid, {
                variantId: stepperBtn.dataset.variantRealId || null,
                variantTitle: stepperBtn.dataset.variantTitle,
                productTitle: stepperBtn.dataset.productTitle,
                productId: stepperBtn.dataset.productId,
                shopifyProductId: stepperBtn.dataset.shopifyProductId || null,
                sku: stepperBtn.dataset.sku || null,
                color: stepperBtn.dataset.color || null,
                size: stepperBtn.dataset.size || null,
                qty: 1,
                buyPrice: Number(buyPriceInput.value || 0)
              });
            }
          }

          if (action === 'dec') {
            if (!existing) return;

            existing.qty -= 1;
            if (existing.qty <= 0) {
              staged.delete(vid);
            }
          }

          shakeStepper(vid);
          updateVariantStepper(vid);
          renderStaged();
          return;
        }

        const removeButton = event.target.closest('.staged-remove');
        if (removeButton) {
          const vid = removeButton.dataset.vid;
          if (!vid || !staged.has(vid)) return;

          staged.delete(vid);
          updateVariantStepper(vid);
          renderStaged();
        }
      });

      footer.addEventListener('click', async (event) => {
        const confirmAdd = event.target.closest('#confirm-add-lot');
        if (!confirmAdd || !staged.size) return;

        try {
          const items = [...staged.values()];
          await Promise.all(
            items.map((item) =>
              addLotItem(
                {
                  lot_id: lot.id,
                  product_id: item.productId,
                  shopify_product_id: item.shopifyProductId || null,
                  product_title: item.productTitle,
                  variant_title: item.variantTitle,
                  variant_id: item.variantId,
                  color: item.color,
                  size: item.size,
                  sku: item.sku,
                  qty: item.qty,
                  buy_price: Number(buyPriceInput.value || item.buyPrice || 0)
                },
                state.currentUser.id
              )
            )
          );

          showToast(
            `${items.length} variant${items.length === 1 ? '' : 's'} added to lot.`,
            'success'
          );
          close('saved');
          renderLotsView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to add lot items.', 'error');
        }
      });

      productSelect.addEventListener('change', syncCapacity);
      buyPriceInput.addEventListener('input', syncCapacity);
      renderStaged();
    }
  });
}

function openLotItemModal(lot, existingItem = null) {
  if (existingItem) {
    openLegacyLotItemModal(lot, existingItem);
    return;
  }

  openStagedLotItemModal(lot);
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
      backgroundColor: '#080808',
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
  const canRepush = hasRole(['admin', 'manager']) && lot.status === 'pushed';

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
          canRepush
            ? `
              <button
                class="button button-secondary button-small btn-repush"
                type="button"
                data-repush-lot="${lot.id}"
                data-lot-id="${lot.id}"
                data-lot-name="${escapeHtml(lot.name)}"
                data-lot-items="${lot.lot_items?.length ?? 0}"
              >
                ↺ Repush
              </button>
            `
            : canPush
              ? `
                <button
                  class="button button-primary button-small"
                  type="button"
                  data-push-lot="${lot.id}"
                >
                  Push to Inventory
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

  $$('[data-repush-lot]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const lot = state.lots.find((entry) => entry.id === button.dataset.repushLot);
      if (!lot) return;

      const itemCount = Number(button.dataset.lotItems || lot.lot_items?.length || 0);

      const confirmed = await confirmModal({
        title: `Repush "${escapeHtml(lot.name)}"?`,
        body: `
          <p>This will add <strong>${itemCount}</strong> variant${itemCount === 1 ? '' : 's'} on top of existing inventory quantities.</p>
          <p>Repush is additive. It does not reset or replace existing stock.</p>
        `,
        confirmLabel: 'Repush to Inventory',
        tone: 'primary'
      });

      if (!confirmed) return;

      try {
        const result = await repushLot(lot.id, state.currentUser.id);
        showToast(`Lot repushed - ${result.pushed} variants added to inventory.`, 'success');
        renderLotsView(container);
      } catch (error) {
        showToast(error.message || 'Unable to repush lot.', 'error');
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
