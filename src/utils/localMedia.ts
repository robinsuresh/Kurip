const DB_NAME = 'kurip-media-db';
const STORE_NAME = 'images';
const LS_FALLBACK_PREFIX = 'kurip.media.v1.';
const LOCAL_PREFIX = 'local://';

const memoryCache = new Map<string, string>();
const inflightReads = new Map<string, Promise<string | null>>();

function openMediaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image data.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export function isLocalMediaUrl(url: string): boolean {
  return url.trim().startsWith(LOCAL_PREFIX);
}

export function getCachedLocalImage(url: string): string | null {
  const key = url.trim();
  if (!isLocalMediaUrl(key)) return key;
  const cached = memoryCache.get(key);
  if (cached) return cached;
  try {
    const ls = localStorage.getItem(`${LS_FALLBACK_PREFIX}${key}`);
    if (ls) {
      memoryCache.set(key, ls);
      return ls;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function saveLocalImageFile(file: File): Promise<{ url: string; alt: string }> {
  const cleanName = (file.name || 'image.png')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const localUrl = `${LOCAL_PREFIX}${id}/${cleanName || 'image.png'}`;
  const dataUrl = await readFileAsDataUrl(file);

  memoryCache.set(localUrl, dataUrl);

  const db = await openMediaDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(dataUrl, localUrl);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } else {
    try {
      localStorage.setItem(`${LS_FALLBACK_PREFIX}${localUrl}`, dataUrl);
    } catch {
      // ignore quota errors
    }
  }

  const baseAlt = (file.name || 'Image').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return { url: localUrl, alt: baseAlt || 'Image' };
}

export async function resolveLocalImageUrl(url: string): Promise<string | null> {
  const key = url.trim();
  if (!isLocalMediaUrl(key)) return key;

  const immediate = getCachedLocalImage(key);
  if (immediate) return immediate;

  const existing = inflightReads.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const db = await openMediaDb();
    if (db) {
      const value = await new Promise<string | null>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(key);
          req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (value) {
        memoryCache.set(key, value);
        return value;
      }
    }
    return null;
  })().finally(() => {
    inflightReads.delete(key);
  });

  inflightReads.set(key, promise);
  return promise;
}
