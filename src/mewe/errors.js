// Pistas para errores conocidos de la API de MeWe
const ERROR_CODE_HINTS = {
  118: 'MeWe exige resolver el captcha para iniciar sesión.',
};

const STATUS_HINTS = {
  401: 'Sesión expirada o inválida. Reconecta la cuenta.',
  403: 'MeWe rechazó la petición (permisos o CSRF).',
  429: 'Demasiadas peticiones. Espera un poco antes de reintentar.',
};

export class MeweApiError extends Error {
  constructor({ status, url, body, message }) {
    super(body?.message || message || `HTTP ${status}`);
    this.name = 'MeweApiError';
    this.status = status ?? null;
    this.url = url ? String(url) : null;
    this.errorCode = body?.errorCode ?? null;
    this.body = body ?? null;
    this.hint = ERROR_CODE_HINTS[this.errorCode] ?? STATUS_HINTS[this.status] ?? null;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      errorCode: this.errorCode,
      hint: this.hint,
      url: this.url,
      body: this.body,
    };
  }
}

// Convierte cualquier error en un objeto plano que puede cruzar IPC
export function serializeError(err) {
  if (typeof err?.toJSON === 'function') return err.toJSON();
  return { name: err?.name ?? 'Error', message: err?.message ?? String(err) };
}
