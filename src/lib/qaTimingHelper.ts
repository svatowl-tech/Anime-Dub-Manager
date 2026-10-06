import { Episode, RoleAssignment, UploadedFile, Track } from '../types';

export interface DeduplicatedActorTrack {
  actorKey: string;
  dubberNick: string;
  dubberId?: string;
  characterName: string;
  assignmentIds: string[];
  selectedFile: {
    id: string;
    name: string;
    path: string;
    isFix: boolean;
    type: 'DUBBER_FILE' | 'FIXES';
    createdAt?: string;
    size?: number;
  };
  patchSnippet?: {
    id: string;
    name: string;
    path: string;
  } | null;
  status: 'recorded' | 'approved' | 'fixes_needed' | 'pending';
}

/**
 * Clean and normalize dubber nickname for deduplication matching
 */
export function cleanDubberNick(rawNick: string): string {
  if (!rawNick) return '';
  return String(rawNick)
    .replace(/\[.*\]/g, '')
    .replace(/_?(дорожка|слой|take|layer|фикс|fix)\s*\d*/gi, '')
    .replace(/[^\w\d\s\u0400-\u04FF_-]/g, '')
    .trim();
}

/**
 * Normalizes string for key comparison
 */
export function normalizeKey(str: string): string {
  return cleanDubberNick(str).toLowerCase().replace(/[\s._-]+/g, '');
}

/**
 * Prepares and deduplicates QA tracks for Timing module.
 * 
 * Rules:
 * 1. Groups all files (DUBBER_FILE and FIXES) by actor/dubber.
 * 2. If multiple files of the same type exist, keeps strictly the newest one by createdAt.
 * 3. If a FIXES file exists alongside a DUBBER_FILE:
 *    - Full Fix (length/size >= 70% of original): DUBBER_FILE is COMPLETELY EXCLUDED,
 *      only the latest clean fix file is used as the single actor track.
 *    - Local Snippet (length/size < 70%): Original track remains main track,
 *      short fix is attached as patchSnippet with target QA timecodes.
 * 4. Result: EXACTLY ONE master track per unique actor/role.
 */
export function prepareQATracksForTiming(
  episode: Episode,
  manifestTracks: Array<{ id?: string; name?: string; path: string; size?: number; dubberNick?: string }> = []
): Track[] {
  if (!episode) return [];

  const assignments: RoleAssignment[] = episode.assignments || [];
  const uploads: UploadedFile[] = episode.uploads || [];

  // Group actors and their metadata
  const actorMap = new Map<string, {
    normKey: string;
    dubberNick: string;
    dubberId?: string;
    assignmentIds: Set<string>;
    characters: Set<string>;
  }>();

  const registerActor = (rawNick: string, dubberId?: string, charName?: string, assignmentId?: string) => {
    const nick = cleanDubberNick(rawNick) || rawNick.trim();
    if (!nick || /^[\d\s._-]+$/.test(nick)) return;
    const normKey = normalizeKey(nick);
    if (!normKey) return;

    if (!actorMap.has(normKey)) {
      actorMap.set(normKey, {
        normKey,
        dubberNick: nick,
        dubberId,
        assignmentIds: new Set<string>(),
        characters: new Set<string>()
      });
    }
    const entry = actorMap.get(normKey)!;
    if (dubberId && !entry.dubberId) entry.dubberId = dubberId;
    if (charName) {
      charName.split(/[,;\/]/).map(c => c.trim()).filter(Boolean).forEach(c => entry.characters.add(c));
    }
    if (assignmentId) entry.assignmentIds.add(assignmentId);
  };

  // 1. Collect actors from assignments
  assignments.forEach(as => {
    const dId = as.substituteId || as.dubberId;
    const rawNick = as.substitute?.nickname || as.dubber?.nickname || '';
    registerActor(rawNick, dId, as.characterName, as.id);
  });

  // 2. Collect actors from uploads
  uploads.forEach(u => {
    if ((u.type === 'DUBBER_FILE' || u.type === 'FIXES') && u.path) {
      const rawNick = u.uploadedBy?.nickname || '';
      if (rawNick) {
        registerActor(rawNick, u.uploadedById, undefined, u.assignmentId);
      }
    }
  });

  const finalTracks: Track[] = [];

  Array.from(actorMap.values()).forEach(actor => {
    const { normKey, dubberNick, dubberId, assignmentIds } = actor;
    const charStr = Array.from(actor.characters).filter(Boolean).join(', ') || dubberNick;

    // Filter uploads for this actor
    const actorUploads = uploads.filter(u => {
      if (!u.path || (u.type !== 'DUBBER_FILE' && u.type !== 'FIXES')) return false;
      const lowerP = u.path.toLowerCase();
      if (lowerP.includes('slice') || lowerP.includes('temp_')) return false;
      if (u.assignmentId && assignmentIds.has(u.assignmentId)) return true;
      if (dubberId && (u.uploadedById === dubberId || (u as any).dubberId === dubberId)) return true;
      const uNick = normalizeKey(cleanDubberNick(u.uploadedBy?.nickname || ''));
      return uNick && uNick === normKey;
    }).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    // Filter manifest files for this actor
    const actorManifestFiles = manifestTracks.filter(mt => {
      const p = mt.path || '';
      const base = p.split(/[/\\]/).pop() || '';
      const lowerB = base.toLowerCase();
      if (lowerB.includes('slice') || lowerB.includes('temp_')) return false;
      const mtNick = normalizeKey(cleanDubberNick(mt.dubberNick || base));
      return mtNick && (mtNick === normKey || mtNick.includes(normKey) || normKey.includes(mtNick));
    });

    const isFixFile = (f: { name?: string; path?: string; type?: string }) => {
      if (f.type === 'FIXES') return true;
      const str = `${f.name || ''} ${f.path || ''}`.toLowerCase();
      return str.includes('fix') || str.includes('фикс');
    };

    // Separate main files and fix files
    const mainCandidates = [
      ...actorUploads.filter(u => !isFixFile(u)).map(u => ({ id: u.id, name: u.path.split(/[/\\]/).pop() || 'Дорожка', path: u.path, size: (u as any).size || 0, createdAt: u.createdAt, type: 'DUBBER_FILE' as const })),
      ...actorManifestFiles.filter(m => !isFixFile(m)).map(m => ({ id: m.id || m.path, name: m.name || m.path.split(/[/\\]/).pop() || 'Дорожка', path: m.path, size: m.size || 0, createdAt: '', type: 'DUBBER_FILE' as const }))
    ];

    const fixCandidates = [
      ...actorUploads.filter(u => isFixFile(u)).map(u => ({ id: u.id, name: u.path.split(/[/\\]/).pop() || 'Фикс', path: u.path, size: (u as any).size || 0, createdAt: u.createdAt, type: 'FIXES' as const })),
      ...actorManifestFiles.filter(m => isFixFile(m)).map(m => ({ id: m.id || m.path, name: m.name || m.path.split(/[/\\]/).pop() || 'Фикс', path: m.path, size: m.size || 0, createdAt: '', type: 'FIXES' as const }))
    ];

    // Pick strictly the newest file of each category
    const newestMain = mainCandidates.length > 0 ? mainCandidates[mainCandidates.length - 1] : null;
    const newestFix = fixCandidates.length > 0 ? fixCandidates[fixCandidates.length - 1] : null;

    if (!newestMain && !newestFix) return;

    let selectedFile: typeof newestMain | typeof newestFix = null;
    let patchSnippet: typeof newestFix = null;

    if (newestMain && newestFix) {
      const mainSize = newestMain.size || 1;
      const fixSize = newestFix.size || 0;
      const ratio = fixSize > 0 ? (fixSize / mainSize) : 0;

      // Rule 2a: Full Fix (size/duration >= 70% of original)
      // Draft track is COMPLETELY EXCLUDED from timing export!
      if (ratio >= 0.70 || fixSize === 0) {
        selectedFile = newestFix;
        patchSnippet = null;
      } else {
        // Rule 2b: Local snippet (< 70%)
        selectedFile = newestMain;
        patchSnippet = newestFix;
      }
    } else if (newestFix) {
      selectedFile = newestFix;
    } else {
      selectedFile = newestMain;
    }

    if (!selectedFile) return;

    // EXACTLY ONE master track per actor
    finalTracks.push({
      id: `track_${normKey}`,
      projectId: episode.projectId,
      episodeId: episode.id,
      participant: dubberNick,
      character: charStr,
      dubberName: dubberNick,
      characterName: charStr,
      filePath: selectedFile.path,
      role: 'dubber',
      status: selectedFile.type === 'FIXES' ? ('fixes_needed' as Track['status']) : ('recorded' as Track['status']),
      files: [selectedFile] as any,
      selectedFileId: selectedFile.id,
      patchSnippet: patchSnippet ? {
        id: patchSnippet.id,
        name: patchSnippet.name,
        path: patchSnippet.path
      } : undefined
    } as any);
  });

  return finalTracks;
}
