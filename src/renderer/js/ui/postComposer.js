import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { h } from './dom.js';
import { openEmojiPicker } from './emojiPicker.js';
import { icon } from './icon.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILES = 20; // igual que config.mewe.posts.maxImages
const DRAFT_SAVE_MS = 500;

// --- Borrador local (uno por cuenta) ---
// El texto y el destino van en localStorage; las imágenes en IndexedDB, porque los archivos no entran en localStorage.

const DB_NAME = 'meweviewer';
const DB_STORE = 'postDraftImages'; // accountId → [File]
const draftKey = (accountId) => `postDraft:${accountId}`;

function readDraft(accountId) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(accountId))) ?? {};
  } catch {
    return {};
  }
}

function writeDraft(accountId, draft) {
  try {
    if (draft) localStorage.setItem(draftKey(accountId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(accountId));
  } catch {
    // sin storage: el borrador no se guarda
  }
}

// Abre la base, corre `run(store)` en una transacción y devuelve el resultado de su pedido
function withStore(mode, run) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(DB_STORE);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(DB_STORE, mode);
      const request = run(tx.objectStore(DB_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

async function readDraftImages(accountId) {
  try {
    return (await withStore('readonly', (store) => store.get(accountId))) ?? [];
  } catch (err) {
    console.warn('[borrador] imágenes', err);
    return [];
  }
}

function writeDraftImages(accountId, files) {
  return withStore('readwrite', (store) => (files.length ? store.put(files, accountId) : store.delete(accountId))).catch((err) =>
    console.warn('[borrador] imágenes', err),
  );
}

// Compositor de publicaciones, en un diálogo.
//   Nueva: openPostComposer({ account, groupId?, groupName?, onDone })
//     Se publica en el feed propio o en un grupo (se elige; con groupId arranca en ese grupo).
//     Lo escrito y las imágenes se guardan solos como borrador de la cuenta; "Limpiar" lo borra.
//   Editar: openPostComposer({ account, post, onDone }) → sólo cambia el texto; las fotos se ven pero no se tocan.
// onDone(post): se publicó o se guardó (post puede ser null si MeWe no devuelve la publicación).
// Imágenes: botón de adjuntar, Ctrl+V con una imagen copiada, o arrastrarlas al diálogo.
export function openPostComposer({ account, groupId = null, groupName = '', post = null, onDone }) {
  const editing = Boolean(post);
  const accountId = account.id;
  const draft = editing ? {} : readDraft(accountId);

  const textarea = h('textarea', {
    className: 'input post-composer-text',
    rows: 6,
    placeholder: '¿Qué quieres compartir?',
    value: editing ? post.text : (draft.text ?? ''),
    attrs: { 'aria-label': 'Texto de la publicación', dir: 'auto' },
  });
  const target = h('select', { className: 'input', attrs: { 'aria-label': 'Dónde se publica' } }, h('option', { value: '' }, 'Mi feed'));
  const audience = h(
    'select',
    { className: 'input', title: 'Quién puede ver la publicación', attrs: { 'aria-label': 'Quién puede ver la publicación' } },
    h('option', { value: '' }, 'Mis seguidores'),
    h('option', { value: 'everyone' }, 'Público (todos)'),
  );
  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), multiple: true, hidden: true, attrs: { 'aria-hidden': 'true', tabindex: '-1' } });
  const attachBtn = h('button', { type: 'button', className: 'btn icon-btn', title: 'Agregar imágenes', attrs: { 'aria-label': 'Agregar imágenes' } }, icon('paperclip'));
  const emojiBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn', title: 'Insertar emoji', attrs: { 'aria-label': 'Insertar emoji', 'aria-haspopup': 'dialog' } },
    icon('smile'),
  );
  const clearBtn = h('button', { type: 'button', className: 'btn', title: 'Borra el texto, las imágenes y el borrador guardado' }, 'Limpiar');
  const closeBtn = h('button', { type: 'button', className: 'btn' }, 'Cerrar');
  const submitBtn = h('button', { type: 'submit', className: 'btn primary' }, editing ? 'Guardar' : 'Publicar');
  const thumbs = h('div', { className: 'composer-thumbs' });
  const status = h('p', { className: 'status post-composer-status', attrs: { 'aria-live': 'polite' } });
  const errorEl = h('div');
  const form = h(
    'form',
    { className: 'post-composer-form' },
    h('h2', {}, editing ? 'Editar publicación' : 'Crear publicación'),
    !editing && h('div', { className: 'post-composer-target' }, h('span', {}, 'Publicar en'), target, audience),
    textarea,
    thumbs,
    editing && post.images.length > 0 && h('p', { className: 'status' }, 'Las imágenes de la publicación no se pueden cambiar desde aquí.'),
    status,
    errorEl,
    h('div', { className: 'modal-actions' }, !editing && attachBtn, emojiBtn, h('span', { className: 'spacer' }), !editing && clearBtn, closeBtn, submitBtn),
    fileInput,
  );
  const dialog = h('dialog', { className: 'modal wide post-composer', attrs: { 'aria-label': editing ? 'Editar publicación' : 'Crear publicación' } }, form);

  let files = []; // [{ file, url }]
  let busy = false;
  let saveTimer = null;
  let discard = false; // se publicó o se limpió: al cerrar no se guarda el borrador

  // --- Destino ---

  function renderTarget() {
    audience.hidden = Boolean(target.value); // en un grupo lo ven sus miembros
  }

  function addGroupOption(id, name) {
    if ([...target.options].some((option) => option.value === id)) return;
    target.append(h('option', { value: id }, `Grupo: ${name || 'Grupo'}`));
  }

  async function loadGroups(selected) {
    try {
      const groups = await api.getGroups(accountId);
      for (const group of groups.filter((g) => g.isMember && g.id).sort((a, b) => a.name.localeCompare(b.name))) addGroupOption(group.id, group.name);
      // el destino del borrador se aplica cuando ya está cargado su grupo
      if (selected && [...target.options].some((option) => option.value === selected)) target.value = selected;
      renderTarget();
    } catch (err) {
      console.warn('[publicación] grupos', err); // sin la lista se puede publicar igual en el feed
    }
  }

  // --- Borrador ---

  function saveDraft() {
    clearTimeout(saveTimer);
    if (editing || discard) return;
    const text = textarea.value;
    const empty = !text.trim() && !files.length;
    writeDraft(accountId, empty ? null : { text, groupId: target.value || null, everyone: audience.value === 'everyone' });
    writeDraftImages(accountId, files.map((item) => item.file));
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, DRAFT_SAVE_MS);
  }

  // --- Imágenes ---

  function addFiles(list) {
    const images = [...list].filter((file) => IMAGE_TYPES.includes(file.type));
    if (!images.length || editing) return false;
    for (const file of images.slice(0, MAX_FILES - files.length)) files.push({ file, url: URL.createObjectURL(file) });
    status.textContent = files.length >= MAX_FILES && images.length ? `Máximo ${MAX_FILES} imágenes por publicación.` : '';
    renderFiles();
    scheduleSave();
    return true;
  }

  function removeFile(index) {
    URL.revokeObjectURL(files[index].url);
    files.splice(index, 1);
    renderFiles();
    scheduleSave();
  }

  function renderFiles() {
    if (editing) {
      thumbs.replaceChildren(...post.images.map((img) => h('div', { className: 'composer-thumb' }, h('img', { src: imageUrl(accountId, img.src), alt: '' }))));
      return;
    }
    thumbs.replaceChildren(
      ...files.map(({ file, url }, i) =>
        h(
          'div',
          { className: 'composer-thumb' },
          h('img', { src: url, alt: file.name }),
          h('button', { type: 'button', className: 'icon-btn', title: 'Quitar', attrs: { 'aria-label': `Quitar ${file.name}` }, onClick: () => removeFile(i) }, icon('x')),
        ),
      ),
    );
  }

  function clear() {
    for (const { url } of files) URL.revokeObjectURL(url);
    files = [];
    textarea.value = '';
    status.textContent = '';
    clearError(errorEl);
    renderFiles();
    writeDraft(accountId, null);
    writeDraftImages(accountId, []);
    textarea.focus();
  }

  // --- Publicar / guardar ---

  async function submit() {
    const text = textarea.value.trim();
    if (busy) return;
    if (!text && !(editing ? post.images.length : files.length)) {
      status.textContent = 'Escribe algo o agrega una imagen.';
      return;
    }
    busy = true;
    for (const control of [submitBtn, clearBtn, attachBtn, target, audience]) control.disabled = true;
    clearError(errorEl);
    try {
      let result;
      if (editing) {
        status.textContent = 'Guardando…';
        result = await api.editPost(accountId, post, { text, mediaIds: post.mediaIds });
      } else {
        const imageIds = [];
        for (const [i, { file }] of files.entries()) {
          status.textContent = `Subiendo imagen ${i + 1} de ${files.length}…`;
          const data = new Uint8Array(await file.arrayBuffer());
          imageIds.push(await api.uploadPostImage(accountId, { name: file.name, type: file.type, data }));
        }
        status.textContent = 'Publicando…';
        result = await api.createPost(accountId, { text, imageIds, groupId: target.value || null, everyone: audience.value === 'everyone' });
        discard = true;
        writeDraft(accountId, null);
        writeDraftImages(accountId, []);
      }
      dialog.close();
      onDone?.(result);
    } catch (err) {
      status.textContent = '';
      showError(errorEl, err, 'MeWe publicación');
    } finally {
      busy = false;
      for (const control of [submitBtn, clearBtn, attachBtn, target, audience]) control.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  textarea.addEventListener('input', scheduleSave);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });
  textarea.addEventListener('paste', (event) => {
    if (addFiles(event.clipboardData?.files ?? [])) event.preventDefault();
  });
  target.addEventListener('change', () => {
    renderTarget();
    scheduleSave();
  });
  audience.addEventListener('change', scheduleSave);
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  emojiBtn.addEventListener('click', () =>
    openEmojiPicker(
      emojiBtn,
      (emoji) => {
        textarea.setRangeText(emoji, textarea.selectionStart, textarea.selectionEnd, 'end');
        textarea.focus();
        scheduleSave();
      },
      { forText: true },
    ),
  );
  clearBtn.addEventListener('click', clear);
  closeBtn.addEventListener('click', () => dialog.close());
  // Arrastrar imágenes al diálogo
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  dialog.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  dialog.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  });
  // Esc no cierra mientras se está publicando
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    saveDraft(); // lo que quedó escrito se conserva para la próxima vez
    for (const { url } of files) URL.revokeObjectURL(url);
    dialog.remove();
  });

  // --- Estado inicial ---

  if (!editing) {
    // abierto desde un grupo se publica ahí; si no, donde decía el borrador
    const selected = groupId ?? draft.groupId ?? null;
    if (groupId) addGroupOption(groupId, groupName);
    if (groupId) target.value = groupId;
    audience.value = draft.everyone ? 'everyone' : '';
    renderTarget();
    loadGroups(selected);
    readDraftImages(accountId).then((saved) => {
      if (dialog.isConnected && !files.length && saved.length) addFiles(saved);
    });
  }
  renderFiles();
  document.body.append(dialog);
  dialog.showModal();
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}
