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
    comments: any[];
    assignmentStatus?: string;
  }>();

  const registerActor = (rawNick: string, dubberId?: string, charName?: string, assignmentId?: string, comments?: any[], status?: string) => {
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
        characters: new Set<string>(),
        comments: [],
        assignmentStatus: status
      });
    }
    const entry = actorMap.get(normKey)!;
    if (dubberId && !entry.dubberId) entry.dubberId = dubberId;
    if (charName) {
      charName.split(/[,;\/]/).map(c => c.trim()).filter(Boolean).forEach(c => entry.characters.add(c));
    }
    if (assignmentId) entry.assignmentIds.add(assignmentId);
    if (comments && comments.length > 0) {
      entry.comments.push(...comments);
    }
    if (status && !entry.assignmentStatus) {
      entry.assignmentStatus = status;
    }
  };

  // 1. Collect actors from assignments
  assignments.forEach(as => {
    const dId = as.substituteId || as.dubberId;
    const rawNick = as.substitute?.nickname || as.dubber?.nickname || '';
    let parsedComments: any[] = [];
    if (as.comments) {
      try {
        parsedComments = JSON.parse(as.comments);
      } catch (e) {}
    }
    registerActor(rawNick, dId, as.characterName, as.id, parsedComments, as.status);
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

    // Separate main files and fix files, deduplicated by file path
    const mainPathMap = new Map<string, { id?: string; name: string; path: string; size: number; createdAt?: string; type: 'DUBBER_FILE' }>();
    actorUploads.filter(u => !isFixFile(u) && u.path).forEach(u => {
      mainPathMap.set(u.path, { id: u.id, name: u.path.split(/[/\\]/).pop() || 'Дорожка', path: u.path, size: (u as any).size || 0, createdAt: u.createdAt, type: 'DUBBER_FILE' });
    });
    actorManifestFiles.filter(m => !isFixFile(m) && m.path).forEach(m => {
      if (!mainPathMap.has(m.path)) {
        mainPathMap.set(m.path, { id: m.id || m.path, name: m.name || m.path.split(/[/\\]/).pop() || 'Дорожка', path: m.path, size: m.size || 0, createdAt: '', type: 'DUBBER_FILE' });
      }
    });

    const fixPathMap = new Map<string, { id?: string; name: string; path: string; size: number; createdAt?: string; type: 'FIXES' }>();
    actorUploads.filter(u => isFixFile(u) && u.path).forEach(u => {
      fixPathMap.set(u.path, { id: u.id, name: u.path.split(/[/\\]/).pop() || 'Фикс', path: u.path, size: (u as any).size || 0, createdAt: u.createdAt, type: 'FIXES' });
    });
    actorManifestFiles.filter(m => isFixFile(m) && m.path).forEach(m => {
      if (!fixPathMap.has(m.path)) {
        fixPathMap.set(m.path, { id: m.id || m.path, name: m.name || m.path.split(/[/\\]/).pop() || 'Фикс', path: m.path, size: m.size || 0, createdAt: '', type: 'FIXES' });
      }
    });

    const mainCandidates = Array.from(mainPathMap.values()).sort((a, b) => {
      const timeDiff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });

    const fixCandidates = Array.from(fixPathMap.values()).sort((a, b) => {
      const timeDiff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });

    if (mainCandidates.length === 0 && fixCandidates.length === 0) return;

    // Helper to test if a fix file is intended for a specific track by name / suffix
    const isFixForTrack = (fixFile: typeof fixCandidates[0], trackName: string, trackIdx: number): boolean => {
      const fName = fixFile.name.toLowerCase();
      const tName = trackName.toLowerCase();
      // Check explicit track index markers: _дорожка2, track2, tr2, take2, layer2
      const trNum = trackIdx + 1;
      const patterns = [
        `дорожка${trNum}`, `дорожка_${trNum}`, `track${trNum}`, `track_${trNum}`,
        `tr${trNum}`, `take${trNum}`, `take_${trNum}`, `layer${trNum}`, `слой${trNum}`
      ];
      if (patterns.some(p => fName.includes(p))) return true;
      if (tName && fName.includes(tName.replace(/\.[^/.]+$/, ''))) return true;
      return false;
    };

    // СЦЕНАРИЙ 1: У даббера ровно 1 основная дорожка (или только фикс)
    if (mainCandidates.length <= 1) {
      const newestMain = mainCandidates[0] || null;
      const newestFix = fixCandidates.length > 0 ? fixCandidates[fixCandidates.length - 1] : null;

      let selectedFile: typeof newestMain | typeof newestFix = null;
      let patchSnippet: typeof newestFix = null;

      if (newestMain && newestFix) {
        const mainSize = newestMain.size || 1;
        const fixSize = newestFix.size || 0;
        const ratio = fixSize > 0 ? (fixSize / mainSize) : 0;
        const sizeDiffMb = Math.abs(fixSize - mainSize) / (1024 * 1024);

        // Тип 1: Цельный фикс (плюс-минус как оригинал по размеру/весу, >= 70% или разница <= 3 МБ)
        // Даббер переписал реплики и отрендерил полную готовую дорожку всей серии.
        // В этом случае вшивать фиксы не нужно — чистовик заменяет черновик целиком.
        if (ratio >= 0.70 || sizeDiffMb <= 3.0 || fixSize === 0) {
          selectedFile = newestFix;
          patchSnippet = null;
        } else {
          // Тип 2: Фиксы частями (отдельные фразы, гораздо легче оригинальной дорожки)
          // В этом случае оригинальная дорожка остается основной, а фиксы вшиваются на места фраз.
          selectedFile = newestMain;
          patchSnippet = newestFix;
        }
      } else if (newestFix) {
        selectedFile = newestFix;
      } else {
        selectedFile = newestMain;
      }

      if (!selectedFile) return;

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
        status: (actor.assignmentStatus?.toLowerCase() || (selectedFile.type === 'FIXES' ? 'fixes_needed' : 'recorded')) as Track['status'],
        files: [selectedFile] as any,
        selectedFileId: selectedFile.id,
        comments: actor.comments || [],
        patchSnippet: patchSnippet ? {
          id: patchSnippet.id,
          name: patchSnippet.name,
          path: patchSnippet.path
        } : undefined
      } as any);
      return;
    }

    // СЦЕНАРИЙ 2: У даббера ДВЕ (или более) основных дорожек
    // Правило: "Если у дабера две дорожки, но нет фиксов, значит, дальше в тайминг и в сведение идёт две дорожки. Вот жёстко две дорожки.
    // Если у дабера две дорожки и фиксы (три суммарно), то фиксы встраиваются в одну из дорожек, в ту, в которой есть эта фраза,
    // после чего в сведение идёт также две дорожки".
    for (let tIdx = 0; tIdx < mainCandidates.length; tIdx++) {
      const mainFile = mainCandidates[tIdx];
      const trackNum = tIdx + 1;
      const trackLabel = `${dubberNick} (Дорожка ${trackNum})`;

      // Ищем фиксы, предназначенные именно для этой дорожки
      const matchingFixes = fixCandidates.filter(f => isFixForTrack(f, mainFile.name, tIdx));
      // Если фикс один и не имеет явных меток трека, но есть нераспределенный фикс:
      let assignedFix = matchingFixes.length > 0 ? matchingFixes[matchingFixes.length - 1] : null;
      if (!assignedFix && fixCandidates.length > 0) {
        // Если фикс ровно один на все дорожки и не распределен, привязываем к дорожке 1
        // (в тайминге фразы фикса дополнительно маршрутизируются по содержанию реплик)
        if (tIdx === 0 && !fixCandidates.some(f => isFixForTrack(f, '', 1))) {
          assignedFix = fixCandidates[fixCandidates.length - 1];
        }
      }

      let effectiveFile: { id?: string; name: string; path: string; size: number; createdAt?: string; type: 'DUBBER_FILE' | 'FIXES' } = mainFile;
      let effectivePatchSnippet: typeof assignedFix = null;

      if (assignedFix) {
        const mainSize = mainFile.size || 1;
        const fixSize = assignedFix.size || 0;
        const ratio = fixSize > 0 ? (fixSize / mainSize) : 0;
        const sizeDiffMb = Math.abs(fixSize - mainSize) / (1024 * 1024);

        // Тип 1: Цельный фикс (плюс-минус как оригинал по размеру/весу, >= 70% или разница <= 3 МБ)
        // Заменяет соответствующую дорожку целиком, вшивать не нужно!
        if (ratio >= 0.70 || sizeDiffMb <= 3.0) {
          effectiveFile = assignedFix;
          effectivePatchSnippet = null;
        } else {
          // Тип 2: Фиксы частями (отдельные фразы, гораздо легче оригинала)
          // Вшиваются в дорожку оригинала
          effectiveFile = mainFile;
          effectivePatchSnippet = assignedFix;
        }
      }

      finalTracks.push({
        id: `track_${normKey}_${trackNum}`,
        projectId: episode.projectId,
        episodeId: episode.id,
        participant: trackLabel,
        character: charStr,
        dubberName: dubberNick,
        characterName: charStr,
        subTrackIndex: trackNum,
        filePath: effectiveFile.path,
        role: 'dubber',
        status: (actor.assignmentStatus?.toLowerCase() || (effectiveFile.type === 'FIXES' ? 'fixes_needed' : 'recorded')) as Track['status'],
        files: [effectiveFile] as any,
        selectedFileId: effectiveFile.id,
        comments: actor.comments || [],
        patchSnippet: effectivePatchSnippet ? {
          id: effectivePatchSnippet.id,
          name: effectivePatchSnippet.name,
          path: effectivePatchSnippet.path
        } : undefined
      } as any);
    }
  });

  return finalTracks;
}
