/**
 * SMALL UI HELPERS
 * ----------------
 * Just enough to build elements without repeating the same six lines
 * everywhere. No framework, no magic: `h` makes an element, `icon` makes an
 * icon, and the rest are little widgets the screens share.
 */

/**
 * Make an element.
 *   h('button', { class: 'btn', onclick: fn }, 'Save')
 *   h('div', {}, child, anotherChild)
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key in node && key !== 'list' && typeof value !== 'string') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/**
 * One icon from the Phosphor sprite that index.html loads at startup.
 * Icon-only buttons must pass a label, so a screen reader has something to say.
 */
export function icon(name, { size = '', label = null } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', size === 'sm' ? 'icon icon--sm' : 'icon');
  svg.setAttribute('viewBox', '0 0 256 256');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function iconButton(name, label, onClick, extraClass = '') {
  return h('button', {
    class: `btn btn--icon ${extraClass}`.trim(),
    type: 'button',
    'aria-label': label,
    title: label,
    onclick: onClick,
  }, icon(name));
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/**
 * A labelled slider with its value shown in monospace on the right.
 * `format` turns the raw number into what the eye reads.
 */
export function sliderRow({ label, min, max, step, value, format, onInput }) {
  const readout = h('span', { class: 'mono' }, format ? format(value) : String(value));
  const input = h('input', {
    class: 'slider',
    type: 'range',
    min, max, step,
    value,
    'aria-label': label,
  });

  const paint = () => {
    const fraction = (Number(input.value) - min) / (max - min || 1);
    input.style.setProperty('--fill', `${Math.round(fraction * 100)}%`);
  };
  paint();

  input.addEventListener('input', () => {
    const next = Number(input.value);
    readout.textContent = format ? format(next) : String(next);
    paint();
    onInput(next);
  });

  return h('div', { class: 'slider-row' },
    h('div', { class: 'slider-row__head' }, h('span', {}, label), readout),
    input,
  );
}

/**
 * A row of mutually exclusive choices.
 * `options` is [{ value, label }]; `onPick` gets the chosen value.
 */
export function segmented(options, current, onPick, ariaLabel) {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': ariaLabel || '' });
  for (const option of options) {
    const button = h('button', {
      type: 'button',
      'aria-pressed': String(option.value === current),
      onclick: () => onPick(option.value),
    }, option.label);
    button.dataset.value = String(option.value);
    group.append(button);
  }
  // Move the pressed state without rebuilding the row.
  group.select = value => {
    for (const button of group.children) {
      button.setAttribute('aria-pressed', String(button.dataset.value === String(value)));
    }
  };
  return group;
}

export function emptyState(message) {
  return h('p', { class: 'empty' }, message);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastNode = null;
let toastTimer = null;

export function toast(message, ms = 2600) {
  if (toastNode) toastNode.remove();
  clearTimeout(toastTimer);
  toastNode = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(toastNode);
  toastTimer = setTimeout(() => {
    if (toastNode) toastNode.remove();
    toastNode = null;
  }, ms);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Decode a blob into something a canvas can draw. `createImageBitmap` is the
 * fast path; the <img> route is the fallback for older Safari.
 */
export async function decodeImage(blob) {
  if (!blob) return null;
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall through
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('That image could not be opened.'));
      image.src = url;
    });
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
