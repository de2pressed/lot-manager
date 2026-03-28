import { state } from '../state.js';
import { supabase } from '../supabase.js';
import { logActivity } from './log.service.js';

export async function fetchInventory() {
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .order('date_added', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createInventoryItem(payload, userId) {
  const { data, error } = await supabase
    .from('inventory')
    .insert({
      ...payload,
      created_by: userId
    })
    .select()
    .single();

  if (error) throw error;

  state.upsertCollectionRow('inventory', data);

  await logActivity({
    userId,
    type: 'inventory_added',
    description: `Added ${data.quantity} x ${data.product_title} (${data.variant_title}) to inventory`,
    amount: Number(data.buy_price || 0) * Number(data.quantity || 0),
    refId: data.id,
    refType: 'inventory'
  });

  return data;
}

export async function updateInventoryItem(inventoryId, payload, userId) {
  const { data, error } = await supabase
    .from('inventory')
    .update(payload)
    .eq('id', inventoryId)
    .select()
    .single();

  if (error) throw error;

  state.upsertCollectionRow('inventory', data);

  await logActivity({
    userId,
    type: 'inventory_updated',
    description: `Updated inventory item "${data.product_title}" (${data.variant_title})`,
    refId: data.id,
    refType: 'inventory'
  });

  return data;
}

export async function deleteInventoryItem(inventoryId, userId) {
  const { data: item, error: readError } = await supabase
    .from('inventory')
    .select('*')
    .eq('id', inventoryId)
    .single();

  if (readError) throw readError;

  const { error } = await supabase.from('inventory').delete().eq('id', inventoryId);
  if (error) throw error;

  state.removeCollectionRow('inventory', inventoryId);

  await logActivity({
    userId,
    type: 'inventory_deleted',
    description: `Deleted inventory item "${item.product_title}" (${item.variant_title})`,
    refId: inventoryId,
    refType: 'inventory'
  });
}
