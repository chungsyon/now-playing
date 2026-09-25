/**
 * LOCAL SAVING
 * ------------
 * Everything lives in IndexedDB on this device. Nothing is uploaded, and there
 * is no account. Two stores:
 *
 *   drafts  a project, plus the photo and the cover as blobs
 *   styles  a project with the photo and the song removed, to reuse later
 *
 * All the functions here return promises, so call them with `await`.
 */

const DB_NAME = 'now-playing';
const DB_VERSION = 1;

let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('styles')) {
        db.createObjectStore('styles', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

function run(storeName, mode, work) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function putDraft(draft) {
  return run('drafts', 'readwrite', store => store.put({ ...draft, updatedAt: Date.now() }));
}

export function getDraft(id) {
  return run('drafts', 'readonly', store => store.get(id));
}

export function deleteDraft(id) {
  return run('drafts', 'readwrite', store => store.delete(id));
}

export function listDrafts() {
  return run('drafts', 'readonly', store => store.getAll())
    .then(all => (all || []).sort((a, b) => b.updatedAt - a.updatedAt));
}

export function putStyle(style) {
  return run('styles', 'readwrite', store => store.put({ ...style, updatedAt: Date.now() }));
}

export function deleteStyle(id) {
  return run('styles', 'readwrite', store => store.delete(id));
}

export function listStyles() {
  return run('styles', 'readonly', store => store.getAll())
    .then(all => (all || []).sort((a, b) => b.updatedAt - a.updatedAt));
}

/**
 * Save at most once every `wait` milliseconds, and always save the last change.
 * Used for autosave, so dragging a layer does not write to disk sixty times a
 * second.
 */
export function debounce(fn, wait = 800) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    return fn(...args);
  };
  return wrapped;
}
