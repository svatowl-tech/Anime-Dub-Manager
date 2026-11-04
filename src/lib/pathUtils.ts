/**
 * Cross-platform path and filename sanitization for Windows, macOS, and Linux.
 * - Replaces invalid characters: < > : " / \ | ? * and control characters \x00-\x1F
 * - Prevents FFmpeg protocol confusion (e.g., "Киберпанк: ..." mistaken for protocol)
 * - Prevents Windows NTFS errors with invalid characters, trailing dots, or spaces
 */

export const sanitizeFolderName = (name: string): string => {
  if (!name || typeof name !== 'string') return 'Folder';
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '') || 'Folder';
};

export const sanitizeProjectTitle = (title: string): string => {
  if (!title || typeof title !== 'string') return 'Project';
  return sanitizeFolderName(title);
};

export const sanitizeFileName = (fileName: string): string => {
  if (!fileName || typeof fileName !== 'string') return 'file';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot > 0) {
    const base = fileName.slice(0, lastDot);
    const ext = fileName.slice(lastDot);
    const cleanBase = sanitizeFolderName(base);
    const cleanExt = ext.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').toLowerCase();
    return `${cleanBase}${cleanExt}`;
  }
  return sanitizeFolderName(fileName);
};

export const sanitizeFilePath = (fullPath: string): string => {
  if (!fullPath || typeof fullPath !== 'string') return fullPath;
  const isWin = fullPath.includes('\\') || /^[a-zA-Z]:/.test(fullPath);
  const sep = isWin ? '\\' : '/';

  let drivePrefix = '';
  let rest = fullPath;
  const driveMatch = rest.match(/^([a-zA-Z]:)[/\\]/);
  if (driveMatch) {
    drivePrefix = driveMatch[1] + sep;
    rest = rest.slice(driveMatch[0].length);
  } else if (rest.startsWith('/') || rest.startsWith('\\')) {
    drivePrefix = sep;
    rest = rest.slice(1);
  }

  const parts = rest.split(/[/\\]/).filter(Boolean);
  const sanitizedParts = parts.map((part, index) => {
    if (index === parts.length - 1 && part.includes('.')) {
      return sanitizeFileName(part);
    }
    return sanitizeFolderName(part);
  });

  return drivePrefix + sanitizedParts.join(sep);
};

/**
 * Normalizes any Windows or mixed path separators into clean POSIX forward slashes
 * for safe storage in cross-platform JSON manifests and virtual file caches.
 */
export const normalizeSlashes = (inputPath: string): string => {
  if (!inputPath || typeof inputPath !== 'string') return '';
  return inputPath.replace(/\\/g, '/').replace(/\/+/g, '/');
};

/**
 * Extracts the file or folder base name from any Windows, POSIX, or URL path
 * without relying on OS-specific path separators.
 */
export const getFileBaseName = (inputPath: string, stripExtension = false): string => {
  if (!inputPath || typeof inputPath !== 'string') return '';
  const clean = normalizeSlashes(inputPath).replace(/\/+$/, '');
  const parts = clean.split('/');
  const base = parts[parts.length - 1] || '';
  if (stripExtension && base.includes('.')) {
    return base.slice(0, base.lastIndexOf('.'));
  }
  return base;
};

/**
 * Safely joins relative path segments using POSIX forward slashes so paths work
 * identically across Windows, macOS, Linux, and Web/Android virtual storage.
 */
export const joinRelativePath = (...segments: Array<string | undefined | null>): string => {
  const cleaned = segments
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => normalizeSlashes(s.trim()).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  return cleaned.join('/');
};

export interface RuntimeCapabilities {
  platform: 'electron' | 'android' | 'ios' | 'web';
  supportsNativeVst3: boolean;
  supportsFileSystemAccessApi: boolean;
  isSandboxed: boolean;
}

/**
 * Detects runtime platform and sandbox capabilities (Electron desktop vs Android/iOS/Web).
 */
export const getRuntimeCapabilities = (): RuntimeCapabilities => {
  const hasWindow = typeof window !== 'undefined';
  const isElectron = Boolean(hasWindow && window.electronAPI && typeof window.electronAPI.invoke === 'function');
  const ua = hasWindow && typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const supportsFsa = Boolean(hasWindow && 'showDirectoryPicker' in window && 'showOpenFilePicker' in window);

  const platform: RuntimeCapabilities['platform'] = isElectron
    ? 'electron'
    : isAndroid
      ? 'android'
      : isIOS
        ? 'ios'
        : 'web';

  return {
    platform,
    supportsNativeVst3: isElectron && !isAndroid && !isIOS,
    supportsFileSystemAccessApi: supportsFsa,
    isSandboxed: !isElectron
  };
};

