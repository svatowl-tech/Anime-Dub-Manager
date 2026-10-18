export function isSubtitleForCharacter(subName: string, trackChar: string, trackDubber: string, assignments: any[] = []): boolean {
  if (!subName) return false;
  const normSub = subName.trim().toLowerCase();
  const normChar = (trackChar || '').trim().toLowerCase();
  const normDubber = (trackDubber || '').trim().toLowerCase();

  if (normSub === normChar || normSub.includes(normChar) || normChar.includes(normSub)) {
    return true;
  }
  if (normSub === normDubber || normSub.includes(normDubber) || normDubber.includes(normSub)) {
    return true;
  }
  return false;
}

export function cleanDubberNick(name: string): string {
  if (!name) return '';
  return name.replace(/\[.*?\]/g, '').trim();
}

export function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  return `${mins}:${Number(secs) < 10 ? '0' : ''}${secs}`;
}

export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr) || 0;
}
