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

    // Helper to extract explicit track index (e.g. дорожка1, дорожка2, track1, layer2)
    const getExplicitTrackIndex = (nameOrPath: string): number | null => {
      const m = (nameOrPath || '').match(/(?:дорожка|слой|track|take|layer)[_\s-]*(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    };

    const isFileFix = (type?: string, nameOrPath?: string): boolean => {
      return type === 'FIXES' || /(?:^|[_[\s-])(fix|фикс)(?:\d*|[_\]\s.-]|$)/i.test(nameOrPath || '');
    };

    // Build canonical list of Original files and Fix files without duplicating upload vs manifest copies
    type FileEntry = {
      id: string;
      name: string;
      path: string;
      size: number;
      createdAt: string;
      type: 'DUBBER_FILE' | 'FIXES';
      trackIndex: number | null;
    };

    const rawUploadOriginals: FileEntry[] = [];
    const rawUploadFixes: FileEntry[] = [];

    actorUploads.filter(u => u.path).forEach(u => {
      const name = u.path.split(/[/\\]/).pop() || 'Дорожка';
      const fixFlag = isFileFix(u.type, name);
      const entry: FileEntry = {
        id: u.id || u.path,
        name,
        path: u.path,
        size: (u as any).size || 0,
        createdAt: u.createdAt || '',
        type: fixFlag ? 'FIXES' : 'DUBBER_FILE',
        trackIndex: getExplicitTrackIndex(name)
      };
      if (fixFlag) rawUploadFixes.push(entry);
      else rawUploadOriginals.push(entry);
    });

    const rawManifestOriginals: FileEntry[] = [];
    const rawManifestFixes: FileEntry[] = [];

    actorManifestFiles.filter(m => m.path).forEach(m => {
      const name = m.name || m.path.split(/[/\\]/).pop() || 'Дорожка';
      const fixFlag = isFileFix(undefined, name);
      const entry: FileEntry = {
        id: m.id || m.path,
        name,
        path: m.path,
        size: m.size || 0,
        createdAt: '',
        type: fixFlag ? 'FIXES' : 'DUBBER_FILE',
        trackIndex: getExplicitTrackIndex(name)
      };
      if (fixFlag) rawManifestFixes.push(entry);
      else rawManifestOriginals.push(entry);
    });

    // Propagate file sizes and exported paths from manifest files into upload entries so same file is never duplicated
    const mergeUploadAndManifest = (uploadsList: FileEntry[], manifestList: FileEntry[]): FileEntry[] => {
      if (uploadsList.length === 0) return manifestList;
      if (manifestList.length === 0) return uploadsList;

      // Enrich uploads with size from matching manifest file
      const usedManifestPaths = new Set<string>();
      const merged = uploadsList.map((u, idx) => {
        let match = manifestList.find(m =>
          !usedManifestPaths.has(m.path) &&
          (m.path === u.path || m.name === u.name || (u.trackIndex !== null && m.trackIndex === u.trackIndex))
        );
        if (!match && manifestList.length === uploadsList.length) {
          match = manifestList[idx];
        }
        if (!match && uploadsList.length === 1 && manifestList.length === 1) {
          match = manifestList[0];
        }
        if (match) {
          usedManifestPaths.add(match.path);
          return {
            ...u,
            size: u.size || match.size || 0,
            path: match.path || u.path
          };
        }
        return u;
      });

      // Only add manifest files that have an explicit trackIndex not present in uploads
      manifestList.forEach(m => {
        if (!usedManifestPaths.has(m.path) && m.trackIndex !== null && !merged.some(u => u.trackIndex === m.trackIndex)) {
          merged.push(m);
        }
      });

      return merged;
    };

    const originals = mergeUploadAndManifest(rawUploadOriginals, rawManifestOriginals);
    const fixes = mergeUploadAndManifest(rawUploadFixes, rawManifestFixes);

    // Deduplicate originals by explicit trackIndex (keep newest take per trackIndex)
    // If no explicit trackIndex exists on originals, check if multiple distinct files were uploaded
    let mainCandidates: FileEntry[] = [];
    if (originals.length <= 1) {
      mainCandidates = originals;
    } else {
      const hasExplicitIndices = originals.some(o => o.trackIndex !== null);
      if (hasExplicitIndices) {
        const byIdx = new Map<number, FileEntry>();
        originals.forEach((o, i) => {
          const idxKey = o.trackIndex ?? (i + 1);
          byIdx.set(idxKey, o);
        });
        mainCandidates = Array.from(byIdx.entries()).sort((a, b) => a[0] - b[0]).map(e => e[1]);
      } else {
        // Deduplicate by identical size or basename; keep distinct takes if truly different layers
        const uniqueOriginals: FileEntry[] = [];
        for (const o of originals) {
          const dupIdx = uniqueOriginals.findIndex(x => x.path === o.path || (x.size > 0 && o.size > 0 && x.size === o.size));
          if (dupIdx >= 0) {
            uniqueOriginals[dupIdx] = o; // keep newest
          } else {
            uniqueOriginals.push(o);
          }
        }
        mainCandidates = uniqueOriginals;
      }
    }

    const sortedAllFiles = [...mainCandidates, ...fixes];

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

    // Helper: determines if a fix file is a FULL track replacement vs a FRAGMENTARY phrase fix
    const isFullReplacementFix = (fixFile: FileEntry, mainFile: FileEntry | null): boolean => {
      if (!mainFile) return true;
      if (mainFile.size > 0 && fixFile.size > 0) {
        const ratio = fixFile.size / mainFile.size;
        const diffMb = Math.abs(mainFile.size - fixFile.size) / (1024 * 1024);
        // If fix is >= 65% of main track size OR within 3.5 MB of main track size -> full replacement!
        return ratio >= 0.65 || diffMb <= 3.5;
      }
      return false;
    };

    // Helper to test if a fix file is intended for a specific track by name / suffix
    const isFixForTrack = (fixFile: FileEntry, trackName: string, trackIdx: number): boolean => {
      const fName = fixFile.name.toLowerCase();
      const tName = trackName.toLowerCase();
      const trNum = trackIdx + 1;
      if (fixFile.trackIndex !== null) {
        return fixFile.trackIndex === trNum;
      }
      const patterns = [
        `дорожка${trNum}`, `дорожка_${trNum}`, `track${trNum}`, `track_${trNum}`,
        `tr${trNum}`, `take${trNum}`, `take_${trNum}`, `layer${trNum}`, `слой${trNum}`
      ];
      if (patterns.some(p => fName.includes(p))) return true;
      if (tName && fName.includes(tName.replace(/\.[^/.]+$/, ''))) return true;
      return false;
    };

    // СЦЕНАРИЙ 1: У даббера ровно 1 основная дорожка (или только фикс)
    if (mainCandidates.length <= 1 || !splitMultiTracks) {
      const newestMain = mainCandidates.length > 0 ? mainCandidates[mainCandidates.length - 1] : null;
      const newestFix = fixes.length > 0 ? fixes[fixes.length - 1] : null;

      let selectedFile: FileEntry | null = null;
      let patchSnippet: FileEntry | null = null;

      if (newestMain && newestFix) {
        if (isFullReplacementFix(newestFix, newestMain)) {
          // ЦЕЛЬНЫЙ ФИКС: полностью переписывает основную дорожку! Берется в работу ТОЛЬКО фикс!
          selectedFile = { ...newestFix, type: 'DUBBER_FILE' };
          patchSnippet = null;
        } else {
          // ЧАСТИЧНЫЙ ФИКС (отдельные фразы): экспортируется и основная дорога, и фикс для вшивания по кнопке
          selectedFile = newestMain;
          patchSnippet = newestFix;
        }
      } else if (newestFix) {
        selectedFile = { ...newestFix, type: 'DUBBER_FILE' };
        patchSnippet = null;
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
        status: (actor.assignmentStatus?.toLowerCase() || (patchSnippet ? 'fixes_needed' : 'recorded')) as Track['status'],
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

    // СЦЕНАРИЙ 2: У даббера ДВЕ (или более) основных дорожек (например, Дорожка 1 и Дорожка 2 для нахлестов)
    for (let tIdx = 0; tIdx < mainCandidates.length; tIdx++) {
      const mainFile = mainCandidates[tIdx];
      const trackNum = tIdx + 1;
      const trackLabel = `${dubberNick} (Дорожка ${trackNum})`;

      const matchingFixes = fixes.filter(f => isFixForTrack(f, mainFile.name, tIdx));
      let assignedFix = matchingFixes.length > 0 ? matchingFixes[matchingFixes.length - 1] : null;
      if (!assignedFix && fixes.length > 0) {
        if (tIdx === 0 && !fixes.some(f => isFixForTrack(f, '', 1))) {
          assignedFix = fixes[fixes.length - 1];
        }
      }

      let effectiveFile = mainFile;
      let effectivePatchSnippet: FileEntry | null = assignedFix;

      if (assignedFix && isFullReplacementFix(assignedFix, mainFile)) {
        // Цельный фикс для этой дорожки — берем только фикс вместо старой дорожки!
        effectiveFile = { ...assignedFix, type: 'DUBBER_FILE' };
        effectivePatchSnippet = null;
      }

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
        status: (actor.assignmentStatus?.toLowerCase() || (effectivePatchSnippet ? 'fixes_needed' : 'recorded')) as Track['status'],
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
