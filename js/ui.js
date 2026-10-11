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
 * A labelled slider with its value shown on the right.
 * `format` turns the raw number into what the eye reads.
 */
export function sliderRow({ label, min, max, step, value, format, onInput }) {
  const readout = h('span', {}, format ? format(value) : String(value));
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
 * A segmented control: equal segments on a track, with a raised thumb that
 * slides to the chosen one. `options` is [{ value, label }]; `onPick` gets
 * the chosen value.
 */
export function segmented(options, current, onPick, ariaLabel) {
  const thumb = h('span', { class: 'seg__thumb', 'aria-hidden': 'true' });
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel || '' }, thumb);
  group.style.setProperty('--n', String(options.length));
  const buttons = options.map(option => {
    const button = h('button', {
      type: 'button',
      onclick: () => onPick(option.value),
    }, option.label);
    button.dataset.value = String(option.value);
    group.append(button);
    return button;
  });
  // Move the pressed state and the thumb without rebuilding the row.
  group.select = value => {
    buttons.forEach((button, index) => {
      const on = button.dataset.value === String(value);
      button.setAttribute('aria-pressed', String(on));
      if (on) group.style.setProperty('--i', String(index));
    });
  };
  group.select(current);
  return group;
}

/** A row with an on/off switch at its end. */
export function switchRow(label, checked, onChange) {
  const input = h('input', {
    class: 'switch',
    type: 'checkbox',
    role: 'switch',
    checked,
    'aria-label': label,
    onchange: () => onChange(input.checked),
  });
  return h('label', { class: 'row', style: { cursor: 'pointer' } },
    h('span', { class: 'row__main' }, label), input);
}

export function emptyState(message) {
  return h('p', { class: 'empty' }, message);
}

/** The page's large title, with an optional line under it. */
export function largeTitle(text, subtitle = null) {
  return h('div', { class: 'page__head' },
    h('h1', { class: 'large-title' }, text),
    subtitle ? h('p', { class: 'subtitle' }, subtitle) : null,
  );
}

/**
 * The small caps line over a group, with an optional value at its end.
 * An empty string still gets a slot, so a count can be written into it once
 * the list it measures has loaded. Only null means "no value here".
 */
export function sectionHead(name, value = null) {
  return h('p', { class: 'section__head' },
    h('span', {}, name),
    value === null || value === undefined ? null : h('span', { class: 'section__value' }, value),
  );
}

/** A header, then whatever belongs under it. */
export function section(head, ...children) {
  return h('section', { class: 'section' },
    typeof head === 'string' ? sectionHead(head) : head, ...children);
}

export function footnote(text) {
  return h('p', { class: 'footnote' }, text);
}

/**
 * The loop position, drawn like a player's scrubber: elapsed time, a track
 * that fills, and the loop length. Returns the element plus a `set`
 * function, so the editor can drive it every frame without rebuilding
 * anything.
 */
export function loopTimer() {
  const fill = h('span', { class: 'timer__fill' });
  const now = h('span', { class: 'timer__time' }, '0.0');
  const total = h('span', { class: 'timer__time' }, '8.0');
  const node = h('div', { class: 'timer', 'aria-hidden': 'true' },
    now, h('span', { class: 'timer__track' }, fill), total);
  let lastNow = '0.0';
  let lastTotal = '8.0';

  return {
    node,
    set(t, loopSeconds) {
      const fraction = loopSeconds > 0 ? Math.min(1, t / loopSeconds) : 0;
      // A transform, not a width, so it never costs a layout.
      fill.style.transform = `scaleX(${fraction})`;
      // The count only shows tenths, so it is only written when a tenth has
      // gone by rather than on every frame.
      const tenths = t.toFixed(1);
      if (tenths !== lastNow) { now.textContent = tenths; lastNow = tenths; }
      const whole = loopSeconds.toFixed(1);
      if (whole !== lastTotal) { total.textContent = whole; lastTotal = whole; }
    },
  };
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastNode = null;
let toastTimer = null;

export function toast(message, ms = 2600) {
  if (toastNode) toastNode.remove();
  clearTimeout(toastTimer);
  const node = h('div', { class: 'toast', role: 'status' }, message);
  toastNode = node;
  document.body.append(node);
  toastTimer = setTimeout(() => {
    // Leaves the way it came in, then goes.
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);
    if (toastNode === node) toastNode = null;
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
