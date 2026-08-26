/**
 * Time and text utilities for subtitle lines and character speech inspection.
 */

/**
 * Parses ASS timecode ("H:MM:SS.cs" or "HH:MM:SS.cs" or "MM:SS.cs") to seconds.
 */
export function parseAssTimeToSeconds(timeStr: string | number): number {
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;

  const clean = timeStr.trim();
  const parts = clean.split(':');
  
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  
  const sec = parseFloat(clean);
  return isNaN(sec) ? 0 : sec;
}

/**
 * Formats seconds to short human readable timestamp "MM:SS.c" or "HH:MM:SS".
 */
export function formatSecondsToTime(seconds: number, includeHours = false): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 10);

  const mStr = String(m).padStart(2, '0');
  const sStr = String(s).padStart(2, '0');

  if (h > 0 || includeHours) {
    const hStr = String(h).padStart(2, '0');
    return `${hStr}:${mStr}:${sStr}.${cs}`;
  }
  return `${mStr}:${sStr}.${cs}`;
}

/**
 * Formats seconds to standard ASS timestamp format "H:MM:SS.cs".
 */
export function secondsToAssTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);

  const mStr = String(m).padStart(2, '0');
  const sStr = String(s).padStart(2, '0');
  const csStr = String(cs).padStart(2, '0');

  return `${h}:${mStr}:${sStr}.${csStr}`;
}

/**
 * Cleans ASS formatting tags, drawing commands, and newlines from dialogue text for clear reading.
 */
export function cleanDialogueText(text: string): string {
  if (!text) return '';
  return text
    // Replace ASS newlines with standard space or newline
    .replace(/\\N/gi, ' ')
    .replace(/\\n/gi, ' ')
    .replace(/\\h/gi, ' ')
    // Remove ASS style override tags like {\an8}, {\pos(100,200)}, {\c&HFFFFFF&}, {\fad(100,100)}
    .replace(/\{[^}]*\}/g, '')
    // Clean multiple consecutive whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
