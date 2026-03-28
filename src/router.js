export const ROUTES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'lots', label: 'Lots' },
  { key: 'products', label: 'Products' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'sales', label: 'Sales' },
  { key: 'history', label: 'History' },
  { key: 'admin', label: 'Admin', adminOnly: true },
  { key: 'settings', label: 'Settings' }
];

const routeKeys = new Set(ROUTES.map((route) => route.key));

export function getCurrentRouteKey() {
  const route = window.location.hash.replace(/^#\//, '').trim();
  return routeKeys.has(route) ? route : 'dashboard';
}

export function navigateTo(routeKey) {
  window.location.hash = `#/${routeKey}`;
}

export function watchRouteChange(callback) {
  const handleChange = () => callback(getCurrentRouteKey());
  window.addEventListener('hashchange', handleChange);
  handleChange();

  return () => {
    window.removeEventListener('hashchange', handleChange);
  };
}
