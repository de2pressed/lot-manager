import { state } from '../state.js';
import { supabase } from '../supabase.js';
import { getAccessToken } from '../auth/session.js';
import { logActivity } from './log.service.js';
import { ROLE_OPTIONS } from '../utils/constants.js';

export async function fetchProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function updateProfileRole(profileId, role, userId) {
  if (!ROLE_OPTIONS.includes(role)) {
    throw new Error('Invalid role selected.');
  }

  if (profileId === userId) {
    throw new Error('You cannot change your own role from this screen.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', profileId)
    .select()
    .single();

  if (error) throw error;

  state.upsertCollectionRow('profiles', data);

  await logActivity({
    userId,
    type: 'role_updated',
    description: `Updated role for "${data.username}" to ${role}`,
    refId: profileId,
    refType: 'profile'
  });

  return data;
}

export async function createUserAccount(payload, userId) {
  if (!ROLE_OPTIONS.includes(payload.role)) {
    throw new Error('Invalid role selected.');
  }

  const token = await getAccessToken();
  const response = await fetch('/api/admin/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Unable to create user.');
  }

  await logActivity({
    userId,
    type: 'user_created',
    description: `Created user "${payload.username}" with role ${payload.role}`,
    refId: result.userId,
    refType: 'profile'
  });

  return result;
}

export async function deleteUserAccount(targetUserId, userId) {
  if (targetUserId === userId) {
    throw new Error('You cannot delete your own account from this screen.');
  }

  const targetProfile = state.profiles.find((profile) => profile.id === targetUserId);
  const token = await getAccessToken();

  const response = await fetch('/api/admin/create-user', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ userId: targetUserId })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Unable to delete user.');
  }

  state.removeCollectionRow('profiles', targetUserId);

  await logActivity({
    userId,
    type: 'user_deleted',
    description: `Deleted user "${targetProfile?.username || targetUserId}"`,
    refId: targetUserId,
    refType: 'profile'
  });

  return result;
}
