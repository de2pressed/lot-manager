import { supabase } from '../supabase.js';
import { openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { buildVariantTitle } from '../utils/products.js';
import { logActivity } from '../services/log.service.js';

const LOT_STORAGE_KEY = 'lotCounter';
const INVENTORY_STORAGE_KEY = 'raptile_inventory_v1';
const MIGRATION_FLAG_KEY = 'raptile_migrated_v2';

function getLegacyVariantMatrix(product) {
  const colors = Array.isArray(product?.colors) && product.colors.length ? product.colors : [null];
  const sizes = Array.isArray(product?.sizes) && product.sizes.length ? product.sizes : [null];
  const variants = [];

  colors.forEach((color) => {
    sizes.forEach((size) => {
      variants.push({
        title: buildVariantTitle({ color, size }),
        sku: '',
        price: 0,
        color,
        size
      });
    });
  });

  return variants.length ? variants : [{ title: 'Default', sku: '', price: 0, color: null, size: null }];
}

function parseJson(raw) {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadExistingProducts() {
  const { data, error } = await supabase.from('products').select('*');
  if (error) throw error;

  return new Map((data || []).map((product) => [product.title.toLowerCase(), product]));
}

async function ensureProduct(productCache, title, seed = {}) {
  const key = title.trim().toLowerCase();
  if (!key) return null;

  if (productCache.has(key)) {
    return productCache.get(key);
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      title,
      image_url: seed.image_url ?? null,
      variants: seed.variants ?? [{ title: 'Default', sku: '', price: 0, color: null, size: null }]
    })
    .select()
    .single();

  if (error) throw error;
  productCache.set(key, data);
  return data;
}

async function seedLegacyProducts(oldLotState, oldInventoryState, productCache) {
  for (const product of oldLotState?.products || []) {
    const title = product.name || product.title;
    if (!title) continue;

    await ensureProduct(productCache, title, {
      image_url: product.image || null,
      variants: getLegacyVariantMatrix(product)
    });
  }

  for (const product of oldInventoryState?.products || []) {
    const title = product.title || product.name;
    if (!title) continue;

    await ensureProduct(productCache, title, {
      image_url: product.image || null,
      variants: product.variants || getLegacyVariantMatrix(product)
    });
  }
}

async function migrateLots(oldState, userId, productCache) {
  for (const legacyLot of oldState?.lots || []) {
    const { data: lot, error: lotError } = await supabase
      .from('lots')
      .insert({
        name: legacyLot.name || `Migrated Lot ${legacyLot.id || ''}`.trim(),
        max_items: Number(legacyLot.maxItems || legacyLot.max_items || 100),
        created_by: userId
      })
      .select()
      .single();

    if (lotError) throw lotError;

    const rows = [];
    for (const item of legacyLot.items || []) {
      const product = await ensureProduct(productCache, item.productName || item.name || 'Migrated Product', {
        variants: [
          {
            title: buildVariantTitle({ color: item.color, size: item.size }),
            sku: item.sku || '',
            price: 0,
            color: item.color || null,
            size: item.size || null
          }
        ]
      });

      rows.push({
        lot_id: lot.id,
        product_id: product.id,
        shopify_product_id: product.shopify_product_id,
        product_title: product.title,
        variant_title: buildVariantTitle({ color: item.color, size: item.size }),
        color: item.color || null,
        size: item.size || null,
        sku: item.sku || null,
        qty: Number(item.qty || 1),
        buy_price: Number(item.buyPrice || item.buy_price || 0)
      });
    }

    if (rows.length) {
      const { error } = await supabase.from('lot_items').insert(rows);
      if (error) throw error;
    }
  }
}

async function migrateInventory(oldState, userId, productCache) {
  for (const item of oldState?.inventory || []) {
    const title = item.name || item.product_title || 'Migrated Inventory Item';
    const product = title ? await ensureProduct(productCache, title) : null;

    const { error } = await supabase.from('inventory').insert({
      product_id: product?.id ?? null,
      shopify_product_id: product?.shopify_product_id ?? item.shopifyProductId ?? null,
      product_title: title,
      variant_title:
        item.variant ||
        item.variant_title ||
        buildVariantTitle({ color: item.color, size: item.size }),
      color: item.color || null,
      size: item.size || null,
      sku: item.sku || null,
      buy_price: Number(item.buyPrice || item.buy_price || 0),
      quantity: Number(item.quantity || 0),
      status: item.status || 'in_stock',
      notes: item.notes || null,
      date_added: item.dateAdded || item.date_added || new Date().toISOString(),
      created_by: userId
    });

    if (error) throw error;
  }

  for (const sale of oldState?.sales || []) {
    const title = sale.name || sale.product_title || 'Migrated Sale';
    const product = title ? await ensureProduct(productCache, title) : null;

    const { error } = await supabase.from('sales').insert({
      product_id: product?.id ?? null,
      shopify_product_id: product?.shopify_product_id ?? sale.shopifyProductId ?? null,
      product_title: title,
      variant_title:
        sale.variant ||
        sale.variant_title ||
        buildVariantTitle({ color: sale.color, size: sale.size }),
      buy_price: Number(sale.buyPrice || sale.buy_price || 0),
      sale_price: Number(sale.salePrice || sale.sale_price || 0),
      qty_sold: Number(sale.qtySold || sale.qty_sold || 1),
      platform: sale.platform || 'Direct',
      date_sold: sale.dateSold || sale.date_sold || new Date().toISOString(),
      notes: sale.notes || null,
      created_by: userId
    });

    if (error) throw error;
  }
}

function showMigrationModal(hasLotData, hasInventoryData) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    const footer = document.createElement('div');
    let resolved = false;

    body.innerHTML = `
      <div class="migration-copy">
        <p>Legacy browser data was found on this machine.</p>
        <ul>
          ${hasLotData ? '<li>Lot Counter data available</li>' : ''}
          ${hasInventoryData ? '<li>Inventory Tracker data available</li>' : ''}
        </ul>
        <p>The import runs once and writes the records into Supabase for this signed-in account.</p>
      </div>
    `;

    footer.innerHTML = `
      <button class="button button-secondary" type="button" data-migration-skip>Skip</button>
      <button class="button button-primary" type="button" data-migration-confirm>Import Legacy Data</button>
    `;

    openModal({
      title: 'Import Legacy Local Data',
      description: 'One-time migration from the two standalone browser apps.',
      body,
      footer,
      onOpen({ footer: footerTarget, close }) {
        footerTarget?.addEventListener('click', (event) => {
          if (event.target.closest('[data-migration-skip]')) {
            resolved = true;
            resolve(false);
            close('skip');
          }

          if (event.target.closest('[data-migration-confirm]')) {
            resolved = true;
            resolve(true);
            close('confirm');
          }
        });
      },
      onClose() {
        if (!resolved) {
          resolve(false);
        }
      }
    });
  });
}

export async function checkLocalStorageMigration(userId) {
  const oldLotData = parseJson(localStorage.getItem(LOT_STORAGE_KEY));
  const oldInventoryData = parseJson(localStorage.getItem(INVENTORY_STORAGE_KEY));
  const alreadyMigrated = localStorage.getItem(MIGRATION_FLAG_KEY);

  if (alreadyMigrated || (!oldLotData && !oldInventoryData)) {
    return;
  }

  const confirmed = await showMigrationModal(Boolean(oldLotData), Boolean(oldInventoryData));
  if (!confirmed) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'skipped');
    return;
  }

  try {
    const productCache = await loadExistingProducts();
    await seedLegacyProducts(oldLotData, oldInventoryData, productCache);

    if (oldLotData) {
      await migrateLots(oldLotData, userId, productCache);
    }

    if (oldInventoryData) {
      await migrateInventory(oldInventoryData, userId, productCache);
    }

    localStorage.setItem(MIGRATION_FLAG_KEY, 'done');

    await logActivity({
      userId,
      type: 'legacy_migration',
      description: 'Imported legacy localStorage data into Ops Hub'
    });

    showToast('Legacy data imported successfully.', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Legacy data migration failed.', 'error');
    throw error;
  }
}
