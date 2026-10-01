import { protocol } from 'electron';
import { config } from '../config.js';

// mewe-img://<accountId>/?u=<url de imagen de MeWe>
// Las imágenes de MeWe necesitan las cookies de la cuenta, así que se descargan desde main.
export function registerImageScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: config.imageScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
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
      const res = await accountManager.clientFor(accountId).fetchRaw(target);
      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
      });
    } catch (err) {
      console.error('[img]', request.url, err);
      return new Response(err.message, { status: 500 });
    }
  });
}

function isMeweHost(hostname) {
  return hostname === 'mewe.com' || hostname.endsWith('.mewe.com');
}
