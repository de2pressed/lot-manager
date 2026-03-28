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
import { openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { recordSale } from '../services/sales.service.js';

let salesTab = 'to_sell';
let searchTerm = '';

function getSellableInventory() {
  return state.inventory.filter((item) => Number(item.quantity || 0) > 0 && item.status !== 'sold_out');
}

function openSellModal(item) {
  const body = document.createElement('div');
  const footer = document.createElement('div');

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

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="sell-form">Record Sale</button>
  `;

  openModal({
    title: 'Record Sale',
    description: 'This will reduce stock immediately.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      $('#sell-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          await recordSale(
            {
              inventoryId: item.id,
              salePrice: Number($('#sell-price', bodyTarget).value),
              qtySold: Number($('#sell-qty', bodyTarget).value),
              platform: $('#sell-platform', bodyTarget).value,
              dateSold: inputDateToIso($('#sell-date', bodyTarget).value),
              notes: $('#sell-notes', bodyTarget).value.trim()
            },
            state.currentUser.id
          );

          close('saved');
          showToast('Sale recorded successfully.', 'success');
          renderSalesView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to record sale.', 'error');
        }
      });
    }
  });
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
  `;
}

function renderSoldRows() {
  const sales = state.sales.filter((sale) => {
    const haystack = `${sale.product_title} ${sale.variant_title} ${sale.platform || ''}`.toLowerCase();
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

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Product</th>
            <th>Variant</th>
            <th>Qty</th>
            <th>Platform</th>
            <th>Buy</th>
            <th>Sale</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          ${sales
            .map((sale) => {
              const profit =
                (Number(sale.sale_price || 0) - Number(sale.buy_price || 0)) *
                Number(sale.qty_sold || 0);

              return `
                <tr>
                  <td>${formatDate(sale.date_sold)}</td>
                  <td>${escapeHtml(sale.product_title)}</td>
                  <td>${escapeHtml(sale.variant_title)}</td>
                  <td>${sale.qty_sold}</td>
                  <td>${escapeHtml(sale.platform || 'Direct')}</td>
                  <td>${formatCurrency(sale.buy_price)}</td>
                  <td>${formatCurrency(sale.sale_price)}</td>
                  <td>${formatCurrency(profit)}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

export async function renderSalesView(container) {
  container.innerHTML = `
    <section class="page-section">
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

  return {};
}
