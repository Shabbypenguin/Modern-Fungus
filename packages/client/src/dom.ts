type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Minimal element builder: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/**
 * System 7 title bar. With `onClose`, a close box sits at the left end — the
 * classic Mac way to close a window. It's always a shortcut, never the only way out.
 */
export function titlebar(title: string, onClose?: () => void, closeLabel = 'Close'): HTMLElement {
  return h(
    'header',
    { class: 'titlebar' },
    onClose ? h('button', { type: 'button', class: 'close-box', 'aria-label': closeLabel, title: closeLabel, onclick: onClose }) : null,
    h('span', {}, title),
  );
}
