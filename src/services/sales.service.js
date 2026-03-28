import { state } from '../state.js';
import { supabase } from '../supabase.js';
import { logActivity } from './log.service.js';

export async function fetchSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .order('date_sold', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function recordSale(
  { inventoryId, salePrice, qtySold, platform, dateSold, notes = '' },
  userId
) {
  const { data: inventoryRow, error: inventoryError } = await supabase
    .from('inventory')
    .select('*')
    .eq('id', inventoryId)
    .single();

  if (inventoryError) throw inventoryError;

  if (!inventoryRow) {
    throw new Error('Inventory item not found.');
  }

  if (Number(qtySold || 0) < 1 || Number(qtySold || 0) > Number(inventoryRow.quantity || 0)) {
    throw new Error('Sale quantity exceeds current stock.');
  }

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      inventory_id: inventoryRow.id,
      product_id: inventoryRow.product_id,
      shopify_product_id: inventoryRow.shopify_product_id,
      product_title: inventoryRow.product_title,
      variant_title: inventoryRow.variant_title,
      buy_price: inventoryRow.buy_price,
      sale_price: salePrice,
      qty_sold: qtySold,
      platform,
      date_sold: dateSold,
      notes,
      created_by: userId
    })
    .select()
    .single();

  if (saleError) throw saleError;

  const { data: updatedInventory, error: inventoryUpdateError } = await supabase
    .from('inventory')
    .update({
      quantity: Number(inventoryRow.quantity || 0) - Number(qtySold || 0)
    })
    .eq('id', inventoryRow.id)
    .select()
    .single();

  if (inventoryUpdateError) throw inventoryUpdateError;

  state.upsertCollectionRow('sales', sale);
  state.upsertCollectionRow('inventory', updatedInventory);

  await logActivity({
    userId,
    type: 'sale_recorded',
    description: `Recorded sale of ${qtySold} x ${sale.product_title} (${sale.variant_title})`,
    amount: Number(sale.sale_price || 0) * Number(sale.qty_sold || 0),
    refId: sale.id,
    refType: 'sale'
  });

  return sale;
}
