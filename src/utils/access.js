import { state } from '../state.js';
import { showToast } from '../ui/toast.js';

export function hasRole(roles) {
  return roles.includes(state.currentRole);
}

export function guardRole(roles) {
  if (hasRole(roles)) {
    return true;
  }

  showToast('You do not have access to that section.', 'warning');
  window.location.hash = '#/dashboard';
  return false;
}
