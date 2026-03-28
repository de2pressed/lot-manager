import { ROUTES } from '../router.js';
import { state } from '../state.js';

function getRouteMeta(routeKey) {
  switch (routeKey) {
    case 'lots':
      return `${state.lots.length}`;
    case 'inventory':
      return `${state.inventory.length}`;
    case 'sales':
      return `${state.sales.length}`;
    default:
      return '';
  }
}

export function renderSidebar(activeRoute) {
  const routes = ROUTES.filter((route) => !route.adminOnly || state.currentRole === 'admin');

  return `
    <!-- Version marker: bump by 0.01 for every update to make UI changes easy to verify. -->
    <div class="brand-lockup">
      <p class="brand-kicker">Raptile Studio</p>
      <h1>Ops Hub</h1>
      <p class="brand-caption">Unified team operations</p>
    </div>
    <nav class="sidebar-nav" aria-label="Primary navigation">
      ${routes
        .map((route) => {
          const meta = getRouteMeta(route.key);
          return `
            <button class="sidebar-link ${route.key === activeRoute ? 'is-active' : ''}" data-route="${route.key}">
              <span>${route.label}</span>
              ${meta ? `<span class="sidebar-count">${meta}</span>` : ''}
            </button>
          `;
        })
        .join('')}
    </nav>
    <div class="sidebar-footer">
      <span class="role-chip">${state.currentRole || 'viewer'}</span>
      <span class="live-chip">Realtime ready</span>
      <span class="version-chip">v1.04</span>
    </div>
  `;
}
