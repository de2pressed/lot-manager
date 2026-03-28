import { signIn } from './session.js';
import { showToast } from '../ui/toast.js';

export function renderLogin() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-backdrop"></div>
      <div class="auth-card">
        <p class="auth-kicker">Raptile Studio</p>
        <h1>Ops Hub</h1>
        <p class="auth-copy">
          Team access only. Sign in with the credentials issued by your admin.
        </p>
        <form id="login-form" class="auth-form">
          <label>
            <span>Email</span>
            <input id="login-email" type="email" autocomplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <input id="login-password" type="password" autocomplete="current-password" required />
          </label>
          <button class="button button-primary auth-submit" type="submit">Sign In</button>
        </form>
        <p class="auth-help">Contact admin to get access.</p>
      </div>
    </section>
  `;

  const form = document.getElementById('login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');

    submitButton.disabled = true;
    submitButton.textContent = 'Signing In...';

    try {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      await signIn(email, password);
    } catch (error) {
      showToast(error.message || 'Unable to sign in.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Sign In';
    }
  });
}
