// Persiste la lista de cuentas (sin contraseñas; las cookies las guarda la plataforma).
// storage: { read() → texto o null si todavía no hay nada, write(texto) }
export class AccountStore {
  #storage;
  #accounts = [];

  constructor(storage) {
    this.#storage = storage;
  }

  async load() {
    try {
      this.#accounts = JSON.parse((await this.#storage.read()) ?? '[]');
    } catch (err) {
      console.error('[store] lista de cuentas ilegible:', err);
      this.#accounts = [];
    }
  }

  list() {
    return [...this.#accounts];
  }

  get(id) {
    return this.#accounts.find((a) => a.id === id);
  }

  findByUserId(userId) {
    return this.#accounts.find((a) => a.userId && a.userId === userId);
  }

  async upsert(account) {
    const idx = this.#accounts.findIndex((a) => a.id === account.id);
    if (idx === -1) this.#accounts.push(account);
    else this.#accounts[idx] = account;
    await this.#save();
  }

  async remove(id) {
    this.#accounts = this.#accounts.filter((a) => a.id !== id);
    await this.#save();
  }

  async #save() {
    await this.#storage.write(JSON.stringify(this.#accounts, null, 2));
  }
}
