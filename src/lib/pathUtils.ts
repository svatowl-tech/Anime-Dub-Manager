/**
 * Sanitizes a string to be used as a folder or file name in Windows/macOS/Linux.
 * Replaces invalid characters with an underscore.
 */
export const sanitizeFolderName = (name: string): string => {
  // Invalid characters in Windows: < > : " / \ | ? *
  // Also remove trailing spaces and dots which can cause issues on Windows
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/\.+$/, '');
};
