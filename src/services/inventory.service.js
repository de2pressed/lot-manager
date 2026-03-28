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

/**
 * Mark one inventory item as defected.
 * @param {string} inventoryId
 * @param {string} userId
 * @param {string} [reason] - optional reason text
 */
export async function markDefected(inventoryId, userId, reason = '') {
  const { data, error } = await supabase
    .from('inventory')
    .update({
      status: 'defected',
      defected_at: new Date().toISOString(),
      defected_by: userId,
      defect_reason: reason || null
    })
    .eq('id', inventoryId)
    .select('*')
    .single();

  if (error) throw error;

  state.upsertCollectionRow('inventory', data);

  await logActivity({
    userId,
    type: 'item_defected',
    description: `Item marked as defected${reason ? ': ' + reason : ''}`,
    refId: inventoryId,
    refType: 'inventory'
  });

  return data;
}

/**
 * Revert a defected item back to active inventory.
 * Recalculates status from current quantity.
 */
export async function revertDefected(inventoryId, userId) {
  const { data: item } = await supabase
    .from('inventory')
    .select('quantity, product_title, variant_title')
    .eq('id', inventoryId)
    .single();

  if (!item) throw new Error('Item not found');

  let status = 'in_stock';
  if (item.quantity <= 0) status = 'sold_out';
  else if (item.quantity <= 3) status = 'low_stock';

  const { data, error } = await supabase
    .from('inventory')
    .update({
      status,
      defected_at: null,
      defected_by: null,
      defect_reason: null
    })
    .eq('id', inventoryId)
    .select('*')
    .single();

  if (error) throw error;

  state.upsertCollectionRow('inventory', data);

  await logActivity({
    userId,
    type: 'defect_reverted',
    description: `Defected item restored to inventory: ${item.product_title} — ${item.variant_title}`,
    refId: inventoryId,
    refType: 'inventory'
  });

  return data;
}
