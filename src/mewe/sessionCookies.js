// Adaptador sobre el cookie store de una sesión (partition) de Electron.
// Cada cuenta tiene su propia sesión, así que las cookies nunca se mezclan.
const SAME_SITE = { lax: 'lax', strict: 'strict', none: 'no_restriction' };

export class SessionCookies {
  constructor(electronSession) {
    this.ses = electronSession;
  }

  async header(url) {
    const cookies = await this.ses.cookies.get({ url: String(url) });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  async get(name, domain = 'mewe.com') {
    const [cookie] = await this.ses.cookies.get({ domain, name });
    return cookie?.value;
  }

  async storeFromResponse(url, response) {
    for (const raw of response.headers.getSetCookie()) {
      const cookie = parseSetCookie(raw, new URL(url));
      if (!cookie) continue;
      if (cookie.expired) await this.ses.cookies.remove(cookie.url, cookie.name);
      else await this.ses.cookies.set(cookie);
    }
  }
}

function parseSetCookie(raw, url) {
  const [pair, ...attrs] = raw.split(';');
  const idx = pair.indexOf('=');
  if (idx === -1) return null;

  const cookie = {
    url: `${url.protocol}//${url.host}`,
    name: pair.slice(0, idx).trim(),
    value: pair.slice(idx + 1).trim(),
  };

  let maxAge = null;
  for (const attr of attrs) {
    const [k, ...rest] = attr.split('=');
    const key = k.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'domain') cookie.domain = val;
    else if (key === 'path') cookie.path = val;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite') cookie.sameSite = SAME_SITE[val.toLowerCase()];
    else if (key === 'max-age') maxAge = Number(val);
    else if (key === 'expires') cookie.expirationDate = Date.parse(val) / 1000;
  }
  if (maxAge !== null) cookie.expirationDate = Date.now() / 1000 + maxAge;
  cookie.expired = cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000;
  if (!cookie.expired) delete cookie.expired;
  return cookie;
}
