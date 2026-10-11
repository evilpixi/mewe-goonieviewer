import { MeweClient } from '../mewe/client.js';

// Orquesta las cuentas: cada una tiene su sesión (cookies aisladas) y su MeweClient.
// Lo que depende de dónde corre la app lo pone `platform` (Electron: src/main/platform.js):
//   newAccount(id) → los datos de una cuenta nueva que se guardan: { id, … }
//   cookiesFor(account) → adaptador de cookies de la sesión de esa cuenta
//   clientOptions → opciones de MeweClient (fetch, dump)
//   login({ account, email, password, verify, onApiError, onStatus }) → el perfil, cuando el usuario se loguea
//   clearSession(account) → borra las cookies de la cuenta
export class AccountManager {
  #clients = new Map();

  constructor({ store, platform, onLoginError, onLoginStatus }) {
    this.store = store;
    this.platform = platform;
    this.onLoginError = onLoginError;
    this.onLoginStatus = onLoginStatus;
  }

  list() {
    return this.store.list().map(({ id, name, email, avatar, userId }) => ({ id, name, email, avatar, userId }));
  }

  clientFor(id) {
    const account = this.store.get(id);
    if (!account) throw new Error(`Cuenta desconocida: ${id}`);
    if (!this.#clients.has(id)) this.#clients.set(id, this.#newClient(account));
    return this.#clients.get(id);
  }

  async add({ email, password }) {
    const draft = this.platform.newAccount(crypto.randomUUID());
    const client = this.#newClient(draft);

    try {
      const profile = await this.#login({ account: draft, client, email, password });

      const existing = this.store.findByUserId(profile.userId);
      if (existing) throw new Error(`La cuenta ${existing.name} ya estaba agregada.`);

      await this.store.upsert({ ...draft, email, ...profile });
      this.#clients.set(draft.id, client);
      return this.list().find((a) => a.id === draft.id);
    } catch (err) {
      await this.platform.clearSession(draft);
      throw err;
    }
  }

  // Vuelve a loguear una cuenta existente (sesión expirada) en su misma sesión
  async relogin(id) {
    const account = this.store.get(id);
    if (!account) throw new Error(`Cuenta desconocida: ${id}`);
    const client = this.clientFor(id);
    // Si el refresh-token sigue vigente alcanza con renovar la sesión (getMe lo hace solo): no hace falta la ventana
    const profile = await client.getMe().catch(() => this.#login({ account, client, email: account.email }));
    await this.store.upsert({ ...account, ...profile });
    return this.list().find((a) => a.id === id);
  }

  async remove(id) {
    const account = this.store.get(id);
    if (!account) return;
    await this.platform.clearSession(account);
    this.#clients.delete(id);
    await this.store.remove(id);
  }

  // Ejecuta fn(client, me) con el cliente de la cuenta; me = { id, userId } (userId = id de MeWe)
  withClient(id, fn) {
    const client = this.clientFor(id);
    return fn(client, { id, userId: this.store.get(id).userId });
  }

  #newClient(account) {
    return new MeweClient(this.platform.cookiesFor(account), this.platform.clientOptions);
  }

  #login({ account, client, email, password }) {
    return this.platform.login({
      account,
      email,
      password,
      verify: async () => {
        if (!(await client.hasSessionCookie())) throw new Error('Sin cookie de sesión todavía.');
        return client.getMe();
      },
      onApiError: (err) => this.onLoginError(account.id, err),
      onStatus: (message) => this.onLoginStatus(account.id, message),
    });
  }
}
