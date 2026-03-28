import { state } from '../state.js';
import { supabase } from '../supabase.js';
import { logActivity } from './log.service.js';

export async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('title');

  if (error) throw error;
  return data ?? [];
}

export async function createProduct(payload, userId) {
  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  state.upsertCollectionRow('products', data);

  await logActivity({
    userId,
    type: 'product_created',
    description: `Created product "${data.title}"`,
    refId: data.id,
    refType: 'product'
  });

  return data;
}

export async function updateProduct(productId, payload, userId) {
  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', productId)
    .select()
    .single();

  if (error) throw error;

  state.upsertCollectionRow('products', data);

  await logActivity({
    userId,
    type: 'product_updated',
    description: `Updated product "${data.title}"`,
    refId: data.id,
    refType: 'product'
  });

  return data;
}

export async function deleteProduct(productId, userId) {
  const { data: product, error: readError } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (readError) throw readError;

  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw error;

  state.removeCollectionRow('products', productId);

  await logActivity({
    userId,
    type: 'product_deleted',
    description: `Deleted product "${product.title}"`,
    refId: productId,
    refType: 'product'
  });
}
