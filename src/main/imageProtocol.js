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
      const res = await client.fetchRaw(target, range ? { range } : {});
      const headers = { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' };
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

function isMeweHost(hostname) {
  return hostname === 'mewe.com' || hostname.endsWith('.mewe.com');
}
