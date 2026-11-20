import { exclusive } from '../coordination';

const ttl = 7 * 24 * 3600 * 1000;
type SavedText = { text: string; revision: string; expires: number; project?: string };
const root = 'agentdeck.web.text-drafts.v1.';

// Only called for the main composer after the authenticated Host snapshot has
// selected its owner. Other Draft fields may name files or contain binary data.
export class LocalTextDrafts {
  readonly preference: string;
  private readonly prefix: string;
  private readonly revisions = new Map<string, string>();

  constructor(readonly scope: string) {
    this.preference = root + JSON.stringify(scope);
    this.prefix = this.preference + '/';
  }
  enabled() {
    try {
      return !!this.scope && localStorage.getItem(this.preference) === '1';
    } catch {
      return false;
    }
  }
  private edit(work: () => void) {
    return exclusive(this.preference, async () => work());
  }
  private keys() {
    return Object.keys(localStorage).filter((key) => key.startsWith(this.prefix));
  }
  private read(key: string): SavedText | undefined {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (
        typeof value?.revision === 'string' &&
        typeof value.text === 'string' &&
        typeof value.expires === 'number' &&
        value.expires > Date.now()
      )
        return value;
    } catch {
      /* A damaged record is ineligible for restoration. */
    }
  }
  prune() {
    if (!this.enabled()) return Promise.resolve();
    return this.edit(() => {
      for (const key of this.keys()) if (!this.read(key)) localStorage.removeItem(key);
    });
  }
  pruneProjects(hostId: string, projects: Set<string>) {
    if (!this.enabled()) return Promise.resolve();
    return this.edit(() => {
      for (const key of this.keys()) {
        const record = this.read(key);
        const owner = key.slice(this.prefix.length);
        let parts: unknown;
        try {
          parts = JSON.parse(owner);
        } catch {
          continue;
        }
        if (
          Array.isArray(parts) &&
          parts[0] === this.scope &&
          parts[1] === hostId &&
          record?.project &&
          !projects.has(record.project)
        )
          localStorage.removeItem(key);
      }
    });
  }
  async setEnabled(value: boolean) {
    if (value) return this.edit(() => localStorage.setItem(this.preference, '1'));
    const clear = () => {
      localStorage.removeItem(this.preference);
      for (const key of this.keys()) localStorage.removeItem(key);
      this.revisions.clear();
    };
    // Logout can immediately navigate away. Remove consent and copies before
    // yielding, then serialize cleanup behind any writer already in flight.
    clear();
    return this.edit(clear);
  }
  restore(key: string, inMemory?: string) {
    if (!this.enabled()) return;
    const record = this.read(this.prefix + key);
    if (record && (inMemory === undefined || inMemory === record.text)) {
      this.revisions.set(key, record.revision);
      return record.text;
    }
  }
  revision(key: string) {
    return this.revisions.get(key);
  }
  save(key: string, text: string, project?: string) {
    if (!this.enabled()) return Promise.resolve();
    const revision = crypto.randomUUID();
    this.revisions.set(key, revision);
    return this.edit(() => {
      if (!this.enabled()) return;
      if (text)
        localStorage.setItem(
          this.prefix + key,
          JSON.stringify({ text, revision, expires: Date.now() + ttl, project }),
        );
      else localStorage.removeItem(this.prefix + key);
    });
  }
  // Acknowledgements may arrive after this tab or another tab edits again.
  settle(key: string, revision: string | undefined, newKey?: string) {
    if (!revision || !this.enabled()) return Promise.resolve();
    if (newKey) this.revisions.set(newKey, revision);
    return this.edit(() => {
      if (!this.enabled()) return;
      const source = this.prefix + key;
      const record = this.read(source);
      if (record?.revision !== revision) return;
      if (newKey && !this.read(this.prefix + newKey)) {
        localStorage.setItem(this.prefix + newKey, JSON.stringify(record));
      }
      localStorage.removeItem(source);
    });
  }
}
