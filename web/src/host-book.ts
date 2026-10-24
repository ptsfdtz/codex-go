export type HostGrant = { hostId: string; fingerprint: string; credential: string };

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('agentdeck.web.grants.v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('grants');
      request.result.createObjectStore('keys');
    };
    request.onerror = () => reject(new Error('Cannot open browser device storage'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function read<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot read browser device storage'));
  });
}

async function write(db: IDBDatabase, store: string, key: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(new Error('Cannot save browser device authorization'));
  });
}

export async function saveGrant(scope: string, grant: HostGrant): Promise<void> {
  const db = await database();
  try {
    // A separate key per grant avoids key creation races between browser tabs.
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const id = `${scope}:${grant.hostId}`;
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
      key,
      new TextEncoder().encode(JSON.stringify(grant)),
    );
    await write(db, 'grants', id, { key, iv, data });
  } finally {
    db.close();
  }
}

export async function loadGrant(scope: string, hostId: string): Promise<HostGrant | undefined> {
  const db = await database();
  try {
    const id = `${scope}:${hostId}`;
    const record = await read<{ key: CryptoKey; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }>(
      db,
      'grants',
      id,
    );
    if (!record) return undefined;
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: new TextEncoder().encode(id) },
      record.key,
      record.data,
    );
    const grant = JSON.parse(new TextDecoder().decode(bytes)) as HostGrant;
    if (
      grant.hostId !== hostId ||
      !/^[a-f0-9]{64}$/i.test(grant.fingerprint) ||
      !/^[A-Za-z0-9_-]{43}$/.test(grant.credential)
    )
      throw new Error('Invalid stored host grant');
    return grant;
  } finally {
    db.close();
  }
}
