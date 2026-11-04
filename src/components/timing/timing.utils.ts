import { SubtitleLine, RoleAssignment } from '../../types';
import { normalizeSpeechText } from '../../lib/qa/whisperTextChecker';
import { resolveLocalPath } from '../../lib/webFileSystem';

/**
 * Checks whether a phrase is already within subtitle bounds or its tail overhang
 * does not exceed 30% of the subtitle duration (meaning timing shift is not required).
 */
export function isPhraseTimingNotRequired(
  clipStartSec: number,
  clipDurationSec: number,
  subStartSec: number,
  subEndSec: number
): { notRequired: boolean; reason?: string } {
  const clipEndSec = clipStartSec + clipDurationSec;
  const subDurationSec = Math.max(0.1, subEndSec - subStartSec);

  // Must start inside or within a tiny tolerance (-0.12s) of subtitle start
  if (clipStartSec < subStartSec - 0.12 || clipStartSec > subEndSec) {
    return { notRequired: false };
  }

  // Case 1: Phrase fits completely within subtitle boundaries
  if (clipEndSec <= subEndSec + 0.05) {
    return {
      notRequired: true,
      reason: 'Фраза полностью в границах субтитра — тайминг не требуется'
    };
  }

  // Case 2: Tail overhang after subtitle end is <= 30% of subtitle duration
  const tailOverhangSec = clipEndSec - subEndSec;
  const maxAllowedTailSec = subDurationSec * 0.30;
  if (tailOverhangSec <= maxAllowedTailSec + 0.02) {
    const tailPct = Math.round((tailOverhangSec / subDurationSec) * 100);
    return {
      notRequired: true,
      reason: `Хвост фразы (+${tailOverhangSec.toFixed(2)}с / ${tailPct}%) ≤ 30% саба — тайминг не требуется`
    };
  }

  return { notRequired: false };
}


/**
 * Calculates text similarity for Whisper speech vs. Subtitle text
 * Word-level Dice coefficient with prefix/stem matching for Russian morphology.
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const norm1 = normalizeSpeechText(text1);
  const norm2 = normalizeSpeechText(text2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

  const words1 = norm1.split(' ').filter(Boolean);
  const words2 = norm2.split(' ').filter(Boolean);
  if (words1.length === 0 || words2.length === 0) return 0;

  let common = 0;
  for (const w of words1) {
    if (words2.includes(w)) {
      common += 1.0;
    } else {
      const stem = w.slice(0, Math.min(5, w.length));
      if (stem.length >= 4 && words2.some(w2 => w2.startsWith(stem))) {
        common += 0.8;
      }
    }
  }
  const dice = (2 * common) / (words1.length + words2.length);
  return Math.min(1.0, Math.max(0, dice));
}

export const isFixTrack = (t: any): boolean => {
  if (!t) return false;
  if (t.role === 'fix' || t.isFix === true || t.type === 'FIXES') return true;
  if (t.id && (t.id.endsWith('_fix') || t.id.includes('_fix_') || t.id.startsWith('fix_') || /_fix\d*$/i.test(t.id))) return true;
  if (t.filePath && (/(?:_fix|фикс|\[fix\]|\[фикс\])/i.test(t.filePath))) return true;
  if (t.participant && (/(?:_fix|фикс|\[fix\]|\[фикс\]|\(фикс)/i.test(t.participant))) return true;
  if (t.role === 'dubber') return false;
  return false;
};

export function parseTimeToSeconds(timeStr: string | number): number {
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const str = timeStr.trim();
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2].replace(',', '.')) || 0;
    return h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseFloat(parts[1].replace(',', '.')) || 0;
    return m * 60 + s;
  }
  return parseFloat(str.replace(',', '.')) || 0;
}

export function formatSeconds(sec: number): string {
  const safe = Math.max(0, sec || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export const normalizeName = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_.\-—–()\[\]«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanDubberNick = (raw: string): string => {
  return normalizeName(
    (raw || '')
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/(?:[_\-\s]|^)(?:fix|фикс|испр|правки|дозапись|перезапись|дубль|ch\d+|part\d+|\d+s|\d+ep|\d+серия)(?:[_\-\s\d]|$)/gi, ' ')
  );
};

export const splitCharactersList = (raw: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,;/+&]+|\s+и\s+/i)
    .map(s => normalizeName(s))
    .filter(s => s.length > 0 && s !== 'персонаж' && s !== 'неизвестный' && s !== 'unknown' && s !== 'все' && s !== 'all');
};

export const isCharacterMatch = (subCharNorm: string, targetCharNorm: string): boolean => {
  if (!subCharNorm || !targetCharNorm) return false;
  if (subCharNorm === targetCharNorm) return true;
  const subParts = splitCharactersList(subCharNorm);
  const targetParts = splitCharactersList(targetCharNorm);
  for (const sp of subParts) {
    for (const tp of targetParts) {
      if (sp === tp) return true;
      if (sp.length >= 3 && tp.length >= 3) {
        const spTokens = sp.split(' ');
        const tpTokens = tp.split(' ');
        if (spTokens.includes(tp) || tpTokens.includes(sp)) return true;
      }
    }
  }
  return false;
};

export const isSubtitleForCharacter = (
  subOrName: SubtitleLine | string | undefined,
  targetCharOrList: string | string[],
  cleanTrackNick: string,
  allAssignments: RoleAssignment[] = [],
  subStyle?: string,
  projectAliases?: Record<string, any>
): boolean => {
  const rawName = typeof subOrName === 'string'
    ? subOrName
    : (subOrName?.name || (subOrName as any)?.character || (subOrName as any)?.actor || '');
  const rawStyle = subStyle ?? (typeof subOrName === 'object' && subOrName ? subOrName.style : '');
  const sChar = normalizeName(rawName || rawStyle || '');
  const sStyle = normalizeName(rawStyle || '');
  if (!sChar && !sStyle) return false;

  const trackCharactersNorm: string[] = Array.isArray(targetCharOrList)
    ? targetCharOrList.flatMap(c => splitCharactersList(c))
    : splitCharactersList(targetCharOrList);

  if (projectAliases && typeof projectAliases === 'object') {
    for (const [aliasKey, mainVal] of Object.entries(projectAliases)) {
      const normAlias = normalizeName(aliasKey);
      const normMain = normalizeName(String(mainVal || ''));
      if (normAlias && normMain) {
        if (trackCharactersNorm.some(tc => isCharacterMatch(tc, normMain) || isCharacterMatch(tc, normAlias))) {
          if (isCharacterMatch(sChar, normAlias) || isCharacterMatch(sChar, normMain) || (sStyle && (isCharacterMatch(sStyle, normAlias) || isCharacterMatch(sStyle, normMain)))) {
            return true;
          }
        }
      }
    }
  }

  if (trackCharactersNorm.some(tc => (sChar && isCharacterMatch(sChar, tc)) || (sStyle && isCharacterMatch(sStyle, tc)))) {
    return true;
  }

  const normTrackNick = cleanDubberNick(cleanTrackNick);
  if (normTrackNick && ((sChar && isCharacterMatch(sChar, normTrackNick)) || (sStyle && isCharacterMatch(sStyle, normTrackNick)))) {
    return true;
  }

  if (normTrackNick && allAssignments.length > 0) {
    for (const role of allAssignments) {
      const roleAny = role as any;
      const roleDubbers = [
        ...(Array.isArray(roleAny.dubbers) ? roleAny.dubbers : []),
        ...(Array.isArray(roleAny.assignedDubbers) ? roleAny.assignedDubbers : []),
        role.dubber?.nickname,
        role.substitute?.nickname,
        roleAny.participant,
        roleAny.dubberName
      ].filter(Boolean).map(d => cleanDubberNick(String(d)));

      const isAssignedToThisDubber = roleDubbers.some(
        rd => rd && (rd === normTrackNick || (rd.length >= 3 && normTrackNick.length >= 3 && (rd.includes(normTrackNick) || normTrackNick.includes(rd))))
      );

      if (isAssignedToThisDubber) {
        const rName = normalizeName(role.characterName || roleAny.character || roleAny.role || '');
        if (rName && ((sChar && isCharacterMatch(sChar, rName)) || (sStyle && isCharacterMatch(sStyle, rName)))) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Resolves a local file path to a playable URL in Electron/Browser.
 */
export async function getPlayableAudioUrl(filePath?: string | null): Promise<string | null> {
  if (!filePath || typeof filePath !== 'string') return null;
  if (filePath.startsWith('blob:') || filePath.startsWith('data:')) {
    return filePath;
  }
  const resolved = await resolveLocalPath(filePath);
  if (resolved) return resolved;

  if (
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('media://') ||
    filePath.startsWith('/api/')
  ) {
    return filePath;
  }
  const normalized = filePath.replace(/\\/g, '/');
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return `media://local/${encodeURIComponent(normalized)}`;
  }
  return `/api/local-file?path=${encodeURIComponent(normalized)}`;
}

