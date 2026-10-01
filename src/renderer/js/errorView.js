// Muestra un error de la API en pantalla y en la consola (DevTools).
export function showError(container, err, context = 'MeWe API') {
  const details = err?.details ?? { message: err?.message ?? String(err) };
  console.error(`[${context}]`, details);

  const box = document.createElement('div');
  box.className = 'error-box';

  const title = document.createElement('strong');
  title.textContent = details.message;
  box.append(title);

  if (details.hint) {
    const hint = document.createElement('div');
    hint.textContent = details.hint;
    box.append(hint);
  }

  const meta = [
    details.status && `HTTP ${details.status}`,
    details.errorCode != null && `errorCode ${details.errorCode}`,
    details.url,
  ].filter(Boolean);
  if (meta.length) {
    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.textContent = meta.join(' · ');
    box.append(metaEl);
  }

  if (details.body) {
    const more = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Respuesta de la API';
    const pre = document.createElement('pre');
    pre.textContent = typeof details.body === 'string' ? details.body : JSON.stringify(details.body, null, 2);
    more.append(summary, pre);
    box.append(more);
  }

  container.replaceChildren(box);
}

export function clearError(container) {
  container.replaceChildren();
}
