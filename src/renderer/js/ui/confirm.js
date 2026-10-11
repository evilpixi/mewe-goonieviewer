import { h } from './dom.js';

// Diálogo de confirmación propio (reemplaza al confirm() nativo). Devuelve una promesa: true si se confirmó.
//   danger: el botón de confirmar va en rojo (bloquear, quitar…)
// Se cierra con Esc o Cancelar (false). El foco arranca en Cancelar para que Enter no confirme sin querer.
export function confirmDialog({ title, text = '', confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const cancelBtn = h('button', { type: 'button', className: 'btn' }, cancelLabel);
    const confirmBtn = h('button', { type: 'button', className: `btn ${danger ? 'danger-solid' : 'primary'}` }, confirmLabel);
    const dialog = h(
      'dialog',
      { className: 'modal confirm', attrs: { role: 'alertdialog', 'aria-label': title } },
      h('h2', { attrs: { dir: 'auto' } }, title),
      text && h('p', { className: 'confirm-text' }, text),
      h('div', { className: 'modal-actions' }, cancelBtn, confirmBtn),
    );
    cancelBtn.addEventListener('click', () => dialog.close());
    confirmBtn.addEventListener('click', () => dialog.close('ok'));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'ok');
    });
    document.body.append(dialog);
    dialog.showModal();
    cancelBtn.focus();
  });
}
