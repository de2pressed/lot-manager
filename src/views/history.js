import { state } from '../state.js';
import { escapeHtml, formatCurrency, formatDateTime } from '../utils/format.js';

const ACTIVITY_LABELS = {
  sale_reverted: 'Sale Reverted',
  item_defected: 'Marked as Defected',
  defect_reverted: 'Restored from Defected'
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

export async function renderHistoryView(container) {
  const items = state.log;

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
        items.length
          ? `
            <div class="history-feed">
              ${items
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
              <h3>No activity yet</h3>
              <p>Write actions will appear here once the team starts using the hub.</p>
            </div>
          `
      }
    </section>
  `;

  return {};
}
