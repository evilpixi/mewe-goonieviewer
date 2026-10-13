import { avatar } from './ui/avatar.js';
import { h } from './ui/dom.js';

// Columna vertical de cuentas. Llama a onSelect(account) y onAdd().
// En mobile no se ve: la reemplaza el menú de cuentas de la cabecera (app.js).
export function createAccountsColumn({ listEl, addButton, onSelect, onAdd }) {
  let accounts = [];
  let activeId = null;
  let activityOf = () => ''; // ver setActivity

  addButton.addEventListener('click', onAdd);

  function render() {
    listEl.replaceChildren(
      ...accounts.map((account) => {
        const news = activityOf(account.id);
        const btn = h(
          'button',
          {
            className: `account-btn${account.id === activeId ? ' active' : ''}`,
            title: [account.name, account.email, news].filter(Boolean).join('\n'),
            attrs: { 'aria-label': news ? `${account.name}: ${news}` : account.name, 'aria-current': account.id === activeId ? 'true' : null },
            onClick: () => onSelect(account),
          },
          avatar(account.id, account.avatar, { name: account.name, size: 'lg' }),
        );
        // el punto va fuera del botón, que recorta lo que sobresale de la foto
        return h('li', {}, btn, news && h('span', { className: 'account-dot', attrs: { 'aria-hidden': 'true' } }));
      }),
    );
    // la cuenta activa siempre a la vista, aunque la lista no entre entera
    listEl.querySelector('.account-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return {
    setAccounts(list) {
      accounts = list;
      render();
    },
    setActive(id) {
      activeId = id;
      render();
    },
    // describe(accountId) → las novedades de esa cuenta en palabras ('' si no tiene): las que tienen llevan un punto de aviso
    setActivity(describe) {
      activityOf = describe;
      render();
    },
  };
}
