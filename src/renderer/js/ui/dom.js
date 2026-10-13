// h('button', { className: 'btn', onClick: fn, dataset: { id: 1 } }, 'Texto', otroNodo)
// - props `on<Evento>` se registran como listeners
// - `dataset` y `style` (objeto) se copian; `attrs` se aplica con setAttribute (aria-*, role…)
// - el resto se asigna como propiedad del elemento (className, hidden, src, title…)
// - los hijos null/undefined/false se ignoran; strings y números se convierten en texto; los arrays se aplanan
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'attrs') {
      for (const [name, attr] of Object.entries(value)) {
        if (attr != null && attr !== false) el.setAttribute(name, attr === true ? '' : String(attr));
      }
    } else {
      el[key] = value;
    }
  }
  el.append(...flatten(children));
  return el;
}

function flatten(children) {
  return children
    .flat(Infinity)
    .filter((child) => child != null && child !== false)
    .map((child) => (child instanceof Node ? child : String(child)));
}

// Pone un spinner sobre `box` (que tiene que estar posicionada) hasta que `media`, una imagen o un video,
// cargue o falle. Devuelve `media`.
export function spinWhileLoading(box, media) {
  const spinner = h('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } });
  const done = () => spinner.remove();
  media.addEventListener(media instanceof HTMLVideoElement ? 'loadeddata' : 'load', done, { once: true });
  media.addEventListener('error', done, { once: true });
  box.append(spinner);
  return media;
}

// Mensaje gris centrado ("Cargando…", "No hay mensajes."…)
export function emptyState(text, tag = 'p') {
  // dentro de una lista (li) no se cambia el rol: dejaría de ser un ítem
  return h(tag, { className: 'empty', attrs: { role: tag === 'li' ? null : 'status' } }, text);
}
