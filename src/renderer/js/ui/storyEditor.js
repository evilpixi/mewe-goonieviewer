import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { confirmDialog } from './confirm.js';
import { h } from './dom.js';
import { openEmojiPicker } from './emojiPicker.js';
import { icon } from './icon.js';

// La historia se arma sobre un lienzo de 1080×1920 (9:16) y se sube como una sola imagen JPEG.
const WIDTH = 1080;
const HEIGHT = 1920;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MIN_SIZE = 28;
const MAX_SIZE = 520;
const TEXT_SIZE = 76;
const EMOJI_SIZE = 240;
const LINE_HEIGHT = 1.25;
const MAX_TEXT_WIDTH = WIDTH * 0.86; // el texto más ancho baja de renglón
const PLACEHOLDER = 'Escribe aquí';
const EMOJI_FONTS = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'";

// Fuentes del sistema (con sus equivalentes en macOS y Linux): la historia se sube ya dibujada,
// así que quien la ve no necesita tenerlas.
const FONTS = [
  { name: 'Clásica', family: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif", weight: 700 },
  { name: 'Fina', family: "'Segoe UI Light', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif", weight: 300 },
  { name: 'Serif', family: "Georgia, 'Times New Roman', serif", weight: 700 },
  { name: 'Elegante', family: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", weight: 400, style: 'italic' },
  { name: 'Impacto', family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif", weight: 400 },
  { name: 'Gruesa', family: "'Arial Black', 'Arial Bold', Arial, sans-serif", weight: 900 },
  { name: 'Máquina', family: "'Courier New', Courier, monospace", weight: 700 },
  { name: 'Cómic', family: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive", weight: 700 },
  { name: 'Manuscrita', family: "'Segoe Script', 'Snell Roundhand', 'Brush Script MT', cursive", weight: 400 },
  { name: 'Marcador', family: "'Ink Free', 'Segoe Print', 'Marker Felt', 'Bradley Hand', cursive", weight: 700 },
];

const AUDIENCES = [
  ['followers', 'Mis seguidores'],
  ['public', 'Público (todos)'],
  ['favorites', 'Amigos cercanos'],
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function fontOf(item) {
  const font = FONTS[item.font] ?? FONTS[0];
  return `${font.style ?? 'normal'} ${font.weight} ${item.size}px ${font.family}, ${EMOJI_FONTS}`;
}

// Parte el texto en renglones: respeta los saltos escritos y baja las palabras que no entran
function wrapLines(ctx, text) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > MAX_TEXT_WIDTH) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Editor de historias, a pantalla completa: una imagen de fondo más textos y emojis encima.
// openStoryEditor({ account, onDone })   onDone(): la historia se publicó.
// - Imagen: botón, Ctrl+V con una imagen copiada, o arrastrarla. "Ajustar" la muestra entera sobre un fondo
//   desenfocado; "Rellenar" la recorta para cubrir todo.
// - Cada texto o emoji se mueve arrastrándolo; con la manija de su esquina se gira y se agranda a la vez
//   (también hay deslizadores). El texto se escribe en el panel; tiene 10 fuentes, color y un fondo opcional.
// - Con el lienzo enfocado: flechas mueven el elemento elegido, Supr lo borra.
export function openStoryEditor({ account, onDone }) {
  const canvas = h('canvas', { className: 'story-editor-canvas', width: WIDTH, height: HEIGHT, tabIndex: 0, attrs: { 'aria-label': 'Vista previa de la historia' } });
  const ctx = canvas.getContext('2d');
  const backdrop = h('canvas', { width: WIDTH, height: HEIGHT }); // el fondo ya dibujado (desenfocar es caro)
  const handle = h('button', { type: 'button', className: 'story-editor-handle', title: 'Arrastra para girar y cambiar el tamaño', attrs: { 'aria-label': 'Girar y cambiar el tamaño' } });
  const frame = h('div', { className: 'story-editor-frame', hidden: true }, handle);
  const pickBtn = h('button', { type: 'button', className: 'btn primary' }, icon('image'), ' Elegir imagen');
  const hint = h('div', { className: 'story-editor-hint' }, h('p', {}, 'Elige una imagen, pégala con Ctrl+V o arrástrala aquí.'), pickBtn);
  const stage = h('div', { className: 'story-editor-stage' }, canvas, frame, hint);

  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true, attrs: { 'aria-hidden': 'true', tabindex: '-1' } });
  const imageBtn = h('button', { type: 'button', className: 'btn' }, icon('image'), ' Imagen');
  const fitBtn = h('button', { type: 'button', className: 'btn', title: 'Mostrar la imagen entera o recortarla para cubrir todo', disabled: true }, 'Ajustar');
  const textBtn = h('button', { type: 'button', className: 'btn' }, icon('type'), ' Texto');
  const stickerBtn = h('button', { type: 'button', className: 'btn', attrs: { 'aria-haspopup': 'dialog' } }, icon('smile-plus'), ' Emoji');

  const textarea = h('textarea', { className: 'input story-editor-text', rows: 2, placeholder: PLACEHOLDER, attrs: { 'aria-label': 'Texto', dir: 'auto' } });
  const textEmojiBtn = h('button', { type: 'button', className: 'btn icon-btn', title: 'Insertar emoji en el texto', attrs: { 'aria-label': 'Insertar emoji en el texto', 'aria-haspopup': 'dialog' } }, icon('smile'));
  const fontButtons = FONTS.map((font, index) =>
    h('button', { type: 'button', className: 'story-font', dataset: { font: index }, style: { fontFamily: font.family, fontWeight: font.weight, fontStyle: font.style ?? 'normal' } }, font.name),
  );
  const fontsEl = h('div', { className: 'story-fonts', attrs: { role: 'group', 'aria-label': 'Fuente' } }, fontButtons);
  const sizeInput = h('input', { type: 'range', min: MIN_SIZE, max: MAX_SIZE, step: 1 });
  const rotationInput = h('input', { type: 'range', min: -180, max: 180, step: 1 });
  const colorInput = h('input', { type: 'color', value: '#ffffff' });
  const bgToggle = h('input', { type: 'checkbox' });
  const bgColorInput = h('input', { type: 'color', value: '#000000' });
  const removeBtn = h('button', { type: 'button', className: 'btn danger' }, icon('trash-2'), ' Quitar');
  const textRow = h('div', { className: 'story-editor-row' }, textarea, textEmojiBtn);
  const styleRow = h(
    'div',
    { className: 'story-editor-row wrap' },
    h('label', { className: 'story-editor-field' }, 'Color', colorInput),
    h('label', { className: 'story-editor-field' }, bgToggle, 'Fondo'),
    h('label', { className: 'story-editor-field' }, 'Color del fondo', bgColorInput),
  );
  const itemPanel = h(
    'div',
    { className: 'story-editor-item', hidden: true },
    textRow,
    fontsEl,
    styleRow,
    h('label', { className: 'story-editor-field slider' }, 'Tamaño', sizeInput),
    h('label', { className: 'story-editor-field slider' }, 'Giro', rotationInput),
    h('div', { className: 'story-editor-row' }, h('span', { className: 'spacer' }), removeBtn),
  );
  const helpEl = h('p', { className: 'story-editor-help' }, 'Agrega un texto o un emoji y arrástralo para ubicarlo.');
  const status = h('p', { className: 'story-editor-status', attrs: { 'aria-live': 'polite' } });
  const errorEl = h('div');

  const audience = h(
    'select',
    { className: 'input', title: 'Quién puede ver la historia', attrs: { 'aria-label': 'Quién puede ver la historia' } },
    AUDIENCES.map(([value, label]) => h('option', { value }, label)),
  );
  const closeBtn = h('button', { type: 'button', className: 'icon-btn', title: 'Cerrar (Esc)', attrs: { 'aria-label': 'Cerrar' } }, icon('x'));
  const publishBtn = h('button', { type: 'button', className: 'btn primary' }, 'Publicar');

  const dialog = h(
    'dialog',
    { className: 'story-editor', attrs: { 'aria-label': 'Crear historia' } },
    h('div', { className: 'story-editor-bar' }, closeBtn, h('h2', {}, 'Nueva historia'), h('span', { className: 'spacer' }), audience, publishBtn),
    h(
      'div',
      { className: 'story-editor-body' },
      h('div', { className: 'story-editor-stage-box' }, stage),
      h('div', { className: 'story-editor-panel' }, h('div', { className: 'story-editor-row wrap' }, imageBtn, fitBtn, textBtn, stickerBtn), helpEl, itemPanel, status, errorEl),
    ),
    fileInput,
  );

  // items: [{ id, kind: 'text' | 'emoji', text, x, y, rotation (grados), size (px del lienzo), font, color, bg, bgColor, box }]
  // x, y es el centro; box = { w, h } lo calcula el dibujo.
  let items = [];
  let selected = null;
  let nextId = 1;
  let image = null; // HTMLImageElement del fondo
  let objectUrl = null;
  let fit = 'cover'; // 'cover' rellena · 'contain' muestra la imagen entera
  let drag = null; // arrastre en curso: { item, dx, dy } o { item, angle, distance, rotation, size }
  let busy = false;
  let closing = false;
  let drawQueued = false;

  // --- Dibujo ---

  function drawImage(target, mode, scale = 1) {
    const ratio = mode === 'cover' ? Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight) : Math.min(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight);
    const w = image.naturalWidth * ratio * scale;
    const h2 = image.naturalHeight * ratio * scale;
    target.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h2) / 2, w, h2);
  }

  function renderBackdrop() {
    const back = backdrop.getContext('2d');
    back.filter = 'none';
    const gradient = back.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#2b2f45');
    gradient.addColorStop(1, '#0d0e14');
    back.fillStyle = image ? '#000000' : gradient;
    back.fillRect(0, 0, WIDTH, HEIGHT);
    if (!image) return;
    if (fit === 'contain') {
      // los bordes que deja la imagen se rellenan con ella misma, desenfocada y más oscura
      back.filter = 'blur(48px) brightness(0.55)';
      drawImage(back, 'cover', 1.15);
      back.filter = 'none';
    }
    drawImage(back, fit);
  }

  // Mide un elemento: renglones y caja (con el margen del fondo)
  function layout(item, text = item.text) {
    ctx.font = fontOf(item);
    const lines = wrapLines(ctx, text);
    const lineHeight = item.size * LINE_HEIGHT;
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width), item.size * 0.5);
    const padX = item.kind === 'text' ? item.size * 0.4 : 0;
    const padY = item.kind === 'text' ? item.size * 0.22 : 0;
    return { lines, lineHeight, w: width + padX * 2, h: lines.length * lineHeight + padY * 2 };
  }

  // final: el dibujo que se sube (sin el texto de ejemplo de los elementos vacíos)
  function drawItem(item, final) {
    const empty = !item.text.trim();
    if (empty && final) return;
    const { lines, lineHeight, w, h: height } = layout(item, empty ? PLACEHOLDER : item.text);
    item.box = { w, h: height };
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.globalAlpha = empty ? 0.5 : 1;
    if (item.bg && item.kind === 'text') {
      ctx.save();
      ctx.globalAlpha *= 0.86;
      ctx.fillStyle = item.bgColor;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -height / 2, w, height, item.size * 0.3);
      ctx.fill();
      ctx.restore();
    } else if (item.kind === 'text') {
      // sin fondo, una sombra separa el texto de la imagen
      ctx.shadowColor = 'rgb(0 0 0 / 75%)';
      ctx.shadowBlur = item.size * 0.2;
      ctx.shadowOffsetY = item.size * 0.04;
    }
    ctx.fillStyle = item.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const top = -(lines.length * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 0, top + lineHeight * (i + 0.5)));
    ctx.restore();
  }

  function draw(final = false) {
    drawQueued = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    for (const item of items) drawItem(item, final);
    placeFrame();
  }

  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => draw());
  }

  // Marco de selección (DOM) sobre el elemento elegido
  function placeFrame() {
    frame.hidden = !selected?.box;
    if (frame.hidden) return;
    Object.assign(frame.style, {
      left: `${(selected.x / WIDTH) * 100}%`,
      top: `${(selected.y / HEIGHT) * 100}%`,
      width: `${(selected.box.w / WIDTH) * 100}%`,
      height: `${(selected.box.h / HEIGHT) * 100}%`,
      transform: `translate(-50%, -50%) rotate(${selected.rotation}deg)`,
    });
  }

  // --- Elementos ---

  function select(item) {
    selected = item;
    itemPanel.hidden = !item;
    helpEl.hidden = Boolean(item);
    if (item) {
      const isText = item.kind === 'text';
      textRow.hidden = fontsEl.hidden = styleRow.hidden = !isText;
      textarea.value = item.text;
      sizeInput.value = item.size;
      rotationInput.value = item.rotation;
      colorInput.value = item.color;
      bgToggle.checked = item.bg;
      bgColorInput.value = item.bgColor;
      bgColorInput.disabled = !item.bg;
      for (const btn of fontButtons) btn.setAttribute('aria-pressed', String(Number(btn.dataset.font) === item.font));
    }
    queueDraw();
  }

  function addItem(kind, text) {
    const item = {
      id: nextId++,
      kind,
      text,
      x: WIDTH / 2,
      // cada elemento nuevo cae un poco más abajo que el anterior
      y: clamp(HEIGHT * 0.3 + (items.length % 6) * HEIGHT * 0.09, 0, HEIGHT),
      rotation: 0,
      size: kind === 'emoji' ? EMOJI_SIZE : TEXT_SIZE,
      font: 0,
      color: '#ffffff',
      bg: kind === 'text',
      bgColor: '#000000',
      box: null,
    };
    items.push(item);
    hint.hidden = true;
    select(item);
    return item;
  }

  function removeItem(item) {
    items = items.filter((other) => other !== item);
    if (selected === item) select(null);
    renderHint();
    queueDraw();
  }

  function update(changes) {
    if (!selected) return;
    Object.assign(selected, changes);
    queueDraw();
  }

  function renderHint() {
    hint.hidden = Boolean(image) || items.length > 0;
  }

  // --- Imagen de fondo ---

  function setImage(file) {
    if (!file || !IMAGE_TYPES.includes(file.type)) return false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      image = img;
      objectUrl = url;
      // una imagen apaisada recortada a 9:16 perdería casi todo: arranca entera
      fit = img.naturalWidth > img.naturalHeight ? 'contain' : 'cover';
      renderFit();
      renderBackdrop();
      renderHint();
      status.textContent = '';
      queueDraw();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      status.textContent = 'No se pudo abrir esa imagen.';
    };
    img.src = url;
    return true;
  }

  function renderFit() {
    fitBtn.disabled = !image;
    fitBtn.textContent = fit === 'cover' ? 'Ajustar' : 'Rellenar';
  }

  // --- Puntero ---

  // Posición del puntero en px del lienzo
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
  }

  // El elemento de más arriba bajo el punto (los chicos tienen un mínimo, para poder tocarlos)
  function hitTest(p) {
    return items.findLast((item) => {
      if (!item.box) return false;
      const angle = (-item.rotation * Math.PI) / 180;
      const dx = p.x - item.x;
      const dy = p.y - item.y;
      const x = dx * Math.cos(angle) - dy * Math.sin(angle);
      const y = dx * Math.sin(angle) + dy * Math.cos(angle);
      return Math.abs(x) <= Math.max(item.box.w, 90) / 2 && Math.abs(y) <= Math.max(item.box.h, 90) / 2;
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    const p = point(event);
    const item = hitTest(p) ?? null;
    select(item);
    if (!item) return;
    drag = { item, dx: p.x - item.x, dy: p.y - item.y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.angle != null) return;
    const p = point(event);
    drag.item.x = clamp(p.x - drag.dx, 0, WIDTH);
    drag.item.y = clamp(p.y - drag.dy, 0, HEIGHT);
    queueDraw();
  });
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => (drag = null));
  canvas.addEventListener('dblclick', () => {
    if (selected?.kind === 'text') textarea.focus();
  });
  canvas.addEventListener('keydown', (event) => {
    if (!selected) return;
    const step = event.shiftKey ? 50 : 10;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (move) update({ x: clamp(selected.x + move[0], 0, WIDTH), y: clamp(selected.y + move[1], 0, HEIGHT) });
    else if (event.key === 'Delete' || event.key === 'Backspace') removeItem(selected);
    else return;
    event.preventDefault();
  });

  // Manija de la esquina: el ángulo respecto del centro gira el elemento y la distancia lo agranda
  handle.addEventListener('pointerdown', (event) => {
    if (!selected) return;
    event.preventDefault();
    const p = point(event);
    drag = {
      item: selected,
      angle: Math.atan2(p.y - selected.y, p.x - selected.x),
      distance: Math.hypot(p.x - selected.x, p.y - selected.y) || 1,
      rotation: selected.rotation,
      size: selected.size,
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.angle == null) return;
    const { item } = drag;
    const p = point(event);
    const turned = ((Math.atan2(p.y - item.y, p.x - item.x) - drag.angle) * 180) / Math.PI;
    item.rotation = Math.round(((((drag.rotation + turned + 180) % 360) + 360) % 360) - 180);
    item.size = Math.round(clamp((drag.size * Math.hypot(p.x - item.x, p.y - item.y)) / drag.distance, MIN_SIZE, MAX_SIZE));
    sizeInput.value = item.size;
    rotationInput.value = item.rotation;
    queueDraw();
  });
  for (const type of ['pointerup', 'pointercancel']) handle.addEventListener(type, () => (drag = null));

  // --- Controles ---

  textarea.addEventListener('input', () => update({ text: textarea.value }));
  sizeInput.addEventListener('input', () => update({ size: Number(sizeInput.value) }));
  rotationInput.addEventListener('input', () => update({ rotation: Number(rotationInput.value) }));
  colorInput.addEventListener('input', () => update({ color: colorInput.value }));
  bgColorInput.addEventListener('input', () => update({ bgColor: bgColorInput.value }));
  bgToggle.addEventListener('change', () => {
    bgColorInput.disabled = !bgToggle.checked;
    update({ bg: bgToggle.checked });
  });
  fontsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-font]');
    if (!btn || !selected) return;
    update({ font: Number(btn.dataset.font) });
    for (const other of fontButtons) other.setAttribute('aria-pressed', String(other === btn));
  });
  removeBtn.addEventListener('click', () => selected && removeItem(selected));
  textBtn.addEventListener('click', () => {
    addItem('text', '');
    textarea.focus();
  });
  stickerBtn.addEventListener('click', () => openEmojiPicker(stickerBtn, (emoji) => addItem('emoji', emoji), { forText: true }));
  textEmojiBtn.addEventListener('click', () =>
    openEmojiPicker(
      textEmojiBtn,
      (emoji) => {
        textarea.setRangeText(emoji, textarea.selectionStart, textarea.selectionEnd, 'end');
        textarea.focus();
        update({ text: textarea.value });
      },
      { forText: true },
    ),
  );
  for (const btn of [imageBtn, pickBtn]) btn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    setImage(fileInput.files[0]);
    fileInput.value = '';
  });
  fitBtn.addEventListener('click', () => {
    fit = fit === 'cover' ? 'contain' : 'cover';
    renderFit();
    renderBackdrop();
    queueDraw();
  });
  // Pegar o arrastrar una imagen
  dialog.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((f) => IMAGE_TYPES.includes(f.type));
    if (file && setImage(file)) event.preventDefault();
  });
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  dialog.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  dialog.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setImage([...event.dataTransfer.files].find((f) => IMAGE_TYPES.includes(f.type)));
  });

  // --- Publicar y cerrar ---

  const hasContent = () => Boolean(image) || items.some((item) => item.text.trim());

  async function publish() {
    if (busy) return;
    if (!hasContent()) {
      status.textContent = 'Elige una imagen o escribe un texto.';
      return;
    }
    busy = true;
    for (const control of [publishBtn, audience, imageBtn, fitBtn, textBtn, stickerBtn]) control.disabled = true;
    clearError(errorEl);
    status.textContent = 'Publicando…';
    const previous = selected;
    try {
      select(null);
      draw(true);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('No se pudo generar la imagen de la historia.');
      const data = new Uint8Array(await blob.arrayBuffer());
      await api.createStory(account.id, { name: `historia-${Date.now()}.jpg`, type: 'image/jpeg', data }, audience.value);
      closing = true;
      dialog.close();
      onDone?.();
    } catch (err) {
      status.textContent = '';
      select(previous);
      showError(errorEl, err, 'MeWe historia');
    } finally {
      busy = false;
      for (const control of [publishBtn, audience, imageBtn, textBtn, stickerBtn]) control.disabled = false;
      renderFit();
    }
  }

  // Cerrar con algo hecho pide confirmación: no hay borrador
  async function requestClose() {
    if (busy) return;
    if (hasContent()) {
      const confirmed = await confirmDialog({
        title: '¿Descartar la historia?',
        text: 'Lo que armaste se pierde.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
      });
      if (!confirmed) return;
    }
    closing = true;
    dialog.close();
  }

  publishBtn.addEventListener('click', publish);
  closeBtn.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', (event) => {
    if (closing) return;
    event.preventDefault();
    requestClose();
  });
  dialog.addEventListener('close', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    dialog.remove();
  });

  renderBackdrop();
  draw();
  document.body.append(dialog);
  dialog.showModal();
  pickBtn.focus();
}
