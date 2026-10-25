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

    type FileEntry = {
      id: string;
      name: string;
      path: string;
      size: number;
      createdAt: string;
      type: 'DUBBER_FILE' | 'FIXES';
      isFix: boolean;
      targetTrackId?: string;
      trackIndex: number | null;
    };

    const rawUploadOriginals: FileEntry[] = [];
    const rawUploadFixes: FileEntry[] = [];

    // 1. Primary source of truth: files explicitly uploaded in QA (DUBBER_FILE = дорожка, FIXES = фикс)
    actorUploads.filter(u => u.path).forEach(u => {
      const name = u.path.split(/[/\\]/).pop() || 'Дорожка';
      const fixFlag = u.type === 'FIXES' || Boolean((u as any).isFix);
      // Optionally enrich file size from manifest if upload size was 0, NEVER overwriting u.path or u.type
      const matchedManifest = actorManifestFiles.find(m => m.path === u.path || m.name === name);
      const entry: FileEntry = {
        id: u.id || u.path,
        name,
        path: u.path,
        size: (u as any).size || matchedManifest?.size || 0,
        createdAt: u.createdAt || '',
        type: fixFlag ? 'FIXES' : 'DUBBER_FILE',
        isFix: fixFlag,
        targetTrackId: (u as any).targetTrackId,
        trackIndex: getExplicitTrackIndex(name)
      };
      if (fixFlag) rawUploadFixes.push(entry);
      else rawUploadOriginals.push(entry);
    });

    // 2. Fallback ONLY if there are no QA uploads for this actor (e.g. external files placed directly in folder)
    if (rawUploadOriginals.length === 0 && rawUploadFixes.length === 0 && actorManifestFiles.length > 0) {
      actorManifestFiles.filter(m => m.path).forEach(m => {
        const name = m.name || m.path.split(/[/\\]/).pop() || 'Дорожка';
        const fixFlag = /(?:^|[_[\s-])(fix|фикс)(?:\d*|[_\]\s.-]|$)/i.test(name);
        const entry: FileEntry = {
          id: m.id || m.path,
          name,
          path: m.path,
          size: m.size || 0,
          createdAt: '',
          type: fixFlag ? 'FIXES' : 'DUBBER_FILE',
          isFix: fixFlag,
          trackIndex: getExplicitTrackIndex(name)
        };
        if (fixFlag) rawUploadFixes.push(entry);
        else rawUploadOriginals.push(entry);
      });
    }

    if (rawUploadOriginals.length === 0 && rawUploadFixes.length === 0) {
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

    // Build tracks strictly from DUBBER_FILE originals (or from FIXES if only a fix was uploaded):
    // A second DUBBER_FILE is NEVER turned into a fix — if splitMultiTracks is true and there are 2+ DUBBER_FILEs,
    // each DUBBER_FILE is a separate main track (Дорожка 1, Дорожка 2), and FIXES attach only as fixes!
    const baseMainFiles = rawUploadOriginals.length > 0 ? rawUploadOriginals : [rawUploadFixes[rawUploadFixes.length - 1]];
    const availableFixes = rawUploadOriginals.length > 0 ? rawUploadFixes : [];

    if (splitMultiTracks && baseMainFiles.length > 1) {
      baseMainFiles.forEach((mainFile, idx) => {
        const trackNum = mainFile.trackIndex || (idx + 1);
        const trackLabel = `${dubberNick} (Дорожка ${trackNum})`;
        const trackId = dubberId ? `${dubberId}__${normKey}_${trackNum}` : `track_${normKey}_${trackNum}`;
        const baseTrackId = dubberId ? `${dubberId}__${normKey}` : `track_${normKey}`;

        // Find fixes bound to this specific track (or default to first track if unbound)
        const matchingFixes = availableFixes.filter(fx => {
          if (fx.targetTrackId && fx.targetTrackId === trackId) return true;
          if (fx.trackIndex !== null && fx.trackIndex === trackNum) return true;
          if (idx === 0 && (!fx.targetTrackId || fx.targetTrackId === baseTrackId || fx.targetTrackId === dubberId) && fx.trackIndex === null) {
            return true;
          }
          return false;
        });

        const latestFix = matchingFixes.length > 0 ? matchingFixes[matchingFixes.length - 1] : null;
        const allTrackFiles = [mainFile, ...matchingFixes].map(f => ({
          id: f.id,
          name: f.name,
          path: f.path,
          size: f.size,
          createdAt: f.createdAt || new Date().toISOString(),
          type: f.type
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
          filePath: mainFile.path,
          role: 'dubber',
          status: (actor.assignmentStatus?.toLowerCase() || (latestFix ? 'fixes_needed' : 'recorded')) as Track['status'],
          files: allTrackFiles as any,
          selectedFileId: mainFile.id,
          fileSize: mainFile.size,
          comments: actor.comments || [],
          patchSnippet: latestFix ? {
            id: latestFix.id,
            name: latestFix.name,
            path: latestFix.path,
            size: latestFix.size
          } : undefined
        } as any);
      });
    } else {
      // Single track (or grouped dropdown mode in QA)
      const selectedFile = baseMainFiles[baseMainFiles.length - 1];
      const latestFix = availableFixes.length > 0 ? availableFixes[availableFixes.length - 1] : null;
      const trackId = dubberId ? `${dubberId}__${normKey}` : `track_${normKey}`;

      const allTrackFiles = [...baseMainFiles, ...availableFixes].map(f => ({
        id: f.id,
        name: f.name,
        path: f.path,
        size: f.size,
        createdAt: f.createdAt || new Date().toISOString(),
        type: f.type
      }));

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
        status: (actor.assignmentStatus?.toLowerCase() || (latestFix ? 'fixes_needed' : 'recorded')) as Track['status'],
        files: allTrackFiles as any,
        selectedFileId: selectedFile.id,
        fileSize: selectedFile.size,
        comments: actor.comments || [],
        patchSnippet: latestFix ? {
          id: latestFix.id,
          name: latestFix.name,
          path: latestFix.path,
          size: latestFix.size
        } : undefined
      } as any);
    }
  });

  return finalTracks;
}
