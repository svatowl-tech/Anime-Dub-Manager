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
  manifestTracks: Array<{ id?: string; name?: string; path: string; size?: number; dubberNick?: string }> = [],
  splitMultiTracks: boolean = true
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
    let nick = cleanDubberNick(rawNick) || (rawNick ? rawNick.trim() : '');
    if (!nick) {
      if (charName) {
        nick = charName;
      } else if (dubberId) {
        nick = `Даббер (${dubberId.slice(0, 8)})`;
      } else {
        nick = 'Даббер';
      }
    }

    const normKey = normalizeKey(nick) || (dubberId ? normalizeKey(dubberId) : (assignmentId ? normalizeKey(assignmentId) : 'dubber_unknown'));
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

    // Separate files, deduplicated by file path
    const allActorFilesMap = new Map<string, { id?: string; name: string; path: string; size: number; createdAt?: string; type: 'DUBBER_FILE' | 'FIXES' }>();

    actorUploads.filter(u => u.path).forEach(u => {
      const isFix = u.type === 'FIXES' || /fix|фикс/i.test(`${u.path.split(/[/\\]/).pop() || ''}`);
      allActorFilesMap.set(u.path, {
        id: u.id,
        name: u.path.split(/[/\\]/).pop() || 'Дорожка',
        path: u.path,
        size: (u as any).size || 0,
        createdAt: u.createdAt,
        type: isFix ? 'FIXES' : 'DUBBER_FILE'
      });
    });

    actorManifestFiles.filter(m => m.path).forEach(m => {
      if (!allActorFilesMap.has(m.path)) {
        const isFix = /fix|фикс/i.test(`${m.name || m.path}`);
        allActorFilesMap.set(m.path, {
          id: m.id || m.path,
          name: m.name || m.path.split(/[/\\]/).pop() || 'Дорожка',
          path: m.path,
          size: m.size || 0,
          createdAt: '',
          type: isFix ? 'FIXES' : 'DUBBER_FILE'
        });
      }
    });

    const sortedAllFiles = Array.from(allActorFilesMap.values()).sort((a, b) => {
      const timeDiff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });

    if (sortedAllFiles.length === 0) {
      const trackId = dubberId ? `${dubberId}__${normKey}` : `track_${normKey}`;
      finalTracks.push({
        id: trackId,
        projectId: episode.projectId,
        episodeId: episode.id,
        participant: dubberNick,
        character: charStr,
        dubberName: dubberNick,
        characterName: charStr,
        filePath: '',
        role: 'dubber',
        status: (actor.assignmentStatus?.toLowerCase() || 'pending') as Track['status'],
        files: [],
        comments: actor.comments || []
      } as any);
      return;
    }

    // Determine max size to identify short patch snippets vs full recording tracks
    const maxSize = Math.max(...sortedAllFiles.map(f => f.size || 0));

    // A file is a short patch snippet ONLY if there is a main file AND this file is much smaller (< 50% size AND < 2MB)
    const fixCandidates = sortedAllFiles.filter(f => {
      if (f.type !== 'FIXES' && !/fix|фикс/i.test(f.name)) return false;
      if (maxSize > 0 && f.size > 0) {
        const ratio = f.size / maxSize;
        if (ratio >= 0.50 || (maxSize - f.size) / (1024 * 1024) <= 2.0) {
          return false;
        }
      }
      return true;
    });

    const mainCandidates = sortedAllFiles.filter(f => !fixCandidates.some(fix => fix.path === f.path));

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

    // СЦЕНАРИЙ 1: У даббера ровно 1 основная дорожка (или группировка в выпадающий список)
    if (mainCandidates.length <= 1 || !splitMultiTracks) {
      const newestMain = mainCandidates.length > 0 ? mainCandidates[mainCandidates.length - 1] : null;
      const newestFix = fixCandidates.length > 0 ? fixCandidates[fixCandidates.length - 1] : null;

      let selectedFile: typeof newestMain | typeof newestFix = null;
      let patchSnippet: typeof newestFix = null;

      if (newestMain && newestFix) {
        selectedFile = newestMain;
        patchSnippet = newestFix;
      } else if (newestFix) {
        selectedFile = newestFix;
      } else {
        selectedFile = newestMain;
      }

      if (!selectedFile) return;

      const trackId = dubberId ? `${dubberId}__${normKey}` : `track_${normKey}`;

      finalTracks.push({
        id: trackId,
        projectId: episode.projectId,
        episodeId: episode.id,
        participant: dubberNick,
        character: charStr,
        dubberName: dubberNick,
        characterName: charStr,
        filePath: selectedFile.path,
        role: 'dubber',
        status: (actor.assignmentStatus?.toLowerCase() || (selectedFile.type === 'FIXES' ? 'fixes_needed' : 'recorded')) as Track['status'],
        files: sortedAllFiles as any,
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
    for (let tIdx = 0; tIdx < mainCandidates.length; tIdx++) {
      const mainFile = mainCandidates[tIdx];
      const trackNum = tIdx + 1;
      const trackLabel = `${dubberNick} (Дорожка ${trackNum})`;

      const matchingFixes = fixCandidates.filter(f => isFixForTrack(f, mainFile.name, tIdx));
      let assignedFix = matchingFixes.length > 0 ? matchingFixes[matchingFixes.length - 1] : null;
      if (!assignedFix && fixCandidates.length > 0) {
        if (tIdx === 0 && !fixCandidates.some(f => isFixForTrack(f, '', 1))) {
          assignedFix = fixCandidates[fixCandidates.length - 1];
        }
      }

      const effectiveFile = mainFile;
      const effectivePatchSnippet = assignedFix;

      const trackId = dubberId ? `${dubberId}__${normKey}_${trackNum}` : `track_${normKey}_${trackNum}`;

      finalTracks.push({
        id: trackId,
        projectId: episode.projectId,
        episodeId: episode.id,
        participant: trackLabel,
        character: charStr,
        dubberName: dubberNick,
        characterName: charStr,
        subTrackIndex: trackNum,
        filePath: effectiveFile.path,
        role: 'dubber',
        status: (actor.assignmentStatus?.toLowerCase() || 'recorded') as Track['status'],
        files: sortedAllFiles as any,
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
