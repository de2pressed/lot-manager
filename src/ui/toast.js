const queue = [];
const visibleToasts = new Set();
const MAX_VISIBLE = 3;
const DISMISS_MS = 4000;

function getContainer() {
  return document.getElementById('toast-root');
}

function renderNextToast() {
  if (visibleToasts.size >= MAX_VISIBLE || queue.length === 0) {
    return;
  }

  const toast = queue.shift();
  const container = getContainer();
  const element = document.createElement('div');

  element.className = `toast toast-${toast.type}`;
  element.textContent = toast.message;
  visibleToasts.add(element);
  container.append(element);

  window.setTimeout(() => {
    element.classList.add('toast-leaving');
    window.setTimeout(() => {
      visibleToasts.delete(element);
      element.remove();
      renderNextToast();
    }, 180);
  }, DISMISS_MS);
}

export function showToast(message, type = 'info') {
  queue.push({ message, type });
  renderNextToast();
}
