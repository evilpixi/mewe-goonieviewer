// Navegación entre vistas con historial (se vuelve con Alt+←; no hay botón).
//
// Una vista se registra con registerView(name, factory). factory({ navigate, back }) se llama una sola vez
// (la primera vez que se navega a ella) y devuelve:
//   { el, toolbar?, show(account, params), hide?(), reload?() }
// - el: raíz de la vista; el router la agrega a `host` y la oculta/muestra
// - toolbar: controles propios que van en el segundo panel mientras la vista está activa. Un nodo (va al centro)
//   o { left, center, right } para repartirlos en las tres zonas.
// - show: se llama cada vez que la vista pasa a estar activa (o cambia la cuenta/los params)
// toolbarSlots: { left, center, right }, los contenedores de cada zona.
// onChange({ view, params, canGoBack, hasToolbar, canReload }) avisa de cada cambio de vista.
export function createRouter({ host, toolbarSlots, onChange }) {
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

  // Reparte los controles de la vista en las zonas. Devuelve si puso alguno.
  function mountToolbar(toolbar) {
    const zones = toolbar instanceof Node ? { center: toolbar } : (toolbar ?? {});
    for (const [zone, slot] of Object.entries(toolbarSlots)) slot.replaceChildren(...(zones[zone] ? [zones[zone]] : []));
    return Object.keys(toolbarSlots).some((zone) => zones[zone]);
  }

  // focus: al navegar con teclado, el foco pasa a la vista nueva (si no, queda en un botón que ya no existe)
  function activate({ focus = false } = {}) {
    const entry = stack.at(-1);
    const next = instance(entry.view);
    active?.hide?.();
    if (active && active !== next) active.el.hidden = true;
    active = next;
    next.el.hidden = false;
    const hasToolbar = mountToolbar(next.toolbar);
    next.show(account, entry.params);
    onChange?.({ ...entry, canGoBack: stack.length > 1, hasToolbar, canReload: Boolean(next.reload) });
    if (focus) {
      next.el.tabIndex = -1;
      next.el.focus({ preventScroll: true });
    }
  }

  function navigate(view, params = {}, { replace = false } = {}) {
    if (!factories.has(view)) {
      console.warn(`[router] vista no implementada todavía: ${view}`, params);
      return;
    }
    if (replace) stack.pop();
    stack.push({ view, params });
    activate({ focus: true });
  }

  function back() {
    if (stack.length < 2) return;
    stack.pop();
    activate({ focus: true });
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
    // La misma cuenta con datos nuevos (cambió su nombre o su foto): se queda en la vista en la que está
    updateAccount(newAccount) {
      account = newAccount;
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
