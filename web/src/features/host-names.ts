import type { Host } from '../workspace';

export type HostName = Pick<Host, 'hostId' | 'customName' | 'customNameConfigured'>;
export const hostName = (host: Host) => host.customName?.trim() || host.displayName;
const legacyKey = (scope: string, hostId: string) => `agentdeck.web.label.${scope}.${hostId}`;

export async function migrateHostNames(
  hosts: Host[],
  scope: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  save: (hostId: string, customName: string) => Promise<HostName>,
  active: () => boolean,
): Promise<Host[]> {
  const result: Host[] = [];
  for (const host of hosts) {
    if (!active()) return hosts;
    const key = legacyKey(scope, host.hostId);
    const legacy = storage.getItem(key);
    if (legacy !== null && host.customNameConfigured === false) {
      const name = legacy.trim();
      if (
        name &&
        [...name].length <= 80 &&
        !Array.from(name).some((char) => {
          const code = char.codePointAt(0)!;
          return code < 32 || (code >= 127 && code <= 159);
        })
      ) {
        const saved = await save(host.hostId, name);
        if (!active()) return hosts;
        result.push({ ...host, ...saved });
        storage.removeItem(key);
        continue;
      }
    }
    if (host.customNameConfigured === true) storage.removeItem(key);
    result.push(host);
  }
  return result;
}
