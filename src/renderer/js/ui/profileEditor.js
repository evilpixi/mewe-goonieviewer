import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { h } from './dom.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Proporción (alto / ancho) con la que MeWe recorta cada foto: las mismas que usa el recortador de la web
const AVATAR_RATIO = 1;
const COVER_RATIO = 1.11;

// Recorte centrado, lo más grande posible, con esa proporción. En píxeles de la imagen original.
async function centeredCrop(file, ratio) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  const tall = height / width > ratio;
  const cropWidth = tall ? width : Math.round(height / ratio);
  const cropHeight = tall ? Math.round(width * ratio) : height;
  return { x: Math.round((width - cropWidth) / 2), y: Math.round((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}

async function toUpload(file) {
  return { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) };
}

// Diálogo "Editar perfil" (sólo el perfil propio): foto, portada, nombre, presentación y los campos del perfil.
//   profile: el de normalizeUserProfile (trae firstName, lastName, bio y fields: [{ key, label, value }])
//   onSaved({ accountChanged }): se guardó; accountChanged = cambió el nombre o la foto (lo que muestra la cabecera)
// Las fotos se recortan centradas (la vista previa muestra el recorte); no hay recortador manual.
export function openProfileEditor({ account, profile, onSaved }) {
  const accountId = account.id;
  const picked = { avatar: null, cover: null }; // { file, url } elegidos y todavía sin subir

  // Selector de una foto con su vista previa. kind: 'avatar' | 'cover'
  function photoPicker(kind, label, currentUrl) {
    const preview = h('img', { className: `profile-edit-${kind}`, alt: '', src: imageUrl(accountId, currentUrl) ?? '' });
    preview.hidden = !currentUrl;
    const input = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true, attrs: { 'aria-hidden': 'true', tabindex: '-1' } });
    const button = h('button', { type: 'button', className: 'btn', onClick: () => input.click() }, `Cambiar ${label}`);
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (!file || !IMAGE_TYPES.includes(file.type)) return;
      if (picked[kind]) URL.revokeObjectURL(picked[kind].url);
      picked[kind] = { file, url: URL.createObjectURL(file) };
      preview.src = picked[kind].url;
      preview.hidden = false;
      button.textContent = `Elegir otra ${label}`;
    });
    return h('div', { className: 'profile-edit-photo' }, preview, button, input);
  }

  const field = (label, control) => h('label', {}, label, control);
  const firstName = h('input', { type: 'text', maxLength: 100, required: true, value: profile.firstName || profile.name, attrs: { dir: 'auto' } });
  const lastName = h('input', { type: 'text', maxLength: 100, value: profile.lastName, attrs: { dir: 'auto' } });
  const bio = h('textarea', { className: 'input', rows: 4, maxLength: 5000, value: profile.bio, attrs: { dir: 'auto' } });
  const inputs = profile.fields.map(({ key, label, value }) => ({ key, original: value, label, input: h('input', { type: 'text', maxLength: 500, value, attrs: { dir: 'auto' } }) }));

  const status = h('p', { className: 'status', attrs: { 'aria-live': 'polite' } });
  const errorEl = h('div');
  const cancelBtn = h('button', { type: 'button', className: 'btn' }, 'Cancelar');
  const saveBtn = h('button', { type: 'submit', className: 'btn primary' }, 'Guardar');
  const form = h(
    'form',
    { className: 'profile-edit-form' },
    h('h2', {}, 'Editar perfil'),
    h(
      'div',
      { className: 'profile-edit-photos' },
      photoPicker('avatar', 'foto', profile.avatarImage?.full ?? profile.avatar),
      photoPicker('cover', 'portada', profile.cover),
    ),
    h('p', { className: 'status' }, 'Las fotos se recortan centradas, como se ve en la vista previa.'),
    h('div', { className: 'profile-edit-name' }, field('Nombre', firstName), field('Apellido', lastName)),
    field('Presentación', bio),
    inputs.map(({ label, input }) => field(label, input)),
    status,
    errorEl,
    h('div', { className: 'modal-actions' }, cancelBtn, saveBtn),
  );
  const dialog = h('dialog', { className: 'modal wide profile-edit', attrs: { 'aria-label': 'Editar perfil' } }, form);
  let busy = false;

  // Cada paso que termina bien queda hecho: si uno falla, el error dice cuál y lo anterior no se repite al reintentar
  async function save() {
    if (busy) return;
    busy = true;
    saveBtn.disabled = true;
    clearError(errorEl);
    let accountChanged = false;
    try {
      if (picked.avatar) {
        status.textContent = 'Subiendo la foto de perfil…';
        const { file, url } = picked.avatar;
        await api.setAvatar(accountId, await toUpload(file), await centeredCrop(file, AVATAR_RATIO));
        URL.revokeObjectURL(url);
        picked.avatar = null;
        accountChanged = true;
      }
      if (picked.cover) {
        status.textContent = 'Subiendo la portada…';
        const { file, url } = picked.cover;
        await api.setCover(accountId, await toUpload(file), await centeredCrop(file, COVER_RATIO));
        URL.revokeObjectURL(url);
        picked.cover = null;
      }
      const changes = {};
      const nameChanged = firstName.value.trim() !== (profile.firstName || profile.name) || lastName.value.trim() !== profile.lastName;
      if (nameChanged) Object.assign(changes, { firstName: firstName.value.trim(), lastName: lastName.value.trim() });
      if (bio.value !== profile.bio || inputs.some(({ input, original }) => input.value !== original)) {
        changes.fields = { text: bio.value, ...Object.fromEntries(inputs.map(({ key, input }) => [key, input.value])) };
      }
      if (Object.keys(changes).length) {
        status.textContent = 'Guardando los datos…';
        await api.updateProfile(accountId, changes);
        accountChanged ||= nameChanged;
      }
      dialog.close();
      onSaved?.({ accountChanged });
    } catch (err) {
      status.textContent = '';
      showError(errorEl, err, 'MeWe perfil');
      // lo que sí se guardó se tiene que ver aunque el diálogo siga abierto
      if (accountChanged) onSaved?.({ accountChanged, partial: true });
    } finally {
      busy = false;
      saveBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  cancelBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    for (const item of Object.values(picked)) if (item) URL.revokeObjectURL(item.url);
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  firstName.focus();
}
