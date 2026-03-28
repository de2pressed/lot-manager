export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function setNodeContent(target, content) {
  if (!target) return;

  if (typeof content === 'string') {
    target.innerHTML = content;
    return;
  }

  target.innerHTML = '';
  if (content instanceof Node) {
    target.append(content);
  }
}

export function createElement(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
