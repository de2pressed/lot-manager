import { supabase } from '../supabase.js';
import { state } from '../state.js';
import { logActivity } from './log.service.js';
import { fetchProducts } from './products.service.js';

const STORE_URL = 'https://raptilestudio.myshopify.com';

export async function syncShopifyProducts(userId) {
  let allProducts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(`${STORE_URL}/products.json?limit=250&page=${page}`);
    if (!response.ok) {
      throw new Error(`Shopify sync failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    const products = Array.isArray(payload.products) ? payload.products : [];

    if (!products.length) {
      hasMore = false;
      break;
    }

    allProducts = allProducts.concat(products);
    page += 1;
  }

  const rows = allProducts.map((product) => ({
    shopify_product_id: product.id,
    title: product.title,
    image_url: product.images?.[0]?.src ?? null,
    variants: (product.variants || []).map((variant) => ({
      id: variant.id,
      title: variant.title || 'Default',
      sku: variant.sku || '',
      price: Number.parseFloat(variant.price || 0),
      color: extractOption(product, variant, ['color', 'colour']),
      size: extractOption(product, variant, ['size'])
    })),
    synced_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'shopify_product_id' });

  if (error) throw error;

  const products = await fetchProducts();
  state.setCollection('products', products);

  await logActivity({
    userId,
    type: 'product_synced',
    description: `Synced ${rows.length} products from Shopify`,
    amount: rows.length
  });

  return rows.length;
}

function extractOption(product, variant, names) {
  for (const name of names) {
    const option = (product.options || []).find(
      (entry) => entry.name?.toLowerCase() === name
    );

    if (!option) continue;
    return variant[`option${option.position}`] ?? null;
  }

  return null;
}
