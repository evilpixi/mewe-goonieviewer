import { api, imageUrl } from '../api.js';
import { openNewGroupChat } from '../chat/groupChat.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { icon } from '../ui/icon.js';
import { openCreateGroup } from '../ui/groupAdmin.js';
import { confirmBlock, copyLinkButton, openChatWith, personRow } from '../ui/people.js';
import { plainText } from '../ui/richText.js';
import { createTabs } from '../ui/tabs.js';
import { userName } from '../ui/userName.js';

const LIST_KEY = 'listsTab';
const PEOPLE_KEY = 'listsPeople';
const LISTS = [
  ['groups', 'Grupos', 'layout-grid'],
  ['people', 'Personas', 'users'],
];
// Submenú de Personas
const PEOPLE = [
  ['following', 'Siguiendo', 'user-check'],
  ['followers', 'Seguidores', 'heart'],
];
const MAX_PAGES_PER_SEARCH = 40; // tope de páginas que se traen solas al filtrar una lista de personas
const MAX_PREVIEWS = 10; // publicaciones nuevas que se muestran por grupo (después, "Ver más")
const PREVIEW_TEXT_CHARS = 160; // comienzo del texto de una publicación en su tarjeta

// Para comparar texto sin distinguir mayúsculas ni acentos
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin storage: no se recuerda
  }
}

// Antes Siguiendo y Seguidores eran pestañas sueltas: se respeta la que se había elegido
function savedList() {
  const value = stored(LIST_KEY);
  if (PEOPLE.some(([id]) => id === value)) return 'people';
  return LISTS.some(([id]) => id === value) ? value : 'groups';
}

function savedPeople() {
  const value = stored(PEOPLE_KEY) ?? stored(LIST_KEY);
  return PEOPLE.some(([id]) => id === value) ? value : 'following';
}

// Pestaña raíz "Listas": mis grupos (y las invitaciones pendientes) y las personas (las que sigo y las que me
// siguen, en un submenú), con un filtro por nombre que abre el botón 🔍. Los grupos con publicaciones nuevas
// muestran debajo una tira con ellas. Desde una persona: ver su perfil, mandarle un mensaje, copiar su link o
// bloquearla. A la izquierda del segundo panel: crear un grupo o, en Personas, un chat grupal.
export function createListsView({ navigate }) {
  const tabs = createTabs({ label: 'Lista', tabs: LISTS, onChange: changeList });
  const peopleTabs = createTabs({ label: 'Personas', tabs: PEOPLE, onChange: changePeople });
  const peopleBar = h('div', { className: 'tabs-bar', hidden: true }, peopleTabs.el);
  const search = h('input', {
    type: 'search',
    className: 'input',
    attrs: { 'aria-label': 'Filtrar la lista' },
    onInput: () => onSearch(),
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleSearch(false);
  });
  const searchBar = h('div', { className: 'list-search', hidden: true }, search);
  const searchBtn = h(
    'button',
    { className: 'btn icon-btn', title: 'Buscar en la lista', attrs: { 'aria-label': 'Buscar en la lista', 'aria-pressed': 'false' }, onClick: () => toggleSearch() },
    icon('search'),
  );
  const createGroupBtn = h(
    'button',
    { className: 'btn primary icon-btn', title: 'Crear grupo', attrs: { 'aria-label': 'Crear grupo', 'aria-haspopup': 'dialog' }, onClick: () => createGroup() },
    icon('plus'),
  );
  const newChatBtn = h(
    'button',
    { className: 'btn primary icon-btn', title: 'Nuevo chat grupal', attrs: { 'aria-label': 'Nuevo chat grupal', 'aria-haspopup': 'dialog' }, onClick: () => newGroupChat() },
    icon('message-circle-plus'),
  );
  const toolbarLeft = h('div', { className: 'toolbar-slot' }, createGroupBtn, newChatBtn, searchBtn);
  const errorEl = h('div');
  const listEl = h('ul', { className: 'people-list card' });
  const moreBtn = h('button', { className: 'btn load-more', hidden: true, onClick: () => loadPeople(true) }, 'Cargar más');
  const el = h('div', { className: 'view scroll page' }, searchBar, peopleBar, errorEl, listEl, moreBtn);

  let account = null;
  let list = savedList(); // 'groups' | 'people'
  let peopleKind = savedPeople(); // 'following' | 'followers'
  let groups = [];
  const previews = new Map(); // groupId → promesa con las publicaciones de su feed (para las vistas previas)
  let people = [];
  let nextPage = null;
  let loading = false;
  let generation = 0; // descarta respuestas de otra cuenta u otra lista

  function changeList(value) {
    list = value;
    store(LIST_KEY, value);
    load();
  }

  function changePeople(value) {
    peopleKind = value;
    store(PEOPLE_KEY, value);
    load();
  }

  // El botón 🔍 muestra u oculta la barra de búsqueda; al ocultarla se borra lo buscado
  function toggleSearch(open = searchBar.hidden) {
    searchBar.hidden = !open;
    searchBtn.setAttribute('aria-pressed', String(open));
    if (open) search.focus();
    else if (search.value) {
      search.value = '';
      render();
    }
  }

  function load() {
    generation++;
    loading = false;
    groups = [];
    previews.clear();
    previewObserver.disconnect();
    people = [];
    nextPage = null;
    moreBtn.hidden = true;
    const isGroups = list === 'groups';
    search.placeholder = isGroups ? 'Filtrar grupos…' : 'Filtrar personas…';
    createGroupBtn.hidden = !isGroups;
    newChatBtn.hidden = isGroups;
    peopleBar.hidden = isGroups;
    peopleTabs.select(peopleKind);
    clearError(errorEl);
    listEl.replaceChildren(emptyState('Cargando…', 'li'));
    if (isGroups) loadGroups();
    else loadPeople();
  }

  // Crea un chat grupal y lo abre en Chats
  async function newGroupChat() {
    const acc = account;
    if (!acc) return;
    const thread = await openNewGroupChat({ account: acc });
    if (thread?.id && acc === account) navigate('chat', { thread });
  }

  // --- Grupos ---

  async function loadGroups() {
    const gen = generation;
    try {
      const result = await api.getGroups(account.id);
      if (gen !== generation) return;
      groups = result.sort((a, b) => Number(b.isInvited) - Number(a.isInvited) || a.name.localeCompare(b.name));
      render();
    } catch (err) {
      if (gen !== generation) return;
      listEl.replaceChildren();
      showError(errorEl, err, 'MeWe grupos');
    }
  }

  // Crea un grupo y lo abre
  async function createGroup() {
    const acc = account;
    if (!acc) return;
    const group = await openCreateGroup({ account: acc });
    if (group?.id && acc === account) navigate('group', { groupId: group.id });
  }

  // --- Vista previa de las publicaciones nuevas de cada grupo ---

  // Las pide recién cuando el grupo aparece en pantalla, una vez por carga de la lista
  const previewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        previewObserver.unobserve(entry.target);
        entry.target.fill?.();
      }
    },
    { rootMargin: '200px' },
  );

  // Tira horizontal de tarjetas, una por publicación nueva (hasta MAX_PREVIEWS), y al final "Ver más", que abre
  // el grupo
  function renderPreviews(group) {
    const acc = account;
    const gen = generation;
    const count = Math.min(group.newPosts, MAX_PREVIEWS);
    const strip = h(
      'ul',
      { className: 'group-previews', attrs: { 'aria-label': `Publicaciones nuevas de ${group.name}` } },
      Array.from({ length: count }, () => h('li', { className: 'group-preview loading' })),
    );
    strip.fill = async () => {
      try {
        if (!previews.has(group.id)) previews.set(group.id, api.getGroupFeed(acc.id, group.id).then((page) => page.posts));
        const posts = (await previews.get(group.id)).slice(0, count);
        if (gen !== generation || acc !== account) return;
        if (!posts.length) {
          strip.remove();
          return;
        }
        strip.replaceChildren(
          ...posts.map((post) => h('li', {}, previewCard(group, post))),
          h(
            'li',
            {},
            h(
              'button',
              { className: 'group-preview group-preview-more', onClick: () => navigate('group', { groupId: group.id }) },
              icon('chevron-right'),
              h('span', {}, 'Ver más'),
            ),
          ),
        );
      } catch (err) {
        previews.delete(group.id);
        console.warn('[grupos] vista previa', err);
        strip.remove();
      }
    };
    previewObserver.observe(strip);
    return strip;
  }

  // Tarjeta de una publicación: su imagen (si tiene), el comienzo del texto, que se desvanece para dar a entender
  // que sigue, y abajo la foto y el nombre de quien la publicó
  function previewCard(group, post) {
    const image = post.images[0] ?? post.shared?.images?.[0];
    const text = plainText(post.text || post.shared?.text || '').trim();
    return h(
      'button',
      {
        className: `group-preview${image ? ' has-image' : ''}`,
        title: text.slice(0, 200) || 'Ver publicación',
        onClick: () => navigate('post', { postId: post.id, groupId: group.id }),
      },
      image && h('img', { className: 'group-preview-image', src: imageUrl(account.id, image.src), alt: '', loading: 'lazy' }),
      (text || !image) && h('span', { className: 'group-preview-text', attrs: { dir: 'auto' } }, text.slice(0, PREVIEW_TEXT_CHARS) || '…'),
      h(
        'span',
        { className: 'group-preview-author' },
        avatar(account.id, post.author.avatar, { name: post.author.name, size: 'sm' }),
        userName(post.author.name),
      ),
    );
  }

  function renderGroup(group) {
    return h(
      'li',
      { className: 'group-row' },
      h('div', { className: 'person' }, groupRowContent(group)),
      group.isMember && group.newPosts > 0 && renderPreviews(group),
    );
  }

  function groupRowContent(group) {
    return [
      h(
        'button',
        { className: 'person-main link-btn', onClick: () => navigate('group', { groupId: group.id }) },
        avatar(account.id, group.avatar, { name: group.name }),
        h(
          'span',
          { className: 'person-info' },
          userName(group.name, { className: 'person-name', fallback: 'Grupo' }),
          group.membersCount != null && h('span', { className: 'person-meta' }, `${group.membersCount} miembros`),
        ),
      ),
      group.isInvited && h('span', { className: 'badge accent' }, 'Invitación'),
      group.newPosts > 0 && h('span', { className: 'badge accent', title: 'Publicaciones nuevas' }, group.newPosts),
      // abre la sección Chats con el chat del grupo elegido (y la lista de chats al costado)
      group.isMember &&
        h(
          'button',
          {
            className: 'btn icon-btn',
            title: 'Chat del grupo',
            attrs: { 'aria-label': `Chat del grupo: ${group.name}` },
            onClick: () => navigate('chat', { thread: { id: group.id, name: group.name, avatar: group.avatar, isGroup: true } }),
          },
          icon('message-circle'),
        ),
    ];
  }

  // --- Personas ---

  // MeWe entrega estas listas de a páginas y sin buscador: el filtro trabaja sobre lo ya cargado (ver onSearch)
  async function loadPeople(append = false) {
    if (loading) return false;
    const gen = generation;
    const kind = peopleKind;
    loading = true;
    moreBtn.disabled = true;
    clearError(errorEl);
    try {
      const page = await api.getPeople(account.id, kind, append ? nextPage : undefined);
      if (gen !== generation) return false;
      const known = new Set(people.map((user) => user.id));
      people = [...people, ...page.users.filter((user) => !known.has(user.id))];
      nextPage = page.nextPage;
      render();
      return true;
    } catch (err) {
      if (gen !== generation) return false;
      if (!append) listEl.replaceChildren();
      showError(errorEl, err, 'MeWe personas');
      return false;
    } finally {
      if (gen === generation) {
        loading = false;
        moreBtn.disabled = false;
      }
    }
  }

  function renderPerson(user) {
    const acc = account;
    const onError = (err) => showError(errorEl, err, 'MeWe personas');
    const action = (iconName, label, run, className = 'btn icon-btn') => {
      const button = h('button', { className, title: label, attrs: { 'aria-label': `${label}: ${user.name}` } }, icon(iconName));
      button.addEventListener('click', async () => {
        button.disabled = true;
        clearError(errorEl);
        try {
          await run();
        } catch (err) {
          onError(err);
        } finally {
          button.disabled = false;
        }
      });
      return button;
    };
    return personRow({
      account: acc,
      user,
      navigate,
      actions: [
        action('message-circle', 'Enviar mensaje', () => openChatWith({ account: acc, user, navigate })),
        copyLinkButton(user),
        action(
          'ban',
          'Bloquear',
          async () => {
            if (!(await confirmBlock(acc, user)) || acc !== account) return;
            people = people.filter((person) => person.id !== user.id);
            render();
          },
          'btn icon-btn danger',
        ),
      ],
    });
  }

  // --- Lista y filtro ---

  function render() {
    const query = fold(search.value.trim());
    const isGroups = list === 'groups';
    const all = isGroups ? groups : people;
    const shown = query ? all.filter((item) => fold(item.name).includes(query) || fold(item.handle).includes(query)) : all;
    previewObserver.disconnect(); // las tiras se dibujan de nuevo (lo ya pedido queda en `previews`)
    moreBtn.hidden = isGroups || !nextPage;
    if (!shown.length) {
      const empty = isGroups
        ? groups.length
          ? 'Ningún grupo coincide.'
          : 'No estás en ningún grupo.'
        : nextPage
          ? 'Nadie coincide entre las personas cargadas.'
          : people.length
            ? 'Nadie coincide.'
            : peopleKind === 'following'
              ? 'Todavía no sigues a nadie.'
              : 'Todavía no te sigue nadie.';
      listEl.replaceChildren(emptyState(empty, 'li'));
      return;
    }
    listEl.replaceChildren(...shown.map(isGroups ? renderGroup : renderPerson));
  }

  // Al filtrar personas se van trayendo las páginas que faltan, para buscar en la lista entera
  async function onSearch() {
    render();
    if (list === 'groups' || !search.value.trim()) return;
    const gen = generation;
    for (let i = 0; i < MAX_PAGES_PER_SEARCH && nextPage && gen === generation && search.value.trim(); i++) {
      if (!(await loadPeople(true))) break;
    }
  }

  return {
    el,
    toolbar: { left: toolbarLeft, center: tabs.el },
    // params.list: la lista a mostrar ("Ver más" del panel de grupos de las notificaciones)
    show(newAccount, params = {}) {
      // otra cuenta: el filtro empieza de cero; al volver de un perfil se conserva
      if (newAccount?.id !== account?.id) {
        search.value = '';
        searchBar.hidden = true;
        searchBtn.setAttribute('aria-pressed', 'false');
      }
      account = newAccount;
      if (LISTS.some(([id]) => id === params.list)) list = params.list;
      tabs.select(list);
      if (account) load();
      else listEl.replaceChildren();
    },
    hide() {
      generation++;
    },
    reload: () => account && load(),
  };
}
