/**
 * Cross-platform path and filename sanitization for Windows, macOS, and Linux.
 * - Removes/replaces forbidden characters (< > : " / \ | ? * \x00-\x1F)
 * - Prevents FFmpeg protocol confusion (e.g. "Киберпанк: ..." treated as URL protocol)
 * - Prevents Windows NTFS errors (invalid characters, trailing periods/spaces)
 */

function sanitizeFileNamePart(str, fallback = 'file') {
  if (!str || typeof str !== 'string') return fallback;
  const cleaned = str
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  return cleaned || fallback;
}

function sanitizeFolderName(str, fallback = 'Folder') {
  return sanitizeFileNamePart(str, fallback);
}

function sanitizeProjectTitle(str, fallback = 'Project') {
  return sanitizeFileNamePart(str, fallback);
}

function sanitizeDubberNick(str, fallback = 'Dabber') {
  return sanitizeFileNamePart(str, fallback);
}

function sanitizePath(fullPath) {
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
      const ext = part.slice(part.lastIndexOf('.'));
      const base = part.slice(0, part.lastIndexOf('.'));
      return `${sanitizeFileNamePart(base, 'file')}${ext.toLowerCase()}`;
    }
    return sanitizeFileNamePart(part, 'dir');
  });

  return drivePrefix + sanitizedParts.join(sep);
}

module.exports = {
  sanitizeFileNamePart,
  sanitizeFolderName,
  sanitizeProjectTitle,
  sanitizeDubberNick,
  sanitizePath
};
