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

    const allMergedFiles = mergeUploadAndManifest(
      [...rawUploadOriginals, ...rawUploadFixes],
      [...rawManifestOriginals, ...rawManifestFixes]
    );

    // Group files by explicit trackIndex (e.g. Дорожка 1, Дорожка 2 for multi-layer overlap recordings)
    const filesByTrackIndex = new Map<number, FileEntry[]>();
    const unindexedFiles: FileEntry[] = [];

    for (const f of allMergedFiles) {
      if (f.trackIndex !== null) {
        if (!filesByTrackIndex.has(f.trackIndex)) filesByTrackIndex.set(f.trackIndex, []);
        filesByTrackIndex.get(f.trackIndex)!.push(f);
      } else {
        unindexedFiles.push(f);
      }
    }

    // Helper to process a group of files belonging to the same actor track/layer
    // Identifies the largest file as the main original track, and smaller files as fixes
    const processFileGroup = (groupFiles: FileEntry[], subTrackNum?: number) => {
      if (groupFiles.length === 0) return;

      // Separate explicit original recordings vs explicit fix files first
      const explicitOriginals = groupFiles.filter(f => f.type !== 'FIXES');
      const explicitFixes = groupFiles.filter(f => f.type === 'FIXES');

      let selectedFile: FileEntry;
      let patchSnippet: FileEntry | null = null;

      if (explicitOriginals.length > 0 && explicitFixes.length > 0) {
        // Both original track and fix track exist: keep newest/largest original as main track
        // and newest fix as patchSnippet so TimingPanel can inspect real speech coverage (Scenario 1 vs Scenario 2)
        const sortedOrig = [...explicitOriginals].sort((a, b) => {
          if (b.size !== a.size) return b.size - a.size;
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        });
        const sortedFixes = [...explicitFixes].sort((a, b) => {
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        });
        selectedFile = sortedOrig[0];
        patchSnippet = sortedFixes[0];
      } else {
        // Sort files by size descending (largest file first = original main track)
        const sortedBySize = [...groupFiles].sort((a, b) => {
          if (b.size !== a.size) return b.size - a.size;
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        });

        const largestFile = sortedBySize[0];
        const otherFiles = sortedBySize.slice(1);
        selectedFile = largestFile;

        if (otherFiles.length > 0) {
          const candidateFix = otherFiles.find(f => f.type === 'FIXES' || (largestFile.size > 0 && f.size < largestFile.size * 0.95)) || otherFiles[otherFiles.length - 1];
          if (candidateFix) {
            selectedFile = largestFile;
            patchSnippet = candidateFix;
          }
        }
      }

      const trackNum = subTrackNum;
      const trackLabel = trackNum ? `${dubberNick} (Дорожка ${trackNum})` : dubberNick;
      const trackId = trackNum 
        ? (dubberId ? `${dubberId}__${normKey}_${trackNum}` : `track_${normKey}_${trackNum}`)
        : (dubberId ? `${dubberId}__${normKey}` : `track_${normKey}`);

      // Ensure all files for this actor layer are preserved in track.files (selectedFile first)
      const allTrackFiles = [
        selectedFile,
        ...groupFiles.filter(f => f.path !== selectedFile.path)
      ].map(f => ({
        id: f.id,
        name: f.name,
        path: f.path,
        size: f.size,
        createdAt: f.createdAt || new Date().toISOString(),
        type: f.path === selectedFile.path ? 'DUBBER_FILE' : (patchSnippet && f.path === patchSnippet.path ? 'FIXES' : f.type)
      }));

      finalTracks.push({
        id: trackId,
        projectId: episode.projectId,
        episodeId: episode.id,
        participant: trackLabel,
        character: charStr,
        dubberName: dubberNick,
        characterName: charStr,
        subTrackIndex: trackNum,
        filePath: selectedFile.path,
        role: 'dubber',
        status: (actor.assignmentStatus?.toLowerCase() || (patchSnippet ? 'fixes_needed' : 'recorded')) as Track['status'],
        files: allTrackFiles as any,
        selectedFileId: selectedFile.id,
        fileSize: selectedFile.size,
        comments: actor.comments || [],
        patchSnippet: patchSnippet ? {
          id: patchSnippet.id,
          name: patchSnippet.name,
          path: patchSnippet.path,
          size: patchSnippet.size
        } : undefined
      } as any);
    };

    if (allMergedFiles.length === 0) {
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

    if (splitMultiTracks && filesByTrackIndex.size > 1) {
      // Multiple explicit tracks (e.g. Дорожка 1, Дорожка 2)
      const sortedIndices = Array.from(filesByTrackIndex.keys()).sort((a, b) => a - b);
      for (const idx of sortedIndices) {
        processFileGroup(filesByTrackIndex.get(idx)!, idx);
      }
      if (unindexedFiles.length > 0) {
        // If there are unindexed files, associate them with track 1 or process separately
        const tr1Files = filesByTrackIndex.get(1);
        if (tr1Files) {
          tr1Files.push(...unindexedFiles);
        }
      }
    } else {
      // Single track for this dubber: all files evaluated together by byte size
      processFileGroup(allMergedFiles);
    }
  });

  return finalTracks;
}
