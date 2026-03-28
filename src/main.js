import './styles/base.css';
import './styles/auth.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/views.css';

import { supabase } from './supabase.js';
import { renderLogin } from './auth/login.js';
import { showToast } from './ui/toast.js';
import { mountApp, unmountApp } from './ui/layout.js';
import { checkLocalStorageMigration } from './migrations/localStorage.js';

let activeUserId = null;

async function handleSession(session) {
  const nextUserId = session?.user?.id ?? null;

  if (nextUserId === activeUserId && nextUserId !== null) {
    return;
  }

  activeUserId = nextUserId;

  if (!session) {
    unmountApp();
    renderLogin();
    return;
  }

  try {
    await checkLocalStorageMigration(session.user.id);
    await mountApp(session);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to initialize the workspace.', 'error');
    await supabase.auth.signOut();
    unmountApp();
    renderLogin();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  renderLogin();

  const {
    data: { session }
  } = await supabase.auth.getSession();

  await handleSession(session);

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    queueMicrotask(() => {
      handleSession(nextSession);
    });
  });
});
