import { randomUUID } from 'node:crypto';
import { session } from 'electron';
import { MeweClient } from '../mewe/client.js';
import { SessionCookies } from '../mewe/sessionCookies.js';
import { openLoginWindow } from './loginWindow.js';

// Orquesta las cuentas: cada una tiene su partition de Electron y su MeweClient.
export class AccountManager {
  #clients = new Map();

  constructor({ store, getParentWindow, onLoginError, onLoginStatus }) {
    this.store = store;
    this.getParentWindow = getParentWindow;
    this.onLoginError = onLoginError;
    this.onLoginStatus = onLoginStatus;
  }

  list() {
    return this.store.list().map(({ id, name, email, avatar, userId }) => ({ id, name, email, avatar, userId }));
  }

  clientFor(id) {
    const account = this.store.get(id);
    if (!account) throw new Error(`Cuenta desconocida: ${id}`);
    if (!this.#clients.has(id)) {
      const ses = session.fromPartition(account.partition);
      this.#clients.set(id, new MeweClient(new SessionCookies(ses)));
    }
    return this.#clients.get(id);
  }

  async add({ email, password }) {
    const id = randomUUID();
    const partition = `persist:mewe-${id}`;
    const ses = session.fromPartition(partition);
    const client = new MeweClient(new SessionCookies(ses));

    try {
      const profile = await this.#login({ id, ses, client, email, password });

      const existing = this.store.findByUserId(profile.userId);
      if (existing) throw new Error(`La cuenta ${existing.name} ya estaba agregada.`);

      const account = { id, partition, email, ...profile };
      await this.store.upsert(account);
      this.#clients.set(id, client);
      return this.list().find((a) => a.id === id);
    } catch (err) {
      await ses.clearStorageData();
      throw err;
    }
  }

  // Vuelve a loguear una cuenta existente (sesión expirada) en su misma partition
  async relogin(id) {
    const account = this.store.get(id);
    if (!account) throw new Error(`Cuenta desconocida: ${id}`);
    const ses = session.fromPartition(account.partition);
    const client = this.clientFor(id);
    // Si el refresh-token sigue vigente alcanza con renovar la sesión (getMe lo hace solo): no hace falta la ventana
    const profile = await client.getMe().catch(() => this.#login({ id, ses, client, email: account.email }));
    await this.store.upsert({ ...account, ...profile });
    return this.list().find((a) => a.id === id);
  }

  async remove(id) {
    const account = this.store.get(id);
    if (!account) return;
    await session.fromPartition(account.partition).clearStorageData();
    this.#clients.delete(id);
    await this.store.remove(id);
  }

  // Ejecuta fn(client, me) con el cliente de la cuenta; me = { id, userId } (userId = id de MeWe)
  withClient(id, fn) {
    const client = this.clientFor(id);
    return fn(client, { id, userId: this.store.get(id).userId });
  }

  #login({ id, ses, client, email, password }) {
    return openLoginWindow({
      ses,
      parent: this.getParentWindow(),
      email,
      password,
      verify: async () => {
        if (!(await client.hasSessionCookie())) throw new Error('Sin cookie de sesión todavía.');
        return client.getMe();
      },
      onApiError: (err) => this.onLoginError(id, err),
      onStatus: (message) => this.onLoginStatus(id, message),
    });
  }
}
