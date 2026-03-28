import { state } from '../state.js';
import { supabase } from '../supabase.js';

export async function fetchActivityLog() {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) throw error;
  return data ?? [];
}

export async function logActivity({
  userId = state.currentUser?.id ?? null,
  username = state.currentProfile?.username ?? null,
  type,
  description,
  amount = null,
  refId = null,
  refType = null
}) {
  const { data, error } = await supabase
    .from('activity_log')
    .insert({
      user_id: userId,
      username,
      type,
      description,
      amount,
      ref_id: refId,
      ref_type: refType
    })
    .select()
    .single();

  if (error) throw error;

  state.upsertCollectionRow('log', data);
  return data;
}
