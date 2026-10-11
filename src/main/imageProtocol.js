import { protocol } from 'electron';
import { config } from '../config.js';

// mewe-img://<accountId>/?u=<url de imagen de MeWe>
// Las imágenes de MeWe necesitan las cookies de la cuenta, así que se descargan desde main.
export function registerImageScheme() {
  protocol.registerSchemesAsPrivileged([
    // stream: hace falta para que <video> pueda pedir rangos (adelantar y retroceder)
    { scheme: config.imageScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

export function handleImageProtocol(accountManager) {
  protocol.handle(config.imageScheme, async (request) => {
    try {
      const { hostname: accountId, searchParams } = new URL(request.url);
      const target = new URL(searchParams.get('u'));
      if (target.protocol !== 'https:' || !isMeweHost(target.hostname)) {
        return new Response('Host no permitido', { status: 400 });
      }
      const client = accountManager.clientFor(accountId);
      // Imágenes temporales del chat: salen de la memoria del cliente a partir de la segunda vez
      if (client.isTemporalImage(target)) {
        const image = await client.fetchTemporalImage(target);
        if (config.debug) console.log(`[img] temporal ${image.status}${image.cached ? ' (memoria)' : ''} ${target.pathname}`);
        const empty = [204, 205, 304].includes(image.status); // estados que no admiten cuerpo
        return new Response(empty ? null : image.data, { status: image.status, headers: { 'content-type': image.contentType } });
      }
      // Los videos se piden de a rangos: se reenvía el pedido y la respuesta parcial tal cual
      const range = request.headers.get('range');
      const key = `${accountId} ${target}`;
      if (range && whole.has(key)) return partial(await whole.get(key), range);
      const res = await client.fetchRaw(target, range ? { range } : {});
      // Los videos mandados como archivo (/doc/chat/…) no se sirven por rangos: MeWe contesta 200 con el archivo
      // entero pida lo que se pida, y <video> se rompe. Se baja una vez y los rangos se cortan acá.
      const size = Number(res.headers.get('content-length'));
      if (range && res.status === 200 && size > 0 && size <= WHOLE_MAX_BYTES) {
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        const file = res.arrayBuffer().then((data) => ({ data: Buffer.from(data), contentType }));
        whole.set(key, file);
        file.catch(() => whole.delete(key));
        if (whole.size > WHOLE_KEEP) whole.delete(whole.keys().next().value);
        return partial(await file, range);
      }
      const headers = { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' };
      if (config.debug && (range || !res.ok)) {
        const seen = ['content-type', 'content-range', 'content-length', 'accept-ranges', 'content-encoding']
          .map((name) => `${name}=${res.headers.get(name)}`)
          .join(' ');
        console.log(`[img] ${res.status} ${target.pathname} range=${range} ${seen}`);
      }
      const passthrough = ['content-range', 'accept-ranges'];
      if (!res.headers.get('content-encoding')) passthrough.push('content-length'); // comprimida, el largo no coincide
      for (const name of passthrough) {
        const value = res.headers.get(name);
        if (value) headers[name] = value;
      }
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      console.error('[img]', request.url, err);
      return new Response(err.message, { status: 500 });
    }
  });
}

// Archivos bajados enteros para servirlos por rangos: "cuenta url" → Promise<{ data, contentType }>. Quedan los últimos.
const whole = new Map();
const WHOLE_MAX_BYTES = 150 * 1024 * 1024;
const WHOLE_KEEP = 3;

// Respuesta 206 con el pedazo pedido ("bytes=a-b", "bytes=a-" o "bytes=-n") de un archivo que ya está en memoria
function partial({ data, contentType }, range) {
  const size = data.length;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = match?.[1] ? Number(match[1]) : null;
  let end = match?.[2] ? Number(match[2]) : size - 1;
  if (match && start === null && match[2]) {
    start = Math.max(0, size - Number(match[2])); // los últimos n bytes
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start === null || start > end) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  return new Response(data.subarray(start, end + 1), {
    status: 206,
    headers: {
      'content-type': contentType,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
    },
  });
}

function isMeweHost(hostname) {
  return hostname === 'mewe.com' || hostname.endsWith('.mewe.com');
}
