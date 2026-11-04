// Web File System Access API Helper for browser environments

interface DirectoryHandleStored {
  handle: FileSystemDirectoryHandle;
}

// Простой хелпер для сохранения и извлечения FileSystemHandle из IndexedDB
const DB_NAME = 'AnimeDubManagerWebFS';
const STORE_NAME = 'handles';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveHandleToDB(key: string, handle: FileSystemHandle): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(handle, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getHandleFromDB(key: string): Promise<FileSystemHandle | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// Запрос разрешений для работы с сохраненным хэндлом
export async function verifyPermission(fileHandle: any, readWrite = true): Promise<boolean> {
  const options = {
    mode: (readWrite ? 'readwrite' : 'read') as any
  };
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
}

// Глобальный кэш хэндлов открытых файлов, чтобы получать к ним доступ по имени
const fileHandlesCache = new Map<string, File>();

function extractCacheFileKey(name: string): string {
  if (!name) return '';
  const normalized = name.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || name;
}

export function registerFileInCache(name: string, file: File) {
  const cleanName = extractCacheFileKey(name);
  fileHandlesCache.set(cleanName, file);
}

export function getFileFromCache(name: string): File | undefined {
  const cleanName = extractCacheFileKey(name);
  return fileHandlesCache.get(cleanName);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).getFileFromCache = getFileFromCache;
  (window as unknown as Record<string, unknown>).registerFileInCache = registerFileInCache;
}

export async function selectBrowserDirectory(): Promise<string> {
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      const picker = (window as unknown as { showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      const handle = await picker({
        mode: 'readwrite'
      });
      await saveHandleToDB('projectRootDir', handle);
      return handle.name;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Выбор папки отменен пользователем.');
      }
      throw err;
    }
  }

  // Fallback for Android WebView, Firefox, and Safari where File System Access API is unavailable
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Окружение не поддерживает выбор директории.'));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.onchange = () => {
      const files = input.files;
      if (files && files.length > 0) {
        let rootName = 'SandboxWorkspace';
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          if (i === 0 && relPath.includes('/')) {
            rootName = relPath.split('/')[0] || rootName;
          }
          registerFileInCache(relPath, file);
          registerFileInCache(file.name, file);
        }
        resolve(rootName);
      } else {
        reject(new Error('Выбор папки отменен пользователем.'));
      }
    };
    input.click();
  });
}

export async function selectBrowserFile(acceptTypes?: { [key: string]: string[] }): Promise<{ name: string; path: string; file: File }> {
  if (!('showOpenFilePicker' in window)) {
    // Резервный выбор через старый input file
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (acceptTypes) {
        const extensions = Object.values(acceptTypes).flat().join(',');
        input.accept = extensions;
      }
      input.onchange = () => {
        if (input.files && input.files[0]) {
          const file = input.files[0];
          registerFileInCache(file.name, file);
          resolve({
            name: file.name,
            path: file.name,
            file: file
          });
        } else {
          reject(new Error('Файл не выбран'));
        }
      };
      input.click();
    });
  }

  try {
    const types = acceptTypes ? [{
      description: 'Media and Subtitle Files',
      accept: acceptTypes
    }] : undefined;

    const [handle] = await (window as any).showOpenFilePicker({
      multiple: false,
      types
    });

    const file = await handle.getFile();
    registerFileInCache(file.name, file);
    return {
      name: file.name,
      path: file.name,
      file: file
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Выбор файла отменен.');
    }
    throw err;
  }
}

export async function writeToLocalFolder(fileName: string, content: string | Blob): Promise<string> {
  try {
    const rootHandle = await getHandleFromDB('projectRootDir') as FileSystemDirectoryHandle | null;
    if (!rootHandle) {
      // Если папка не выбрана, сохраняем в IndexedDB/скачиваем
      downloadFallback(fileName, content);
      return `Downloaded: ${fileName}`;
    }

    const hasPermission = await verifyPermission(rootHandle, true);
    if (!hasPermission) {
      throw new Error('Нет доступа к локальной папке проектов.');
    }

    // Рекурсивно создаем вложенную структуру если путь содержит слеши
    const pathParts = fileName.replace(/\\/g, '/').split('/');
    let currentDir = rootHandle;
    
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!part || part === '.' || part === '..') continue;
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }

    const fileOnlyName = pathParts[pathParts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileOnlyName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    // Зарегистрируем вновь соданный файл в кэше для быстрого доступа
    const file = await fileHandle.getFile();
    registerFileInCache(fileName, file);

    return `${rootHandle.name}/${fileName}`;
  } catch (e: any) {
    console.warn('Failed writing via File System Access API, downloading instead:', e);
    downloadFallback(fileName, content);
    return `Fallback download: ${fileName}`;
  }
}

export async function readFromLocalFolder(fileName: string): Promise<string | File> {
  try {
    // Сначала проверяем наш кэш открытых в сессии файлов (очень быстро для видео и аудио)
    const cachedFile = getFileFromCache(fileName);
    if (cachedFile) {
      return cachedFile;
    }

    const rootHandle = await getHandleFromDB('projectRootDir') as FileSystemDirectoryHandle | null;
    if (!rootHandle) {
      throw new Error('Локальная папка для синхронизации файлов не выбрана в настройках.');
    }

    const hasPermission = await verifyPermission(rootHandle, false);
    if (!hasPermission) {
      throw new Error('Нет разрешения на чтение из локальной папки.');
    }

    const pathParts = fileName.replace(/\\/g, '/').split('/');
    let currentDir = rootHandle;
    
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!part || part === '.' || part === '..') continue;
      currentDir = await currentDir.getDirectoryHandle(part);
    }

    const fileOnlyName = pathParts[pathParts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileOnlyName);
    const file = await fileHandle.getFile();
    
    registerFileInCache(fileName, file);
    return file;
  } catch (e: any) {
    console.warn(`Could not read local file natively: ${fileName}. Retrying cache.`, e);
    const cached = getFileFromCache(fileName);
    if (cached) return cached;
    throw new Error(`Файл не найден в локальной папке: ${fileName}`);
  }
}

function downloadFallback(fileName: string, content: string | Blob) {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.split('/').pop() || fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function resolveLocalPath(filePath: string): Promise<string> {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:') || filePath.startsWith('data:')) {
    return filePath;
  }
  
  const cleanPath = filePath.replace(/^file:\/\//, '');

  // 1. Поиск по имени файла или пути в in-memory кэше сессии
  const nameOnly = cleanPath.replace(/\\/g, '/').split('/').pop() || cleanPath;
  const cached = getFileFromCache(nameOnly) || getFileFromCache(cleanPath);
  if (cached) {
    return URL.createObjectURL(cached);
  }

  // 2. Поиск в File System Access API (если пользователь выбрал папку проекта)
  try {
    const file = await readFromLocalFolder(cleanPath);
    if (file instanceof File) {
      return URL.createObjectURL(file);
    }
  } catch (e) {
    // Не найдено в локальной папке
  }

  const isElectronEnv = typeof window !== 'undefined' && (
    Boolean((window as any).electronAPI) ||
    Boolean((window as any).isElectron) ||
    Boolean(window.navigator?.userAgent?.includes('Electron'))
  );

  // 3. Если мы находимся в Electron и путь локальный — сразу возвращаем защищенный custom-media:// URL
  if (isElectronEnv && (/^[a-zA-Z]:[/\\]/.test(cleanPath) || cleanPath.startsWith('/'))) {
    const sanitizedPath = cleanPath.replace(/\.tmp_[0-9]+_[a-z0-9]+_/i, '');
    return `custom-media://local/media?path=${encodeURIComponent(sanitizedPath)}`;
  }

  // 4. Проверка доступности файла на сервере через медиа-эндпоинт (для веб-режима)
  if (!isElectronEnv && typeof window !== 'undefined' && window.location) {
    try {
      const serverMediaUrl = `/api/media-file?path=${encodeURIComponent(cleanPath)}`;
      const checkRes = await fetch(serverMediaUrl, { method: 'HEAD' });
      if (checkRes.ok) {
        return serverMediaUrl;
      }
    } catch (e) {
      // Игнорируем сетевые ошибки проверки
    }
  }

  if (/^[a-zA-Z]:[/\\]/.test(cleanPath) || cleanPath.startsWith('/')) {
    if (isElectronEnv) {
      const sanitizedPath = cleanPath.replace(/\.tmp_[0-9]+_[a-z0-9]+_/i, '');
      return `custom-media://local/media?path=${encodeURIComponent(sanitizedPath)}`;
    }
    return '';
  }

  return cleanPath;
}

