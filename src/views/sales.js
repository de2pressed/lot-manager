import { state } from '../state.js';
import { hasRole } from '../utils/access.js';
import { $, $$ } from '../utils/dom.js';
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  toInputDate,
  inputDateToIso
} from '../utils/format.js';
import { SALE_PLATFORMS } from '../utils/constants.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { recordSale, revertSales } from '../services/sales.service.js';

let salesTab = 'to_sell';
let searchTerm = '';
const selectedSaleIds = new Set();
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

function pruneSelectedSaleIds() {
  const visibleIds = new Set(state.sales.map((sale) => sale.id));

  for (const saleId of [...selectedSaleIds]) {
    if (!visibleIds.has(saleId)) {
      selectedSaleIds.delete(saleId);
    }
  }
}

function getSellableInventory() {
  return state.inventory.filter(
    (item) => Number(item.quantity || 0) > 0 && item.status !== 'sold_out' && item.status !== 'defected'
  );
}

function openSellModal(item) {
  const body = document.createElement('div');
  const footer = document.createElement('div');
  const cancelButton = document.createElement('button');
  const submitButton = document.createElement('button');

  body.innerHTML = `
    <form class="modal-form" id="sell-form">
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
          <input id="sell-qty" type="number" min="1" max="${item.quantity}" value="1" required />
        </label>
        <label class="field">
          <span>Sale Price (per unit)</span>
          <input id="sell-price" type="number" min="0" step="0.01" required />
        </label>
        <label class="field">
          <span>Platform</span>
          <select id="sell-platform">
            ${SALE_PLATFORMS.map((platform) => `<option value="${platform}">${platform}</option>`).join('')}
          </select>
        </label>
        <label class="field full">
          <span>
            Buyer Name
            <span class="field-optional">optional</span>
          </span>
          <input id="sell-buyer-name" autocomplete="off" placeholder="e.g. Rahul S." />
        </label>
        <label class="field">
          <span>Date Sold</span>
          <input id="sell-date" type="date" value="${toInputDate()}" required />
        </label>
        <label class="field full">
          <span>Notes</span>
          <textarea id="sell-notes" placeholder="Optional sale notes"></textarea>
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
    title: 'Record Sale',
    description: 'This will reduce stock immediately.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      const form = $('#sell-form', bodyTarget);

      const handleSubmit = async () => {
        try {
          const qtySold = Number($('#sell-qty', bodyTarget).value);
          const salePrice = Number($('#sell-price', bodyTarget).value);
          const dateValue = $('#sell-date', bodyTarget).value;

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
              platform: $('#sell-platform', bodyTarget).value,
              dateSold: inputDateToIso(dateValue),
              notes: $('#sell-notes', bodyTarget).value.trim(),
              buyerName: $('#sell-buyer-name', bodyTarget).value.trim()
            },
            state.currentUser.id
          );

          close('saved');
          showToast('Sale recorded successfully.', 'success');
          renderSalesView(document.getElementById('view-root'));
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

function openRevertPopover(trigger, sale) {
  closeAllPopovers();

  const wrap = trigger.closest('.action-wrap');
  if (!wrap) return;

  const popover = document.createElement('div');
  popover.className = 'inline-popover';
  popover.dataset.salePopover = sale.id;
  popover.innerHTML = `
    <div class="popover-title">Revert this sale?</div>
    <div class="popover-desc">Stock will be restored and the sale will be removed from the ledger.</div>
    <div class="popover-actions">
      <button class="button button-secondary button-small" type="button" data-sale-revert-cancel>Cancel</button>
      <button class="button button-danger button-small" type="button" data-sale-revert-confirm>Revert</button>
    </div>
  `;

  popover.addEventListener('click', async (event) => {
    if (event.target.closest('[data-sale-revert-cancel]')) {
      popover.remove();
      return;
    }

    if (!event.target.closest('[data-sale-revert-confirm]')) {
      return;
    }

    try {
      const revertedCount = await revertSales([sale.id], state.currentUser.id);
      popover.remove();
      showToast(revertedCount ? 'Sale reverted.' : 'No sale was reverted.', 'success');
      renderSalesView(document.getElementById('view-root'));
    } catch (error) {
      showToast(error.message || 'Unable to revert sale.', 'error');
    }
  });

  wrap.append(popover);
}

function renderToSellRows() {
  const inventory = getSellableInventory().filter((item) => {
    const haystack = `${item.product_title} ${item.variant_title} ${item.sku || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  if (!inventory.length) {
    return `
      <div class="empty-state-card">
        <h3>No sellable inventory</h3>
        <p>Stock added in Inventory will appear here for quick sale capture.</p>
      </div>
    `;
  }

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Variant</th>
            <th>Qty</th>
            <th>Buy</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${inventory
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.product_title)}</td>
                  <td>${escapeHtml(item.variant_title)}</td>
                  <td>${item.quantity}</td>
                  <td>${formatCurrency(item.buy_price)}</td>
                  <td><span class="status-badge status-${item.status}">${escapeHtml(item.status.replace('_', ' '))}</span></td>
                  <td>
                    ${
                      hasRole(['admin', 'manager'])
                        ? `<button class="button button-ghost button-small" data-sell-id="${item.id}">Sell</button>`
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
  `;
}

function buildSelectedSales(selectedIds) {
  return state.sales.filter((sale) => selectedIds.has(sale.id));
}

function renderSelectedCountBar(selectedCount) {
  if (!selectedCount) return '';

  return `
    <div class="batch-bar">
      <div class="batch-bar-label">${selectedCount} sale${selectedCount === 1 ? '' : 's'} selected</div>
      <div class="batch-bar-actions">
        <button class="button button-danger button-small" type="button" id="revert-selected-sales">Revert Selected</button>
        <button class="button button-secondary button-small" type="button" id="clear-selected-sales">Clear</button>
      </div>
    </div>
  `;
}

function renderSoldRows() {
  pruneSelectedSaleIds();

  const sales = state.sales.filter((sale) => {
    const haystack = `${sale.product_title} ${sale.variant_title} ${sale.platform || ''} ${sale.buyer_name || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  if (!sales.length) {
    return `
      <div class="empty-state-card">
        <h3>No sales recorded</h3>
        <p>Use the sell action from Inventory or the To Sell tab to start logging revenue.</p>
      </div>
    `;
  }

  const allVisibleSelected = sales.length > 0 && sales.every((sale) => selectedSaleIds.has(sale.id));

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-check">
              <input
                type="checkbox"
                class="row-check"
                id="select-all-sold"
                data-sale-select-all
                ${allVisibleSelected ? 'checked' : ''}
              />
            </th>
            <th>Date</th>
            <th>Product</th>
            <th>Variant</th>
            <th>Buyer</th>
            <th>Qty</th>
            <th>Platform</th>
            <th>Buy</th>
            <th>Sale</th>
            <th>Profit</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${sales
            .map((sale) => {
              const profit =
                (Number(sale.sale_price || 0) - Number(sale.buy_price || 0)) *
                Number(sale.qty_sold || 0);
              const buyerName = sale.buyer_name?.trim();

              return `
                <tr>
                  <td class="col-check">
                    <input
                      type="checkbox"
                      class="row-check sold-row-check"
                      data-sale-id="${sale.id}"
                      data-sale-select="${sale.id}"
                      ${selectedSaleIds.has(sale.id) ? 'checked' : ''}
                    />
                  </td>
                  <td>${formatDate(sale.date_sold)}</td>
                  <td>${escapeHtml(sale.product_title)}</td>
                  <td>${escapeHtml(sale.variant_title)}</td>
                  ${
                    buyerName
                      ? `<td class="buyer-name-cell">${escapeHtml(buyerName)}</td>`
                      : '<td class="buyer-name-cell empty">&mdash;</td>'
                  }
                  <td>${sale.qty_sold}</td>
                  <td>${escapeHtml(sale.platform || 'Direct')}</td>
                  <td>${formatCurrency(sale.buy_price)}</td>
                  <td>${formatCurrency(sale.sale_price)}</td>
                  <td>${formatCurrency(profit)}</td>
                  <td class="col-actions">
                    <div class="action-wrap">
                      <button
                        class="btn btn-ghost btn-sm btn-revert-sale"
                        type="button"
                        data-sale-id="${sale.id}"
                        data-product="${escapeHtml(sale.product_title)}"
                        data-variant="${escapeHtml(sale.variant_title)}"
                        data-qty="${sale.qty_sold}"
                        data-popover-trigger
                        data-sale-revert="${sale.id}"
                      >
                        Revert
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    ${renderSelectedCountBar(selectedSaleIds.size)}
  `;
}

async function handleBatchRevert() {
  const selectedSales = buildSelectedSales(selectedSaleIds);

  if (!selectedSales.length) {
    showToast('Select one or more sales first.', 'warning');
    return;
  }

  const body = `
    <div class="migration-copy">
      <p>The following sales will be restored to inventory and removed from the ledger:</p>
      <ul>
        ${selectedSales
          .map(
            (sale) =>
              `<li>${escapeHtml(sale.product_title)} &mdash; ${escapeHtml(sale.variant_title)}${sale.buyer_name ? ` &bull; ${escapeHtml(sale.buyer_name)}` : ''}</li>`
          )
          .join('')}
      </ul>
    </div>
  `;

  const confirmed = await confirmModal({
    title: 'Revert Selected Sales',
    body,
    confirmLabel: 'Revert Sales',
    tone: 'danger'
  });

  if (!confirmed) return;

  try {
    const revertedCount = await revertSales([...selectedSaleIds], state.currentUser.id);
    selectedSaleIds.clear();
    closeAllPopovers();
    showToast(revertedCount ? 'Selected sales reverted.' : 'No sales were reverted.', 'success');
    renderSalesView(document.getElementById('view-root'));
  } catch (error) {
    showToast(error.message || 'Unable to revert selected sales.', 'error');
  }
}

export async function renderSalesView(container) {
  ensurePopoverDismissal();
  pruneSelectedSaleIds();

  container.innerHTML = `
    <section class="page-section sales-view">
      <div class="page-header-block page-header-inline">
        <div>
          <p class="eyebrow">Sales</p>
          <h2>Sales</h2>
          <p class="page-copy">Track what is ready to sell and keep a clean sold ledger.</p>
        </div>
        <label class="toolbar-search">
          <span>Search</span>
          <input id="sales-search" value="${escapeHtml(searchTerm)}" placeholder="Search product, variant, platform" />
        </label>
      </div>

      <div class="tab-row">
        <button class="tab-button ${salesTab === 'to_sell' ? 'is-active' : ''}" data-sales-tab="to_sell">To Sell</button>
        <button class="tab-button ${salesTab === 'sold' ? 'is-active' : ''}" data-sales-tab="sold">Sold</button>
      </div>

      ${salesTab === 'to_sell' ? renderToSellRows() : renderSoldRows()}
    </section>
  `;

  $('#sales-search', container)?.addEventListener('input', (event) => {
    searchTerm = event.target.value;
    renderSalesView(container);
  });

  $$('[data-sales-tab]', container).forEach((button) => {
    button.addEventListener('click', () => {
      salesTab = button.dataset.salesTab;
      selectedSaleIds.clear();
      closeAllPopovers();
      renderSalesView(container);
    });
  });

  $$('[data-sell-id]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.inventory.find((entry) => entry.id === button.dataset.sellId);
      if (item) {
        openSellModal(item);
      }
    });
  });

  $$('[data-sale-select]', container).forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedSaleIds.add(checkbox.dataset.saleSelect);
      } else {
        selectedSaleIds.delete(checkbox.dataset.saleSelect);
      }
      renderSalesView(container);
    });
  });

  const selectAll = $('[data-sale-select-all]', container);
  if (selectAll) {
    const visibleSales = state.sales.filter((sale) => {
      const haystack = `${sale.product_title} ${sale.variant_title} ${sale.platform || ''} ${sale.buyer_name || ''}`.toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });

    selectAll.indeterminate =
      visibleSales.some((sale) => selectedSaleIds.has(sale.id)) &&
      !visibleSales.every((sale) => selectedSaleIds.has(sale.id));

    selectAll.addEventListener('change', () => {
      if (selectAll.checked) {
        visibleSales.forEach((sale) => selectedSaleIds.add(sale.id));
      } else {
        visibleSales.forEach((sale) => selectedSaleIds.delete(sale.id));
      }
      renderSalesView(container);
    });
  }

  $$('[data-sale-revert]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const sale = state.sales.find((entry) => entry.id === button.dataset.saleRevert);
      if (sale) {
        openRevertPopover(button, sale);
      }
    });
  });

  $('#revert-selected-sales', container)?.addEventListener('click', handleBatchRevert);
  $('#clear-selected-sales', container)?.addEventListener('click', () => {
    selectedSaleIds.clear();
    closeAllPopovers();
    renderSalesView(container);
  });

  return {};
}
