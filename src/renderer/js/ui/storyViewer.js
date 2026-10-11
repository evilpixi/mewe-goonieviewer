import { api, imageUrl } from '../api.js';
import { avatar } from './avatar.js';
import { confirmDialog } from './confirm.js';
import { formatAgo } from './dates.js';
import { h } from './dom.js';
import { openEmojiPicker } from './emojiPicker.js';
import { icon } from './icon.js';
import { userName } from './userName.js';

const PHOTO_MS = 5000; // lo que dura una foto en pantalla (igual que la web)
const HOLD_MS = 250; // mantener apretado más que esto es pausar, no pasar de historia

// Visor de historias a pantalla completa, sobre negro (uno solo para toda la app).
// openStoryViewer({ account, tellers, index, navigate, onClose })
// - tellers: los de api.getStorytellers. El visor pide todas las historias de cada uno al abrirlo y las deja
//   en teller.stories; también actualiza isNew / hasNew y quita las historias que se borran.
// - onClose: se llama al cerrarse (para redibujar la grilla).
// Las fotos pasan solas; los videos duran lo que duran. Tocar a la izquierda o a la derecha cambia de historia,
// mantener apretado pausa. Teclado: ← → cambian de historia, Espacio pausa, G guarda, Esc cierra.
let viewer = null;

export function openStoryViewer(options) {
  viewer ??= createViewer();
  viewer.open(options);
}

function createViewer() {
  const mediaEl = h('div', { className: 'story-media' });
  const progressEl = h('div', { className: 'story-progress', attrs: { 'aria-hidden': 'true' } });
  const authorBtn = h('button', { className: 'story-author', title: 'Ver su perfil' });
  const viewsEl = h('span', { className: 'story-views', hidden: true });
  const pauseBtn = h('button', { className: 'icon-btn', title: 'Pausar (Espacio)', attrs: { 'aria-label': 'Pausar' } }, icon('pause'));
  const saveBtn = h('button', { className: 'icon-btn', title: 'Guardar en el equipo (G)', attrs: { 'aria-label': 'Guardar en el equipo' } }, icon('download'));
  const deleteBtn = h('button', { className: 'icon-btn', title: 'Borrar esta historia', hidden: true, attrs: { 'aria-label': 'Borrar esta historia' } }, icon('trash-2'));
  const closeBtn = h('button', { className: 'icon-btn', title: 'Cerrar (Esc)', attrs: { 'aria-label': 'Cerrar' } }, icon('x'));
  const tapPrev = h('button', { className: 'story-tap prev', tabIndex: -1, attrs: { 'aria-label': 'Historia anterior' } });
  const tapNext = h('button', { className: 'story-tap next', tabIndex: -1, attrs: { 'aria-label': 'Historia siguiente' } });
  const statusEl = h('p', { className: 'story-status', attrs: { 'aria-live': 'polite' } });
  const replyInput = h('input', { className: 'story-reply-input', type: 'text', maxLength: 2000, attrs: { 'aria-label': 'Responder a la historia', dir: 'auto' } });
  const emojiBtn = h('button', { type: 'button', className: 'icon-btn', title: 'Insertar emoji', attrs: { 'aria-label': 'Insertar emoji', 'aria-haspopup': 'dialog' } }, icon('smile'));
  const sendBtn = h('button', { type: 'submit', className: 'icon-btn', title: 'Enviar respuesta', attrs: { 'aria-label': 'Enviar respuesta' } }, icon('send'));
  const replyForm = h('form', { className: 'story-reply' }, emojiBtn, replyInput, sendBtn);
  const frame = h(
    'div',
    { className: 'story-frame', tabIndex: -1 },
    mediaEl,
    tapPrev,
    tapNext,
    h(
      'div',
      { className: 'story-top' },
      progressEl,
      h('div', { className: 'story-head' }, authorBtn, h('span', { className: 'spacer' }), viewsEl, pauseBtn, saveBtn, deleteBtn, closeBtn),
    ),
    h('div', { className: 'story-bottom' }, statusEl, replyForm),
  );
  const prevTellerBtn = h('button', { className: 'story-side prev', title: 'Persona anterior', attrs: { 'aria-label': 'Persona anterior' } }, icon('chevron-left'));
  const nextTellerBtn = h('button', { className: 'story-side next', title: 'Persona siguiente', attrs: { 'aria-label': 'Persona siguiente' } }, icon('chevron-right'));
  const dialog = h(
    'dialog',
    { className: 'story-viewer', attrs: { 'aria-label': 'Historias' } },
    h('div', { className: 'story-viewer-layout' }, prevTellerBtn, h('div', { className: 'story-frame-box' }, frame), nextTellerBtn),
  );
  document.body.append(dialog);

  let account = null;
  let tellers = [];
  let tellerIndex = 0;
  let storyIndex = 0;
  let navigate = null;
  let onClose = null;
  let session = 0; // invalida las cargas de una apertura (o de una persona) anterior
  let loaded = new Set(); // ids de las personas cuyas historias ya se pidieron enteras
  let seen = []; // historias vistas que todavía no se le avisaron a MeWe
  let video = null; // <video> de la historia actual
  let videoSource = 0; // cuál de sus resoluciones se está reproduciendo
  let elapsed = 0; // ms que lleva en pantalla la foto actual
  let lastTick = 0;
  let frameId = 0;
  let holdStart = 0;
  const pauses = new Set(); // motivos por los que está detenida: 'user', 'hold', 'reply', 'busy', 'loading', 'hidden'

  const teller = () => tellers[tellerIndex];
  const story = () => teller()?.stories[storyIndex];

  // --- Pausa y avance ---

  function setPaused(reason, on) {
    if (on) pauses.add(reason);
    else pauses.delete(reason);
    const paused = pauses.size > 0;
    if (video) {
      if (paused) video.pause();
      else video.play().catch(() => {});
    }
    const byUser = pauses.has('user');
    pauseBtn.replaceChildren(icon(byUser ? 'play' : 'pause'));
    pauseBtn.title = byUser ? 'Reanudar (Espacio)' : 'Pausar (Espacio)';
    pauseBtn.setAttribute('aria-label', byUser ? 'Reanudar' : 'Pausar');
    dialog.classList.toggle('paused', pauses.has('hold'));
  }

  function tick(now) {
    frameId = requestAnimationFrame(tick);
    const delta = now - lastTick;
    lastTick = now;
    if (!story()) return;
    let ratio;
    if (video) {
      ratio = video.duration ? video.currentTime / video.duration : 0;
    } else {
      if (!pauses.size) elapsed += delta;
      ratio = elapsed / PHOTO_MS;
    }
    const bar = progressEl.children[storyIndex]?.firstChild;
    if (bar) bar.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
    if (!video && ratio >= 1) go(1);
  }

  // --- Mostrar ---

  function renderProgress() {
    const count = teller()?.stories.length ?? 0;
    progressEl.replaceChildren(...Array.from({ length: count }, () => h('span', { className: 'story-seg' }, h('span'))));
    [...progressEl.children].forEach((seg, i) => {
      seg.firstChild.style.transform = `scaleX(${i < storyIndex ? 1 : 0})`;
    });
  }

  function renderHead() {
    const current = teller();
    const item = story();
    authorBtn.replaceChildren(
      avatar(account.id, current.avatar, { name: current.name }),
      h(
        'span',
        { className: 'story-author-text' },
        userName(current.isMine ? 'Tu historia' : current.name),
        item?.createdAt && h('span', { className: 'story-time' }, formatAgo(item.createdAt)),
      ),
    );
    authorBtn.disabled = current.isPage;
    authorBtn.title = current.isPage ? current.name : `Ver el perfil de ${current.name}`;
    deleteBtn.hidden = !current.isMine;
    viewsEl.hidden = !current.isMine || item?.views == null;
    viewsEl.replaceChildren(icon('eye'), ` ${item?.views ?? 0}`);
    viewsEl.title = `${item?.views ?? 0} personas la vieron`;
    // a una historia propia o de una página no se le responde
    replyForm.hidden = current.isMine || current.isPage;
    replyInput.placeholder = `Responder a ${current.name}…`;
    prevTellerBtn.disabled = tellerIndex === 0;
    nextTellerBtn.disabled = tellerIndex >= tellers.length - 1;
  }

  function markSeen(item) {
    const current = teller();
    if (!item.isNew || current.isMine) return;
    item.isNew = false;
    current.hasNew = current.stories.some((s) => s.isNew);
    seen.push({ storyId: item.id, tellerId: current.id, tellerType: current.type, viewedAt: Date.now() });
  }

  function flushSeen() {
    if (!seen.length || !account) return;
    const views = seen;
    seen = [];
    api.markStoriesSeen(account.id, views).catch((err) => console.warn('[historias] marcar vistas', err));
  }

  function showStory() {
    const item = story();
    if (!item) return;
    const shown = session;
    elapsed = 0;
    video = null;
    statusEl.textContent = '';
    renderProgress();
    renderHead();
    setPaused('loading', true);
    const ready = () => {
      if (shown !== session || story() !== item) return;
      markSeen(item);
      setPaused('loading', false);
    };
    const failed = () => {
      if (shown !== session || story() !== item) return;
      statusEl.textContent = 'No se pudo cargar esta historia.';
    };

    if (item.video) {
      const player = h('video', { className: 'story-content', playsInline: true, poster: imageUrl(account.id, item.video.poster) ?? '' });
      videoSource = 0;
      // se prueban las resoluciones en orden hasta que una reproduce
      player.addEventListener('error', () => {
        if (shown !== session || story() !== item) return;
        videoSource += 1;
        if (videoSource < item.video.sources.length) player.src = imageUrl(account.id, item.video.sources[videoSource]);
        else failed();
      });
      player.addEventListener('canplay', ready, { once: true });
      player.addEventListener('ended', () => {
        if (shown === session && story() === item) go(1);
      });
      player.src = imageUrl(account.id, item.video.sources[0]);
      video = player;
      mediaEl.replaceChildren(player);
    } else {
      const img = h('img', { className: 'story-content', alt: `Historia de ${teller().name}` });
      img.addEventListener('load', ready, { once: true });
      // primero el tamaño grande; si falla, la miniatura
      img.addEventListener(
        'error',
        () => {
          img.addEventListener('error', failed, { once: true });
          img.src = imageUrl(account.id, item.image.src);
        },
        { once: true },
      );
      img.src = imageUrl(account.id, item.image.full ?? item.image.src);
      mediaEl.replaceChildren(img);
    }
  }

  // Abre a una persona: pide todas sus historias (la lista sólo trae algunas) y arranca en la primera sin ver.
  // direction: hacia dónde seguir si no tiene ninguna
  async function showTeller(index, direction = 1) {
    if (index < 0 || index >= tellers.length) {
      if (direction > 0 || !tellers.length) dialog.close();
      return;
    }
    const current = ++session;
    flushSeen();
    tellerIndex = index;
    const who = teller();
    storyIndex = 0;
    video = null;
    mediaEl.replaceChildren();
    progressEl.replaceChildren();
    renderHead();
    statusEl.textContent = 'Cargando…';
    setPaused('loading', true);
    if (!loaded.has(who.id)) {
      try {
        const stories = await api.getStories(account.id, who.id, who.isPage);
        if (stories.length) who.stories = stories;
        loaded.add(who.id);
      } catch (err) {
        console.warn('[historias]', err); // se muestran las que trajo la lista
      }
      if (current !== session) return;
    }
    if (!who.stories.length) {
      showTeller(index + direction, direction);
      return;
    }
    const firstNew = who.stories.findIndex((item) => item.isNew);
    storyIndex = Math.max(0, firstNew);
    showStory();
  }

  function go(delta) {
    const next = storyIndex + delta;
    const count = teller()?.stories.length ?? 0;
    if (next >= count) showTeller(tellerIndex + 1, 1);
    else if (next < 0) {
      // en la primera historia de la primera persona, vuelve a empezarla
      if (tellerIndex === 0) showStory();
      else showTeller(tellerIndex - 1, -1);
    } else {
      storyIndex = next;
      showStory();
    }
  }

  // --- Acciones ---

  async function save() {
    const item = story();
    if (!item) return;
    setPaused('busy', true);
    statusEl.textContent = 'Guardando…';
    const name = `mewe-historia-${item.id}`;
    const urls = item.video
      ? [item.video.sources[videoSource] ?? item.video.sources[0]]
      : [...new Set([item.image.full ?? item.image.src, item.image.src])];
    let message = '';
    for (const url of urls) {
      try {
        const result = await api.downloadImage(account.id, url, name);
        message = result.saved ? 'Guardada.' : '';
        break;
      } catch (err) {
        message = `No se pudo guardar: ${err.message}`; // el tamaño grande puede no existir: se prueba la miniatura
      }
    }
    if (story() === item) statusEl.textContent = message;
    setPaused('busy', false);
  }

  async function remove() {
    const item = story();
    const who = teller();
    if (!item || !who?.isMine) return;
    setPaused('busy', true);
    const confirmed = await confirmDialog({
      title: '¿Borrar esta historia?',
      text: 'Dejará de verse para todos. No se puede deshacer.',
      confirmLabel: 'Borrar',
      danger: true,
    });
    try {
      if (!confirmed) return;
      await api.deleteStory(account.id, item.id, item.scope);
      who.stories = who.stories.filter((s) => s !== item);
      if (!who.stories.length) dialog.close();
      else {
        storyIndex = Math.min(storyIndex, who.stories.length - 1);
        showStory();
      }
    } catch (err) {
      statusEl.textContent = `No se pudo borrar: ${err.message}`;
    } finally {
      setPaused('busy', false);
    }
  }

  async function reply() {
    const item = story();
    const who = teller();
    const text = replyInput.value.trim();
    if (!item || !text || sendBtn.disabled) return;
    sendBtn.disabled = true;
    setPaused('busy', true);
    statusEl.textContent = 'Enviando…';
    try {
      await api.replyToStory(account.id, who.id, item.id, text);
      replyInput.value = '';
      replyInput.blur();
      if (story() === item) statusEl.textContent = 'Respuesta enviada.';
    } catch (err) {
      if (story() === item) statusEl.textContent = `No se pudo enviar: ${err.message}`;
    } finally {
      sendBtn.disabled = false;
      setPaused('busy', false);
    }
  }

  function openProfile() {
    const who = teller();
    if (!who || who.isPage) return;
    const nav = navigate; // cerrar el visor lo borra
    dialog.close();
    nav?.('profile', { userId: who.id });
  }

  // --- Eventos ---

  // Zonas de toque: un toque corto cambia de historia; mantener apretado la pausa hasta soltar
  for (const [zone, delta] of [[tapPrev, -1], [tapNext, 1]]) {
    zone.addEventListener('pointerdown', () => {
      holdStart = performance.now();
      setPaused('hold', true);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) zone.addEventListener(type, () => setPaused('hold', false));
    zone.addEventListener('click', () => {
      const held = holdStart && performance.now() - holdStart > HOLD_MS;
      holdStart = 0;
      if (!held) go(delta);
    });
    zone.addEventListener('contextmenu', (event) => event.preventDefault()); // el toque largo en pantallas táctiles
  }
  prevTellerBtn.addEventListener('click', () => showTeller(tellerIndex - 1, -1));
  nextTellerBtn.addEventListener('click', () => showTeller(tellerIndex + 1, 1));
  pauseBtn.addEventListener('click', () => setPaused('user', !pauses.has('user')));
  saveBtn.addEventListener('click', save);
  deleteBtn.addEventListener('click', remove);
  closeBtn.addEventListener('click', () => dialog.close());
  authorBtn.addEventListener('click', openProfile);
  replyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    reply();
  });
  // mientras se escribe la respuesta, la historia espera
  replyInput.addEventListener('focus', () => setPaused('reply', true));
  replyInput.addEventListener('blur', () => setPaused('reply', false));
  emojiBtn.addEventListener('click', () =>
    openEmojiPicker(
      emojiBtn,
      (emoji) => {
        replyInput.setRangeText(emoji, replyInput.selectionStart, replyInput.selectionEnd, 'end');
        replyInput.focus();
      },
      { forText: true },
    ),
  );
  document.addEventListener('visibilitychange', () => {
    if (dialog.open) setPaused('hidden', document.hidden);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowLeft') go(-1);
    else if (event.key === 'ArrowRight') go(1);
    else if (event.key === ' ' && !event.target.closest('button')) setPaused('user', !pauses.has('user'));
    else if (/^g$/i.test(event.key)) save();
    else return;
    event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    session++;
    cancelAnimationFrame(frameId);
    flushSeen();
    video = null;
    mediaEl.replaceChildren(); // saca el <video>: deja de sonar
    pauses.clear();
    replyInput.value = '';
    const closed = onClose;
    onClose = null;
    navigate = null;
    closed?.();
  });

  return {
    open({ account: newAccount, tellers: list, index = 0, navigate: nav = null, onClose: closed = null }) {
      if (!list?.length) return;
      account = newAccount;
      tellers = list;
      navigate = nav;
      onClose = closed;
      loaded = new Set();
      seen = [];
      pauses.clear();
      setPaused('hidden', document.hidden);
      if (!dialog.open) dialog.showModal();
      frame.focus(); // no en un botón: Espacio tiene que pausar, no activarlo
      cancelAnimationFrame(frameId);
      lastTick = performance.now();
      frameId = requestAnimationFrame(tick);
      showTeller(Math.min(Math.max(index, 0), list.length - 1));
    },
  };
}
