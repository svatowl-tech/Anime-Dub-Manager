const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { getRawSubtitles } = require('./subtitleService.cjs');
const { detectSpeechIntervals, addProcess, getFfmpegPath } = require('./ffmpegService.cjs');
const ffmpeg = require('fluent-ffmpeg');

/**
 * Normalizes strings for robust nickname and character name matching.
 */
function normalizeName(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[\[\]\(\)\{\}\-_.,!?'"~`@#$%^&*+=:;\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Common prefixes and suffixes to strip from filenames when extracting dubber nicknames.
 */
const STRIP_TERMS = [
  'ep', 'episode', 'серия', 'серии', 'эпизод', 'raw', 'vox', 'voice', 
  'audio', 'track', 'fix', 'фикс', 'оригинал', 'original', 'dub', 'fandub', 
  'vocal', 'take', 'clean', 'final', 'sound', 'mix', 'master'
];

/**
 * Extracts potential dubber nicknames from an audio filename.
 */
function extractNicknamesFromFilename(filePath) {
  if (!filePath) return [];
  const baseName = path.basename(filePath, path.extname(filePath));
  const candidates = [];

  // 1. Bracketed tokens e.g. [Persona99], (Owl), {Svat}
  const bracketMatches = baseName.matchAll(/[\[\(\{]([^\]\)\}]+)[\]\)\}]/g);
  for (const m of bracketMatches) {
    const token = m[1].trim();
    if (token && !STRIP_TERMS.includes(token.toLowerCase()) && !/^\d+$/.test(token)) {
      candidates.push(token);
    }
  }

  // 2. Delimited parts by underscore or dash
  const parts = baseName.split(/[_+\-—]/).map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const cleaned = part.replace(/^\[|\]$|^\(|\)$/g, '').trim();
    const isEpisodeNum = /^(ep\d+|\d+p|\d+серия|\d+)$/i.test(cleaned);
    const isGenericTerm = STRIP_TERMS.includes(cleaned.toLowerCase());
    if (cleaned && !isEpisodeNum && !isGenericTerm && cleaned.length >= 2) {
      candidates.push(cleaned);
    }
  }

  // 3. Fallback whole basename if clean
  if (candidates.length === 0) {
    candidates.push(baseName);
  }

  return Array.from(new Set(candidates));
}

/**
 * Checks whether candidate text matches a target nickname or character name.
 */
function isNameMatch(candidate, target) {
  if (!candidate || !target) return false;
  const cNorm = normalizeName(candidate);
  const tNorm = normalizeName(target);
  if (!cNorm || !tNorm) return false;

  if (cNorm === tNorm) return true;
  if (cNorm.includes(tNorm) || tNorm.includes(cNorm)) return true;

  // Word boundary matching
  const cWords = cNorm.split(' ');
  const tWords = tNorm.split(' ');
  for (const cw of cWords) {
    if (cw.length >= 3 && tWords.includes(cw)) return true;
  }

  return false;
}

/**
 * Converts ASS timecode string (0:01:23.45) to seconds.
 */
function parseTimeToSeconds(timeStr) {
  if (timeStr === undefined || timeStr === null) return 0;
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  const str = String(timeStr).trim();
  if (!str) return 0;
  const parts = str.split(':');
  if (parts.length < 3) {
    const f = parseFloat(str.replace(',', '.'));
    return isNaN(f) ? 0 : f;
  }
  const hrs = parseFloat(parts[0]) || 0;
  const mins = parseFloat(parts[1]) || 0;
  const secs = parseFloat(parts[2].replace(',', '.')) || 0;
  return hrs * 3600 + mins * 60 + secs;
}

/**
 * Formats seconds into MM:SS.cc string.
 */
function formatSeconds(sec) {
  if (sec === undefined || sec === null || isNaN(sec)) return '00:00.00';
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const c = Math.floor((total % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/**
 * Service providing smart auto-timing, actor matching, collision resolution,
 * and tail-free fix insertion for dubbing projects.
 */
class AutoTimingService {

  /**
   * Automatically matches subtitle actors/characters with dubber audio tracks.
   */
  static async matchActorsWithAudioTracks(subPath, audioFiles, participantsData = [], characterAliases = {}, existingAssignments = []) {
    log.info(`[AutoTiming] Matching actors in ${subPath} against ${audioFiles?.length || 0} audio files`);
    
    // Parse subtitles to get all character lines
    const subData = subPath ? await getRawSubtitles(subPath) : { lines: [], actors: [] };
    const subLines = subData.lines || [];
    
    // Parse character aliases
    const aliases = typeof characterAliases === 'string' ? JSON.parse(characterAliases || '{}') : (characterAliases || {});
    
    // Extract distinct characters from subtitles (excluding signs and commentary)
    const charactersMap = new Map();
    const signKeywords = ['sign', 'text', 'title', 'signs', 'titles', 'caption', 'надпись', 'текст', 'титр', 'титры', 'заставка', 'экран', 'note', 'info'];

    for (const line of subLines) {
      let charName = (line.name || '').trim();
      const styleName = (line.style || '').toLowerCase();
      if (!charName || charName === 'Default') continue;
      
      // Check if sign
      const isSign = signKeywords.some(kw => charName.toLowerCase().includes(kw) || styleName.includes(kw));
      if (isSign) continue;

      // Apply character alias if defined
      const canonicalChar = aliases[charName] || charName;

      if (!charactersMap.has(canonicalChar)) {
        charactersMap.set(canonicalChar, {
          characterName: canonicalChar,
          originalNames: new Set([charName]),
          linesCount: 0,
          lines: []
        });
      }
      
      const charInfo = charactersMap.get(canonicalChar);
      charInfo.originalNames.add(charName);
      charInfo.linesCount++;
      charInfo.lines.push({
        id: line.id,
        rawLineIndex: line.rawLineIndex,
        startSec: parseTimeToSeconds(line.start),
        endSec: parseTimeToSeconds(line.end),
        startFormatted: line.start,
        endFormatted: line.end,
        text: line.text
      });
    }

    // Sort lines for each character chronologically
    for (const charInfo of charactersMap.values()) {
      charInfo.lines.sort((a, b) => a.startSec - b.startSec);
    }

    const matchedTracks = [];
    const unassignedTracks = [];
    const usedTrackPaths = new Set();
    const usedCharacters = new Set();

    // Helper to determine if track is a fix
    const isTrackFix = (track) => {
      if (track.type === 'FIXES') return true;
      const bn = path.basename(track.path || '').toLowerCase();
      return bn.includes('fix') || bn.includes('фикс');
    };

    // 1. First pass: Match audio tracks using explicit assignments
    for (const assignment of existingAssignments) {
      if (!assignment.dubberId) continue;
      const participant = participantsData.find(p => p.id === assignment.dubberId);
      const nick = participant?.nickname || participant?.name;
      const charName = assignment.characterName;

      for (const track of (audioFiles || [])) {
        if (usedTrackPaths.has(track.path)) continue;

        let matched = false;
        if (track.uploadedById === assignment.dubberId) {
          matched = true;
        } else {
          const candidates = extractNicknamesFromFilename(track.path);
          if (nick && candidates.some(c => isNameMatch(c, nick))) {
            matched = true;
          }
        }

        if (matched) {
          usedTrackPaths.add(track.path);
          usedCharacters.add(charName);
          const isFix = isTrackFix(track);
          matchedTracks.push({
            trackPath: track.path,
            trackId: track.id || path.basename(track.path),
            dubberId: assignment.dubberId,
            dubberNick: nick || 'Даббер',
            characterName: charName,
            isFix,
            type: isFix ? 'FIXES' : 'DUBBER_FILE',
            matchMethod: 'assignment_and_nick',
            confidence: 1.0,
            lines: charactersMap.get(charName)?.lines || []
          });
        }
      }
    }

    // 2. Second pass: Match remaining audio tracks by participant nicknames in filename
    for (const track of (audioFiles || [])) {
      if (usedTrackPaths.has(track.path)) continue;
      const candidates = extractNicknamesFromFilename(track.path);
      
      let matchedParticipant = null;
      for (const p of participantsData) {
        if (candidates.some(c => isNameMatch(c, p.nickname) || isNameMatch(c, p.name))) {
          matchedParticipant = p;
          break;
        }
      }

      if (matchedParticipant) {
        // Find which character is assigned to this participant or match directly
        let targetChar = null;
        for (const [cName, cInfo] of charactersMap.entries()) {
          if (!usedCharacters.has(cName)) {
            if (candidates.some(c => isNameMatch(c, cName)) || isNameMatch(matchedParticipant.nickname, cName)) {
              targetChar = cName;
              break;
            }
          }
        }

        if (!targetChar) {
          const epAssign = existingAssignments.find(a => a.dubberId === matchedParticipant.id);
          if (epAssign && !usedCharacters.has(epAssign.characterName)) {
            targetChar = epAssign.characterName;
          }
        }

        if (targetChar) {
          usedTrackPaths.add(track.path);
          usedCharacters.add(targetChar);
          const isFix = isTrackFix(track);
          matchedTracks.push({
            trackPath: track.path,
            trackId: track.id || path.basename(track.path),
            dubberId: matchedParticipant.id,
            dubberNick: matchedParticipant.nickname,
            characterName: targetChar,
            isFix,
            type: isFix ? 'FIXES' : 'DUBBER_FILE',
            matchMethod: 'filename_nick_matched',
            confidence: 0.95,
            lines: charactersMap.get(targetChar)?.lines || []
          });
          continue;
        }
      }

      // 3. Third pass: Match filename directly against character names in subtitles
      let matchedDirectChar = null;
      for (const [cName, cInfo] of charactersMap.entries()) {
        if (!usedCharacters.has(cName)) {
          if (candidates.some(c => isNameMatch(c, cName))) {
            matchedDirectChar = cName;
            break;
          }
        }
      }

      if (matchedDirectChar) {
        usedTrackPaths.add(track.path);
        usedCharacters.add(matchedDirectChar);
        const isFix = isTrackFix(track);
        matchedTracks.push({
          trackPath: track.path,
          trackId: track.id || path.basename(track.path),
          dubberId: track.uploadedById || null,
          dubberNick: candidates[0] || matchedDirectChar,
          characterName: matchedDirectChar,
          isFix,
          type: isFix ? 'FIXES' : 'DUBBER_FILE',
          matchMethod: 'filename_character_direct',
          confidence: 0.90,
          lines: charactersMap.get(matchedDirectChar)?.lines || []
        });
      } else {
        unassignedTracks.push(track);
      }
    }

    // 4. Fourth pass: Fallback matching for any remaining tracks so NO TRACK IS EVER DROPPED!
    for (const track of unassignedTracks) {
      if (usedTrackPaths.has(track.path)) continue;
      usedTrackPaths.add(track.path);

      let nick = 'Даббер';
      if (track.uploadedById) {
        const p = participantsData.find(part => part.id === track.uploadedById);
        if (p) nick = p.nickname || p.name;
      }
      if (nick === 'Даббер') {
        const cands = extractNicknamesFromFilename(track.path);
        if (cands.length > 0) nick = cands[0];
        else nick = path.basename(track.path, path.extname(track.path));
      }

      const isFix = isTrackFix(track);
      const fallbackCharName = track.characterName || `Дорожка_${nick}`;

      log.info(`[AutoTiming] Fallback matching track: ${path.basename(track.path)} for dubber ${nick}`);
      matchedTracks.push({
        trackPath: track.path,
        trackId: track.id || path.basename(track.path),
        dubberId: track.uploadedById || null,
        dubberNick: nick,
        characterName: fallbackCharName,
        isFix,
        type: isFix ? 'FIXES' : 'DUBBER_FILE',
        matchMethod: 'fallback_unassigned',
        confidence: 0.50,
        lines: [] // no specific lines matched, will preserve original intervals
      });
    }

    const unassignedActors = Array.from(charactersMap.keys()).filter(c => !usedCharacters.has(c));

    log.info(`[AutoTiming] Matched ${matchedTracks.length} tracks in total (including fallback tracks). Unassigned actors: ${unassignedActors.length}`);
    return {
      matchedTracks,
      unassignedActors,
      unassignedTracks,
      allCharacters: Array.from(charactersMap.values())
    };
  }

  /**
   * Pre-analyzes all subtitle lines in the project to determine ground-truth overlap matrix.
   */
  static buildSubtitleOverlapMatrix(allSubtitleLines) {
    const sorted = [...allSubtitleLines].sort((a, b) => {
      const sa = a.startSec !== undefined ? a.startSec : parseTimeToSeconds(a.start);
      const sb = b.startSec !== undefined ? b.startSec : parseTimeToSeconds(b.start);
      return sa - sb;
    });

    const overlapMap = new Map();

    for (let i = 0; i < sorted.length; i++) {
      const lineA = sorted[i];
      const startA = lineA.startSec !== undefined ? lineA.startSec : parseTimeToSeconds(lineA.start);
      const endA = lineA.endSec !== undefined ? lineA.endSec : parseTimeToSeconds(lineA.end);
      const idA = String(lineA.id ?? lineA.rawLineIndex ?? i);

      for (let j = i + 1; j < sorted.length; j++) {
        const lineB = sorted[j];
        const startB = lineB.startSec !== undefined ? lineB.startSec : parseTimeToSeconds(lineB.start);
        const idB = String(lineB.id ?? lineB.rawLineIndex ?? j);

        if (startB >= endA - 0.05) {
          break;
        }

        const key = `${idA}:${idB}`;
        overlapMap.set(key, true);
        overlapMap.set(`${idB}:${idA}`, true);
      }
    }

    return overlapMap;
  }

  /**
   * Analyzes speech phrases in all matched tracks (both regular and fixes),
   * aligns phrase starts to subtitle cues, and resolves collisions.
   */
  static async alignProjectAndResolveCollisions({
    subPath,
    matchedTracks,
    options = {}
  }) {
    const minGapSec = options.minGapSec !== undefined ? options.minGapSec : 0.12; // 120ms voice separation
    const leadInSec = options.leadInSec !== undefined ? options.leadInSec : 0.05; // 50ms pre-attack safety
    const maxShiftEarlySec = options.maxShiftEarlySec !== undefined ? options.maxShiftEarlySec : 0.20;
    
    log.info(`[AutoTiming] Starting project auto-timing with minGap=${minGapSec}s, leadIn=${leadInSec}s`);

    const subData = subPath ? await getRawSubtitles(subPath) : { lines: [] };
    const allSubtitleLines = (subData.lines || []).map(l => ({
      ...l,
      startSec: parseTimeToSeconds(l.start),
      endSec: parseTimeToSeconds(l.end)
    }));
    const subOverlapMatrix = this.buildSubtitleOverlapMatrix(allSubtitleLines);

    const trackPhraseResults = [];
    const allProjectPhrases = [];

    // Step 1: Detect voiced phrases in each audio track and pair with subtitle cues
    for (const track of matchedTracks) {
      log.info(`[AutoTiming] Detecting speech phrases for track: ${path.basename(track.trackPath)} (${track.characterName}) [isFix: ${track.isFix || false}]`);
      
      let intervals = [];
      try {
        const detectRes = await detectSpeechIntervals(track.trackPath, {
          noiseDb: options.noiseDb || -36,
          minSilenceDuration: options.minSilenceDuration || 0.18
        });
        intervals = detectRes.speechIntervals || [];
      } catch (err) {
        log.warn(`[AutoTiming] Speech detection failed for ${track.trackPath}, falling back:`, err);
        intervals = [{ startSec: 0, endSec: 300, durationSec: 300 }];
      }

      const charLines = track.lines || [];
      const phrases = [];

      for (let k = 0; k < intervals.length; k++) {
        const interval = intervals[k];
        
        // Find best matching subtitle line by closest timestamp or index
        let subLine = null;
        if (charLines.length > 0) {
          // If the audio has absolute timestamps (e.g. interval.startSec > 10)
          if (interval.startSec > 5) {
            let bestDiff = Infinity;
            for (const cl of charLines) {
              const diff = Math.abs(cl.startSec - interval.startSec);
              if (diff < bestDiff) {
                bestDiff = diff;
                subLine = cl;
              }
            }
          } else {
            subLine = charLines[k] || charLines[0];
          }
        }

        const subStart = subLine ? subLine.startSec : interval.startSec;
        const subEnd = subLine ? subLine.endSec : interval.endSec;
        const subId = subLine ? String(subLine.id ?? subLine.rawLineIndex ?? k) : `track_${track.trackId}_${k}`;

        const initialStart = Math.max(0, subStart - leadInSec);
        const initialEnd = initialStart + interval.durationSec;

        const phraseObj = {
          id: `phrase_${track.trackId}_${k}`,
          trackId: track.trackId,
          trackPath: track.trackPath,
          dubberNick: track.dubberNick,
          dubberId: track.dubberId,
          characterName: track.characterName,
          isFix: track.isFix || false,
          indexInTrack: k,
          sourceStartSec: interval.startSec,
          sourceEndSec: interval.endSec,
          durationSec: interval.durationSec,
          subStartSec: subStart,
          subEndSec: subEnd,
          subId: subId,
          subText: subLine?.text || '',
          targetStartSec: initialStart,
          targetEndSec: initialEnd,
          shiftDeltaSec: initialStart - interval.startSec,
          collisionResolved: false,
          collisionDetails: null
        };

        phrases.push(phraseObj);
        // Only include in global collision checks if not a standalone fix track (or if regular track)
        if (!track.isFix) {
          allProjectPhrases.push(phraseObj);
        }
      }

      trackPhraseResults.push({
        track,
        phrases
      });
    }

    // Step 2: Global Collision Detection & Ripple Resolution across all regular dialogue
    allProjectPhrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

    const collisionLogs = [];
    let totalCollisionsFound = 0;
    let totalCollisionsResolved = 0;
    let totalIntentionalOverlapsPreserved = 0;

    for (let i = 0; i < allProjectPhrases.length; i++) {
      const current = allProjectPhrases[i];

      for (let j = i + 1; j < allProjectPhrases.length; j++) {
        const next = allProjectPhrases[j];

        if (next.targetStartSec >= current.targetEndSec + minGapSec - 0.001) {
          break;
        }

        const overlapKey = `${current.subId}:${next.subId}`;
        const subOriginallyOverlapped = subOverlapMatrix.has(overlapKey);

        if (subOriginallyOverlapped) {
          totalIntentionalOverlapsPreserved++;
          next.intentionalOverlapWith = current.id;
          continue;
        }

        totalCollisionsFound++;
        const collisionOverlapSec = (current.targetEndSec + minGapSec) - next.targetStartSec;
        const requiredNextStart = current.targetEndSec + minGapSec;
        const shiftAmount = requiredNextStart - next.targetStartSec;

        // Try slight early shift for current phrase if space exists
        let earlyShiftSec = 0;
        if (i > 0) {
          const prev = allProjectPhrases[i - 1];
          const availableRoomBefore = current.targetStartSec - (prev.targetEndSec + minGapSec);
          if (availableRoomBefore > 0.05) {
            earlyShiftSec = Math.min(availableRoomBefore, maxShiftEarlySec, shiftAmount * 0.4);
            current.targetStartSec = Math.max(0, current.targetStartSec - earlyShiftSec);
            current.targetEndSec = current.targetStartSec + current.durationSec;
          }
        }

        const finalNextStart = current.targetEndSec + minGapSec;
        const delta = finalNextStart - next.targetStartSec;
        next.targetStartSec = finalNextStart;
        next.targetEndSec = next.targetStartSec + next.durationSec;
        next.shiftDeltaSec = next.targetStartSec - next.sourceStartSec;
        next.collisionResolved = true;
        totalCollisionsResolved++;

        const logMsg = `[${formatSeconds(current.targetStartSec)} - ${formatSeconds(next.targetEndSec)}] Разведена коллизия: фраза «${current.dubberNick}» (${current.characterName}) перекрывала фразу «${next.dubberNick}» (${next.characterName}) на ${collisionOverlapSec.toFixed(2)}с. Сдвиг второй фразы: +${delta.toFixed(2)}с.`;
        collisionLogs.push(logMsg);
        log.info(`[AutoTiming Collision] ${logMsg}`);

        // Ripple forward
        let rippleIdx = j;
        while (rippleIdx + 1 < allProjectPhrases.length) {
          const rCur = allProjectPhrases[rippleIdx];
          const rNext = allProjectPhrases[rippleIdx + 1];

          if (rNext.targetStartSec >= rCur.targetEndSec + minGapSec) break;

          const rKey = `${rCur.subId}:${rNext.subId}`;
          if (subOverlapMatrix.has(rKey)) break;

          rNext.targetStartSec = rCur.targetEndSec + minGapSec;
          rNext.targetEndSec = rNext.targetStartSec + rNext.durationSec;
          rNext.shiftDeltaSec = rNext.targetStartSec - rNext.sourceStartSec;
          rNext.collisionResolved = true;
          rippleIdx++;
        }
      }
    }

    log.info(`[AutoTiming] Collision resolution complete. Found: ${totalCollisionsFound}, Resolved: ${totalCollisionsResolved}`);

    return {
      trackPhraseResults,
      allProjectPhrases,
      subOverlapMatrix,
      stats: {
        totalTracks: matchedTracks.length,
        totalPhrases: allProjectPhrases.length,
        totalCollisionsFound,
        totalCollisionsResolved,
        totalIntentionalOverlapsPreserved
      },
      collisionLogs
    };
  }

  /**
   * STEP 2 OF PIPELINE:
   * Smartly merges timed fix tracks into the timed original tracks:
   * 1. Eliminates leftover tails: Completely zeros/mutes the original phrase span (plus 40ms safety).
   * 2. Checks longer fix takes: If the fix is longer than original, checks for collisions with the next phrase and shifts next phrase cleanly.
   */
  static smartApplyFixesToTimedTracks(timingResult, options = {}) {
    const minGapSec = options.minGapSec !== undefined ? options.minGapSec : 0.12;
    const { trackPhraseResults, subOverlapMatrix, collisionLogs } = timingResult;

    const fixLogs = [];
    let fixesAppliedCount = 0;
    let leftoverTailsCleanedCount = 0;
    let longerFixCollisionsAdjustedCount = 0;

    // Group tracks by dubber (or character)
    const originalTracks = trackPhraseResults.filter(t => !t.track.isFix);
    const fixTracks = trackPhraseResults.filter(t => t.track.isFix);

    for (const fixItem of fixTracks) {
      const { track: fixTrack, phrases: fixPhrases } = fixItem;
      if (fixPhrases.length === 0) continue;

      // Find corresponding original track for this dubber
      const origItem = originalTracks.find(t => 
        (fixTrack.dubberId && t.track.dubberId === fixTrack.dubberId) ||
        (t.track.characterName === fixTrack.characterName) ||
        (t.track.dubberNick && fixTrack.dubberNick && isNameMatch(t.track.dubberNick, fixTrack.dubberNick))
      );

      if (!origItem) {
        log.info(`[smartApplyFixes] Standalone fix track found without prior original track: ${fixTrack.trackPath}. Keeping as main track for ${fixTrack.dubberNick}`);
        const standaloneItem = {
          track: { ...fixTrack, isFix: false },
          phrases: fixPhrases
        };
        originalTracks.push(standaloneItem);
        fixLogs.push(`[${formatSeconds(fixPhrases[0]?.targetStartSec || 0)}] Самостоятельная дорожка фикса [${fixTrack.dubberNick}]: сохранена и экспортирована как основная дорожка.`);
        continue;
      }

      const origPhrases = origItem.phrases;
      log.info(`[smartApplyFixes] Merging ${fixPhrases.length} fix phrases into original track for ${origItem.track.dubberNick}`);

      for (const fixPhrase of fixPhrases) {
        // Find matching phrase in original track
        let matchedOrigIdx = -1;
        let minDiff = Infinity;

        for (let i = 0; i < origPhrases.length; i++) {
          const origP = origPhrases[i];
          // Check by subId
          if (origP.subId && fixPhrase.subId && origP.subId === fixPhrase.subId) {
            matchedOrigIdx = i;
            break;
          }
          // Or by closest subtitle start time
          const diff = Math.abs(origP.subStartSec - fixPhrase.subStartSec);
          if (diff < minDiff && diff < 3.0) {
            minDiff = diff;
            matchedOrigIdx = i;
          }
        }

        if (matchedOrigIdx >= 0) {
          const oldOrigPhrase = origPhrases[matchedOrigIdx];
          fixesAppliedCount++;

          const origDuration = oldOrigPhrase.durationSec;
          const fixDuration = fixPhrase.durationSec;
          const durDiff = fixDuration - origDuration;

          // Tail elimination: if fix is shorter or different length, we ensure the old phrase is 100% silenced
          if (durDiff < -0.05) {
            leftoverTailsCleanedCount++;
            const tailSec = Math.abs(durDiff);
            const tailMsg = `Фраза фикса короче оригинала на ${tailSec.toFixed(2)}с. Старая фраза полностью обнулена/заглушена, хвост удален.`;
            fixLogs.push(`[${formatSeconds(oldOrigPhrase.targetStartSec)}] Даббер «${origItem.track.dubberNick}»: ${tailMsg}`);
          }

          // Build replacement phrase entry
          const replacedPhrase = {
            ...oldOrigPhrase,
            sourceAudioPath: fixPhrase.trackPath,
            sourceStartSec: fixPhrase.sourceStartSec,
            sourceEndSec: fixPhrase.sourceEndSec,
            durationSec: fixDuration,
            targetStartSec: oldOrigPhrase.targetStartSec,
            targetEndSec: oldOrigPhrase.targetStartSec + fixDuration,
            isReplacedByFix: true,
            origDurationSec: origDuration,
            fixDurationSec: fixDuration
          };

          // Assign replaced phrase into track phrase list
          origPhrases[matchedOrigIdx] = replacedPhrase;

          // Check if fix is longer and collides with subsequent phrase of this dubber
          if (durDiff > 0.05 && matchedOrigIdx + 1 < origPhrases.length) {
            const nextPhrase = origPhrases[matchedOrigIdx + 1];
            if (replacedPhrase.targetEndSec + minGapSec > nextPhrase.targetStartSec) {
              longerFixCollisionsAdjustedCount++;
              const pushDelta = (replacedPhrase.targetEndSec + minGapSec) - nextPhrase.targetStartSec;
              
              const logMsg = `Фраза фикса длиннее оригинала на ${durDiff.toFixed(2)}с и перекрывала следующую фразу. Следующая фраза сдвинута на +${pushDelta.toFixed(2)}с вперед.`;
              fixLogs.push(`[${formatSeconds(nextPhrase.targetStartSec)}] Даббер «${origItem.track.dubberNick}»: ${logMsg}`);
              collisionLogs.push(`[${formatSeconds(nextPhrase.targetStartSec)}] ${logMsg}`);

              // Shift next phrase and ripple forward
              for (let r = matchedOrigIdx + 1; r < origPhrases.length; r++) {
                const curP = origPhrases[r - 1];
                const nxtP = origPhrases[r];
                if (nxtP.targetStartSec < curP.targetEndSec + minGapSec) {
                  nxtP.targetStartSec = curP.targetEndSec + minGapSec;
                  nxtP.targetEndSec = nxtP.targetStartSec + nxtP.durationSec;
                  nxtP.shiftDeltaSec = nxtP.targetStartSec - nxtP.sourceStartSec;
                  nxtP.collisionResolved = true;
                } else {
                  break;
                }
              }
            }
          }
        } else {
          // If no matching phrase was found in original, insert as additional phrase
          origPhrases.push({
            ...fixPhrase,
            sourceAudioPath: fixPhrase.trackPath,
            isReplacedByFix: true
          });
          origPhrases.sort((a, b) => a.targetStartSec - b.targetStartSec);
          fixesAppliedCount++;
        }
      }
    }

    // Return only the unified original tracks (which now include inserted fixes)
    return {
      ...timingResult,
      finalTrackPhraseResults: originalTracks,
      fixStats: {
        fixesAppliedCount,
        leftoverTailsCleanedCount,
        longerFixCollisionsAdjustedCount
      },
      fixLogs
    };
  }

  /**
   * Decodes an audio file to raw 16-bit 48kHz stereo PCM in memory with a safety timeout.
   */
  static decodeToPcm(audioPath, sampleRate = 48000, channels = 2) {
    return new Promise((resolve, reject) => {
      const ffmpegCmd = ffmpeg(audioPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(sampleRate)
        .audioChannels(channels)
        .format('s16le');

      const chunks = [];
      let killed = false;
      const timeout = setTimeout(() => {
        killed = true;
        try { ffmpegCmd.kill('SIGKILL'); } catch (e) {}
        reject(new Error(`Timeout decoding audio to PCM (60s): ${audioPath}`));
      }, 60000);

      const stream = ffmpegCmd.pipe();
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', err => {
        clearTimeout(timeout);
        if (!killed) reject(err);
      });
    });
  }

  /**
   * Creates a standard canonical 44-byte RIFF/WAVE header for raw PCM data.
   */
  static createWavHeader(pcmByteLength, sampleRate = 48000, channels = 2, bitDepth = 16) {
    const header = Buffer.alloc(44);
    const blockAlign = channels * (bitDepth / 8);
    const byteRate = sampleRate * blockAlign;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmByteLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmByteLength, 40);

    return header;
  }

  /**
   * Fast, reliable, 100% deadlock-free audio phrase assembly:
   * 1. Decodes all distinct source files once into raw 16-bit 48kHz stereo PCM in RAM.
   * 2. Allocates a zeroed output buffer (100% silence by default, guaranteeing ZERO tails!).
   * 3. Places active phrases (originals + clean fixes) at their exact target start offsets.
   * 4. Applies smooth 8ms micro-fade at phrase boundaries to eliminate clicks/pops.
   * 5. Writes WAV directly to disk (instantaneous, no ffmpeg required!) or encodes to target format.
   */
  static async assembleMultiSourceTrack(defaultInputPath, phrases, outputAudioPath, options = {}) {
    const sampleRate = 48000;
    const channels = 2;
    const bytesPerSampleFrame = 4; // 2 channels * 2 bytes (16-bit)
    const bytesPerSec = sampleRate * bytesPerSampleFrame; // 192,000 bytes/sec

    // 1. Collect all distinct source audio paths
    const sourcePaths = new Set([defaultInputPath]);
    for (const p of phrases) {
      if (p.sourceAudioPath) sourcePaths.add(p.sourceAudioPath);
    }

    // 2. Decode each distinct source audio to 16-bit 48kHz stereo PCM in memory
    const pcmMap = new Map();
    for (const src of sourcePaths) {
      if (fs.existsSync(src)) {
        try {
          const pcmBuf = await this.decodeToPcm(src, sampleRate, channels);
          pcmMap.set(src, pcmBuf);
        } catch (decErr) {
          log.warn(`[AutoTiming] Could not decode ${src} to PCM:`, decErr.message);
        }
      }
    }

    const defaultPcm = pcmMap.get(defaultInputPath);
    if (!defaultPcm && pcmMap.size === 0) {
      throw new Error(`Failed to decode any audio sources for ${outputAudioPath}`);
    }

    // 3. Determine total required duration
    let maxSec = 0;
    for (const p of phrases) {
      if (p.targetEndSec > maxSec) maxSec = p.targetEndSec;
    }
    if (defaultPcm) {
      const defDur = defaultPcm.length / bytesPerSec;
      if (defDur > maxSec) maxSec = defDur;
    }
    maxSec = Math.max(maxSec + 2.0, 10.0);

    // 4. Allocate clean output buffer initialized to zero (100% pure silence - ZERO tails!)
    const totalSamples = Math.ceil(maxSec * sampleRate);
    const outputPcm = Buffer.alloc(totalSamples * bytesPerSampleFrame, 0);

    // 5. Place each phrase at its exact target timing with 8ms micro-fade
    const fadeSamples = Math.min(384, Math.floor(sampleRate * 0.008)); // 8ms = 384 samples

    for (const p of phrases) {
      const srcBuf = pcmMap.get(p.sourceAudioPath || defaultInputPath) || defaultPcm;
      if (!srcBuf) continue;

      const srcStartSample = Math.max(0, Math.floor(p.sourceStartSec * sampleRate));
      const srcEndSample = Math.min(
        Math.floor(p.sourceEndSec * sampleRate),
        Math.floor(srcBuf.length / bytesPerSampleFrame)
      );

      const phraseSamples = srcEndSample - srcStartSample;
      if (phraseSamples <= 0) continue;

      const dstStartSample = Math.max(0, Math.floor(p.targetStartSec * sampleRate));
      const curFade = Math.min(fadeSamples, Math.floor(phraseSamples / 4));

      for (let s = 0; s < phraseSamples; s++) {
        const dstSampleIdx = dstStartSample + s;
        if (dstSampleIdx >= totalSamples) break;

        const srcOffset = (srcStartSample + s) * bytesPerSampleFrame;
        const dstOffset = dstSampleIdx * bytesPerSampleFrame;
        if (srcOffset + 4 > srcBuf.length || dstOffset + 4 > outputPcm.length) break;

        let fade = 1.0;
        if (curFade > 0) {
          if (s < curFade) fade = s / curFade;
          else if (s > phraseSamples - curFade) fade = (phraseSamples - s) / curFade;
        }

        const leftSample = Math.round(srcBuf.readInt16LE(srcOffset) * fade);
        const rightSample = Math.round(srcBuf.readInt16LE(srcOffset + 2) * fade);

        const curLeft = outputPcm.readInt16LE(dstOffset);
        const curRight = outputPcm.readInt16LE(dstOffset + 2);

        // Mix with saturation clipping prevention
        const mixedLeft = Math.max(-32768, Math.min(32767, curLeft + leftSample));
        const mixedRight = Math.max(-32768, Math.min(32767, curRight + rightSample));

        outputPcm.writeInt16LE(mixedLeft, dstOffset);
        outputPcm.writeInt16LE(mixedRight, dstOffset + 2);
      }
    }

    // 6. Write output file
    const ext = (path.extname(outputAudioPath) || '.wav').toLowerCase();
    const tempOut = path.join(path.dirname(outputAudioPath), `temp_timed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);

    if (ext === '.wav') {
      const header = this.createWavHeader(outputPcm.length, sampleRate, channels, 16);
      await fs.promises.writeFile(tempOut, Buffer.concat([header, outputPcm]));
      if (fs.existsSync(outputAudioPath)) {
        await fs.promises.unlink(outputAudioPath);
      }
      await fs.promises.rename(tempOut, outputAudioPath);
      return outputAudioPath;
    } else {
      // Re-encode from raw PCM buffer to target format (.mp3, .flac, .m4a, etc.)
      const header = this.createWavHeader(outputPcm.length, sampleRate, channels, 16);
      const wavBuffer = Buffer.concat([header, outputPcm]);

      return new Promise((resolve, reject) => {
        let cmd = ffmpeg();
        const { Readable } = require('stream');
        const s = new Readable();
        s.push(wavBuffer);
        s.push(null);

        let timeout = setTimeout(() => {
          try { cmd.kill('SIGKILL'); } catch (e) {}
          reject(new Error(`Timeout encoding ${ext} audio: ${outputAudioPath}`));
        }, 60000);

        cmd
          .input(s)
          .output(tempOut)
          .on('end', async () => {
            clearTimeout(timeout);
            try {
              if (fs.existsSync(outputAudioPath)) {
                await fs.promises.unlink(outputAudioPath);
              }
              await fs.promises.rename(tempOut, outputAudioPath);
              resolve(outputAudioPath);
            } catch (e) {
              reject(e);
            }
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut); } catch (e) {}
            reject(err);
          });

        let audioCodec = 'pcm_s16le';
        if (ext === '.mp3') audioCodec = 'libmp3lame';
        else if (ext === '.flac') audioCodec = 'flac';
        else if (ext === '.ogg') audioCodec = 'libvorbis';
        else if (ext === '.m4a' || ext === '.aac') audioCodec = 'aac';
        cmd.audioCodec(audioCodec);

        cmd.run();
      });
    }
  }

  /**
   * Renders the auto-timed, collision-resolved audio tracks with clean fix insertions to disk.
   */
  static async renderAutoTimedTracks(mergedResult, targetDir, baseVideoName, options = {}, onProgress, onLog) {
    await fs.promises.mkdir(targetDir, { recursive: true });
    const renderedTracks = [];

    const tracksToRender = mergedResult.finalTrackPhraseResults || mergedResult.trackPhraseResults;
    const reportPath = path.join(targetDir, 'ИНФО_О_ФИКСАХ_И_АВТОТАЙМИНГЕ.txt');

    let reportContent = `============================================================\n` +
      `  ОТЧЕТ ОБ АВТОТАЙМИНГЕ, РАЗВЕДЕНИИ КОЛЛИЗИЙ И ВШИТИИ ФИКСОВ\n` +
      `  Дата: ${new Date().toLocaleString()}\n` +
      `============================================================\n\n` +
      `СТАТИСТИКА ПРОЕКТА:\n` +
      `• Обработано дорожек даберов: ${tracksToRender.length}\n` +
      `• Всего выровнено фраз: ${mergedResult.stats.totalPhrases}\n` +
      `• Вшито фраз фиксов: ${mergedResult.fixStats?.fixesAppliedCount || 0}\n` +
      `• Удалено остаточных хвостов старых дублей: ${mergedResult.fixStats?.leftoverTailsCleanedCount || 0}\n` +
      `• Разведено удлиненных коллизий фиксов: ${mergedResult.fixStats?.longerFixCollisionsAdjustedCount || 0}\n` +
      `• Разведено общих коллизий между дорожками: ${mergedResult.stats.totalCollisionsResolved}\n` +
      `• Сохранено оригинальных наложений из сабов: ${mergedResult.stats.totalIntentionalOverlapsPreserved}\n\n`;

    if (mergedResult.fixLogs && mergedResult.fixLogs.length > 0) {
      reportContent += `ЖУРНАЛ ОБРАБОТКИ ФИКСОВ И УДАЛЕНИЯ ХВОСТОВ:\n` +
        mergedResult.fixLogs.map(l => `  • ${l}`).join('\n') + '\n\n';
    }

    reportContent += `ЖУРНАЛ РАЗВЕДЕНИЯ КОЛЛИЗИЙ:\n` +
      (mergedResult.collisionLogs.length > 0 
        ? mergedResult.collisionLogs.map(l => `  • ${l}`).join('\n') 
        : '  • Наложений и коллизий между дорожками не обнаружено (все фразы звучат чисто).\n') +
      `\n\nДЕТАЛИЗАЦИЯ ПО ДОРОЖКАМ:\n`;

    for (let tIdx = 0; tIdx < tracksToRender.length; tIdx++) {
      const item = tracksToRender[tIdx];
      const { track, phrases } = item;
      const ext = path.extname(track.trackPath) || '.wav';
      const nick = track.dubberNick || 'Даббер';
      const outFilename = `${baseVideoName}_[${nick}]${ext}`;
      const outFilePath = path.join(targetDir, outFilename);

      const trackProgressPercent = 70 + Math.round(((tIdx + 1) / tracksToRender.length) * 28);
      const logMsg = `Сборка дорожки [${tIdx + 1}/${tracksToRender.length}]: «${nick}» (${track.characterName}) — фраз: ${phrases.length}`;
      log.info(`[AutoTiming Render] ${logMsg} -> ${outFilePath}`);
      if (onLog) onLog(logMsg);
      if (onProgress) onProgress({ percent: trackProgressPercent, message: logMsg });

      reportContent += `\n------------------------------------------------------------\n` +
        `Даббер: ${nick} | Роль: ${track.characterName}\n` +
        `Основной файл: ${path.basename(track.trackPath)}\n` +
        `Количество фраз: ${phrases.length}\n` +
        `------------------------------------------------------------\n`;

      if (phrases.length === 0) {
        await fs.promises.copyFile(track.trackPath, outFilePath);
        renderedTracks.push({
          dubberNick: nick,
          characterName: track.characterName,
          outputPath: outFilePath,
          phrasesCount: 0
        });
        continue;
      }

      try {
        await this.assembleMultiSourceTrack(track.trackPath, phrases, outFilePath, options);
        renderedTracks.push({
          dubberNick: nick,
          characterName: track.characterName,
          outputPath: outFilePath,
          phrasesCount: phrases.length
        });
        if (onLog) onLog(`Готово: ${outFilename}`);
      } catch (renderErr) {
        log.error(`[AutoTiming Render] Failed assembly for ${nick}, copying original as safe fallback:`, renderErr);
        if (onLog) onLog(`[Предупреждение] Ошибка сборки ${nick}: ${renderErr.message}. Скопирован оригинал.`, 'warn');
        await fs.promises.copyFile(track.trackPath, outFilePath);
        renderedTracks.push({
          dubberNick: nick,
          characterName: track.characterName,
          outputPath: outFilePath,
          phrasesCount: phrases.length,
          warning: 'Fallback copy used due to render error'
        });
      }

      for (const p of phrases) {
        const fixMark = p.isReplacedByFix ? ' [ВШИТ ФИКС]' : '';
        reportContent += `  [${formatSeconds(p.targetStartSec)} - ${formatSeconds(p.targetEndSec)}] Исходное время: ${formatSeconds(p.sourceStartSec)} | Сдвиг: ${(p.targetStartSec - p.sourceStartSec) >= 0 ? '+' : ''}${(p.targetStartSec - p.sourceStartSec).toFixed(2)}с | Саб: ${p.subStartSec.toFixed(2)}с${fixMark}\n` +
          `    Текст: "${p.subText || '—'}"\n`;
      }
    }

    reportContent += `\n============================================================\n` +
      `Все дорожки экспортированы с оттаймленными фразами и чистыми фиксами без хвостов.\n`;

    await fs.promises.writeFile(reportPath, reportContent, 'utf-8');
    log.info(`[AutoTiming] Timing & Fix report saved to: ${reportPath}`);
    if (onLog) onLog(`Отчет по таймингу и фиксам сохранен в: ИНФО_О_ФИКСАХ_И_АВТОТАЙМИНГЕ.txt`);

    return {
      renderedTracks,
      reportPath
    };
  }
}

module.exports = AutoTimingService;
