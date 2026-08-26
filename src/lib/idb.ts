export const idb = {
  dbPromise: typeof window !== 'undefined' ? new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('anime-dub-db', 1);
    req.onupgradeneeded = (e: any) => {
      e.target.result.createObjectStore('files');
    };
    req.onsuccess = (e: any) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  }) : Promise.resolve(null as unknown as IDBDatabase),

  async set(key: string, val: any) {
    const db = await this.dbPromise;
    if (!db) return;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async get(key: string) {
    const db = await this.dbPromise;
    if (!db) return null;
    return new Promise<any>((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
};
