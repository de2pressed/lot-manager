import { state } from '../state.js';
import { hasRole } from '../utils/access.js';
import { supabase } from '../supabase.js';
import { escapeHtml, formatDateTime, downloadBlob } from '../utils/format.js';
import { showToast } from '../ui/toast.js';
import { syncShopifyProducts } from '../services/shopify.js';
import { fetchProfiles } from '../services/admin.service.js';
import { fetchLots } from '../services/lots.service.js';
import { fetchProducts } from '../services/products.service.js';
import { fetchInventory } from '../services/inventory.service.js';
import { fetchSales } from '../services/sales.service.js';
import { fetchActivityLog, logActivity } from '../services/log.service.js';
import { confirmModal } from '../ui/modal.js';

let fileInputInstance = null;

function exportSalesCsv() {
  if (!state.sales.length) {
    showToast('No sales data to export.', 'warning');
    return;
  }

  const rows = state.sales.map((sale) => ({
    Date: sale.date_sold,
    Product: sale.product_title,
    Variant: sale.variant_title,
    Buyer: sale.buyer_name || '',
    Platform: sale.platform || 'Direct',
    'Buy Price': sale.buy_price,
    'Sale Price': sale.sale_price,
    Profit: (Number(sale.sale_price || 0) - Number(sale.buy_price || 0)) * Number(sale.qty_sold || 0),
    Qty: sale.qty_sold
  }));

  const csv = window.Papa
    ? window.Papa.unparse(rows)
    : [
        Object.keys(rows[0]).join(','),
        ...rows.map((row) => Object.values(row).map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      ].join('\n');

  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `raptile-sales-${new Date().toISOString().slice(0, 10)}.csv`
  );
  showToast('Sales CSV exported.', 'success');
}

function exportBackup() {
  const payload = {
    exported_at: new Date().toISOString(),
    profiles: state.currentRole === 'admin' ? state.profiles : [],
    products: state.products,
    lots: state.lots.map(({ lot_items, ...lot }) => lot),
    lot_items: state.lots.flatMap((lot) => lot.lot_items || []),
    inventory: state.inventory,
    sales: state.sales,
    activity_log: state.log
  };

  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
    `raptile-backup-${new Date().toISOString().slice(0, 10)}.json`
  );

  showToast('Backup exported.', 'success');
}

async function refreshAllState() {
  const [products, lots, inventory, sales, log, profiles] = await Promise.all([
    fetchProducts(),
    fetchLots(),
    fetchInventory(),
    fetchSales(),
    fetchActivityLog(),
    state.currentRole === 'admin' ? fetchProfiles() : Promise.resolve([])
  ]);

  state.set({
    products,
    lots,
    inventory,
    sales,
    log,
    profiles
  });
}

async function restoreBackup(jsonText) {
  let payload;

  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    console.warn('Backup import failed while parsing JSON.', error);
    throw new Error('The selected file is not valid JSON.');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('The selected file does not contain a valid backup object.');
  }

  const expectedKeys = ['products', 'lots', 'lot_items', 'inventory', 'sales', 'activity_log', 'profiles'];
  const hasAtLeastOneArray = expectedKeys.some((key) => Array.isArray(payload[key]));

  if (!hasAtLeastOneArray) {
    throw new Error('The selected file does not look like an Ops Hub backup.');
  }

  const steps = [
    ['products', payload.products || []],
    ['lots', payload.lots || []],
    ['lot_items', payload.lot_items || []],
    ['inventory', payload.inventory || []],
    ['sales', (payload.sales || []).map(({ profit, ...sale }) => sale)],
    ['activity_log', payload.activity_log || []],
    ['profiles', payload.profiles || []]
  ];

  const failures = [];

  for (const [table, rows] of steps) {
    if (!rows.length) continue;

    try {
      const { error } = await supabase.from(table).upsert(rows, {
        onConflict: 'id'
      });

      if (error) throw error;
    } catch (error) {
      failures.push(`${table}: ${error.message}`);
    }
  }

  const userId = state.currentUser?.id ?? null;

  await logActivity({
    userId,
    type: 'backup_imported',
    description: 'Imported JSON backup into the workspace'
  });

  await refreshAllState();

  if (failures.length) {
    showToast(`Backup imported with warnings: ${failures.join(' | ')}`, 'warning');
    return;
  }

  showToast('Backup imported.', 'success');
}

async function triggerBackupImport() {
  const confirmed = await confirmModal({
    title: 'Import Backup',
    body: '<p>This will upsert rows from the backup into Supabase. Existing matching records will be updated.</p>',
    confirmLabel: 'Choose File',
    tone: 'primary'
  });

  if (!confirmed) return;

  if (!fileInputInstance) {
    fileInputInstance = document.createElement('input');
    fileInputInstance.type = 'file';
    fileInputInstance.accept = 'application/json,.json';
    fileInputInstance.addEventListener('change', async () => {
      const file = fileInputInstance.files?.[0];
      if (!file) return;

      try {
        await restoreBackup(await file.text());
      } catch (error) {
        showToast(error.message || 'Unable to import backup.', 'error');
      } finally {
        fileInputInstance.value = '';
      }
    });
  }

  fileInputInstance.click();
}

async function handleShopifySync(container) {
  try {
    const userId = state.currentUser?.id ?? null;
    const syncedCount = await syncShopifyProducts(userId);
    showToast(`Synced ${syncedCount} Shopify products.`, 'success');
    renderSettingsView(container);
  } catch (error) {
    showToast(error.message || 'Shopify sync failed. Cached products remain available.', 'error');
  }
}

export async function renderSettingsView(container) {
  const canSync = hasRole(['admin', 'manager']);
  const canImport = hasRole(['admin']);

  container.innerHTML = `
    <section class="page-section">
      <div class="page-header-block">
        <div>
          <p class="eyebrow">Controls</p>
          <h2>Settings</h2>
          <p class="page-copy">Sync catalog data, export operational backups, and restore the workspace when needed.</p>
        </div>
      </div>

      <div class="settings-grid">
        <article class="panel-card">
          <div class="panel-head">
            <h3>Shopify Sync</h3>
            <span>${state.products.length} cached products</span>
          </div>
          <p class="panel-copy">
            Cached catalog data keeps the app usable even if Shopify fetches fail temporarily.
          </p>
          <div class="card-actions">
            <button class="button button-primary" id="settings-sync-button" type="button" ${canSync ? '' : 'disabled'}>
              Sync Shopify
            </button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Exports</h3>
            <span>Local files</span>
          </div>
          <p class="panel-copy">Download sales CSV or a full JSON backup snapshot of the current workspace.</p>
          <div class="card-actions">
            <button class="button button-secondary" id="settings-export-sales" type="button">Export Sales CSV</button>
            <button class="button button-secondary" id="settings-export-backup" type="button">Export Backup JSON</button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Import</h3>
            <span>${canImport ? 'Admin only' : 'Restricted'}</span>
          </div>
          <p class="panel-copy">
            Restore backed-up data by upserting it into the Supabase tables in the correct order.
          </p>
          <div class="card-actions">
            <button class="button button-danger" id="settings-import-backup" type="button" ${canImport ? '' : 'disabled'}>
              Import Backup JSON
            </button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Session</h3>
            <span>Current identity</span>
          </div>
          <p class="panel-copy">
            Signed in as <strong>${escapeHtml(state.currentProfile?.username || state.currentUser?.email || 'Unknown')}</strong>.
          </p>
          <p class="panel-copy">Role: <strong>${escapeHtml(state.currentRole || 'viewer')}</strong></p>
          <p class="panel-copy">Last activity refresh: ${formatDateTime(new Date())}</p>
        </article>
      </div>
    </section>
  `;

  document.getElementById('settings-sync-button')?.addEventListener('click', () => handleShopifySync(container));
  document.getElementById('settings-export-sales')?.addEventListener('click', exportSalesCsv);
  document.getElementById('settings-export-backup')?.addEventListener('click', exportBackup);
  document.getElementById('settings-import-backup')?.addEventListener('click', triggerBackupImport);

  return {
    shortcutSync: canSync ? () => handleShopifySync(container) : null
  };
}
