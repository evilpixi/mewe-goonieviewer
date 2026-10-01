// Navegación entre vistas con historial (botón Volver).
//
// Una vista se registra con registerView(name, factory). factory({ navigate, back }) se llama una sola vez
// (la primera vez que se navega a ella) y devuelve:
//   { el, toolbar?, show(account, params), hide?(), reload?() }
// - el: raíz de la vista; el router la agrega a `host` y la oculta/muestra
// - toolbar: controles propios que se colocan en la cabecera mientras la vista está activa
// - show: se llama cada vez que la vista pasa a estar activa (o cambia la cuenta/los params)
export function createRouter({ host, toolbarSlot, onChange }) {
  const factories = new Map();
  const instances = new Map();
  let account = null;
  let stack = []; // [{ view, params }]
  let active = null; // instancia visible

  function instance(name) {
    if (!instances.has(name)) {
      const view = factories.get(name)({ navigate, back });
      view.el.hidden = true;
      host.append(view.el);
      instances.set(name, view);
    }
    return instances.get(name);
  }

  function activate() {
    const entry = stack.at(-1);
    const next = instance(entry.view);
    active?.hide?.();
    if (active && active !== next) active.el.hidden = true;
    active = next;
    next.el.hidden = false;
    toolbarSlot.replaceChildren(...(next.toolbar ? [next.toolbar] : []));
    next.show(account, entry.params);
    onChange?.({ ...entry, canGoBack: stack.length > 1 });
  }

  function navigate(view, params = {}, { replace = false } = {}) {
    if (!factories.has(view)) {
      console.warn(`[router] vista no implementada todavía: ${view}`, params);
      return;
    }
    if (replace) stack.pop();
    stack.push({ view, params });
    activate();
  }

  function back() {
    if (stack.length < 2) return;
    stack.pop();
    activate();
  }

  return {
    registerView(name, factory) {
      factories.set(name, factory);
    },
    navigate,
    back,
    // Cambiar de cuenta reinicia el historial en la vista raíz indicada
    setAccount(newAccount, rootView) {
      account = newAccount;
      stack = [{ view: rootView, params: {} }];
      activate();
    },
    // Cambia de pestaña raíz (Feed/Chats) descartando el historial
    setRoot(rootView) {
      stack = [{ view: rootView, params: {} }];
      activate();
    },
    reload() {
      active?.reload?.();
    },
    current: () => stack.at(-1) ?? null,
  };
}
