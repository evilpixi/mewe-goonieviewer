import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { h } from './dom.js';
import { takeFiles } from './files.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Cómo se entra a un grupo (modelType de MeWe)
const MODEL_TYPES = [
  ['Public', 'Abierto', 'Cualquiera puede entrar y ver las publicaciones.'],
  ['PublicApply', 'Selectivo', 'Se ve en el buscador, pero hay que pedir entrar y un admin lo aprueba.'],
  ['Private', 'Privado', 'Sólo se entra con una invitación. MeWe puede pedir pagar para crearlo.'],
];
// Roles que se configuran (el dueño y los admins pueden todo)
export const ROLE_LABELS = { Admin: 'Admin', Contributor: 'Colaborador', Limited: 'Limitado', Viewer: 'Lector' };
const PERMISSIONS = [
  ['post', 'Publicar'],
  ['comment', 'Comentar y chatear'],
  ['invite', 'Invitar'],
];
const CONFIGURABLE_ROLES = ['Contributor', 'Limited', 'Viewer'];

let categories = null; // se piden una vez: son las mismas para todas las cuentas

async function loadCategories(accountId) {
  categories ??= api.getGroupCategories(accountId).catch((err) => {
    categories = null; // se reintenta la próxima vez
    throw err;
  });
  return categories;
}

// <select> de categorías, que se llena cuando llegan. selected: la actual (al editar)
function categorySelect(accountId, { selected = null, required = false, errorEl }) {
  const select = h('select', { className: 'input', required }, h('option', { value: '' }, 'Cargando categorías…'));
  loadCategories(accountId)
    .then((list) => {
      select.replaceChildren(
        h('option', { value: '' }, 'Elige una categoría'),
        ...list.map((c) => h('option', { value: c.id, selected: c.id === selected }, c.name)),
      );
      // una categoría que ya no está en la lista se conserva
      if (selected && !list.some((c) => c.id === selected)) select.append(h('option', { value: selected, selected: true }, selected));
    })
    .catch((err) => {
      select.replaceChildren(h('option', { value: selected ?? '' }, selected ?? 'Sin categorías'));
      showError(errorEl, err, 'MeWe grupos');
    });
  return select;
}

async function toUpload(file) {
  return { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) };
}

// "Crear grupo": nombre, descripción, categoría y cómo se entra. Devuelve el grupo creado, o null si se canceló.
export function openCreateGroup({ account }) {
  return new Promise((resolve) => {
    let created = null;
    let busy = false;
    const errorEl = h('div');
    const name = h('input', { type: 'text', className: 'input', maxLength: 50, required: true, attrs: { dir: 'auto' } });
    const description = h('textarea', { className: 'input', rows: 3, maxLength: 3000, attrs: { dir: 'auto' } });
    const category = categorySelect(account.id, { required: true, errorEl });
    const modelInputs = MODEL_TYPES.map(([value], i) => h('input', { type: 'radio', name: 'group-model', value, checked: i === 0 }));
    const status = h('p', { className: 'status', attrs: { 'aria-live': 'polite' } });
    const cancelBtn = h('button', { type: 'button', className: 'btn', onClick: () => dialog.close() }, 'Cancelar');
    const createBtn = h('button', { type: 'submit', className: 'btn primary' }, 'Crear grupo');
    const form = h(
      'form',
      { className: 'profile-edit-form' },
      h('h2', {}, 'Crear grupo'),
      h('label', {}, 'Nombre', name),
      h('label', {}, 'Descripción', description),
      h('label', {}, 'Categoría', category),
      h(
        'fieldset',
        { className: 'group-model' },
        h('legend', {}, '¿Quién puede entrar?'),
        MODEL_TYPES.map(([, label, hint], i) => h('label', { className: 'group-model-option' }, modelInputs[i], h('span', {}, h('strong', {}, label), h('span', { className: 'person-meta' }, hint)))),
      ),
      h('p', { className: 'status' }, 'La foto y la portada se cambian después, desde "Administrar".'),
      status,
      errorEl,
      h('div', { className: 'modal-actions' }, cancelBtn, createBtn),
    );
    const dialog = h('dialog', { className: 'modal wide profile-edit', attrs: { 'aria-label': 'Crear grupo' } }, form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      createBtn.disabled = true;
      clearError(errorEl);
      status.textContent = 'Creando el grupo…';
      try {
        created = await api.createGroup(account.id, {
          name: name.value.trim(),
          description: description.value.trim(),
          categoryId: category.value,
          modelType: modelInputs.find((input) => input.checked)?.value,
        });
        dialog.close();
      } catch (err) {
        status.textContent = '';
        showError(errorEl, err, 'MeWe grupos');
      } finally {
        busy = false;
        createBtn.disabled = false;
      }
    });
    dialog.addEventListener('cancel', (event) => busy && event.preventDefault());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(created);
    });
    document.body.append(dialog);
    dialog.showModal();
    name.focus();
  });
}

// "Administrar grupo" (dueño y admins): foto, portada, nombre, descripción, categoría, qué puede hacer cada rol y
// con qué rol entra la gente nueva. onSaved(group): se guardó algo (también si después falló otro paso).
export function openGroupSettings({ account, group, onSaved }) {
  const accountId = account.id;
  const picked = { avatar: null, cover: null }; // { file, url } elegidos y todavía sin subir
  const errorEl = h('div');

  function photoPicker(kind, label, currentUrl) {
    const preview = h('img', { className: `profile-edit-${kind}`, alt: '', src: imageUrl(accountId, currentUrl) ?? '' });
    preview.hidden = !currentUrl;
    const input = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true, attrs: { 'aria-hidden': 'true', tabindex: '-1' } });
    const button = h('button', { type: 'button', className: 'btn', onClick: () => input.click() }, `Cambiar ${label}`);
    input.addEventListener('change', async () => {
      const [file] = await takeFiles(input);
      if (!file || !IMAGE_TYPES.includes(file.type)) return;
      if (picked[kind]) URL.revokeObjectURL(picked[kind].url);
      picked[kind] = { file, url: URL.createObjectURL(file) };
      preview.src = picked[kind].url;
      preview.hidden = false;
      button.textContent = `Elegir otra ${label}`;
    });
    return h('div', { className: 'profile-edit-photo' }, preview, button, input);
  }

  const name = h('input', { type: 'text', className: 'input', maxLength: 50, required: true, value: group.name, attrs: { dir: 'auto' } });
  const description = h('textarea', { className: 'input', rows: 4, maxLength: 3000, value: group.description, attrs: { dir: 'auto' } });
  const category = categorySelect(accountId, { selected: group.categoryId, errorEl });

  // Permisos: una fila por rol, una columna por permiso
  const boxes = Object.fromEntries(
    CONFIGURABLE_ROLES.map((role) => [
      role,
      Object.fromEntries(PERMISSIONS.map(([perm]) => [perm, h('input', { type: 'checkbox', checked: (group.rolePermissions[role] ?? []).includes(perm), attrs: { 'aria-label': `${ROLE_LABELS[role]}: ${perm}` } })])),
    ]),
  );
  const permissionsTable = h(
    'table',
    { className: 'group-permissions' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Rol'), PERMISSIONS.map(([, label]) => h('th', {}, label)))),
    h('tbody', {}, CONFIGURABLE_ROLES.map((role) => h('tr', {}, h('th', { attrs: { scope: 'row' } }, ROLE_LABELS[role]), PERMISSIONS.map(([perm]) => h('td', {}, boxes[role][perm]))))),
  );
  // si MeWe no dice cuál es, queda sin elegir y no se manda
  const publicRole = h(
    'select',
    { className: 'input' },
    !CONFIGURABLE_ROLES.includes(group.publicRole) && h('option', { value: '' }, '—'),
    CONFIGURABLE_ROLES.map((role) => h('option', { value: role, selected: role === group.publicRole }, ROLE_LABELS[role])),
  );
  const currentPermissions = () => Object.fromEntries(CONFIGURABLE_ROLES.map((role) => [role, PERMISSIONS.map(([perm]) => perm).filter((perm) => boxes[role][perm].checked)]));
  const samePermissions = () =>
    CONFIGURABLE_ROLES.every((role) => {
      const before = new Set((group.rolePermissions[role] ?? []).filter((perm) => PERMISSIONS.some(([p]) => p === perm)));
      const after = currentPermissions()[role];
      return after.length === before.size && after.every((perm) => before.has(perm));
    });

  const status = h('p', { className: 'status', attrs: { 'aria-live': 'polite' } });
  const cancelBtn = h('button', { type: 'button', className: 'btn', onClick: () => dialog.close() }, 'Cancelar');
  const saveBtn = h('button', { type: 'submit', className: 'btn primary' }, 'Guardar');
  const form = h(
    'form',
    { className: 'profile-edit-form' },
    h('h2', {}, `Administrar ${group.name}`),
    h('div', { className: 'profile-edit-photos' }, photoPicker('avatar', 'foto', group.avatarImage?.full ?? group.avatar), photoPicker('cover', 'portada', group.cover)),
    h('label', {}, 'Nombre', name),
    h('label', {}, 'Descripción', description),
    h('label', {}, 'Categoría', category),
    h('h3', {}, 'Permisos'),
    h('p', { className: 'status' }, 'Qué puede hacer cada rol. El dueño y los admins pueden todo; lo de "Limitado" pasa por aprobación.'),
    Object.keys(group.rolePermissions).length ? permissionsTable : h('p', { className: 'status' }, 'MeWe no mandó los permisos de este grupo.'),
    h('label', {}, 'Rol de los miembros nuevos', publicRole),
    status,
    errorEl,
    h('div', { className: 'modal-actions' }, cancelBtn, saveBtn),
  );
  const dialog = h('dialog', { className: 'modal wide profile-edit', attrs: { 'aria-label': 'Administrar grupo' } }, form);
  let busy = false;

  // Cada paso que termina bien queda hecho: si uno falla, el error dice cuál y lo anterior no se repite al reintentar
  async function save() {
    if (busy) return;
    busy = true;
    saveBtn.disabled = true;
    clearError(errorEl);
    let saved = null;
    try {
      for (const [kind, label] of [['avatar', 'la foto'], ['cover', 'la portada']]) {
        if (!picked[kind]) continue;
        status.textContent = `Subiendo ${label}…`;
        const { file, url } = picked[kind];
        await api.setGroupPhoto(accountId, group.id, kind, await toUpload(file));
        URL.revokeObjectURL(url);
        picked[kind] = null;
        saved = group;
      }
      const changes = {};
      if (name.value.trim() !== group.name) changes.name = name.value.trim();
      if (description.value.trim() !== group.description.trim()) changes.description = description.value.trim();
      if (category.value && category.value !== group.categoryId) changes.categoryId = category.value;
      if (Object.keys(changes).length) {
        status.textContent = 'Guardando los datos…';
        saved = await api.updateGroup(accountId, group.id, changes);
        Object.assign(group, { name: saved.name, description: saved.description, categoryId: saved.categoryId });
      }
      const roleChanged = Boolean(publicRole.value) && publicRole.value !== group.publicRole;
      if (Object.keys(group.rolePermissions).length && (!samePermissions() || roleChanged)) {
        status.textContent = 'Guardando los permisos…';
        saved = await api.setGroupPermissions(accountId, group.id, { permissions: currentPermissions(), publicRole: roleChanged ? publicRole.value : undefined });
        Object.assign(group, { rolePermissions: saved.rolePermissions, publicRole: saved.publicRole });
      }
      dialog.close();
      if (saved) onSaved?.(saved);
    } catch (err) {
      status.textContent = '';
      showError(errorEl, err, 'MeWe grupo');
      if (saved) onSaved?.(saved);
    } finally {
      busy = false;
      saveBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  dialog.addEventListener('cancel', (event) => busy && event.preventDefault());
  dialog.addEventListener('close', () => {
    for (const item of Object.values(picked)) if (item) URL.revokeObjectURL(item.url);
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}
