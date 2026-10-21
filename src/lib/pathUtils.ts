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
