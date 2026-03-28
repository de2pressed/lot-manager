import { state } from '../state.js';
import { supabase } from '../supabase.js';
import { logActivity } from './log.service.js';

function weightedBuyPrice(existingRow, incomingRow) {
  const existingQty = Number(existingRow?.quantity || 0);
  const incomingQty = Number(incomingRow?.quantity || 0);
  const totalQty = existingQty + incomingQty;

  if (!totalQty) {
    return Number(incomingRow?.buy_price || existingRow?.buy_price || 0);
  }

  const totalCost =
    Number(existingRow?.buy_price || 0) * existingQty +
    Number(incomingRow?.buy_price || 0) * incomingQty;

  return Number((totalCost / totalQty).toFixed(2));
}

function normalizeLotItemsForPush(items, lotId, userId) {
  const grouped = new Map();

  items.forEach((item) => {
    const key = `${item.product_id}::${item.variant_title}`;
    const current = grouped.get(key);

    if (current) {
      current.quantity += Number(item.qty || 0);
      current.total_cost += Number(item.buy_price || 0) * Number(item.qty || 0);
      current.buy_price = Number((current.total_cost / current.quantity).toFixed(2));
      return;
    }

    grouped.set(key, {
      lot_id: lotId,
      lot_item_id: item.id,
      product_id: item.product_id,
      shopify_product_id: item.shopify_product_id,
      product_title: item.product_title,
      variant_title: item.variant_title,
      color: item.color,
      size: item.size,
      sku: item.sku,
      buy_price: Number(item.buy_price || 0),
      quantity: Number(item.qty || 0),
      created_by: userId,
      total_cost: Number(item.buy_price || 0) * Number(item.qty || 0)
    });
  });

  return Array.from(grouped.values()).map(({ total_cost, ...row }) => row);
}

export async function fetchLots() {
  const { data, error } = await supabase
    .from('lots')
    .select('*, lot_items(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createLot({ name, max_items }, userId) {
  const { data, error } = await supabase
    .from('lots')
    .insert({
      name,
      max_items,
      created_by: userId
    })
    .select('*, lot_items(*)')
    .single();

  if (error) throw error;

  state.upsertCollectionRow('lots', data);

  await logActivity({
    userId,
    type: 'lot_created',
    description: `Created lot "${data.name}"`,
    refId: data.id,
    refType: 'lot'
  });

  return data;
}

export async function updateLot(lotId, payload, userId) {
  const { data, error } = await supabase
    .from('lots')
    .update(payload)
    .eq('id', lotId)
    .select('*, lot_items(*)')
    .single();

  if (error) throw error;

  state.upsertCollectionRow('lots', data);

  await logActivity({
    userId,
    type: 'lot_updated',
    description: `Updated lot "${data.name}"`,
    refId: lotId,
    refType: 'lot'
  });

  return data;
}

export async function deleteLot(lotId, userId) {
  const { data: lot, error: readError } = await supabase
    .from('lots')
    .select('*')
    .eq('id', lotId)
    .single();

  if (readError) throw readError;

  const { error } = await supabase.from('lots').delete().eq('id', lotId);
  if (error) throw error;

  state.removeCollectionRow('lots', lotId);

  await logActivity({
    userId,
    type: 'lot_deleted',
    description: `Deleted lot "${lot.name}"`,
    refId: lotId,
    refType: 'lot'
  });
}

export async function addLotItem(payload, userId) {
  const { data, error } = await supabase
    .from('lot_items')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  const lot = state.lots.find((entry) => entry.id === data.lot_id);
  if (lot) {
    const nextLot = {
      ...lot,
      lot_items: [...(lot.lot_items || []), data]
    };
    state.upsertCollectionRow('lots', nextLot);
  }

  await logActivity({
    userId,
    type: 'lot_item_added',
    description: `Added ${data.qty} x ${data.product_title} (${data.variant_title}) to a lot`,
    refId: data.lot_id,
    refType: 'lot'
  });

  return data;
}

export async function updateLotItem(itemId, payload, userId) {
  const { data, error } = await supabase
    .from('lot_items')
    .update(payload)
    .eq('id', itemId)
    .select()
    .single();

  if (error) throw error;

  const lot = state.lots.find((entry) => entry.id === data.lot_id);
  if (lot) {
    const nextLot = {
      ...lot,
      lot_items: (lot.lot_items || []).map((item) => (item.id === itemId ? data : item))
    };
    state.upsertCollectionRow('lots', nextLot);
  }

  await logActivity({
    userId,
    type: 'lot_item_updated',
    description: `Updated ${data.product_title} (${data.variant_title}) in a lot`,
    refId: data.lot_id,
    refType: 'lot'
  });

  return data;
}

export async function deleteLotItem(itemId, userId) {
  const { data: item, error: readError } = await supabase
    .from('lot_items')
    .select('*')
    .eq('id', itemId)
    .single();

  if (readError) throw readError;

  const { error } = await supabase.from('lot_items').delete().eq('id', itemId);
  if (error) throw error;

  const lot = state.lots.find((entry) => entry.id === item.lot_id);
  if (lot) {
    const nextLot = {
      ...lot,
      lot_items: (lot.lot_items || []).filter((entry) => entry.id !== itemId)
    };
    state.upsertCollectionRow('lots', nextLot);
  }

  await logActivity({
    userId,
    type: 'lot_item_deleted',
    description: `Removed ${item.product_title} (${item.variant_title}) from a lot`,
    refId: item.lot_id,
    refType: 'lot'
  });
}

async function syncLotInventoryToInventory(lotId, userId, { allowRepush = false, logType = 'lot_pushed' } = {}) {
  const { data: lot, error: lotError } = await supabase
    .from('lots')
    .select('*, lot_items(*)')
    .eq('id', lotId)
    .single();

  if (lotError) throw lotError;

  if (!lot) {
    throw new Error('Lot not found.');
  }

  if (!allowRepush && lot.status === 'pushed') {
    throw new Error('Lot already pushed or not found.');
  }

  if (!lot.lot_items?.length) {
    throw new Error('Cannot push an empty lot.');
  }

  const inventoryRows = normalizeLotItemsForPush(lot.lot_items, lotId, userId);
  const { data: existingRows, error: existingError } = await supabase
    .from('inventory')
    .select('*')
    .eq('lot_id', lotId);

  if (existingError) throw existingError;

  const existingMap = new Map(
    (existingRows || []).map((row) => [`${row.product_id}::${row.variant_title}`, row])
  );

  for (const row of inventoryRows) {
    const key = `${row.product_id}::${row.variant_title}`;
    const existing = existingMap.get(key);

    if (existing) {
      const { data: updatedRow, error } = await supabase
        .from('inventory')
        .update({
          quantity: Number(existing.quantity || 0) + Number(row.quantity || 0),
          buy_price: weightedBuyPrice(existing, row),
          notes: existing.notes || null
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      state.upsertCollectionRow('inventory', updatedRow);
      continue;
    }

    const { data: insertedRow, error } = await supabase
      .from('inventory')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    state.upsertCollectionRow('inventory', insertedRow);
  }

  const { data: updatedLot, error: updateLotError } = await supabase
    .from('lots')
    .update({
      status: 'pushed',
      pushed_at: new Date().toISOString(),
      pushed_by: userId
    })
    .eq('id', lotId)
    .select('*, lot_items(*)')
    .single();

  if (updateLotError) throw updateLotError;

  state.upsertCollectionRow('lots', updatedLot);

  await logActivity({
    userId,
    type: logType,
    description: allowRepush
      ? `Lot "${lot.name}" repushed to inventory (${lot.lot_items.length} variants, additive)`
      : `Lot "${lot.name}" pushed to inventory (${inventoryRows.length} merged variants)`,
    refId: lotId,
    refType: 'lot'
  });

  return {
    lot: updatedLot,
    pushed: inventoryRows.length
  };
}

export async function pushLotToInventory(lotId, userId) {
  return syncLotInventoryToInventory(lotId, userId);
}

/**
 * Repush a previously pushed lot - adds quantities on top of existing inventory.
 * Reuses the same additive push logic but skips the pushed-status guard.
 */
export async function repushLot(lotId, userId) {
  return syncLotInventoryToInventory(lotId, userId, {
    allowRepush: true,
    logType: 'lot_repushed'
  });
}
