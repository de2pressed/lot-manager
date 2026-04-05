import { state } from '../state.js';
import { $ } from '../utils/dom.js';
import { escapeHtml, formatCurrency, formatDateTime } from '../utils/format.js';

const ACTIVITY_LABELS = {
  sale_reverted: 'Sale Reverted',
  item_defected: 'Marked as Defected',
  defect_reverted: 'Restored from Defected'
};

let historyFilters = {
  from: '',
  to: '',
  username: ''
};

function formatActivityType(type = '') {
  if (ACTIVITY_LABELS[type]) {
    return ACTIVITY_LABELS[type];
  }

  return String(type)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getFilteredLog() {
  return state.log.filter((entry) => {
    const createdAt = entry.created_at ? new Date(entry.created_at) : null;
    const entryDate =
      createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString().slice(0, 10) : '';

    if (historyFilters.from && entryDate < historyFilters.from) return false;
    if (historyFilters.to && entryDate > historyFilters.to) return false;
    if (historyFilters.username && entry.username !== historyFilters.username) return false;

    return true;
  });
}

function renderHistoryFilters() {
  const usernames = [
    ...new Set([
      ...state.profiles.map((profile) => profile.username).filter(Boolean),
      ...state.log.map((entry) => entry.username).filter(Boolean)
    ])
  ].sort((left, right) => left.localeCompare(right));

  if (historyFilters.username && !usernames.includes(historyFilters.username)) {
    usernames.unshift(historyFilters.username);
  }

  const hasActiveFilter = Boolean(historyFilters.from || historyFilters.to || historyFilters.username);

  return `
    <div class="history-filter-bar">
      <div class="filter-group">
        <label class="field-label">From</label>
        <input
          type="date"
          id="history-filter-from"
          class="filter-date-input"
          value="${historyFilters.from}"
        >
      </div>
      <div class="filter-group">
        <label class="field-label">To</label>
        <input
          type="date"
          id="history-filter-to"
          class="filter-date-input"
          value="${historyFilters.to}"
        >
      </div>
      <div class="filter-group">
        <label class="field-label">User</label>
        <select id="history-filter-user">
          <option value="">All users</option>
          ${usernames
            .map(
              (username) => `
                <option value="${escapeHtml(username)}" ${historyFilters.username === username ? 'selected' : ''}>
                  ${escapeHtml(username)}
                </option>
              `
            )
            .join('')}
        </select>
      </div>
      ${
        hasActiveFilter
          ? `
            <button class="button button-secondary button-small" id="history-clear-filters" type="button">
              Clear Filters
            </button>
          `
          : ''
      }
    </div>
  `;
}

export async function renderHistoryView(container) {
  const filtered = getFilteredLog();

  container.innerHTML = `
    <section class="page-section">
      <div class="page-header-block">
        <div>
          <p class="eyebrow">Audit Trail</p>
          <h2>History</h2>
          <p class="page-copy">Every synced action, stock movement, and role change recorded in one feed.</p>
        </div>
      </div>

      ${
        state.log.length
          ? `
            ${renderHistoryFilters()}
            ${
              filtered.length
                ? `
                  <div class="history-feed">
                    ${filtered
                .map(
                  (item) => `
                    <article class="history-card">
                      <div class="history-icon">${escapeHtml(formatActivityType(item.type).slice(0, 2).toUpperCase() || 'LG')}</div>
                      <div>
                        <h3>${escapeHtml(item.description)}</h3>
                        <p>${escapeHtml(item.username || 'System')} • ${escapeHtml(formatActivityType(item.type) || item.type)}</p>
                      </div>
                      <div class="history-meta">
                        <strong>${item.amount ? formatCurrency(item.amount) : '—'}</strong>
                        <span>${formatDateTime(item.created_at)}</span>
                      </div>
                    </article>
                  `
                )
                .join('')}
                  </div>
                `
                : `
                  <div class="empty-state-card">
                    <h3>No matching entries</h3>
                    <p>Try adjusting the date range or user filter.</p>
                  </div>
                `
            }
          `
          : `
            <div class="empty-state-card">
              <h3>No activity yet</h3>
              <p>Write actions will appear here once the team starts using the hub.</p>
            </div>
          `
      }
    </section>
  `;

  $('#history-filter-from', container)?.addEventListener('change', (event) => {
    historyFilters = {
      ...historyFilters,
      from: event.target.value
    };
    renderHistoryView(container);
  });

  $('#history-filter-to', container)?.addEventListener('change', (event) => {
    historyFilters = {
      ...historyFilters,
      to: event.target.value
    };
    renderHistoryView(container);
  });

  $('#history-filter-user', container)?.addEventListener('change', (event) => {
    historyFilters = {
      ...historyFilters,
      username: event.target.value
    };
    renderHistoryView(container);
  });

  $('#history-clear-filters', container)?.addEventListener('click', () => {
    historyFilters = {
      from: '',
      to: '',
      username: ''
    };
    renderHistoryView(container);
  });

  return {};
}
