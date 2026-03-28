import { state } from '../state.js';
import { guardRole } from '../utils/access.js';
import { $, $$ } from '../utils/dom.js';
import { ROLE_OPTIONS } from '../utils/constants.js';
import { escapeHtml, formatDateTime } from '../utils/format.js';
import { confirmModal, openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import {
  createUserAccount,
  deleteUserAccount,
  fetchProfiles,
  updateProfileRole
} from '../services/admin.service.js';

function openCreateUserModal(container) {
  const body = document.createElement('div');
  const footer = document.createElement('div');

  body.innerHTML = `
    <form class="modal-form" id="create-user-form">
      <div class="form-grid-2">
        <div class="field-group">
          <label class="field-label" for="new-email">Email</label>
          <input type="email" id="new-email" autocomplete="off" placeholder="user@example.com" required />
        </div>
        <div class="field-group">
          <label class="field-label" for="new-username">Username</label>
          <input type="text" id="new-username" autocomplete="off" placeholder="team_member" required />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="field-group">
          <label class="field-label" for="new-password">Password</label>
          <input type="password" id="new-password" autocomplete="new-password" placeholder="••••••••" required />
        </div>
        <div class="field-group">
          <label class="field-label" for="new-role">Role</label>
          <select id="new-role">
            ${ROLE_OPTIONS.map((role) => `<option value="${role}">${role}</option>`).join('')}
          </select>
        </div>
      </div>
    </form>
  `;

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="create-user-form">Create User</button>
  `;

  openModal({
    title: 'Create User',
    description: 'Creates the auth user through the serverless admin endpoint.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      $('#create-user-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          await createUserAccount(
            {
              email: $('#new-email', bodyTarget).value.trim(),
              username: $('#new-username', bodyTarget).value.trim(),
              password: $('#new-password', bodyTarget).value,
              role: $('#new-role', bodyTarget).value
            },
            state.currentUser.id
          );

          const profiles = await fetchProfiles();
          state.setCollection('profiles', profiles);

          close('saved');
          showToast('User created.', 'success');
          renderAdminView(container);
        } catch (error) {
          showToast(error.message || 'Unable to create user.', 'error');
        }
      });
    }
  });
}

export async function renderAdminView(container) {
  if (!guardRole(['admin'])) {
    return {};
  }

  const pushedLots = state.lots.filter((lot) => lot.status === 'pushed');

  container.innerHTML = `
    <section class="page-section">
      <div class="page-header-block page-header-inline">
        <div>
          <p class="eyebrow">Administration</p>
          <h2>Admin</h2>
          <p class="page-copy">Manage team access, role assignments, and lot push accountability.</p>
        </div>
        <button class="button button-primary" id="admin-create-user" type="button">Create User</button>
      </div>

      <div class="panel-stack">
        <article class="panel-card">
          <div class="panel-head">
            <h3>Users</h3>
            <span>${state.profiles.length} profiles</span>
          </div>
          <div class="table-card nested">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${state.profiles
                  .map(
                    (profile) => `
                      <tr>
                        <td>${escapeHtml(profile.username)}</td>
                        <td>
                          ${
                            profile.id === state.currentUser.id
                              ? `<span class="badge badge-info">${escapeHtml(profile.role)}</span>`
                              : `<select class="inline-select" data-profile-role="${profile.id}">
                                  ${ROLE_OPTIONS.map(
                                    (role) =>
                                      `<option value="${role}" ${role === profile.role ? 'selected' : ''}>${role}</option>`
                                  ).join('')}
                                </select>`
                          }
                        </td>
                        <td>${formatDateTime(profile.created_at)}</td>
                        <td>
                          ${
                            profile.id === state.currentUser.id
                              ? '<span class="muted-copy">Current user</span>'
                              : `<button class="button button-danger button-small" type="button" data-delete-user="${profile.id}">Delete</button>`
                          }
                        </td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Lot Push Audit</h3>
            <span>${pushedLots.length} pushed lots</span>
          </div>
          ${
            pushedLots.length
              ? `
                <div class="table-card nested">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Lot</th>
                        <th>Pushed By</th>
                        <th>Pushed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${pushedLots
                        .map((lot) => {
                          const profile = state.profiles.find((entry) => entry.id === lot.pushed_by);
                          return `
                            <tr>
                              <td>${escapeHtml(lot.name)}</td>
                              <td>${escapeHtml(profile?.username || lot.pushed_by || 'Unknown')}</td>
                              <td>${formatDateTime(lot.pushed_at)}</td>
                            </tr>
                          `;
                        })
                        .join('')}
                    </tbody>
                  </table>
                </div>
              `
              : '<div class="empty-state-card nested"><h3>No pushed lots yet</h3><p>Once lots are pushed into inventory they will appear here.</p></div>'
          }
        </article>
      </div>
    </section>
  `;

  $('#admin-create-user', container)?.addEventListener('click', () => openCreateUserModal(container));

  $$('[data-profile-role]', container).forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await updateProfileRole(select.dataset.profileRole, select.value, state.currentUser.id);
        showToast('Role updated.', 'success');
        renderAdminView(container);
      } catch (error) {
        showToast(error.message || 'Unable to update role.', 'error');
      }
    });
  });

  $$('[data-delete-user]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const target = state.profiles.find((profile) => profile.id === button.dataset.deleteUser);
      if (!target) return;

      const confirmed = await confirmModal({
        title: 'Delete User',
        body: `<p>Delete <strong>${escapeHtml(target.username)}</strong>? This removes their auth account.</p>`,
        confirmLabel: 'Delete User',
        tone: 'danger'
      });

      if (!confirmed) return;

      try {
        await deleteUserAccount(target.id, state.currentUser.id);
        const profiles = await fetchProfiles();
        state.setCollection('profiles', profiles);
        showToast('User deleted.', 'success');
        renderAdminView(container);
      } catch (error) {
        showToast(error.message || 'Unable to delete user.', 'error');
      }
    });
  });

  return {};
}
