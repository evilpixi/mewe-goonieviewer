import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { icon } from '../ui/icon.js';
import { openStoryEditor } from '../ui/storyEditor.js';
import { openStoryViewer } from '../ui/storyViewer.js';
import { userName } from '../ui/userName.js';

// Pestaña raíz "Historias": una grilla con quienes tienen historias (la propia primero), sobre fondo negro.
// Cada tarjeta abre el visor a pantalla completa (ui/storyViewer.js); "Crear historia" abre el editor (ui/storyEditor.js).
export function createStoriesView({ navigate }) {
  const createBtn = h('button', { className: 'btn primary', hidden: true, onClick: create }, icon('plus'), ' Crear historia');
  const errorEl = h('div');
  const gridEl = h('div', { className: 'story-grid', attrs: { role: 'list' } });
  const noteEl = h('div');
  const el = h('div', { className: 'view scroll stories-view' }, errorEl, gridEl, noteEl);

  let account = null;
  let mine = null; // mis historias, como un "teller" más
  let others = [];
  let requestId = 0; // descarta respuestas de una cuenta que ya no está activa

  function create() {
    if (account) openStoryEditor({ account, onDone: () => load() });
  }

  function open(teller) {
    const tellers = [mine, ...others].filter((item) => item?.stories.length);
    openStoryViewer({
      account,
      tellers,
      index: Math.max(0, tellers.indexOf(teller)),
      navigate,
      // al cerrar: los anillos de "sin ver" y las historias borradas
      onClose: render,
    });
  }

  // Tarjeta 9:16 con la primera historia sin ver de fondo, la foto con su anillo y el nombre
  function card(teller) {
    const preview = (teller.stories.find((story) => story.isNew) ?? teller.stories[0])?.image?.src;
    const label = teller.isMine ? 'Tu historia' : teller.name;
    return h(
      'div',
      { className: 'story-card-slot', attrs: { role: 'listitem' } },
      h(
        'button',
        {
          className: `story-card ${teller.hasNew ? 'unseen' : 'seen'}`,
          title: label,
          attrs: { 'aria-label': `Ver la historia de ${teller.isMine ? 'tu cuenta' : teller.name}${teller.hasNew ? ' (sin ver)' : ''}` },
          onClick: () => open(teller),
        },
        preview && h('img', { className: 'story-card-img', src: imageUrl(account.id, preview), alt: '', loading: 'lazy' }),
        h('span', { className: 'story-card-ring' }, avatar(account.id, teller.avatar, { name: teller.name, size: 'lg' })),
        userName(label, { className: 'story-card-name' }),
      ),
      teller.isMine &&
        h('button', { className: 'story-card-add', title: 'Crear otra historia', attrs: { 'aria-label': 'Crear otra historia' }, onClick: create }, icon('plus')),
    );
  }

  // Sin historias propias: la primera tarjeta invita a crear una
  function createCard() {
    return h(
      'div',
      { className: 'story-card-slot', attrs: { role: 'listitem' } },
      h(
        'button',
        { className: 'story-card empty', attrs: { 'aria-label': 'Crear una historia' }, onClick: create },
        h('span', { className: 'story-card-plus' }, icon('plus')),
        h('span', { className: 'story-card-name' }, 'Crear historia'),
      ),
    );
  }

  function render() {
    if (!account) return;
    others = others.filter((teller) => teller.stories.length);
    gridEl.replaceChildren(mine?.stories.length ? card(mine) : createCard(), ...others.map(card));
    noteEl.replaceChildren(...(others.length ? [] : [emptyState('Nadie a quien sigues tiene historias ahora.')]));
  }

  async function load() {
    if (!account) return;
    const current = ++requestId;
    const active = account;
    clearError(errorEl);
    gridEl.replaceChildren();
    noteEl.replaceChildren(emptyState('Cargando historias…'));
    try {
      // las propias se piden aparte: la lista de historias no siempre trae a la cuenta
      const [tellers, own] = await Promise.all([
        api.getStorytellers(active.id),
        active.userId ? api.getStories(active.id, active.userId).catch(() => []) : [],
      ]);
      if (current !== requestId) return;
      const me = tellers.find((teller) => teller.isMine);
      mine = {
        id: active.userId,
        type: 'User',
        isPage: false,
        name: active.name,
        avatar: active.avatar,
        handle: null,
        ...me,
        isMine: true,
        hasNew: false,
        stories: own.length ? own : (me?.stories ?? []),
      };
      others = tellers.filter((teller) => !teller.isMine);
      render();
    } catch (err) {
      if (current !== requestId) return;
      noteEl.replaceChildren();
      showError(errorEl, err, 'MeWe historias');
    }
  }

  return {
    el,
    toolbar: { left: createBtn },
    show(newAccount) {
      account = newAccount;
      requestId++;
      mine = null;
      others = [];
      createBtn.hidden = !account;
      clearError(errorEl);
      if (account) load();
      else {
        gridEl.replaceChildren();
        noteEl.replaceChildren(emptyState('Agrega una cuenta con el botón + de la izquierda.'));
      }
    },
    hide() {
      requestId++;
    },
    reload: () => load(),
  };
}
