import fs from 'node:fs/promises';
import path from 'node:path';

// Persiste la lista de cuentas (sin contraseñas; las cookies viven en cada partition).
export class AccountStore {
  #file;
  #accounts = [];

  constructor(dir) {
    this.#file = path.join(dir, 'accounts.json');
  }

  async load() {
    try {
      this.#accounts = JSON.parse(await fs.readFile(this.#file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[store] accounts.json ilegible:', err);
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
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    await fs.writeFile(this.#file, JSON.stringify(this.#accounts, null, 2));
  }
}
