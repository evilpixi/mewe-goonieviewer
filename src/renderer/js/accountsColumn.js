import { avatar } from './ui/avatar.js';
import { h } from './ui/dom.js';

// Columna vertical de cuentas. Llama a onSelect(account) y onAdd().
// En mobile no se ve: la reemplaza el menú de cuentas de la cabecera (app.js).
export function createAccountsColumn({ listEl, addButton, onSelect, onAdd }) {
  let accounts = [];
  let activeId = null;

  addButton.addEventListener('click', onAdd);

  function render() {
    listEl.replaceChildren(
      ...accounts.map((account) => {
        const btn = h(
          'button',
          {
            className: `account-btn${account.id === activeId ? ' active' : ''}`,
            title: account.email ? `${account.name}\n${account.email}` : account.name,
            attrs: { 'aria-label': account.name, 'aria-current': account.id === activeId ? 'true' : null },
            onClick: () => onSelect(account),
          },
          avatar(account.id, account.avatar, { name: account.name, size: 'lg' }),
        );
        return h('li', {}, btn);
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
  };
}
