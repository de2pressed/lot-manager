import { state } from '../state.js';
import { getMyProfile, supabase } from '../supabase.js';
import { ROUTES, getCurrentRouteKey, navigateTo, watchRouteChange } from '../router.js';
import { signOut } from '../auth/session.js';
import { isTypingTarget } from '../utils/dom.js';
import { applyRealtimePayload } from '../utils/realtime.js';
import { renderSidebar } from './sidebar.js';
import { closeModal, isModalOpen } from './modal.js';
import { showToast } from './toast.js';
import { fetchProfiles } from '../services/admin.service.js';
import { fetchLots } from '../services/lots.service.js';
import { fetchProducts } from '../services/products.service.js';
import { fetchInventory } from '../services/inventory.service.js';
import { fetchSales } from '../services/sales.service.js';
import { fetchActivityLog } from '../services/log.service.js';
import { renderDashboardView } from '../views/dashboard.js';
import { renderLotsView } from '../views/lots.js';
import { renderProductsView } from '../views/products.js';
import { renderInventoryView } from '../views/inventory.js';
import { renderSalesView } from '../views/sales.js';
import { renderHistoryView } from '../views/history.js';
import { renderAdminView } from '../views/admin.js';
import { renderSettingsView } from '../views/settings.js';

const viewRenderers = {
  dashboard: renderDashboardView,
  lots: renderLotsView,
  products: renderProductsView,
  inventory: renderInventoryView,
  sales: renderSalesView,
  history: renderHistoryView,
  admin: renderAdminView,
  settings: renderSettingsView
};

const channels = [];
const cleanupFns = [];
let routeCleanup = null;
let renderQueued = false;
let shortcutsBound = false;
let reactivityBound = false;

function getRouteLabel(routeKey) {
  return ROUTES.find((route) => route.key === routeKey)?.label ?? 'Dashboard';
}

function renderShell() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="app-shell" id="app-shell">
      <button class="sidebar-backdrop" id="sidebar-backdrop" type="button" aria-label="Close navigation"></button>
      <aside class="sidebar" id="app-sidebar"></aside>
      <main class="app-main">
        <header class="topbar">
          <div class="topbar-left">
            <button class="button button-secondary topbar-menu" id="sidebar-toggle" type="button">Menu</button>
            <div>
              <p class="topbar-copy">Raptile Studio Ops Hub</p>
              <h1 id="topbar-title">Loading</h1>
            </div>
          </div>
          <div class="topbar-actions">
            <div class="user-summary">
              <strong id="topbar-user">Loading...</strong>
              <span id="topbar-role"></span>
            </div>
            <button class="button button-secondary" id="sign-out-button" type="button">Sign Out</button>
          </div>
        </header>
        <section id="view-root" class="view-root">
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Loading workspace...</p>
          </div>
        </section>
      </main>
    </div>
  `;
}

function refreshChrome() {
  const routeKey = state.currentRoute || getCurrentRouteKey();
  const shell = document.getElementById('app-shell');

  if (!shell) return;

  const sidebar = document.getElementById('app-sidebar');
  if (sidebar) {
    sidebar.innerHTML = renderSidebar(routeKey);
  }

  const title = document.getElementById('topbar-title');
  if (title) {
    title.textContent = getRouteLabel(routeKey);
  }

  const user = document.getElementById('topbar-user');
  if (user) {
    user.textContent = state.currentProfile?.username || state.currentUser?.email || 'Unknown user';
  }

  const role = document.getElementById('topbar-role');
  if (role) {
    role.textContent = state.currentRole || 'viewer';
  }
}

async function renderRoute(routeKey) {
  state.currentRoute = routeKey;
  refreshChrome();

  const container = document.getElementById('view-root');
  if (!container) return;

  const renderer = viewRenderers[routeKey] || renderDashboardView;
  const actions = (await renderer(container)) || {};
  state.viewActions = actions;
}

function scheduleRender() {
  if (renderQueued) return;

  renderQueued = true;
  queueMicrotask(async () => {
    renderQueued = false;
    await renderRoute(state.currentRoute || getCurrentRouteKey());
  });
}

function bindChromeEvents() {
  const sidebar = document.getElementById('app-sidebar');
  const signOutButton = document.getElementById('sign-out-button');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const shell = document.getElementById('app-shell');

  const handleSidebarClick = (event) => {
    if (event.target.closest('[data-sidebar-signout]')) {
      handleSignOut();
      shell?.classList.remove('sidebar-open');
      return;
    }

    const button = event.target.closest('[data-route]');
    if (!button) return;

    navigateTo(button.dataset.route);
    shell?.classList.remove('sidebar-open');
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      closeModal('signout');
    } catch (error) {
      showToast(error.message || 'Unable to sign out.', 'error');
    }
  };

  const handleToggle = () => {
    shell?.classList.toggle('sidebar-open');
  };

  const handleBackdropClick = () => {
    shell?.classList.remove('sidebar-open');
  };

  sidebar?.addEventListener('click', handleSidebarClick);
  signOutButton?.addEventListener('click', handleSignOut);
  sidebarToggle?.addEventListener('click', handleToggle);
  sidebarBackdrop?.addEventListener('click', handleBackdropClick);

  cleanupFns.push(
    () => sidebar?.removeEventListener('click', handleSidebarClick),
    () => signOutButton?.removeEventListener('click', handleSignOut),
    () => sidebarToggle?.removeEventListener('click', handleToggle),
    () => sidebarBackdrop?.removeEventListener('click', handleBackdropClick)
  );
}

function bindStateReactivity() {
  if (reactivityBound) {
    return;
  }

  reactivityBound = true;

  const events = [
    'lots:changed',
    'inventory:changed',
    'sales:changed',
    'products:changed',
    'log:changed',
    'profiles:changed',
    'currentRole:changed'
  ];

  events.forEach((event) => {
    const unsubscribe = state.on(event, () => {
      if (state.hydrated) {
        scheduleRender();
      }
    });

    cleanupFns.push(unsubscribe);
  });

  cleanupFns.push(() => {
    reactivityBound = false;
  });
}

function bindGlobalShortcuts() {
  if (shortcutsBound) return;

  const handleKeydown = (event) => {
    if (isTypingTarget(event.target)) return;
    if (isModalOpen() && event.key !== 'Escape') return;

    if (event.key.toLowerCase() === 'n' && typeof state.viewActions.shortcutNew === 'function') {
      event.preventDefault();
      state.viewActions.shortcutNew();
    }

    if (event.key.toLowerCase() === 's' && typeof state.viewActions.shortcutSync === 'function') {
      event.preventDefault();
      state.viewActions.shortcutSync();
    }

    if (event.key === 'Escape' && isModalOpen()) {
      event.preventDefault();
      closeModal('escape');
    }
  };

  document.addEventListener('keydown', handleKeydown);
  shortcutsBound = true;
  cleanupFns.push(() => {
    document.removeEventListener('keydown', handleKeydown);
    shortcutsBound = false;
  });
}

function applyLotItemPayload(payload) {
  const lotId = payload.eventType === 'DELETE' ? payload.old.lot_id : payload.new.lot_id;
  const lot = state.lots.find((entry) => entry.id === lotId);
  if (!lot) return;

  let lotItems = [...(lot.lot_items || [])];

  if (payload.eventType === 'DELETE') {
    lotItems = lotItems.filter((item) => item.id !== payload.old.id);
  } else {
    const index = lotItems.findIndex((item) => item.id === payload.new.id);
    if (index === -1) {
      lotItems.unshift(payload.new);
    } else {
      lotItems[index] = payload.new;
    }
  }

  state.upsertCollectionRow('lots', {
    ...lot,
    lot_items: lotItems
  });
}

export function subscribeToRealtime() {
  if (channels.length) return;

  channels.push(
    supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
        applyRealtimePayload('inventory', payload);
        state.emit('inventory:changed', payload);
      })
      .subscribe(),
    supabase
      .channel('sales-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (payload) => {
        applyRealtimePayload('sales', payload);
        state.emit('sales:changed', payload);
      })
      .subscribe(),
    supabase
      .channel('lots-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, (payload) => {
        applyRealtimePayload('lots', payload);
        state.emit('lots:changed', payload);
      })
      .subscribe(),
    supabase
      .channel('lot-items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lot_items' }, (payload) => {
        applyLotItemPayload(payload);
        state.emit('lots:changed', payload);
      })
      .subscribe(),
    supabase
      .channel('products-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        applyRealtimePayload('products', payload);
        state.emit('products:changed', payload);
      })
      .subscribe(),
    supabase
      .channel('activity-log-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_log' }, (payload) => {
        applyRealtimePayload('log', payload);
        state.emit('log:changed', payload);
      })
      .subscribe()
  );
}

export function unsubscribeAll() {
  channels.forEach((channel) => channel.unsubscribe());
  channels.length = 0;
}

async function hydrateState(session) {
  const profile = (await getMyProfile()) || {
    id: session.user.id,
    username: session.user.email,
    role: 'viewer'
  };

  const [products, lots, inventory, sales, log, profiles] = await Promise.all([
    fetchProducts(),
    fetchLots(),
    fetchInventory(),
    fetchSales(),
    fetchActivityLog(),
    profile.role === 'admin' ? fetchProfiles() : Promise.resolve([])
  ]);

  state.set({
    currentUser: session.user,
    currentProfile: profile,
    currentRole: profile.role,
    products,
    lots,
    inventory,
    sales,
    log,
    profiles,
    hydrated: true
  });
}

export async function mountApp(session) {
  renderShell();
  bindChromeEvents();
  bindStateReactivity();
  bindGlobalShortcuts();

  await hydrateState(session);

  if (!window.location.hash) {
    navigateTo('dashboard');
  }

  if (!routeCleanup) {
    routeCleanup = watchRouteChange((routeKey) => {
      renderRoute(routeKey);
    });
  } else {
    await renderRoute(getCurrentRouteKey());
  }

  refreshChrome();
  subscribeToRealtime();
}

export function unmountApp() {
  unsubscribeAll();

  if (routeCleanup) {
    routeCleanup();
    routeCleanup = null;
  }

  cleanupFns.splice(0).forEach((cleanup) => cleanup());
  state.reset();
  closeModal('unmount');

  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '';
  }
}
