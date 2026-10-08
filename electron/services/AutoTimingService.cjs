const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('electron-log');
const { getRawSubtitles } = require('./subtitleService.cjs');
const { detectSpeechIntervals, addProcess, getFfmpegPath } = require('./ffmpegService.cjs');
const ffmpeg = require('fluent-ffmpeg');

/**
 * Нормализация строк для надежного сопоставления никнеймов и имен персонажей.
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
 * Стандартные префиксы и суффиксы для очистки имен файлов при извлечении никнеймов дабберов.
 */
const STRIP_TERMS = [
  'ep', 'episode', 'серия', 'серии', 'эпизод', 'raw', 'vox', 'voice', 
  'audio', 'track', 'fix', 'фикс', 'оригинал', 'original', 'dub', 'fandub', 
  'vocal', 'take', 'clean', 'final', 'sound', 'mix', 'master'
];

/**
 * Извлечение кандидатов в никнеймы дабберов из названия аудиофайла.
 */
function extractNicknamesFromFilename(filePath) {
  if (!filePath) return [];
  const baseName = path.basename(filePath, path.extname(filePath));
  const candidates = [];

  // 1. Токены в скобках [Persona99], (Owl), {Svat}
  const bracketMatches = baseName.matchAll(/[\[\(\{]([^\]\)\}]+)[\]\)\}]/g);
  for (const m of bracketMatches) {
    const token = m[1].trim();
    if (
      token &&
      /[a-zA-Zа-яА-ЯёЁ]/.test(token) &&
      !STRIP_TERMS.includes(token.toLowerCase()) &&
      !/^\d+$/.test(token) &&
      !/^[\d\s._-]+$/.test(token)
    ) {
      candidates.push(token);
    }
  }

  // 2. Части, разделенные подчеркиваниями или дефисами
  const parts = baseName.split(/[_+\-—]/).map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const cleaned = part.replace(/^\[|\]$|^\(|\)$/g, '').trim();
    const isEpisodeNum = /^(ep\d+|\d+p|\d+серия|\d+)$/i.test(cleaned);
    const isGenericTerm = STRIP_TERMS.includes(cleaned.toLowerCase());
    const hasLetters = /[a-zA-Zа-яА-ЯёЁ]/.test(cleaned);
    const isNumericArtifact = /^[\d\s._-]+$/.test(cleaned);

    if (cleaned && hasLetters && !isNumericArtifact && !isEpisodeNum && !isGenericTerm && cleaned.length >= 2) {
      candidates.push(cleaned);
    }
  }

  // 3. Запасной вариант - все чистое имя файла
  if (candidates.length === 0) {
    if (/[a-zA-Zа-яА-ЯёЁ]/.test(baseName) && !/^[\d\s._-]+$/.test(baseName)) {
      candidates.push(baseName);
    }
  }

  return Array.from(new Set(candidates));
}

/**
 * Проверка совпадения кандидата с ником или персонажем.
 */
function isNameMatch(candidate, target) {
  if (!candidate || !target) return false;
  const cNorm = normalizeName(candidate);
  const tNorm = normalizeName(target);
  if (!cNorm || !tNorm) return false;

  if (cNorm === tNorm) return true;
  if (cNorm.includes(tNorm) || tNorm.includes(cNorm)) return true;

  const cWords = cNorm.split(' ');
  const tWords = tNorm.split(' ');
  for (const cw of cWords) {
    if (cw.length >= 3 && tWords.includes(cw)) return true;
  }

  return false;
}

/**
 * Конвертация таймкода ASS (0:01:23.45) в секунды.
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
 * Форматирование секунд в строку MM:SS.cc.
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
 * Сервис интеллектуального автотайминга, распознавания речи, разведения коллизий,
 * бесшовного вшивания правок и низкоуровневой потоковой сборки PCM с защитой по памяти.
 */
class AutoTimingService {

  /**
   * Автоматическое сопоставление персонажей из субтитров и загруженных аудиодорожек.
   */
  static async matchActorsWithAudioTracks(subPath, audioFiles, participantsData = [], characterAliases = {}, existingAssignments = []) {
    log.info(`[AutoTiming] Сопоставление актеров из ${subPath} с ${audioFiles?.length || 0} аудиофайлами`);
    
    const subData = subPath ? await getRawSubtitles(subPath) : { lines: [], actors: [] };
    const subLines = subData.lines || [];
    const aliases = typeof characterAliases === 'string' ? JSON.parse(characterAliases || '{}') : (characterAliases || {});
    
    const charactersMap = new Map();
    const signKeywords = ['sign', 'text', 'title', 'signs', 'titles', 'caption', 'надпись', 'текст', 'титр', 'титры', 'заставка', 'экран', 'note', 'info'];

    for (const line of subLines) {
      let rawChar = (line.name || '').trim();
      const styleName = (line.style || '').trim();
      const lowerStyle = styleName.toLowerCase();

      const isSign = signKeywords.some(kw => (rawChar && rawChar.toLowerCase().includes(kw)) || lowerStyle.includes(kw));
      if (isSign) continue;

      if ((!rawChar || rawChar.toLowerCase() === 'default') && styleName && lowerStyle !== 'default' && !lowerStyle.includes('alt') && !lowerStyle.includes('sign')) {
        rawChar = styleName;
      }

      if (!rawChar) continue;

      const subCharacters = rawChar.split(/[,;&/]|(?:\s+и\s+)/i).map(s => s.trim()).filter(Boolean);
      const charsToProcess = subCharacters.length > 0 ? subCharacters : [rawChar];

      for (const charName of charsToProcess) {
        if (!charName || charName.toLowerCase() === 'default') continue;
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
          text: line.text,
          name: charName,
          style: line.style
        });
      }
    }

    for (const charInfo of charactersMap.values()) {
      charInfo.lines.sort((a, b) => a.startSec - b.startSec);
    }

    const matchedTracks = [];
    const unassignedTracks = [];
    const usedTrackPaths = new Set();
    const usedCharacters = new Set();

    const isTrackFix = (track) => {
      if (track.type === 'FIXES') return true;
      const bn = path.basename(track.path || '').toLowerCase();
      return bn.includes('fix') || bn.includes('фикс');
    };

    const extractFixTargets = (assignment) => {
      if (!assignment || !assignment.comments) return [];
      try {
        const parsed = typeof assignment.comments === 'string' ? JSON.parse(assignment.comments) : assignment.comments;
        if (Array.isArray(parsed)) {
          const list = parsed.map(c => ({
            subId: c.subId ? String(c.subId) : undefined,
            timestamp: c.timestamp !== undefined ? Number(c.timestamp) : undefined,
            lineIndex: c.lineIndex !== undefined ? Number(c.lineIndex) : undefined,
            text: c.text
          })).filter(c => c.timestamp !== undefined || c.subId || c.lineIndex !== undefined);
          list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
          return list;
        }
      } catch (e) {}
      return [];
    };

    // 1. Сопоставление по назначениям
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
          const isFix = isTrackFix(track);
          if (!isFix) usedCharacters.add(charName);
          const fixTargetLines = isFix ? extractFixTargets(assignment) : [];
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
            lines: charactersMap.get(charName)?.lines || [],
            fixTargetLines
          });
        }
      }
    }

    // 2. Сопоставление по никнеймам в названии файлов
    for (const track of (audioFiles || [])) {
      if (usedTrackPaths.has(track.path)) continue;
      const candidates = extractNicknamesFromFilename(track.path);
      const isFix = isTrackFix(track);
      
      let matchedParticipant = null;
      for (const p of participantsData) {
        if (candidates.some(c => isNameMatch(c, p.nickname) || isNameMatch(c, p.name))) {
          matchedParticipant = p;
          break;
        }
      }

      if (matchedParticipant) {
        let targetChar = null;
        for (const [cName, cInfo] of charactersMap.entries()) {
          if (!usedCharacters.has(cName) || isFix) {
            if (candidates.some(c => isNameMatch(c, cName)) || isNameMatch(matchedParticipant.nickname, cName)) {
              targetChar = cName;
              break;
            }
          }
        }

        if (!targetChar) {
          const epAssign = existingAssignments.find(a => a.dubberId === matchedParticipant.id);
          if (epAssign && (!usedCharacters.has(epAssign.characterName) || isFix)) {
            targetChar = epAssign.characterName;
          }
        }

        if (targetChar) {
          usedTrackPaths.add(track.path);
          if (!isFix) usedCharacters.add(targetChar);
          const relatedAssign = existingAssignments.find(a => 
            a.dubberId === matchedParticipant.id || a.characterName === targetChar
          );
          const fixTargetLines = isFix ? extractFixTargets(relatedAssign) : [];
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
            lines: charactersMap.get(targetChar)?.lines || [],
            fixTargetLines
          });
          continue;
        }
      }

      // 3. Сопоставление имени файла с персонажем из субтитров
      let matchedDirectChar = null;
      for (const [cName, cInfo] of charactersMap.entries()) {
        if (!usedCharacters.has(cName) || isFix) {
          if (candidates.some(c => isNameMatch(c, cName))) {
            matchedDirectChar = cName;
            break;
          }
        }
      }

      if (matchedDirectChar) {
        usedTrackPaths.add(track.path);
        if (!isFix) usedCharacters.add(matchedDirectChar);
        const relatedAssign = existingAssignments.find(a => 
          a.characterName === matchedDirectChar || (track.uploadedById && a.dubberId === track.uploadedById)
        );
        const fixTargetLines = isFix ? extractFixTargets(relatedAssign) : [];
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
          lines: charactersMap.get(matchedDirectChar)?.lines || [],
          fixTargetLines
        });
      } else {
        unassignedTracks.push(track);
      }
    }

    // 4. Резервное сохранение всех оставшихся файлов
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

      if (!nick || !/[a-zA-Zа-яА-ЯёЁ]/.test(nick) || /^[\d\s._-]+$/.test(nick)) {
        continue;
      }

      const isFix = isTrackFix(track);
      const fallbackCharName = track.characterName || `Дорожка_${nick}`;

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
        lines: []
      });
    }

    // Apply Version Priority Rule and Deduplication per actor
    const deduplicatedMatchedTracks = [];
    const tracksByActor = new Map();

    const cleanNickStr = (str) => String(str || '').replace(/\[.*\]/g, '').replace(/_?(дорожка|слой|take|layer|фикс|fix)\s*\d*/gi, '').replace(/[^\w\d\s\u0400-\u04FF_-]/g, '').trim().toLowerCase();

    for (const mt of matchedTracks) {
      const actorKey = cleanNickStr(mt.dubberNick || mt.characterName);
      if (!tracksByActor.has(actorKey)) {
        tracksByActor.set(actorKey, []);
      }
      tracksByActor.get(actorKey).push(mt);
    }

    for (const actorTracks of tracksByActor.values()) {
      if (actorTracks.length === 1) {
        deduplicatedMatchedTracks.push(actorTracks[0]);
        continue;
      }

      const mainTracks = actorTracks.filter(t => !t.isFix);
      const fixTracks = actorTracks.filter(t => t.isFix);

      const newestMain = mainTracks.length > 0 ? mainTracks[mainTracks.length - 1] : null;
      const newestFix = fixTracks.length > 0 ? fixTracks[fixTracks.length - 1] : null;

      if (newestMain && newestFix) {
        let mainSize = 0;
        let fixSize = 0;
        try { mainSize = fs.statSync(newestMain.trackPath).size; } catch (e) {}
        try { fixSize = fs.statSync(newestFix.trackPath).size; } catch (e) {}

        const ratio = (mainSize > 0 && fixSize > 0) ? (fixSize / mainSize) : 0;

        // Rule 2a: Full Fix (size/duration >= 70%)
        // Draft track (DUBBER_FILE) is COMPLETELY EXCLUDED!
        if (ratio >= 0.70 || fixSize === 0) {
          newestFix.isFix = false;
          deduplicatedMatchedTracks.push(newestFix);
        } else {
          // Rule 2b: Local snippet (< 70%)
          if (!newestMain.fixTargetLines || newestMain.fixTargetLines.length === 0) {
            newestMain.fixTargetLines = newestFix.fixTargetLines;
          }
          newestMain.patchSnippetPath = newestFix.trackPath;
          deduplicatedMatchedTracks.push(newestMain);
        }
      } else if (newestFix) {
        newestFix.isFix = false;
        deduplicatedMatchedTracks.push(newestFix);
      } else if (newestMain) {
        deduplicatedMatchedTracks.push(newestMain);
      }
    }

    const unassignedActors = Array.from(charactersMap.keys()).filter(c => !usedCharacters.has(c));
    const nickCounts = new Map();
    for (const mt of deduplicatedMatchedTracks) {
      const c = (nickCounts.get(mt.dubberNick) || 0) + 1;
      nickCounts.set(mt.dubberNick, c);
      mt.subTrackIndex = c;
    }

    return {
      matchedTracks: deduplicatedMatchedTracks,
      unassignedActors,
      unassignedTracks,
      allCharacters: Array.from(charactersMap.values())
    };
  }

  /**
   * Построение матрицы пересечений реплик в исходных субтитрах.
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

        if (startB >= endA - 0.05) break;

        const key = `${idA}:${idB}`;
        overlapMap.set(key, true);
        overlapMap.set(`${idB}:${idA}`, true);
      }
    }

    return overlapMap;
  }

  /**
   * Выравнивание тайминга фраз и разведение коллизий диалогов.
   * Адаптивный pre-roll минимум 90 мс для защиты взрывных согласных ('П', 'Б', 'Т') и микрофонных вдохов.
   */
  static async alignProjectAndResolveCollisions({
    subPath,
    matchedTracks,
    options = {}
  }) {
    const minGapSec = options.minGapSec !== undefined ? options.minGapSec : 0.12; // 120ms
    const leadInSec = options.leadInSec !== undefined ? options.leadInSec : 0.090; // 90ms adaptive pre-roll
    const maxShiftEarlySec = options.maxShiftEarlySec !== undefined ? options.maxShiftEarlySec : 0.20;
    
    log.info(`[AutoTiming] Запуск автотайминга с minGap=${minGapSec}с, leadIn=${leadInSec}с`);

    const subData = subPath ? await getRawSubtitles(subPath) : { lines: [] };
    const allSubtitleLines = (subData.lines || []).map(l => ({
      ...l,
      startSec: parseTimeToSeconds(l.start),
      endSec: parseTimeToSeconds(l.end)
    }));
    const subOverlapMatrix = this.buildSubtitleOverlapMatrix(allSubtitleLines);

    const trackPhraseResults = [];
    const allProjectPhrases = [];

    for (const track of matchedTracks) {
      let intervals = [];
      try {
        const detectRes = await detectSpeechIntervals(track.trackPath, {
          noiseDb: options.noiseDb || -45,
          minSilenceDuration: options.minSilenceDuration || 0.30
        });
        intervals = detectRes.speechIntervals || [];
      } catch (err) {
        intervals = [{ startSec: 0, endSec: 300, durationSec: 300 }];
      }

      const charLines = track.lines || [];
      const phrases = [];
      const fixTargets = track.fixTargetLines || [];

      let isTrackInTimeline = false;
      if (intervals.length > 0) {
        const firstStart = intervals[0].startSec;
        const lastEnd = intervals[intervals.length - 1].endSec;
        const totalSpan = lastEnd - firstStart;

        if (track.isFix) {
          const targets = fixTargets.length > 0 ? fixTargets : charLines;
          const matchCount = intervals.filter(inv => 
            targets.some(t => {
              const tSec = t.timestamp !== undefined ? t.timestamp : t.startSec;
              return tSec !== undefined && Math.abs(tSec - inv.startSec) < 15.0;
            })
          ).length;
          if (matchCount >= Math.ceil(intervals.length / 2) && firstStart > 5.0) {
            isTrackInTimeline = true;
          }
        } else {
          if (firstStart > 15.0 || totalSpan > 45.0) {
            isTrackInTimeline = true;
          }
        }
      }

      for (let k = 0; k < intervals.length; k++) {
        const interval = intervals[k];
        let subLine = null;

        if (track.isFix) {
          if (isTrackInTimeline) {
            let bestDiff = Infinity;
            for (const cl of charLines) {
              const diff = Math.abs(cl.startSec - interval.startSec);
              if (diff < bestDiff && diff < 25.0) {
                bestDiff = diff;
                subLine = cl;
              }
            }
          } else {
            if (fixTargets.length > 0 && k < fixTargets.length) {
              const target = fixTargets[k];
              if (target.subId) {
                subLine = charLines.find(cl => String(cl.id) === String(target.subId) || String(cl.rawLineIndex) === String(target.subId));
              }
              if (!subLine && target.timestamp !== undefined) {
                subLine = charLines.find(cl => Math.abs(cl.startSec - target.timestamp) < 2.0);
              }
              if (!subLine && typeof target.lineIndex === 'number') {
                subLine = charLines.find(cl => cl.rawLineIndex === target.lineIndex);
              }
              if (!subLine && target.timestamp !== undefined) {
                subLine = { 
                  startSec: target.timestamp, 
                  endSec: target.timestamp + interval.durationSec, 
                  id: target.subId || `fix_${k}`, 
                  text: target.text || '' 
                };
              }
            }
            if (!subLine && charLines.length > 0) {
              subLine = charLines[k] || charLines[charLines.length - 1];
            }
          }
        } else {
          if (isTrackInTimeline) {
            let bestDiff = Infinity;
            for (const cl of charLines) {
              const diff = Math.abs(cl.startSec - interval.startSec);
              if (diff < bestDiff && diff < 20.0) {
                bestDiff = diff;
                subLine = cl;
              }
            }
          } else {
            if (charLines.length > 0) {
              subLine = charLines[k] || charLines[charLines.length - 1];
            }
          }
        }

        const subStart = subLine ? subLine.startSec : interval.startSec;
        const subEnd = subLine ? subLine.endSec : interval.endSec;
        const subId = subLine ? String(subLine.id ?? subLine.rawLineIndex ?? k) : `track_${track.trackId}_${k}`;

        const initialStart = isTrackInTimeline 
          ? interval.startSec 
          : Math.max(0, subStart - leadInSec);
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
        if (!track.isFix) {
          allProjectPhrases.push(phraseObj);
        }
      }

      trackPhraseResults.push({
        track,
        phrases
      });
    }

    // Разведение коллизий между разными актерами
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

        if (current.dubberNick && current.dubberNick === next.dubberNick && current.trackId !== next.trackId) {
          totalIntentionalOverlapsPreserved++;
          next.intentionalOverlapWith = current.id;
          continue;
        }

        totalCollisionsFound++;
        const collisionOverlapSec = (current.targetEndSec + minGapSec) - next.targetStartSec;
        const requiredNextStart = current.targetEndSec + minGapSec;
        const shiftAmount = requiredNextStart - next.targetStartSec;

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

        const logMsg = `[${formatSeconds(current.targetStartSec)} - ${formatSeconds(next.targetEndSec)}] Разведена коллизия: фраза «${current.dubberNick}» (${current.characterName}) перекрывала фразу «${next.dubberNick}» (${next.characterName}) на ${collisionOverlapSec.toFixed(2)}с. Сдвиг: +${delta.toFixed(2)}с.`;
        collisionLogs.push(logMsg);

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
   * Слияние правок (FIX) с оригинальными дорожками с защитой от хвостов и каскадным сдвигом.
   */
  static smartApplyFixesToTimedTracks(timingResult, options = {}) {
    const minGapSec = options.minGapSec ?? 0.12;
    const { trackPhraseResults, collisionLogs } = timingResult;

    const fixLogs = [];
    let fixesAppliedCount = 0;
    let leftoverTailsCleanedCount = 0;
    let longerFixCollisionsAdjustedCount = 0;

    const originalTracks = trackPhraseResults.filter(t => !t.track.isFix);
    const fixTracks = trackPhraseResults.filter(t => t.track.isFix);

    for (const fixItem of fixTracks) {
      const { track: fixTrack, phrases: fixPhrases } = fixItem;
      if (fixPhrases.length === 0) continue;

      const origItem = originalTracks.find(t => 
        (fixTrack.dubberId && t.track.dubberId === fixTrack.dubberId) ||
        (t.track.characterName === fixTrack.characterName) ||
        (t.track.dubberNick && fixTrack.dubberNick && isNameMatch(t.track.dubberNick, fixTrack.dubberNick))
      );

      if (!origItem) {
        const standaloneItem = {
          track: { ...fixTrack, isFix: false },
          phrases: fixPhrases
        };
        originalTracks.push(standaloneItem);
        continue;
      }

      const origPhrases = origItem.phrases;

      for (const fixPhrase of fixPhrases) {
        let matchedOrigIdx = -1;
        let minDiff = Infinity;

        for (let i = 0; i < origPhrases.length; i++) {
          const origP = origPhrases[i];
          if (origP.subId && fixPhrase.subId && origP.subId === fixPhrase.subId) {
            matchedOrigIdx = i;
            break;
          }
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

          if (durDiff < -0.05) {
            leftoverTailsCleanedCount++;
            const tailSec = Math.abs(durDiff);
            const tailMsg = `Фраза фикса короче оригинала на ${tailSec.toFixed(2)}с. Старая фраза полностью обнулена/заглушена, хвост удален.`;
            fixLogs.push(`[${formatSeconds(oldOrigPhrase.targetStartSec)}] Даббер «${origItem.track.dubberNick}»: ${tailMsg}`);
          }

          const replacedPhrase = {
            ...oldOrigPhrase,
            sourceAudioPath: fixPhrase.trackPath,
            sourceStartSec: fixPhrase.sourceStartSec,
            sourceEndSec: fixPhrase.sourceEndSec,
            durationSec: fixDuration,
            targetStartSec: oldOrigPhrase.targetStartSec,
            targetEndSec: oldOrigPhrase.targetStartSec + fixDuration,
            oldTargetStartSec: oldOrigPhrase.targetStartSec,
            oldTargetEndSec: oldOrigPhrase.targetEndSec,
            isReplacedByFix: true,
            origDurationSec: origDuration,
            fixDurationSec: fixDuration
          };

          origPhrases[matchedOrigIdx] = replacedPhrase;

          // Каскадный сдвиг (Ripple Shift) при удлинении дубля фикса
          if (durDiff > 0.05 && matchedOrigIdx + 1 < origPhrases.length) {
            const nextPhrase = origPhrases[matchedOrigIdx + 1];
            if (replacedPhrase.targetEndSec + minGapSec > nextPhrase.targetStartSec) {
              longerFixCollisionsAdjustedCount++;
              const pushDelta = (replacedPhrase.targetEndSec + minGapSec) - nextPhrase.targetStartSec;
              
              const logMsg = `Фраза фикса длиннее оригинала на ${durDiff.toFixed(2)}с и перекрывала следующую фразу. Каскадный сдвиг (ripple shift) на +${pushDelta.toFixed(2)}с вперед.`;
              fixLogs.push(`[${formatSeconds(nextPhrase.targetStartSec)}] Даббер «${origItem.track.dubberNick}»: ${logMsg}`);
              collisionLogs.push(`[${formatSeconds(nextPhrase.targetStartSec)}] ${logMsg}`);

              for (let r = matchedOrigIdx + 1; r < origPhrases.length; r++) {
                const prevP = origPhrases[r - 1];
                const curP = origPhrases[r];
                const requiredMinStart = prevP.targetEndSec + minGapSec;
                if (curP.targetStartSec < requiredMinStart) {
                  curP.targetStartSec = requiredMinStart;
                  curP.targetEndSec = Number((curP.targetStartSec + curP.durationSec).toFixed(3));
                  curP.shiftDeltaSec = Number((curP.targetStartSec - curP.sourceStartSec).toFixed(3));
                  curP.collisionResolved = true;
                } else {
                  break;
                }
              }
            }
          }
        } else {
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
   * Декодирует аудиофайл во временный файл чистого 16-бит 48кГц стерео PCM на диск.
   * Принудительно задает передискретизацию (-ar 48000 -ac 2 -f s16le -acodec pcm_s16le).
   * Исключает выделение больших буферов в V8 Heap.
   */
  static decodeToPcmFile(audioPath, outRawPath, sampleRate = 48000, channels = 2) {
    return new Promise((resolve, reject) => {
      let killed = false;
      const ffmpegCmd = ffmpeg(audioPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(sampleRate)
        .audioChannels(channels)
        .outputOptions([
          '-ar', String(sampleRate),
          '-ac', String(channels),
          '-f', 's16le'
        ])
        .output(outRawPath);

      const timeout = setTimeout(() => {
        killed = true;
        try { ffmpegCmd.kill('SIGKILL'); } catch (e) {}
        reject(new Error(`Таймаут декодирования PCM на диск (180с): ${audioPath}`));
      }, 180000);

      ffmpegCmd.on('end', () => {
        clearTimeout(timeout);
        resolve(outRawPath);
      });
      ffmpegCmd.on('error', (err) => {
        clearTimeout(timeout);
        if (!killed) reject(err);
      });

      ffmpegCmd.run();
    });
  }

  /**
   * Загрузка карты громкостей из phrase_volume_map.json или timing_metadata.json.
   */
  static loadPhraseVolumeMap(searchDirs = []) {
    const volumeMap = {};
    const rolesMap = {};

    for (const dir of searchDirs) {
      if (!dir) continue;
      const candidates = [
        path.join(dir, 'timing_project.analysis.json'),
        path.join(dir, 'Тайминг', 'timing_project.analysis.json'),
        path.join(dir, 'phrase_volume_map.json'),
        path.join(dir, 'timing_metadata.json'),
        path.join(dir, '00_исходные', 'phrase_volume_map.json'),
        path.join(dir, '00_исходные', 'timing_metadata.json')
      ];

      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try {
            const raw = fs.readFileSync(cand, 'utf8');
            const data = JSON.parse(raw);
            if (data.rolesVolumeMap && typeof data.rolesVolumeMap === 'object') {
              Object.assign(rolesMap, data.rolesVolumeMap);
            }
            if (Array.isArray(data.phrases)) {
              for (const p of data.phrases) {
                if (p.id && (p.volumePercent !== undefined || p.volumeGainDb !== undefined)) {
                  let vol = p.volumePercent;
                  if (vol === undefined && p.volumeGainDb !== undefined) {
                    vol = Math.round(Math.pow(10, p.volumeGainDb / 20) * 100);
                  }
                  if (vol !== undefined) volumeMap[p.id] = vol;
                }
              }
            }
            if (Object.keys(volumeMap).length > 0 || Object.keys(rolesMap).length > 0) {
              return { volumeMap, rolesMap };
            }
          } catch (e) {}
        }
      }
    }

    return { volumeMap, rolesMap };
  }

  /**
   * Создание стандартного 44-байтного заголовка RIFF WAVE для PCM аудио.
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
    header.writeUInt16LE(1, 20); // PCM
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
   * ПОТОКОВАЯ СБОРКА АУДИОДОРОЖКИ С МИНИМАЛЬНЫМ ПОТРЕБЛЕНИЕМ RAM (< 20 МБ):
   * 1. Исходные файлы стримятся в 48kHz 16-bit stereo .raw файлы на диске.
   * 2. Аудио рендерится блоками (чанками по 10 секунд) непосредственно в выходной WAV файл.
   * 3. Адаптивный pre-roll (>= 90 мс) с плавным 10 мс S-образным (Hann window) fade-in сохраняет вдохи и взрывные 'П','Б','Т'.
   * 4. Post-roll (>= 180 мс) с 15 мс S-образным (Hann window) fade-out сохраняет естественное затухание реверберации.
   * 5. Учитываются коэффициенты phrase_volume_map.json / timing_metadata.json.
   * 6. Полностью исключен JavaScript heap out of memory на сериях любой длительности (25+ мин).
   */
  static async assembleMultiSourceTrack(defaultInputPath, phrases, outputAudioPath, options = {}) {
    const sampleRate = 48000;
    const channels = 2;
    const bytesPerSampleFrame = 4; // 2 канала * 2 байта (16-bit)
    const bytesPerSec = sampleRate * bytesPerSampleFrame; // 192,000 байт/сек

    // 1. Сбор всех уникальных исходных путей
    const sourcePaths = new Set([defaultInputPath]);
    for (const p of phrases) {
      if (p.sourceAudioPath) sourcePaths.add(p.sourceAudioPath);
    }

    const tempDir = path.dirname(outputAudioPath);
    await fs.promises.mkdir(tempDir, { recursive: true });

    // 2. Декодирование исходников во временные .raw файлы на диск через FFmpeg (без выделения RAM)
    const rawPcmFilesMap = new Map();
    const tempRawFilesToCleanup = [];

    try {
      for (const src of sourcePaths) {
        if (fs.existsSync(src)) {
          const tempRawPath = path.join(tempDir, `temp_src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.raw`);
          try {
            await this.decodeToPcmFile(src, tempRawPath, sampleRate, channels);
            rawPcmFilesMap.set(src, tempRawPath);
            tempRawFilesToCleanup.push(tempRawPath);
          } catch (decErr) {
            log.warn(`[AutoTiming] Ошибка конвертации в PCM ${src}:`, decErr.message);
          }
        }
      }

      const defaultRawPath = rawPcmFilesMap.get(defaultInputPath);
      if (!defaultRawPath && rawPcmFilesMap.size === 0) {
        throw new Error(`Не удалось декодировать аудиоисточники для ${outputAudioPath}`);
      }

      // Открываем файловые дескрипторы для быстрого прямого позиционирования без чтения в RAM
      const fdsMap = new Map();
      for (const [src, rawP] of rawPcmFilesMap.entries()) {
        try {
          const fd = fs.openSync(rawP, 'r');
          const size = fs.statSync(rawP).size;
          fdsMap.set(src, { fd, size });
        } catch (e) {}
      }

      const defaultFdInfo = fdsMap.get(defaultInputPath);
      const defaultDurationSec = defaultFdInfo ? (defaultFdInfo.size / bytesPerSec) : 0;

      // 3. Загрузка карты громкостей
      const searchDirs = [
        options.targetDir,
        path.dirname(outputAudioPath),
        path.dirname(path.dirname(outputAudioPath)),
        options.workingDir
      ].filter(Boolean);
      const { volumeMap, rolesMap } = this.loadPhraseVolumeMap(searchDirs);

      // 4. Определение общей длительности трека
      let maxSec = defaultDurationSec;
      for (const p of phrases) {
        if (p.targetEndSec > maxSec) maxSec = p.targetEndSec;
      }
      if (options.timingMetadata && Array.isArray(options.timingMetadata.phrases)) {
        for (const p of options.timingMetadata.phrases) {
          if (p.endSec > maxSec) maxSec = p.endSec;
        }
      }
      if (options.totalDurationSec && options.totalDurationSec > maxSec) {
        maxSec = options.totalDurationSec;
      }
      maxSec = Math.max(maxSec + 1.0, 5.0);

      // Проверка на непрерывную таймлайн-запись:
      // При экспорте из тайминга или явном рендеринге из оттаймленных клипов (renderFromClips / exactTimelineRender)
      // ВСЕГДА рендерится чистый мастер-трек из готовых оттаймленных фраз (isTimelineTrack = false).
      let isTimelineTrack = false;
      if (!options.renderFromClips && !options.exactTimelineRender && options.preserveBackgroundAudio) {
        if (defaultDurationSec >= 45.0) {
          isTimelineTrack = true;
        } else if (phrases.length > 0) {
          const span = Math.max(...phrases.map(p => p.sourceEndSec)) - Math.min(...phrases.map(p => p.sourceStartSec));
          if (span > 40.0) isTimelineTrack = true;
        }
      }

      // 5. Инициализация временного выходного файла
      const tempOut = path.join(tempDir, `temp_timed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.wav`);
      const outFd = fs.openSync(tempOut, 'w');

      // Резервируем место под 44-байтный заголовок WAV
      const initialHeader = this.createWavHeader(0, sampleRate, channels, 16);
      fs.writeSync(outFd, initialHeader, 0, 44, 0);

      // 6. Потоковый рендеринг чанками по 10 секунд (всего 1.92 МБ RAM на чанк)
      const CHUNK_DURATION_SEC = 10.0;
      const samplesPerChunk = Math.round(CHUNK_DURATION_SEC * sampleRate);
      const bytesPerChunk = samplesPerChunk * bytesPerSampleFrame;
      const totalChunks = Math.ceil(maxSec / CHUNK_DURATION_SEC);
      const chunkBuffer = Buffer.alloc(bytesPerChunk, 0);

      // Параметры атак и затуханий:
      // Pre-roll: 90мс (защита 'П','Б','Т'), Fade-in: 10мс (Hann window)
      // Post-roll: 180мс (хвост реверберации комнаты), Fade-out: 15мс (Hann window)
      const safetyPreSec = 0.090; // 90 ms
      const safetyPostSec = 0.180; // 180 ms
      const fadeSamplesIn = Math.min(480, Math.floor(sampleRate * 0.010)); // 10 ms = 480 samples
      const fadeSamplesOut = Math.min(720, Math.floor(sampleRate * 0.015)); // 15 ms = 720 samples

      let totalPcmBytesWritten = 0;

      for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
        const chunkStartSec = cIdx * CHUNK_DURATION_SEC;
        const chunkEndSec = Math.min(maxSec, chunkStartSec + CHUNK_DURATION_SEC);
        const currentChunkSec = chunkEndSec - chunkStartSec;
        const currentChunkBytes = Math.round(currentChunkSec * sampleRate) * bytesPerSampleFrame;

        if (currentChunkBytes <= 0) break;

        // Очищаем чанк буфер
        chunkBuffer.fill(0, 0, currentChunkBytes);

        // Шаг А: Если таймлайн-дорожка, читаем базовый непрерывный PCM из файла
        if (isTimelineTrack && defaultFdInfo) {
          const startByteOffset = Math.floor(chunkStartSec * bytesPerSec);
          const availableBytes = Math.max(0, Math.min(currentChunkBytes, defaultFdInfo.size - startByteOffset));
          if (availableBytes > 0) {
            fs.readSync(defaultFdInfo.fd, chunkBuffer, 0, availableBytes, startByteOffset);
          }
        }

        // Шаг Б: Зануление областей заменяемых правок (start - 0.09s до end + 0.18s) в таймлайн-дорожках
        if (isTimelineTrack) {
          for (const p of phrases) {
            if (p.isReplacedByFix || (p.collisionResolved && Math.abs(p.shiftDeltaSec) > 0.03)) {
              const oldStartSec = Math.max(0, (p.oldTargetStartSec ?? p.sourceStartSec) - safetyPreSec);
              const oldEndSec = (p.oldTargetEndSec ?? p.sourceEndSec) + safetyPostSec;

              if (oldEndSec > chunkStartSec && oldStartSec < chunkEndSec) {
                const muteLocalStartSec = Math.max(0, oldStartSec - chunkStartSec);
                const muteLocalEndSec = Math.min(currentChunkSec, oldEndSec - chunkStartSec);
                const muteStartSample = Math.floor(muteLocalStartSec * sampleRate);
                const muteEndSample = Math.min(samplesPerChunk, Math.ceil(muteLocalEndSec * sampleRate));

                for (let s = muteStartSample; s < muteEndSample; s++) {
                  const off = s * bytesPerSampleFrame;
                  if (off + 4 <= currentChunkBytes) {
                    chunkBuffer.writeInt16LE(0, off);
                    chunkBuffer.writeInt16LE(0, off + 2);
                  }
                }
              }
            }
          }
        }

        // Шаг В: Наложение фраз, пересекающих текущий чанк
        for (const p of phrases) {
          if (isTimelineTrack && !p.isReplacedByFix && (!p.collisionResolved || Math.abs(p.shiftDeltaSec) <= 0.03)) {
            // Фраза уже находится на своем месте в базовом таймлайн-аудио
            continue;
          }

          const srcFdInfo = fdsMap.get(p.sourceAudioPath || defaultInputPath) || defaultFdInfo;
          if (!srcFdInfo) continue;

          // Расчет исходных границ считывания с учетом доступных пред- и пост-интервалов
          const srcDurationSec = srcFdInfo.size / bytesPerSec;
          const srcStart = typeof p.sourceStartSec === 'number' ? p.sourceStartSec : 0;
          const srcEnd = typeof p.sourceEndSec === 'number' ? p.sourceEndSec : (srcStart + (p.durationSec || 1.0));
          const trgStart = typeof p.targetStartSec === 'number' ? p.targetStartSec : 0;

          const availablePreSec = Math.max(0, Math.min(safetyPreSec, srcStart, trgStart));
          const availablePostSec = Math.max(0, Math.min(safetyPostSec, srcDurationSec - srcEnd));

          const rawSrcStartSec = srcStart - availablePreSec;
          const rawSrcEndSec = srcEnd + availablePostSec;
          const totalPhraseDuration = Math.max(0, rawSrcEndSec - rawSrcStartSec);
          const totalPhraseSamples = Math.floor(totalPhraseDuration * sampleRate);
          if (totalPhraseSamples <= 0) continue;

          const phraseTargetStart = trgStart - availablePreSec;
          const phraseTargetEnd = phraseTargetStart + totalPhraseDuration;

          // Проверяем пересечение с текущим чанком
          if (phraseTargetEnd <= chunkStartSec || phraseTargetStart >= chunkEndSec) {
            continue;
          }

          // Расчет относительного смещения внутри чанка
          const overlapStartSec = Math.max(chunkStartSec, phraseTargetStart);
          const overlapEndSec = Math.min(chunkEndSec, phraseTargetEnd);

          const phraseSampleOffsetStart = Math.max(0, Math.floor((overlapStartSec - phraseTargetStart) * sampleRate));
          const phraseSampleOffsetEnd = Math.min(totalPhraseSamples, Math.ceil((overlapEndSec - phraseTargetStart) * sampleRate));
          const samplesToProcess = phraseSampleOffsetEnd - phraseSampleOffsetStart;
          if (samplesToProcess <= 0) continue;

          const bytesToRead = samplesToProcess * bytesPerSampleFrame;
          const srcStartByte = Math.floor(rawSrcStartSec * bytesPerSec) + (phraseSampleOffsetStart * bytesPerSampleFrame);

          if (srcStartByte >= srcFdInfo.size) continue;
          const actualBytesToRead = Math.min(bytesToRead, srcFdInfo.size - srcStartByte);

          // Временный буфер для одной обрабатываемой фразы (обычно 10-100 КБ)
          const phraseTempBuf = Buffer.alloc(actualBytesToRead);
          fs.readSync(srcFdInfo.fd, phraseTempBuf, 0, actualBytesToRead, srcStartByte);

          // Определение множителя громкости
          let volPct = p.volumePercent;
          if (volPct === undefined || volPct === null) {
            if (p.id && volumeMap[p.id] !== undefined) {
              volPct = volumeMap[p.id];
            } else if (p.characterName && rolesMap[p.characterName] !== undefined) {
              volPct = rolesMap[p.characterName];
            } else if (p.dubberNick && rolesMap[p.dubberNick] !== undefined) {
              volPct = rolesMap[p.dubberNick];
            } else {
              volPct = 100;
            }
          }
          const volScale = Math.max(0, Math.min(2.0, (volPct ?? 100) / 100.0));

          const curFadeIn = Math.min(fadeSamplesIn, Math.floor(totalPhraseSamples / 8));
          const curFadeOut = Math.min(fadeSamplesOut, Math.floor(totalPhraseSamples / 6));

          const chunkLocalStartSample = Math.max(0, Math.floor((overlapStartSec - chunkStartSec) * sampleRate));

          for (let s = 0; s < samplesToProcess; s++) {
            const globalPhraseSampleIdx = phraseSampleOffsetStart + s;
            const srcOffset = s * bytesPerSampleFrame;
            const dstOffset = (chunkLocalStartSample + s) * bytesPerSampleFrame;

            if (srcOffset + 4 > actualBytesToRead || dstOffset + 4 > currentChunkBytes) break;

            // S-образное окно (Hann window) для атак и затуханий:
            // Вход: sin^2(pi*t / 2T), Выход: cos^2(pi*t / 2T)
            let fade = 1.0;
            if (curFadeIn > 0 && globalPhraseSampleIdx < curFadeIn) {
              fade = 0.5 * (1 - Math.cos((Math.PI * globalPhraseSampleIdx) / curFadeIn));
            } else if (curFadeOut > 0 && globalPhraseSampleIdx > totalPhraseSamples - curFadeOut) {
              const outIdx = globalPhraseSampleIdx - (totalPhraseSamples - curFadeOut);
              fade = 0.5 * (1 + Math.cos((Math.PI * outIdx) / curFadeOut));
            }

            const rawLeft = phraseTempBuf.readInt16LE(srcOffset);
            const rawRight = phraseTempBuf.readInt16LE(srcOffset + 2);
            const leftSample = Math.round(rawLeft * fade * volScale);
            const rightSample = Math.round(rawRight * fade * volScale);

            if (isTimelineTrack) {
              chunkBuffer.writeInt16LE(leftSample, dstOffset);
              chunkBuffer.writeInt16LE(rightSample, dstOffset + 2);
            } else {
              const curLeft = chunkBuffer.readInt16LE(dstOffset);
              const curRight = chunkBuffer.readInt16LE(dstOffset + 2);
              const mixedLeft = Math.max(-32768, Math.min(32767, curLeft + leftSample));
              const mixedRight = Math.max(-32768, Math.min(32767, curRight + rightSample));
              chunkBuffer.writeInt16LE(mixedLeft, dstOffset);
              chunkBuffer.writeInt16LE(mixedRight, dstOffset + 2);
            }
          }
        }

        // Записываем срендеренный чанк на диск
        fs.writeSync(outFd, chunkBuffer, 0, currentChunkBytes);
        totalPcmBytesWritten += currentChunkBytes;
      }

      // 7. Обновляем итоговый 44-байтный заголовок WAV с точным размером
      const finalHeader = this.createWavHeader(totalPcmBytesWritten, sampleRate, channels, 16);
      fs.writeSync(outFd, finalHeader, 0, 44, 0);

      // Закрываем дескриптор записи
      fs.closeSync(outFd);

      // Закрываем дескрипторы исходников
      for (const info of fdsMap.values()) {
        try { fs.closeSync(info.fd); } catch (e) {}
      }

      // 8. Финализация формата вывода (WAV / MP3 / FLAC / AAC)
      const ext = (path.extname(outputAudioPath) || '.wav').toLowerCase();
      if (ext === '.wav') {
        if (fs.existsSync(outputAudioPath)) {
          await fs.promises.unlink(outputAudioPath);
        }
        await fs.promises.rename(tempOut, outputAudioPath);
        return outputAudioPath;
      } else {
        return new Promise((resolve, reject) => {
          let cmd = ffmpeg(tempOut)
            .noVideo()
            .audioChannels(channels)
            .audioFrequency(sampleRate);

          let audioCodec = 'pcm_s16le';
          if (ext === '.mp3') audioCodec = 'libmp3lame';
          else if (ext === '.flac') audioCodec = 'flac';
          else if (ext === '.ogg') audioCodec = 'libvorbis';
          else if (ext === '.m4a' || ext === '.aac') audioCodec = 'aac';
          cmd.audioCodec(audioCodec);

          const encodeTemp = path.join(tempDir, `temp_enc_${Date.now()}${ext}`);
          cmd.output(encodeTemp);

          cmd.on('end', async () => {
            try {
              if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut);
              if (fs.existsSync(outputAudioPath)) await fs.promises.unlink(outputAudioPath);
              await fs.promises.rename(encodeTemp, outputAudioPath);
              resolve(outputAudioPath);
            } catch (e) {
              reject(e);
            }
          });

          cmd.on('error', (err) => {
            try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut); } catch (e) {}
            try { if (fs.existsSync(encodeTemp)) fs.unlinkSync(encodeTemp); } catch (e) {}
            reject(err);
          });

          cmd.run();
        });
      }
    } finally {
      // Удаляем временные .raw файлы
      for (const tempRaw of tempRawFilesToCleanup) {
        try {
          if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw);
        } catch (e) {}
      }
    }
  }

  /**
   * Сборка и экспорт оттаймленных аудиодорожек с отчетом в целевую папку.
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

    const rawDir = path.join(targetDir, '00_исходные');
    if (fs.existsSync(targetDir)) {
      try { fs.mkdirSync(rawDir, { recursive: true }); } catch (e) {}
    }

    for (let tIdx = 0; tIdx < tracksToRender.length; tIdx++) {
      const item = tracksToRender[tIdx];
      const { track, phrases } = item;
      const nick = track.dubberNick || 'Даббер';
      const cleanNick = String(nick)
        .replace(/\[.*\]/g, '')
        .replace(/_?(дорожка|слой|take|layer|фикс|fix)\s*\d*/gi, '')
        .replace(/[^\w\d\s\u0400-\u04FF_-]/g, '')
        .trim() || 'dubber';

      const sameNickTracks = tracksToRender.filter(t => (t.track.dubberNick || 'Даббер') === nick);
      const isMultiTrack = sameNickTracks.length > 1;
      const subIdx = track.subTrackIndex || (sameNickTracks.indexOf(item) + 1);
      const trackSuffix = isMultiTrack ? `_${subIdx}` : '';

      const outFilename = `00_timed_${cleanNick}${trackSuffix}.wav`;
      const outFilePath = path.join(targetDir, outFilename);
      const outRawFilePath = path.join(rawDir, outFilename);

      const trackProgressPercent = 70 + Math.round(((tIdx + 1) / tracksToRender.length) * 28);
      const logMsg = `Сборка мастер-дорожки [${tIdx + 1}/${tracksToRender.length}]: «${nick}» (${track.characterName}) — фраз: ${phrases.length}`;
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
        try { await fs.promises.copyFile(outFilePath, outRawFilePath); } catch (e) {}
        renderedTracks.push({
          dubberNick: nick,
          characterName: track.characterName,
          outputPath: outFilePath,
          phrasesCount: 0
        });
        continue;
      }

      try {
        await this.assembleMultiSourceTrack(track.trackPath, phrases, outFilePath, { ...options, targetDir });
        try { await fs.promises.copyFile(outFilePath, outRawFilePath); } catch (e) {}
        renderedTracks.push({
          dubberNick: nick,
          characterName: track.characterName,
          outputPath: outFilePath,
          phrasesCount: phrases.length
        });
        if (onLog) onLog(`Готово: ${outFilename}`);
      } catch (renderErr) {
        log.error(`[AutoTiming Render] Ошибка потоковой сборки для ${nick}, резервное копирование оригинала:`, renderErr);
        if (onLog) onLog(`[Предупреждение] Ошибка сборки ${nick}: ${renderErr.message}. Скопирован оригинал.`, 'warn');
        await fs.promises.copyFile(track.trackPath, outFilePath);
        try { await fs.promises.copyFile(outFilePath, outRawFilePath); } catch (e) {}
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

    // Clean up temporary slice micro-files from export directory and 00_исходные
    const cleanupDirs = [targetDir, rawDir];
    for (const cDir of cleanupDirs) {
      if (fs.existsSync(cDir)) {
        try {
          const files = fs.readdirSync(cDir);
          for (const f of files) {
            const lower = f.toLowerCase();
            if ((lower.includes('slice') || lower.startsWith('temp_') || lower.endsWith('.raw')) && !f.startsWith('00_timed_')) {
              try { fs.unlinkSync(path.join(cDir, f)); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    reportContent += `\n============================================================\n` +
      `Все дорожки экспортированы с оттаймленными фразами и чистыми фиксами без хвостов.\n`;

    await fs.promises.writeFile(reportPath, reportContent, 'utf-8');
    log.info(`[AutoTiming] Отчет по таймингу и фиксам сохранен в: ${reportPath}`);
    if (onLog) onLog(`Отчет по таймингу и фиксам сохранен в: ИНФО_О_ФИКСАХ_И_АВТОТАЙМИНГЕ.txt`);

    // Генерация timing_metadata.json & phrase_volume_map.json
    try {
      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        baseVideoName,
        rolesVolumeMap: tracksToRender.reduce((acc, tr) => {
          const nick = tr.track?.dubberNick || 'Даббер';
          const roleName = tr.track?.characterName || nick;
          const volPct = tr.track?.volumePercent || 100;
          acc[roleName] = volPct;
          acc[nick] = volPct;
          return acc;
        }, {}),
        phrases: tracksToRender.flatMap(tr => {
          const nick = tr.track?.dubberNick || 'Даббер';
          const roleName = tr.track?.characterName || nick;
          return (tr.phrases || []).map(p => {
            const volPct = p.volumePercent || tr.track?.volumePercent || 100;
            return {
              id: p.id || `phrase_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              dubberNick: nick,
              characterName: roleName,
              startSec: Number((p.targetStartSec || p.sourceStartSec || 0).toFixed(2)),
              endSec: Number((p.targetEndSec || p.sourceEndSec || 0).toFixed(2)),
              text: p.subText || '',
              volumePercent: volPct,
              volumeGainDb: Number((20 * Math.log10(Math.max(10, volPct) / 100)).toFixed(2))
            };
          });
        })
      };

      const timingJsonPath = path.join(targetDir, 'timing_metadata.json');
      const volumeJsonPath = path.join(targetDir, 'phrase_volume_map.json');
      const analysisJsonPath = path.join(targetDir, 'timing_project.analysis.json');
      await fs.promises.writeFile(timingJsonPath, JSON.stringify(timingMetadata, null, 2), 'utf-8');
      await fs.promises.writeFile(volumeJsonPath, JSON.stringify(timingMetadata, null, 2), 'utf-8');
      await fs.promises.writeFile(analysisJsonPath, JSON.stringify(timingMetadata, null, 2), 'utf-8');
      log.info(`[AutoTiming] Сохранены timing_metadata.json, phrase_volume_map.json и timing_project.analysis.json в: ${targetDir}`);
      if (onLog) onLog(`Карта громкостей фраз сохранена в сведение: timing_metadata.json`);
    } catch (metaErr) {
      log.warn(`[AutoTiming] Предупреждение при сохранении timing_metadata.json:`, metaErr);
    }

    return {
      renderedTracks,
      reportPath
    };
  }
}

module.exports = AutoTimingService;
