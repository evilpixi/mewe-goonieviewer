import { config } from '../config.js';

// Eventos del websocket de MeWe que interesan a la UI (el resto se ignora)
const CHAT_EVENTS = new Set([
  'newChatMessage',
  'chat-newMessage',
  'GroupChatMessage',
  'EventChatMessage',
  'chat-message-emoji-added',
  'chat-message-emoji-removed',
  'chat-delMessage',
  'chat-editMessage',
  'DelGroupChatMessage',
  'DelEventChatMessage',
]);

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60000;
const IDLE_TIMEOUT_MS = 90000; // sin mensajes ni pings en este tiempo: se reconecta

// Una conexión websocket por cuenta (wss://ws.mewe.com/indexWS?userId=…), autenticada con las cookies
// de su sesión. Reenvía a la UI los eventos de chat como 'chat:event' y el estado como 'chat:status'.
export class Realtime {
  #connections = new Map();

  constructor({ accountManager, send }) {
    this.accountManager = accountManager;
    this.send = send;
  }

  // Idempotente: la UI lo llama al mostrar los chats de una cuenta
  start(accountId) {
    let conn = this.#connections.get(accountId);
    if (!conn) {
      conn = { accountId, ws: null, connected: false, retryMs: RECONNECT_MIN_MS, timer: null, idle: null, stopped: false };
      this.#connections.set(accountId, conn);
      this.#open(conn);
    }
    return { connected: conn.connected };
  }

  stop(accountId) {
    const conn = this.#connections.get(accountId);
    if (!conn) return;
    conn.stopped = true;
    clearTimeout(conn.timer);
    clearTimeout(conn.idle);
    try {
      conn.ws?.close();
    } catch {
      // ya cerrado
    }
    this.#connections.delete(accountId);
  }

  stopAll() {
    for (const id of [...this.#connections.keys()]) this.stop(id);
  }

  async #open(conn) {
    if (conn.stopped) return;
    try {
      const { client, userId } = this.accountManager.withClient(conn.accountId, (client, me) => ({ client, userId: me.userId }));
      const url = new URL(config.mewe.websocket);
      url.searchParams.set('userId', userId);
      // Las cookies de sesión pueden ser sólo de mewe.com (sin dominio): se usan las de mewe.com
      const { cookie, 'user-agent': userAgent, origin } = await client.headers(new URL(config.mewe.host));
      // El WebSocket de Node (undici) acepta cabeceras extra: las cookies autentican la conexión
      const ws = new WebSocket(url, { headers: { cookie, 'user-agent': userAgent, origin } });
      conn.ws = ws;

      ws.addEventListener('open', () => {
        conn.retryMs = RECONNECT_MIN_MS;
        this.#setConnected(conn, true);
        this.#touch(conn);
      });
      ws.addEventListener('message', (event) => this.#onMessage(conn, event.data));
      ws.addEventListener('close', () => this.#onClose(conn));
      ws.addEventListener('error', () => {}); // 'close' llega igual y reprograma
    } catch (err) {
      console.error('[realtime]', conn.accountId, err.message);
      this.#onClose(conn);
    }
  }

  #onMessage(conn, raw) {
    this.#touch(conn);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Protocolo de la web: los mensajes numerados se confirman; el resto se contesta con pong
    if (msg.msgNo) this.#write(conn, { ack: msg.msgNo });
    else if (msg.msgType !== 'chat-isOnline') this.#write(conn, { message: 'pong' });

    if (config.debug) console.log('[realtime]', conn.accountId, msg.msgType);
    // Notificación nueva: la UI vuelve a pedir el contador
    if (/notification/i.test(msg.msgType ?? '')) {
      this.send('notif:event', { accountId: conn.accountId, type: msg.msgType });
      return;
    }
    if (!CHAT_EVENTS.has(msg.msgType)) return;
    const data = msg.data ?? {};
    this.send('chat:event', {
      accountId: conn.accountId,
      type: msg.msgType,
      threadId: data.threadId ?? data.groupId ?? data.eventId ?? data.message?.threadId ?? null,
    });
  }

  #onClose(conn) {
    clearTimeout(conn.idle);
    this.#setConnected(conn, false);
    if (conn.stopped) return;
    clearTimeout(conn.timer);
    conn.timer = setTimeout(() => this.#open(conn), conn.retryMs);
    conn.retryMs = Math.min(conn.retryMs * 2, RECONNECT_MAX_MS);
  }

  #touch(conn) {
    clearTimeout(conn.idle);
    conn.idle = setTimeout(() => {
      try {
        conn.ws?.close();
      } catch {
        this.#onClose(conn);
      }
    }, IDLE_TIMEOUT_MS);
  }

  #write(conn, payload) {
    try {
      conn.ws?.send(JSON.stringify(payload));
    } catch {
      // se reconecta en 'close'
    }
  }

  #setConnected(conn, connected) {
    if (conn.connected === connected) return;
    conn.connected = connected;
    this.send('chat:status', { accountId: conn.accountId, connected });
  }
}
