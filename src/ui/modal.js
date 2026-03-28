import { $, setNodeContent } from '../utils/dom.js';

let activeCleanup = [];
let activeOnClose = null;
let previousFocus = null;

function getModalRoot() {
  return document.getElementById('modal-root');
}

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true');
}

function teardown(reason = 'dismiss') {
  activeCleanup.forEach((cleanup) => cleanup());
  activeCleanup = [];

  const onClose = activeOnClose;
  activeOnClose = null;

  const root = getModalRoot();
  root.innerHTML = '';

  if (previousFocus instanceof HTMLElement) {
    previousFocus.focus();
  }

  if (typeof onClose === 'function') {
    onClose(reason);
  }
}

export function closeModal(reason) {
  teardown(reason);
}

export function isModalOpen() {
  return Boolean($('.modal-overlay', getModalRoot()));
}

export function openModal({
  title,
  description = '',
  body = '',
  footer = '',
  className = '',
  onOpen,
  onClose
}) {
  if (isModalOpen()) {
    teardown('replaced');
  }

  const root = getModalRoot();
  previousFocus = document.activeElement;
  activeOnClose = onClose ?? null;

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-shell ${className}" role="dialog" aria-modal="true" aria-labelledby="shared-modal-title" tabindex="-1">
        <div class="modal-head">
          <div>
            <h2 id="shared-modal-title">${title}</h2>
            ${description ? `<p class="modal-description">${description}</p>` : ''}
          </div>
          <button class="icon-button" type="button" data-close-modal aria-label="Close modal">×</button>
        </div>
        <div class="modal-body" data-modal-body></div>
        ${footer ? '<div class="modal-foot" data-modal-foot></div>' : ''}
      </div>
    </div>
  `;

  const overlay = $('.modal-overlay', root);
  const shell = $('.modal-shell', root);
  const bodyTarget = $('[data-modal-body]', root);
  const footerTarget = $('[data-modal-foot]', root);

  setNodeContent(bodyTarget, body);
  setNodeContent(footerTarget, footer);

  const handleOverlayClick = (event) => {
    if (event.target === overlay) {
      closeModal('overlay');
    }
  };

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeModal('escape');
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = getFocusable(shell);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCloseClick = (event) => {
    const button = event.target.closest('[data-close-modal]');
    if (button) {
      closeModal('button');
    }
  };

  overlay.addEventListener('click', handleOverlayClick);
  root.addEventListener('click', handleCloseClick);
  document.addEventListener('keydown', handleEscape);

  activeCleanup = [
    () => overlay.removeEventListener('click', handleOverlayClick),
    () => root.removeEventListener('click', handleCloseClick),
    () => document.removeEventListener('keydown', handleEscape)
  ];

  onOpen?.({
    root,
    overlay,
    shell,
    body: bodyTarget,
    footer: footerTarget,
    close: closeModal
  });

  const focusable = getFocusable(shell);
  (focusable[0] || shell).focus();
}

export function confirmModal({
  title,
  body,
  description = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary'
}) {
  return new Promise((resolve) => {
    let resolved = false;

    openModal({
      title,
      description,
      body,
      footer: `
        <button class="button button-secondary" type="button" data-modal-cancel>${cancelLabel}</button>
        <button class="button button-${tone}" type="button" data-modal-confirm>${confirmLabel}</button>
      `,
      onOpen({ footer, close }) {
        footer?.addEventListener('click', (event) => {
          if (event.target.closest('[data-modal-cancel]')) {
            resolved = true;
            resolve(false);
            close('cancel');
          }

          if (event.target.closest('[data-modal-confirm]')) {
            resolved = true;
            resolve(true);
            close('confirm');
          }
        });
      },
      onClose() {
        if (!resolved) {
          resolve(false);
        }
      }
    });
  });
}
