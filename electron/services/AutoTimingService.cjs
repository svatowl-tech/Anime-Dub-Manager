const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('electron-log');
const { getRawSubtitles } = require('./subtitleService.cjs');
const { detectSpeechIntervals, addProcess, getFfmpegPath } = require('./ffmpegService.cjs');
const ffmpeg = require('fluent-ffmpeg');
const {
  TIMING_RULES,
  getMaxSafeShiftSec,
  computeTargetClipStartSec,
  isPhraseTimingNotRequired: sharedIsPhraseTimingNotRequired,
  isIntentionalOverlapDecision,
  evaluateSoftTimeFit,
} = require('../lib/TimingRulesConfig.cjs');

/**
 * Высокоточная конвертация Float32 сэмпла в 16-битный PCM (Int16LE)
 * Обеспечивает 100% линейную прозрачную передачу исходного звука без искажений,
 * лимитеров и сатурации.
 */
function floatToPcm16(fVal) {
  if (Number.isNaN(fVal)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(fVal * 32768.0)));
}

/**
 * Нормализация строк для надежного сопоставления никнеймов и имен персонажей.
 */
function normalizeName(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\[\]\(\)\{\}\-_.,!?'"~`@#$%^&*+=:;\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompactName(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\[\]\(\)\{\}\-_.,!?'"~`@#$%^&*+=:;\/\\\s]/g, '')
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

  const cCompact = normalizeCompactName(candidate);
  const tCompact = normalizeCompactName(target);
  if (cCompact && tCompact && cCompact === tCompact) return true;

  const cWords = cNorm.split(' ').filter(Boolean);
  const tWords = tNorm.split(' ').filter(Boolean);

  // Точное совпадение отдельного слова (защита от ложного попадания коротких ников типа «РИ» внутрь «Сидзури»)
  if (tWords.length === 1 && cWords.includes(tWords[0])) return true;
  if (cWords.length === 1 && tWords.includes(cWords[0])) return true;

  for (const cw of cWords) {
    if (cw.length >= 3 && tWords.includes(cw)) return true;
  }

  // Подстрочное совпадение разрешаем только для достаточно длинных имен (>= 4 символов)
  // и только на границе слова / при близкой длине, чтобы короткие ники не перехватывали чужих персонажей
  const shorterLen = Math.min(cCompact.length, tCompact.length);
  if (shorterLen >= 4) {
    const cBounded = ` ${cNorm} `;
    const tBounded = ` ${tNorm} `;
    if (cBounded.includes(` ${tNorm} `) || tBounded.includes(` ${cNorm} `)) {
      return true;
    }
    if (shorterLen >= 5 && (cCompact.includes(tCompact) || tCompact.includes(cCompact))) {
      return true;
    }
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
   * Детекция речевых интервалов Silero VAD v5 с автоматическим отказоустойчивым фоллбэком на FFmpeg silencedetect.
   */
  static async detectSpeechIntervals(filePath, options = {}) {
    try {
      const { detectSpeechWithSileroVad } = require('./SileroVadService.cjs');
      return await detectSpeechWithSileroVad(filePath, options, getFfmpegPath() || 'ffmpeg');
    } catch (err) {
      log.warn(`[AutoTiming] Silero VAD failed, falling back to FFmpeg silencedetect: ${err.message}`);
      return await detectSpeechIntervals(filePath, options);
    }
  }

  /**
   * Выполнение принудительного пословного/пофразового выравнивания через Aeneas sidecar
   * с перехватом ошибок и отказоустойчивым фоллбэком на сопоставление по Whisper / VAD.
   */
  static async alignTrackWithSubtitles(trackPath, charLines, options = {}) {
    if (!trackPath || !fs.existsSync(trackPath) || !charLines || charLines.length === 0) {
      return null;
    }

    const subtitlesPayload = charLines.map((line, idx) => ({
      id: String(line.id ?? line.rawLineIndex ?? idx),
      text: line.text || '',
      startSec: line.startSec ?? parseTimeToSeconds(line.start),
      endSec: line.endSec ?? parseTimeToSeconds(line.end)
    }));

    let tempSubJsonPath = null;
    let tempOutPath = null;

    try {
      const AudioNeuralService = require('./AudioNeuralService.cjs');
      const tmpDir = os.tmpdir();
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      tempSubJsonPath = path.join(tmpDir, `adm_aeneas_sub_${uniqueSuffix}.json`);
      tempOutPath = path.join(tmpDir, `adm_aeneas_out_${uniqueSuffix}.json`);

      fs.writeFileSync(tempSubJsonPath, JSON.stringify(subtitlesPayload, null, 2), 'utf8');

      log.info(`[AutoTiming] Попытка Aeneas alignment для ${path.basename(trackPath)} (${subtitlesPayload.length} реплик)...`);

      const result = await AudioNeuralService.aeneasAlign({
        inputPath: trackPath,
        subtitlesJsonPath: tempSubJsonPath,
        outputPath: tempOutPath,
        language: options.language || 'ru'
      });

      let alignedResults = null;
      if (fs.existsSync(tempOutPath)) {
        try {
          const rawOut = fs.readFileSync(tempOutPath, 'utf8');
          alignedResults = JSON.parse(rawOut);
        } catch (e) {}
      }

      if (!alignedResults && Array.isArray(result)) {
        alignedResults = result;
      }

      if (Array.isArray(alignedResults) && alignedResults.length > 0) {
        log.info(`[AutoTiming] Aeneas alignment успешно выравнял ${alignedResults.length} реплик.`);
        return alignedResults;
      }

      throw new Error('Aeneas output invalid or empty');
    } catch (err) {
      log.warn(`[AutoTiming] Aeneas alignment unavailable, fallback to Whisper matching: ${err.message}`);
      return null;
    } finally {
      try { if (tempSubJsonPath && fs.existsSync(tempSubJsonPath)) fs.unlinkSync(tempSubJsonPath); } catch (e) {}
      try { if (tempOutPath && fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath); } catch (e) {}
    }
  }

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

    const getEffectiveDubberId = (assignment) =>
      assignment?.substituteId || assignment?.dubberId || null;

    const findParticipantById = (id) => {
      if (!id) return null;
      return participantsData.find(p => String(p.id) === String(id)) || null;
    };

    const findParticipantByNick = (rawNick) => {
      if (!rawNick) return null;
      const targetCompact = normalizeCompactName(rawNick);
      if (!targetCompact) return null;
      return participantsData.find(p =>
        normalizeCompactName(p.nickname) === targetCompact ||
        normalizeCompactName(p.name) === targetCompact
      ) || null;
    };

    const resolveAssignmentsForDubber = (dubberId, dubberNick) => {
      const matched = [];
      for (const a of (existingAssignments || [])) {
        const effId = getEffectiveDubberId(a);
        if (dubberId && effId && String(effId) === String(dubberId)) {
          matched.push(a);
          continue;
        }
        if (dubberNick) {
          const p = findParticipantById(effId);
          const aNick = a.substitute?.nickname || a.dubber?.nickname || p?.nickname || p?.name || '';
          if (aNick && normalizeCompactName(aNick) === normalizeCompactName(dubberNick)) {
            matched.push(a);
          }
        }
      }
      return matched;
    };

    const buildAggregatedRoleInfo = (assignmentsList, preferredCharName, filenameCandidates = []) => {
      const uniqueCharNames = [];
      const addChar = (cn) => {
        if (!cn || typeof cn !== 'string') return;
        const canonical = aliases[cn] || cn;
        if (!uniqueCharNames.includes(canonical)) {
          uniqueCharNames.push(canonical);
        }
      };

      // Если имя персонажа явно присутствует в названии файла — ставим его первым
      if (filenameCandidates.length > 0) {
        for (const a of assignmentsList) {
          if (a.characterName && filenameCandidates.some(c => isNameMatch(c, a.characterName))) {
            addChar(a.characterName);
          }
        }
      }
      if (preferredCharName) addChar(preferredCharName);
      for (const a of assignmentsList) {
        if (a.characterName) addChar(a.characterName);
      }

      const combinedLines = [];
      const seenLineKeys = new Set();
      for (const cName of uniqueCharNames) {
        let charInfo = charactersMap.get(cName);
        if (!charInfo) {
          for (const [mapChar, info] of charactersMap.entries()) {
            if (isNameMatch(cName, mapChar)) {
              charInfo = info;
              break;
            }
          }
        }
        if (charInfo && Array.isArray(charInfo.lines)) {
          for (const ln of charInfo.lines) {
            const key = `${ln.id ?? ''}_${ln.rawLineIndex ?? ''}_${ln.startSec}_${ln.endSec}_${ln.text || ''}`;
            if (!seenLineKeys.has(key)) {
              seenLineKeys.add(key);
              combinedLines.push(ln);
            }
          }
        }
      }
      combinedLines.sort((a, b) => a.startSec - b.startSec);

      const fixTargets = [];
      for (const a of assignmentsList) {
        fixTargets.push(...extractFixTargets(a));
      }
      fixTargets.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

      return {
        characterNames: uniqueCharNames,
        characterName: uniqueCharNames.join(', ') || preferredCharName || 'Персонаж',
        lines: combinedLines,
        fixTargets
      };
    };

    const resolveSubTrackIndex = (track) => {
      if (track.subTrackIndex && Number(track.subTrackIndex) > 0) return Number(track.subTrackIndex);
      if (track.trackNumber && Number(track.trackNumber) > 0) return Number(track.trackNumber);
      const m = path.basename(track.path || '').match(/(?:дорожка|слой|track|take|layer)[_\s-]*(\d+)/i);
      return m ? parseInt(m[1], 10) : undefined;
    };

    // 1. Приоритетное сопоставление по явным метаданным дорожки (assignmentId / dubberId / uploadedById / dubberNick)
    for (const track of (audioFiles || [])) {
      if (!track || !track.path || usedTrackPaths.has(track.path)) continue;
      const isFix = isTrackFix(track);
      const candidates = extractNicknamesFromFilename(track.path);

      let resolvedDubberId = track.dubberId || track.uploadedById || track.participantId || null;
      let resolvedParticipant = findParticipantById(resolvedDubberId);
      let resolvedNick = track.dubberNick || track.uploadedBy?.nickname || resolvedParticipant?.nickname || resolvedParticipant?.name || '';
      if (!resolvedParticipant && resolvedNick) {
        resolvedParticipant = findParticipantByNick(resolvedNick);
        if (resolvedParticipant && !resolvedDubberId) {
          resolvedDubberId = resolvedParticipant.id;
        }
      }

      let relatedAssignments = [];
      if (track.assignmentId) {
        const directAssign = (existingAssignments || []).find(a => String(a.id) === String(track.assignmentId));
        if (directAssign) {
          if (!resolvedDubberId) resolvedDubberId = getEffectiveDubberId(directAssign);
          if (!resolvedParticipant && resolvedDubberId) resolvedParticipant = findParticipantById(resolvedDubberId);
          if (!resolvedNick) {
            resolvedNick = directAssign.substitute?.nickname || directAssign.dubber?.nickname || resolvedParticipant?.nickname || resolvedParticipant?.name || '';
          }
          relatedAssignments.push(directAssign);
        }
      }

      const dubberAssignments = resolveAssignmentsForDubber(resolvedDubberId, resolvedNick);
      for (const da of dubberAssignments) {
        if (!relatedAssignments.includes(da)) relatedAssignments.push(da);
      }

      if (relatedAssignments.length > 0 || (resolvedDubberId && resolvedNick)) {
        // Если назначений не нашлось по ID, пробуем найти персонажа по имени файла
        let preferredChar = track.characterName || null;
        if (!preferredChar && relatedAssignments.length === 0) {
          for (const [cName] of charactersMap.entries()) {
            if (candidates.some(c => isNameMatch(c, cName))) {
              preferredChar = cName;
              break;
            }
          }
        }
        const roleInfo = buildAggregatedRoleInfo(relatedAssignments, preferredChar, candidates);
        usedTrackPaths.add(track.path);
        if (!isFix) roleInfo.characterNames.forEach(c => usedCharacters.add(c));

        matchedTracks.push({
          trackPath: track.path,
          trackId: track.id || path.basename(track.path),
          dubberId: resolvedDubberId || null,
          dubberNick: resolvedNick || resolvedParticipant?.nickname || 'Даббер',
          characterName: roleInfo.characterName,
          subTrackIndex: resolveSubTrackIndex(track),
          isFix,
          type: isFix ? 'FIXES' : 'DUBBER_FILE',
          matchMethod: 'assignment_and_nick',
          confidence: 1.0,
          lines: roleInfo.lines,
          fixTargetLines: isFix ? roleInfo.fixTargets : []
        });
      }
    }

    // 2. Сопоставление по персонажу в имени файла -> назначению даббера (ПРИОРИТЕТНЕЕ, чем поиск короткого ника по подстроке!)
    for (const track of (audioFiles || [])) {
      if (!track || !track.path || usedTrackPaths.has(track.path)) continue;
      const candidates = extractNicknamesFromFilename(track.path);
      const isFix = isTrackFix(track);

      // 2a. Ищем назначение, чей персонаж указан в названии файла (например, dub_...Сидзури Мугино...)
      let matchedAssignmentByChar = null;
      for (const a of (existingAssignments || [])) {
        if (a.characterName && candidates.some(c => isNameMatch(c, a.characterName))) {
          matchedAssignmentByChar = a;
          break;
        }
      }

      if (matchedAssignmentByChar) {
        const effDubberId = getEffectiveDubberId(matchedAssignmentByChar);
        const participant = findParticipantById(effDubberId);
        const nick = track.dubberNick || matchedAssignmentByChar.substitute?.nickname || matchedAssignmentByChar.dubber?.nickname || participant?.nickname || participant?.name || 'Даббер';
        const allDubberAssignments = resolveAssignmentsForDubber(effDubberId, nick);
        if (!allDubberAssignments.includes(matchedAssignmentByChar)) {
          allDubberAssignments.unshift(matchedAssignmentByChar);
        }
        const roleInfo = buildAggregatedRoleInfo(allDubberAssignments, matchedAssignmentByChar.characterName, candidates);

        usedTrackPaths.add(track.path);
        if (!isFix) roleInfo.characterNames.forEach(c => usedCharacters.add(c));

        matchedTracks.push({
          trackPath: track.path,
          trackId: track.id || path.basename(track.path),
          dubberId: effDubberId,
          dubberNick: nick,
          characterName: roleInfo.characterName,
          subTrackIndex: resolveSubTrackIndex(track),
          isFix,
          type: isFix ? 'FIXES' : 'DUBBER_FILE',
          matchMethod: 'filename_character_assignment',
          confidence: 0.98,
          lines: roleInfo.lines,
          fixTargetLines: isFix ? roleInfo.fixTargets : []
        });
        continue;
      }

      // 2b. Сопоставление по никнейму даббера в названии файла (строгий матч, без ложных подстрок)
      let matchedParticipant = null;
      for (const p of participantsData) {
        if (candidates.some(c => isNameMatch(c, p.nickname) || isNameMatch(c, p.name))) {
          matchedParticipant = p;
          break;
        }
      }

      if (matchedParticipant) {
        const dubberAssignments = resolveAssignmentsForDubber(matchedParticipant.id, matchedParticipant.nickname);
        let preferredChar = null;
        for (const [cName] of charactersMap.entries()) {
          if (!usedCharacters.has(cName) || isFix) {
            if (candidates.some(c => isNameMatch(c, cName)) || isNameMatch(matchedParticipant.nickname, cName)) {
              preferredChar = cName;
              break;
            }
          }
        }
        if (dubberAssignments.length > 0 || preferredChar) {
          const roleInfo = buildAggregatedRoleInfo(dubberAssignments, preferredChar, candidates);
          usedTrackPaths.add(track.path);
          if (!isFix) roleInfo.characterNames.forEach(c => usedCharacters.add(c));

          matchedTracks.push({
            trackPath: track.path,
            trackId: track.id || path.basename(track.path),
            dubberId: matchedParticipant.id,
            dubberNick: matchedParticipant.nickname,
            characterName: roleInfo.characterName,
            subTrackIndex: resolveSubTrackIndex(track),
            isFix,
            type: isFix ? 'FIXES' : 'DUBBER_FILE',
            matchMethod: 'filename_nick_matched',
            confidence: 0.95,
            lines: roleInfo.lines,
            fixTargetLines: isFix ? roleInfo.fixTargets : []
          });
          continue;
        }
      }

      // 3. Сопоставление имени файла напрямую с персонажем из субтитров
      let matchedDirectChar = null;
      for (const [cName] of charactersMap.entries()) {
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
        const relatedAssign = (existingAssignments || []).find(a =>
          isNameMatch(a.characterName, matchedDirectChar) ||
          (track.uploadedById && String(getEffectiveDubberId(a)) === String(track.uploadedById))
        );
        const effDubberId = relatedAssign ? getEffectiveDubberId(relatedAssign) : (track.dubberId || track.uploadedById || null);
        const p = findParticipantById(effDubberId);
        const resolvedNick = track.dubberNick || relatedAssign?.substitute?.nickname || relatedAssign?.dubber?.nickname || p?.nickname || candidates[0] || matchedDirectChar;
        const fixTargetLines = isFix ? extractFixTargets(relatedAssign) : [];
        matchedTracks.push({
          trackPath: track.path,
          trackId: track.id || path.basename(track.path),
          dubberId: effDubberId,
          dubberNick: resolvedNick,
          characterName: matchedDirectChar,
          subTrackIndex: resolveSubTrackIndex(track),
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

      let nick = track.dubberNick || 'Даббер';
      if (nick === 'Даббер' && (track.dubberId || track.uploadedById)) {
        const p = findParticipantById(track.dubberId || track.uploadedById);
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

      // Enrich tracks with file sizes from disk
      for (const t of actorTracks) {
        if (!t.size && t.trackPath) {
          try { t.size = fs.statSync(t.trackPath).size; } catch (_) {}
        }
      }

      // Separate main tracks and fix tracks strictly by explicit QA type (t.isFix):
      // - Tracks uploaded as DUBBER_FILE (!t.isFix) are always main tracks (supporting 1, 2, or more tracks per dubber).
      // - Tracks uploaded via "Загрузить фикс" (t.isFix) are always fixes.
      // Size comparison is used ONLY on fixes to distinguish:
      //   Type 1: Full-track replacement fix (size comparable to original, >= 75% of main track) -> replaces main track without splicing
      //   Type 2: Partial phrase fix (smaller than original) -> stitched into main track via patchSnippetPath
      const mainTracks = actorTracks.filter(t => !t.isFix);
      const fixTracks = actorTracks.filter(t => t.isFix);

      // Helper to extract explicit track index (e.g. дорожка1, дорожка2, track1, layer2, фикс1, fix2)
      const getTrackNum = (nameOrPath) => {
        const m = String(nameOrPath || '').match(/(?:дорожка|слой|track|take|layer|фикс|fix)[_\s-]*(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
      };

      // СЦЕНАРИЙ 1: У даббера 1 основная дорожка (или только фиксы)
      if (mainTracks.length <= 1) {
        const newestMain = mainTracks[0] || null;

        // Check if ANY of the fix tracks is a full-track replacement (>= 75% size of main)
        const fullFix = fixTracks.slice().reverse().find(f => {
          if (!newestMain) return true;
          const mainSize = newestMain.size || 1;
          const fixSize = f.size || 0;
          return mainSize > 0 && fixSize > 0 && fixSize >= mainSize * 0.75;
        });

        if (fullFix) {
          // Цельный фикс заменяет предыдущую дорожку целиком
          fullFix.isFix = false;
          deduplicatedMatchedTracks.push(fullFix);
        } else if (newestMain) {
          // Тип 2: Фиксы частями (отдельные фразы, меньше оригинала) — все вшиваются в оригинал
          if (fixTracks.length > 0) {
            newestMain.patchSnippetPath = fixTracks[fixTracks.length - 1].trackPath;
            newestMain.patchSnippetPaths = fixTracks.map(f => f.trackPath);
            const combinedFixTargetLines = [];
            for (const fx of fixTracks) {
              if (Array.isArray(fx.fixTargetLines)) {
                combinedFixTargetLines.push(...fx.fixTargetLines);
              }
            }
            if (combinedFixTargetLines.length > 0) {
              newestMain.fixTargetLines = combinedFixTargetLines;
            }
          }
          deduplicatedMatchedTracks.push(newestMain);
        } else if (fixTracks.length > 0) {
          for (let fIdx = 0; fIdx < fixTracks.length; fIdx++) {
            const f = fixTracks[fIdx];
            f.isFix = false;
            f.subTrackIndex = fIdx + 1;
            deduplicatedMatchedTracks.push(f);
          }
        }
        continue;
      }

      // СЦЕНАРИЙ 2: У даббера 2 (или более) основных дорожек
      // Все основные дорожки сохраняются как отдельные дорожки, а фиксы применяются к своей целевой дорожке
      for (let mIdx = 0; mIdx < mainTracks.length; mIdx++) {
        const mainTr = mainTracks[mIdx];
        const trNum = mIdx + 1;

        const assignedFixes = fixTracks.filter(f => {
          if (f.targetTrackId && mainTr.id && f.targetTrackId === mainTr.id) return true;
          const fTrackNum = getTrackNum(f.trackPath);
          if (fTrackNum !== null && fTrackNum === trNum) return true;
          const fName = (f.trackPath || '').toLowerCase();
          if (fName.includes(`дорожка${trNum}`) || fName.includes(`track${trNum}`) || fName.includes(`take${trNum}`) || fName.includes(`_layer${trNum}`) || fName.includes(`фикс${trNum}`) || fName.includes(`fix${trNum}`)) return true;
          if (mIdx === 0 && fixTracks.length === 1 && fTrackNum === null) return true;
          return false;
        });

        const mainSize = mainTr.size || 1;
        const fullFix = assignedFixes.slice().reverse().find(f => {
          const fixSize = f.size || 0;
          return mainSize > 0 && fixSize > 0 && fixSize >= mainSize * 0.75;
        });

        if (fullFix) {
          // Цельный фикс заменяет данную дорожку целиком
          fullFix.isFix = false;
          deduplicatedMatchedTracks.push(fullFix);
        } else if (assignedFixes.length > 0) {
          // Фиксы частями — прикрепляем сниппеты для вшивания
          mainTr.patchSnippetPath = assignedFixes[assignedFixes.length - 1].trackPath;
          mainTr.patchSnippetPaths = assignedFixes.map(f => f.trackPath);
          deduplicatedMatchedTracks.push(mainTr);
        } else {
          deduplicatedMatchedTracks.push(mainTr);
        }
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

  static normalizeSubPhraseText(text) {
    return String(text || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  static isSameSubtitlePhrase(a, b) {
    if (!a || !b) return false;
    const hasRealSubA = a.subId && !String(a.subId).startsWith('track_');
    const hasRealSubB = b.subId && !String(b.subId).startsWith('track_');
    if (hasRealSubA && hasRealSubB && String(a.subId) === String(b.subId)) {
      return true;
    }
    const normA = this.normalizeSubPhraseText(a.subText);
    const normB = this.normalizeSubPhraseText(b.subText);
    if (normA && normB && normA === normB && Math.abs((a.subStartSec || 0) - (b.subStartSec || 0)) <= 0.08) {
      return true;
    }
    return false;
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
   * Поиск пути к отделённому вокалу оригинала (`original_vocals.wav` / `vocals.wav`).
   */
  static resolveOriginalVocalsPath(options = {}, subPath = null) {
    const directCandidates = [
      options.originalVocalsPath,
      options.vocalsPath,
      options.manifest?.sourceFiles?.originalVocals?.path,
      options.episode?.vocalsPath,
      options.episode?.originalVocalsPath,
      options.episode?.stems?.vocalsPath
    ].filter(Boolean);

    for (const cand of directCandidates) {
      try {
        if (typeof cand === 'string' && fs.existsSync(cand)) return cand;
      } catch (e) {}
    }

    const baseDirs = [
      options.workingDir,
      options.targetDir,
      subPath ? path.dirname(subPath) : null,
      options.episode?.rawPath ? path.dirname(options.episode.rawPath) : null
    ].filter(Boolean);

    for (const dir of baseDirs) {
      const staticNames = [
        path.join(dir, 'original_vocals.wav'),
        path.join(dir, 'vocals.wav'),
        path.join(dir, 'Тайминг', 'original_vocals.wav'),
        path.join(dir, 'Тайминг', 'vocals.wav'),
        path.join(dir, '00_исходные', 'original_vocals.wav'),
        path.join(dir, 'stems', 'vocals.wav')
      ];
      for (const sPath of staticNames) {
        try {
          if (fs.existsSync(sPath)) return sPath;
        } catch (e) {}
      }

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const lower = ent.name.toLowerCase();
          if (ent.isFile() && /\.(wav|flac|mp3|ogg|m4a)$/i.test(lower) && (lower === 'original_vocals.wav' || lower === 'vocals.wav' || lower.includes('_vocals') || lower.includes('(vocals)'))) {
            return path.join(dir, ent.name);
          }
          if (ent.isDirectory() && (lower.includes('demucs') || lower.includes('separation') || lower.includes('uvr') || lower.includes('stem'))) {
            const subDir = path.join(dir, ent.name);
            const v1 = path.join(subDir, 'original_vocals.wav');
            const v2 = path.join(subDir, 'vocals.wav');
            if (fs.existsSync(v1)) return v1;
            if (fs.existsSync(v2)) return v2;
          }
        }
      } catch (e) {}
    }

    return null;
  }

  /**
   * Потоковый расчёт 10-мс RMS кадров через временный моно 16 кГц PCM файл (без нагрузки на V8 Heap).
   */
  static async analyzeAudioRmsFramesFromFile(audioPath, tempDir, sampleRate = 16000) {
    if (!audioPath || !fs.existsSync(audioPath)) return null;
    const dir = tempDir || os.tmpdir();
    try { await fs.promises.mkdir(dir, { recursive: true }); } catch (e) {}
    const tempRawPath = path.join(dir, `adm_rms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.raw`);
    const frameDurSec = 0.01; // 10ms window
    const winSamples = Math.max(64, Math.floor(sampleRate * frameDurSec));
    const bytesPerWin = winSamples * 2; // mono s16le

    try {
      await this.decodeToPcmFile(audioPath, tempRawPath, sampleRate, 1);
      const stat = fs.statSync(tempRawPath);
      const totalFrames = Math.floor(stat.size / bytesPerWin);
      if (totalFrames <= 0) return null;

      const rmsFrames = new Float32Array(totalFrames);
      const fd = fs.openSync(tempRawPath, 'r');
      const chunkWindows = 1000; // 10 seconds per chunk
      const chunkBuf = Buffer.alloc(chunkWindows * bytesPerWin);
      let frameIdx = 0;

      try {
        while (frameIdx < totalFrames) {
          const winsToRead = Math.min(chunkWindows, totalFrames - frameIdx);
          const bytesToRead = winsToRead * bytesPerWin;
          const bytesRead = fs.readSync(fd, chunkBuf, 0, bytesToRead, frameIdx * bytesPerWin);
          const actualWins = Math.floor(bytesRead / bytesPerWin);
          if (actualWins <= 0) break;

          for (let w = 0; w < actualWins; w++) {
            const winOffset = w * bytesPerWin;
            let sumSq = 0;
            for (let s = 0; s < winSamples; s++) {
              const sampleNorm = chunkBuf.readInt16LE(winOffset + s * 2) / 32768.0;
              sumSq += sampleNorm * sampleNorm;
            }
            rmsFrames[frameIdx++] = Math.sqrt(sumSq / winSamples);
          }
        }
      } finally {
        try { fs.closeSync(fd); } catch (e) {}
      }

      // Adaptive room noise floor estimation
      const sampleStep = Math.max(1, Math.floor(totalFrames / 6000));
      const dbSamples = [];
      for (let f = 0; f < totalFrames; f += sampleStep) {
        const r = rmsFrames[f];
        dbSamples.push(r > 3.16e-5 ? 20 * Math.log10(r) : -91);
      }
      dbSamples.sort((a, b) => a - b);
      const nonNull = dbSamples.filter(v => v > -88);
      const isSparse = nonNull.length / Math.max(1, dbSamples.length) < 0.55;
      let roomNoiseDb = -54;
      if (isSparse) {
        const raw = nonNull.length > 20 ? nonNull[Math.floor(nonNull.length * 0.08)] : -72;
        roomNoiseDb = Math.max(-84, Math.min(-50, raw));
      } else if (dbSamples.length > 0) {
        roomNoiseDb = Math.max(-84, Math.min(-48, dbSamples[Math.floor(dbSamples.length * 0.15)]));
      }

      return {
        rmsFrames,
        frameDurSec,
        durationSec: totalFrames * frameDurSec,
        roomNoiseDb
      };
    } catch (err) {
      log.warn(`[AutoTiming] Не удалось проанализировать RMS кадры (${path.basename(audioPath)}): ${err.message}`);
      return null;
    } finally {
      try { if (fs.existsSync(tempRawPath)) fs.unlinkSync(tempRawPath); } catch (e) {}
    }
  }

  /**
   * Вычисляет точное смещение атаки голоса (speechOnsetOffsetSec) и конца речи (speechOffsetSec)
   * внутри клипа [sourceStartSec .. sourceEndSec] по 10-мс кадрам RMS:
   * после нахождения вокального ядра шагает назад к реальной границе начальной согласной/слога
   * и ограничивает pre-roll величиной MAX_ONSET_PREROLL_SEC (0.18 с), чтобы фразы не сдвигались раньше оригинала.
   */
  static detectClipSpeechBoundsFromFrames(framesData, sourceStartSec, sourceEndSec) {
    const clipDur = Math.max(0.05, (sourceEndSec || 0) - (sourceStartSec || 0));
    if (!framesData || !framesData.rmsFrames || framesData.rmsFrames.length === 0) {
      return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms: 0, roomNoiseDb: -54 };
    }

    const { rmsFrames, frameDurSec, roomNoiseDb } = framesData;
    const fStart = Math.max(0, Math.floor(sourceStartSec / frameDurSec));
    const fEnd = Math.min(rmsFrames.length, Math.ceil(sourceEndSec / frameDurSec));
    if (fEnd <= fStart) {
      return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms: 0, roomNoiseDb };
    }

    let peakRms = 0;
    for (let f = fStart; f < fEnd; f++) {
      if (rmsFrames[f] > peakRms) peakRms = rmsFrames[f];
    }

    const noiseFloorAmp = Math.pow(10, roomNoiseDb / 20);
    const noisePlus10Amp = Math.pow(10, (roomNoiseDb + 10) / 20);
    const peak15Amp = peakRms * 0.15;

    if (peakRms < Math.max(1e-5, noiseFloorAmp * 1.35)) {
      return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms, roomNoiseDb };
    }

    const isSpeechFrame = (idx) => {
      const r = rmsFrames[idx];
      return r > noiseFloorAmp * 1.4 && (r > noisePlus10Amp || r > peak15Amp);
    };

    let onsetFrame = -1;
    let offsetFrame = -1;
    for (let f = fStart; f < fEnd; f++) {
      if (!isSpeechFrame(f)) continue;
      const confirmedAdj =
        (f + 1 < fEnd && isSpeechFrame(f + 1)) ||
        (f - 1 >= fStart && isSpeechFrame(f - 1)) ||
        rmsFrames[f] > peakRms * 0.35;
      if (confirmedAdj) {
        if (onsetFrame === -1) onsetFrame = f;
        offsetFrame = f + 1;
      }
    }

    if (onsetFrame === -1 || offsetFrame === -1) {
      return { onsetOffsetSec: 0, offsetSec: clipDur, peakRms, roomNoiseDb };
    }

    // Обратный проход к начальной согласной/безударному слогу (до 280 мс назад)
    const wordEdgeAmp = Math.max(
      noiseFloorAmp * 1.75,
      Math.pow(10, Math.max(-58, roomNoiseDb + 4.5) / 20),
      peakRms * 0.04
    );
    let trueOnsetFrame = onsetFrame;
    let backSilentRun = 0;
    const minBackFrame = Math.max(fStart, onsetFrame - 28);
    for (let b = onsetFrame - 1; b >= minBackFrame; b--) {
      if (rmsFrames[b] >= wordEdgeAmp) {
        trueOnsetFrame = b;
        backSilentRun = 0;
      } else {
        backSilentRun++;
        if (backSilentRun > 3) break;
      }
    }

    // Прямой проход к мягкому окончанию слова (до 180 мс вперёд)
    let trueOffsetFrame = offsetFrame;
    let fwdSilentRun = 0;
    const maxFwdFrame = Math.min(fEnd - 1, offsetFrame + 18);
    for (let f = offsetFrame; f <= maxFwdFrame; f++) {
      if (rmsFrames[f] >= wordEdgeAmp) {
        trueOffsetFrame = f + 1;
        fwdSilentRun = 0;
      } else {
        fwdSilentRun++;
        if (fwdSilentRun > 3) break;
      }
    }

    const onsetSecRaw = (trueOnsetFrame - fStart) * frameDurSec;
    const offsetSecRaw = (trueOffsetFrame - fStart) * frameDurSec;
    const maxAllowedPreRollSec = Math.min(clipDur - 0.04, TIMING_RULES.MAX_ONSET_PREROLL_SEC);

    const onsetOffsetSec = Number(Math.max(0, Math.min(maxAllowedPreRollSec, onsetSecRaw)).toFixed(3));
    const offsetSec = Number(Math.max(Math.min(clipDur, onsetOffsetSec + 0.02), Math.min(clipDur, offsetSecRaw)).toFixed(3));
    return { onsetOffsetSec, offsetSec, peakRms, roomNoiseDb };
  }

  /**
   * Сканирует окно [subStartSec - 0.06s .. subEndSec + 0.35s] на original_vocals.wav
   * для нахождения реального начала (refVocalStartSec) и конца (refVocalEndSec) речи сейю,
   * игнорируя хвосты предыдущих реплик и короткие вдохи перед фразой.
   */
  static findOriginalVocalsAnchor(vocalsFramesData, subStartSec, subEndSec) {
    if (!vocalsFramesData || !vocalsFramesData.rmsFrames || vocalsFramesData.rmsFrames.length === 0) {
      return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
    }

    const { rmsFrames, frameDurSec, roomNoiseDb, durationSec } = vocalsFramesData;
    const preSubMaxSec = TIMING_RULES.VOCALS_ANCHOR_PRE_SUB_MAX_SEC ?? 0.06;
    const postSubMaxSec = TIMING_RULES.VOCALS_ANCHOR_POST_SUB_MAX_SEC ?? 0.35;
    const scanStartSec = Math.max(0, subStartSec - preSubMaxSec);
    const scanEndSec = Math.min(durationSec, subEndSec + postSubMaxSec);
    const fStart = Math.max(0, Math.floor(scanStartSec / frameDurSec));
    const fEnd = Math.min(rmsFrames.length, Math.ceil(scanEndSec / frameDurSec));
    if (fEnd <= fStart + 4) {
      return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
    }

    let peakRms = 0;
    for (let f = fStart; f < fEnd; f++) {
      if (rmsFrames[f] > peakRms) peakRms = rmsFrames[f];
    }
    if (peakRms < Math.pow(10, -46 / 20)) {
      return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
    }

    const noisePlus12Amp = Math.pow(10, (roomNoiseDb + 12) / 20);
    const threshold = Math.max(noisePlus12Amp, peakRms * 0.16, Math.pow(10, -44 / 20));

    const numFrames = fEnd - fStart;
    const activeMask = new Uint8Array(numFrames);
    let activeFrames = 0;
    for (let i = 0; i < numFrames; i++) {
      const f = fStart + i;
      if (rmsFrames[f] <= threshold) continue;
      const confirmedAdj =
        (f + 1 < fEnd && rmsFrames[f + 1] > threshold) ||
        (f - 1 >= fStart && rmsFrames[f - 1] > threshold) ||
        rmsFrames[f] > peakRms * 0.35;
      if (confirmedAdj) {
        activeMask[i] = 1;
        activeFrames++;
      }
    }

    if (activeFrames < 3) {
      return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
    }

    // Сглаживаем внутрислоговые микро-провалы <= 3 кадров (30 мс)
    let gapRun = 0;
    for (let i = 0; i < numFrames; i++) {
      if (activeMask[i] === 0) {
        gapRun++;
      } else {
        if (gapRun > 0 && gapRun <= 3 && i - gapRun > 0) {
          for (let k = i - gapRun; k < i; k++) activeMask[k] = 1;
        }
        gapRun = 0;
      }
    }

    const clusters = [];
    let idx = 0;
    while (idx < numFrames) {
      if (activeMask[idx] === 1) {
        const cStart = idx;
        let cPeak = 0;
        while (idx < numFrames && activeMask[idx] === 1) {
          if (rmsFrames[fStart + idx] > cPeak) cPeak = rmsFrames[fStart + idx];
          idx++;
        }
        const cEnd = idx;
        if (cEnd - cStart >= 2) {
          clusters.push({
            startFrame: fStart + cStart,
            endFrame: fStart + cEnd,
            durFrames: cEnd - cStart,
            clusterPeak: cPeak,
          });
        }
      } else {
        idx++;
      }
    }

    if (clusters.length === 0) {
      return { anchorStartSec: subStartSec, anchorEndSec: subEndSec, hasRefVocal: false };
    }

    let chosenClusterIdx = 0;
    if (clusters.length >= 2) {
      const first = clusters[0];
      const second = clusters[1];
      const firstStartSec = first.startFrame * frameDurSec;
      const valleyFrames = second.startFrame - first.endFrame;
      const isFirstPreBreathOrTail =
        firstStartSec <= subStartSec + 0.06 &&
        valleyFrames >= 4 &&
        (first.durFrames <= 15 || first.clusterPeak < peakRms * 0.45) &&
        (second.durFrames >= 10 || second.clusterPeak >= first.clusterPeak * 1.25);
      if (isFirstPreBreathOrTail) {
        chosenClusterIdx = 1;
      }
    }

    let onsetFrame = clusters[chosenClusterIdx].startFrame;
    const offsetFrame = clusters[clusters.length - 1].endFrame;

    const edgeThreshold = Math.max(Math.pow(10, (roomNoiseDb + 8) / 20), peakRms * 0.08);
    const minEdgeFrame = chosenClusterIdx > 0 ? clusters[chosenClusterIdx - 1].endFrame + 2 : fStart;
    for (let b = onsetFrame - 1; b >= Math.max(minEdgeFrame, onsetFrame - 3); b--) {
      if (rmsFrames[b] >= edgeThreshold) {
        onsetFrame = b;
      } else {
        break;
      }
    }

    const minAllowedVocalStartSec = Math.max(0, subStartSec - preSubMaxSec);
    const refVocalStartSec = Number(Math.max(minAllowedVocalStartSec, onsetFrame * frameDurSec).toFixed(3));
    const refVocalEndSec = Number(Math.max(refVocalStartSec + 0.08, offsetFrame * frameDurSec).toFixed(3));
    return {
      refVocalStartSec,
      refVocalEndSec,
      anchorStartSec: refVocalStartSec,
      anchorEndSec: refVocalEndSec,
      hasRefVocal: true
    };
  }

  /**
   * Строгое правило освобождения от автотайминга (единый модуль TimingRulesConfig).
   */
  static isPhraseTimingNotRequired(
    clipStartSec,
    clipDurationSec,
    anchorStartSec,
    anchorEndSec,
    speechOnsetOffsetSec = 0,
    speechOffsetSec,
    hasRefVocal = true
  ) {
    return sharedIsPhraseTimingNotRequired(
      clipStartSec,
      clipDurationSec,
      anchorStartSec,
      anchorEndSec,
      speechOnsetOffsetSec,
      speechOffsetSec,
      hasRefVocal
    );
  }

  /**
   * Пост-проверка коллизий после сдвигов внутри одной дорожки:
   * гарантирует зазор >= minGapSec (по умолчанию 60 мс из TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) между соседними фразами,
   * НЕ утягивая предыдущую фразу раньше её эталонного якоря (Anti-Rush).
   */
  static enforceSameTrackMinGap(phrases, minGapSec = TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) {
    if (!Array.isArray(phrases) || phrases.length < 2) return phrases;
    phrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

    for (let i = 0; i < phrases.length - 1; i++) {
      const p1 = phrases[i];
      const p2 = phrases[i + 1];
      const gap = p2.targetStartSec - p1.targetEndSec;
      if (gap >= minGapSec - 0.001) continue;

      let remaining = minGapSec - gap;

      // 1. Срезаем только тихий post-roll хвост до speechOffsetSec + 25мс
      const speechEndFloor = typeof p1.speechOffsetSec === 'number' && p1.speechOffsetSec > 0
        ? Math.max(0.18, p1.speechOffsetSec + 0.025)
        : Math.max(0.22, p1.durationSec - 0.12);
      const maxSafeTrim = Math.max(0, p1.durationSec - speechEndFloor);
      if (maxSafeTrim > 0.005) {
        const trim = Math.min(remaining, maxSafeTrim);
        p1.durationSec = Number((p1.durationSec - trim).toFixed(3));
        p1.sourceEndSec = Number((p1.sourceStartSec + p1.durationSec).toFixed(3));
        p1.targetEndSec = Number((p1.targetStartSec + p1.durationSec).toFixed(3));
        remaining -= trim;
      }

      // 2. Микро-сдвиг p1 влево разрешён ТОЛЬКО если p1 стоит правее своего эталонного якоря (не раньше оригинала!)
      if (remaining > 0.005 && !p1.isUnisonPhrase) {
        const prevEnd = i > 0 ? (phrases[i - 1].targetEndSec + minGapSec) : 0;
        const p1AnchorFloor = computeTargetClipStartSec({
          anchorStartSec: p1.refVocalStartSec ?? p1.subStartSec ?? p1.targetStartSec,
          anchorEndSec: p1.refVocalEndSec ?? p1.subEndSec,
          speechOnsetOffsetSec: p1.speechOnsetOffsetSec,
          hasRefVocal: Boolean(p1.hasRefVocalAnchor),
        });
        const minAllowedStart = Math.max(prevEnd, p1AnchorFloor);
        const canPull = Math.min(0.18, Math.max(0, p1.targetStartSec - minAllowedStart));
        if (canPull > 0.005) {
          const pull = Math.min(remaining, canPull);
          p1.targetStartSec = Number(Math.max(0, p1.targetStartSec - pull).toFixed(3));
          p1.targetEndSec = Number((p1.targetStartSec + p1.durationSec).toFixed(3));
          p1.shiftDeltaSec = Number((p1.targetStartSec - p1.sourceStartSec).toFixed(3));
          remaining -= pull;
        }
      }

      // 3. Микро-сдвиг p2 вправо (<= 0.35с) внутри коридора до p3
      if (remaining > 0.005 && !p2.isUnisonPhrase) {
        const nextLimit = i + 2 < phrases.length
          ? (phrases[i + 2].targetStartSec - p2.durationSec - minGapSec)
          : Infinity;
        const canPush = Math.min(0.35, Math.max(0, nextLimit - p2.targetStartSec));
        if (canPush > 0.005) {
          const push = Math.min(remaining, canPush);
          p2.targetStartSec = Number((p2.targetStartSec + push).toFixed(3));
          p2.targetEndSec = Number((p2.targetStartSec + p2.durationSec).toFixed(3));
          p2.shiftDeltaSec = Number((p2.targetStartSec - p2.sourceStartSec).toFixed(3));
          p2.collisionResolved = true;
          remaining -= push;
        }
      }

      // 4. Жёсткая защита от наезда вплотную
      if (p1.targetEndSec > p2.targetStartSec - minGapSec) {
        const safeEnd = Math.max(p1.targetStartSec + 0.14, p2.targetStartSec - minGapSec);
        if (safeEnd < p1.targetEndSec) {
          p1.durationSec = Number((safeEnd - p1.targetStartSec).toFixed(3));
          p1.sourceEndSec = Number((p1.sourceStartSec + p1.durationSec).toFixed(3));
          p1.targetEndSec = Number(safeEnd.toFixed(3));
        }
      }
    }

    return phrases;
  }

  /**
   * Правило 2A / вспомогательный метод: Поиск самой тихой 40-мс долины (4 x 10мс) в диапазоне [searchStartSec .. searchEndSec].
   */
  static findQuietValley40ms(framesData, searchStartSec, searchEndSec) {
    if (!framesData || !framesData.rmsFrames || framesData.rmsFrames.length < 4) return null;
    if (searchEndSec <= searchStartSec + 0.05) return null;

    const { rmsFrames, frameDurSec } = framesData;
    const fStart = Math.max(0, Math.floor(Math.max(0, searchStartSec) / frameDurSec));
    const fEnd = Math.min(rmsFrames.length, Math.ceil(Math.min(framesData.durationSec, searchEndSec) / frameDurSec));
    const winLen = 4; // 40ms
    if (fEnd - fStart < winLen) return null;

    let minAvg = Infinity;
    let minIdx = fStart;
    for (let f = fStart; f <= fEnd - winLen; f++) {
      const avg = (rmsFrames[f] + rmsFrames[f + 1] + rmsFrames[f + 2] + rmsFrames[f + 3]) / winLen;
      if (avg < minAvg) {
        minAvg = avg;
        minIdx = f;
      }
    }

    return {
      valleySec: Number(((minIdx + winLen / 2) * frameDurSec).toFixed(3)),
      valleyRms: minAvg
    };
  }

  /**
   * Правило 2B: Поиск внутренней паузы длительностью 200-550 мс внутри речевого клипа [sourceStartSec .. sourceEndSec].
   */
  static detectInternalPausesFromFrames(framesData, sourceStartSec, sourceEndSec, minPauseSec = 0.20, maxPauseSec = 0.55) {
    const clipDur = (sourceEndSec || 0) - (sourceStartSec || 0);
    if (!framesData || !framesData.rmsFrames || clipDur < 0.65) return [];

    const { rmsFrames, frameDurSec, roomNoiseDb } = framesData;
    const fStart = Math.max(0, Math.floor(sourceStartSec / frameDurSec));
    const fEnd = Math.min(rmsFrames.length, Math.ceil(sourceEndSec / frameDurSec));
    if (fEnd - fStart < 40) return [];

    let peakRms = 0;
    for (let f = fStart; f < fEnd; f++) {
      if (rmsFrames[f] > peakRms) peakRms = rmsFrames[f];
    }
    const noiseFloorAmp = Math.pow(10, roomNoiseDb / 20);
    const silenceThreshold = Math.max(noiseFloorAmp * 2.4, Math.pow(10, (roomNoiseDb + 9) / 20), peakRms * 0.09);

    const len = fEnd - fStart;
    const isSilent = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      isSilent[i] = rmsFrames[fStart + i] < silenceThreshold ? 1 : 0;
    }
    for (let i = 1; i < len - 1; i++) {
      if (isSilent[i - 1] === 1 && isSilent[i + 1] === 1) isSilent[i] = 1;
    }

    let firstAct = -1;
    let lastAct = -1;
    for (let i = 0; i < len; i++) {
      if (isSilent[i] === 0) {
        if (firstAct === -1) firstAct = i;
        lastAct = i;
      }
    }
    const minEdgeFrames = Math.max(8, Math.round(0.10 / frameDurSec));
    if (firstAct === -1 || lastAct - firstAct < minEdgeFrames * 2) return [];

    const pauses = [];
    let inPause = false;
    let pStart = 0;
    for (let i = firstAct; i <= lastAct; i++) {
      if (isSilent[i] === 1 && !inPause) {
        inPause = true;
        pStart = i;
      } else if (isSilent[i] === 0 && inPause) {
        inPause = false;
        if (pStart - firstAct >= minEdgeFrames && lastAct - i + 1 >= minEdgeFrames) {
          const pStartSec = Number(((fStart + pStart) * frameDurSec).toFixed(3));
          const pEndSec = Number(((fStart + i) * frameDurSec).toFixed(3));
          const pDur = Number((pEndSec - pStartSec).toFixed(3));
          if (pDur >= minPauseSec && pDur <= maxPauseSec) {
            let bestIdx = Math.floor((pStart + i) / 2);
            let min4 = Infinity;
            for (let k = pStart; k <= i - 4; k++) {
              const gf = fStart + k;
              const avg = (rmsFrames[gf] + rmsFrames[gf + 1] + rmsFrames[gf + 2] + rmsFrames[gf + 3]) / 4;
              if (avg < min4) {
                min4 = avg;
                bestIdx = k + 2;
              }
            }
            pauses.push({
              pauseStartSec: pStartSec,
              pauseEndSec: pEndSec,
              pauseDurationSec: pDur,
              valleyCenterSec: Number(((fStart + bestIdx) * frameDurSec).toFixed(3))
            });
          }
        }
      }
    }

    return pauses;
  }

  /**
   * Правило 2B: Проверяет наличие паузы > 180 мс в эталонном original_vocals.wav внутри субтитра.
   */
  static checkOriginalVocalsPauseInWindow(vocalsFramesData, subStartSec, subEndSec, approxRelFrac, searchRadiusSec = 0.45, minOrigPauseSec = 0.18) {
    const fallback = { hasPause: false, origHalf1StartSec: subStartSec, origHalf1EndSec: subEndSec };
    if (!vocalsFramesData || !vocalsFramesData.rmsFrames || subEndSec <= subStartSec + 0.4) return fallback;

    const { rmsFrames, frameDurSec, roomNoiseDb, durationSec } = vocalsFramesData;
    const fStart = Math.max(0, Math.floor(Math.max(0, subStartSec - 0.35) / frameDurSec));
    const fEnd = Math.min(rmsFrames.length, Math.ceil(Math.min(durationSec, subEndSec + 0.35) / frameDurSec));
    if (fEnd - fStart < 30) return fallback;

    let peakRms = 0;
    for (let f = fStart; f < fEnd; f++) {
      if (rmsFrames[f] > peakRms) peakRms = rmsFrames[f];
    }
    if (peakRms < Math.pow(10, -46 / 20)) return fallback;

    const threshold = Math.max(Math.pow(10, (roomNoiseDb + 11) / 20), peakRms * 0.14, Math.pow(10, -44 / 20));
    const len = fEnd - fStart;
    const isSilent = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      isSilent[i] = rmsFrames[fStart + i] <= threshold ? 1 : 0;
    }

    let firstAct = -1;
    let lastAct = -1;
    for (let i = 0; i < len; i++) {
      if (isSilent[i] === 0) {
        if (firstAct === -1) firstAct = i;
        lastAct = i;
      }
    }
    if (firstAct === -1 || lastAct <= firstAct + 20) return fallback;

    const origStart = Number(((fStart + firstAct) * frameDurSec).toFixed(3));
    const origEnd = Number(((fStart + lastAct + 1) * frameDurSec).toFixed(3));
    const expectedCenter = origStart + (origEnd - origStart) * Math.max(0.15, Math.min(0.85, approxRelFrac));

    let bestPause = null;
    let inPause = false;
    let pStart = 0;
    for (let i = firstAct; i <= lastAct; i++) {
      if (isSilent[i] === 1 && !inPause) {
        inPause = true;
        pStart = i;
      } else if (isSilent[i] === 0 && inPause) {
        inPause = false;
        const pStartSec = (fStart + pStart) * frameDurSec;
        const pEndSec = (fStart + i) * frameDurSec;
        const pDur = pEndSec - pStartSec;
        const dist = Math.abs((pStartSec + pEndSec) / 2 - expectedCenter);
        if (pDur > minOrigPauseSec && dist <= searchRadiusSec + 0.35 && (pStart - firstAct) >= 8 && (lastAct - i + 1) >= 8) {
          if (!bestPause || dist < bestPause.dist) {
            bestPause = {
              start: Number(pStartSec.toFixed(3)),
              end: Number(pEndSec.toFixed(3)),
              dist,
              lastBeforeIdx: pStart,
              firstAfterIdx: i
            };
          }
        }
      }
    }

    if (!bestPause) {
      return { hasPause: false, origHalf1StartSec: origStart, origHalf1EndSec: origEnd };
    }

    return {
      hasPause: true,
      origPauseStartSec: bestPause.start,
      origPauseEndSec: bestPause.end,
      origHalf1StartSec: origStart,
      origHalf1EndSec: Number(((fStart + bestPause.lastBeforeIdx) * frameDurSec).toFixed(3)),
      origHalf2StartSec: Number(((fStart + bestPause.firstAfterIdx) * frameDurSec).toFixed(3)),
      origHalf2EndSec: origEnd
    };
  }

  /**
   * Правила 2A и 2B на этапе предобработки интервалов дорожки:
   * - 2A: Если 2 соседние реплики склеились в один кусок, находит самую тихую 40-мс долину в original_vocals.wav
   *       в окне ±0.45с от границы `.ass` и режет кусок по соответствующей 40-мс долине даббера.
   * - 2B: Для длинной реплики с внутренней паузой 200-550 мс: если пауза в оригинале >180 мс -> делит надвое;
   *       если оригинал слитный и пауза даббера >300 мс -> НЕ режет, а задаёт internalPauseEdit (сжатие до 120 мс).
   */
  static refineAndAdaptIntervalsWithVocals(intervals, charLines, trackFramesData, vocalsFramesData, statsAcc) {
    if (!Array.isArray(intervals) || intervals.length === 0 || !trackFramesData) {
      return intervals;
    }

    // Шаг 2A: Разрезаем интервалы, объединившие 2 соседних субтитра (поиск 40-мс долины в оригинале ±0.45с)
    const sortedSubs = [...(charLines || [])].sort((a, b) => a.startSec - b.startSec);
    let afterSplit2A = [...intervals];
    if (sortedSubs.length >= 2) {
      let splitHappened = true;
      let passes = 0;
      while (splitHappened && passes < 4) {
        splitHappened = false;
        passes++;
        const nextList = [];
        for (const inv of afterSplit2A) {
          const spanning = sortedSubs.filter(s => s.startSec >= inv.startSec - 0.55 && s.endSec <= inv.endSec + 0.55);
          if (spanning.length >= 2 && spanning.length <= 4) {
            let cutPerformed = false;
            for (let si = 0; si < spanning.length - 1; si++) {
              const subA = spanning[si];
              const subB = spanning[si + 1];
              if (subB.startSec - subA.endSec >= 1.25) continue;

              const assBoundary = (subA.endSec + subB.startSec) / 2;
              const origValley = vocalsFramesData
                ? this.findQuietValley40ms(vocalsFramesData, assBoundary - 0.45, assBoundary + 0.45)
                : null;
              const searchCenter = origValley ? (assBoundary * 0.35 + origValley.valleySec * 0.65) : assBoundary;
              const searchStart = Math.max(inv.startSec + 0.25, searchCenter - 0.45);
              const searchEnd = Math.min(inv.endSec - 0.25, searchCenter + 0.45);
              const dubValley = this.findQuietValley40ms(trackFramesData, searchStart, searchEnd);
              const splitPoint = dubValley ? dubValley.valleySec : searchCenter;

              if (splitPoint - inv.startSec >= 0.25 && inv.endSec - splitPoint >= 0.25) {
                nextList.push({
                  startSec: inv.startSec,
                  endSec: Number(splitPoint.toFixed(3)),
                  durationSec: Number((splitPoint - inv.startSec).toFixed(3))
                });
                nextList.push({
                  startSec: Number(splitPoint.toFixed(3)),
                  endSec: inv.endSec,
                  durationSec: Number((inv.endSec - splitPoint).toFixed(3))
                });
                splitHappened = true;
                cutPerformed = true;
                break;
              }
            }
            if (!cutPerformed) nextList.push(inv);
          } else {
            nextList.push(inv);
          }
        }
        afterSplit2A = nextList;
      }
    }

    if (!vocalsFramesData) return afterSplit2A;

    // Шаг 2B: Адаптивная проверка внутренних пауз 200-550 мс внутри одиночного длинного субтитра
    const result = [];
    for (const inv of afterSplit2A) {
      if ((inv.durationSec || 0) < 0.70) {
        result.push(inv);
        continue;
      }

      // Находим ближайший длинный субтитр
      let bestSub = null;
      let bestDiff = Infinity;
      for (const s of sortedSubs) {
        const d = Math.abs(s.startSec - inv.startSec);
        if (d < 1.5 && d < bestDiff) {
          bestDiff = d;
          bestSub = s;
        }
      }

      if (!bestSub || (bestSub.endSec - bestSub.startSec) < 0.85) {
        result.push(inv);
        continue;
      }

      const pauses = this.detectInternalPausesFromFrames(
        trackFramesData,
        inv.startSec,
        inv.endSec,
        TIMING_RULES.INTERNAL_PAUSE_MIN_SEC,
        TIMING_RULES.INTERNAL_PAUSE_MAX_SEC
      );
      if (pauses.length === 0) {
        result.push(inv);
        continue;
      }

      pauses.sort((a, b) => b.pauseDurationSec - a.pauseDurationSec);
      const mainPause = pauses[0];
      const relFrac = (mainPause.valleyCenterSec - inv.startSec) / Math.max(0.2, inv.endSec - inv.startSec);
      const origCheck = this.checkOriginalVocalsPauseInWindow(
        vocalsFramesData,
        bestSub.startSec,
        bestSub.endSec,
        relFrac,
        0.45,
        TIMING_RULES.ORIG_VOCAL_PAUSE_MIN_SEC
      );

      if (origCheck.hasPause && origCheck.origHalf2StartSec !== undefined) {
        const p1End = Number(Math.max(inv.startSec + 0.22, mainPause.valleyCenterSec - 0.01).toFixed(3));
        const p2Start = Number(Math.min(inv.endSec - 0.22, mainPause.valleyCenterSec + 0.01).toFixed(3));
        if (p1End - inv.startSec >= 0.22 && inv.endSec - p2Start >= 0.22) {
          result.push({
            startSec: inv.startSec,
            endSec: p1End,
            durationSec: Number((p1End - inv.startSec).toFixed(3)),
            _overrideSub: {
              ...bestSub,
              id: `${bestSub.id ?? bestSub.rawLineIndex ?? 'sub'}_h1`,
              startSec: origCheck.origHalf1StartSec,
              endSec: origCheck.origHalf1EndSec,
              text: `${bestSub.text || ''} (ч. 1)`
            },
            _overrideAnchor: {
              refVocalStartSec: origCheck.origHalf1StartSec,
              refVocalEndSec: origCheck.origHalf1EndSec,
              anchorStartSec: origCheck.origHalf1StartSec,
              anchorEndSec: origCheck.origHalf1EndSec,
              hasRefVocal: true
            }
          });
          result.push({
            startSec: p2Start,
            endSec: inv.endSec,
            durationSec: Number((inv.endSec - p2Start).toFixed(3)),
            _overrideSub: {
              ...bestSub,
              id: `${bestSub.id ?? bestSub.rawLineIndex ?? 'sub'}_h2`,
              startSec: origCheck.origHalf2StartSec,
              endSec: origCheck.origHalf2EndSec ?? bestSub.endSec,
              text: `${bestSub.text || ''} (ч. 2)`
            },
            _overrideAnchor: {
              refVocalStartSec: origCheck.origHalf2StartSec,
              refVocalEndSec: origCheck.origHalf2EndSec ?? bestSub.endSec,
              anchorStartSec: origCheck.origHalf2StartSec,
              anchorEndSec: origCheck.origHalf2EndSec ?? bestSub.endSec,
              hasRefVocal: true
            }
          });
          if (statsAcc) statsAcc.pausesSplitCount++;
          continue;
        }
      } else if (mainPause.pauseDurationSec > TIMING_RULES.INTERNAL_PAUSE_COMPRESS_TRIGGER_SEC) {
        const targetPauseSec = TIMING_RULES.INTERNAL_PAUSE_TARGET_SEC;
        const savedSec = Number((mainPause.pauseDurationSec - targetPauseSec).toFixed(3));
        result.push({
          ...inv,
          internalPauseEdit: {
            pauseStartSec: mainPause.pauseStartSec,
            pauseEndSec: mainPause.pauseEndSec,
            targetPauseSec
          },
          unscaledDurationSec: Number(Math.max(0.25, inv.durationSec - savedSec).toFixed(3)),
          durationSec: Number(Math.max(0.25, inv.durationSec - savedSec).toFixed(3))
        });
        if (statsAcc) statsAcc.pausesCompressedCount++;
        continue;
      }

      result.push(inv);
    }

    return result;
  }

  /**
   * Правило 1: Поиск свободного неартикулированного всплеска (0.12с .. 2.50с) в окне ±1.0с на original_vocals.wav для клипа «Физика».
   */
  static findOriginalVocalsBurstForPhysics(vocalsFramesData, clipStartSec, clipEndSec, onsetOffsetSec, occupiedWindows) {
    if (!vocalsFramesData || !vocalsFramesData.rmsFrames || vocalsFramesData.rmsFrames.length === 0) {
      return { found: false };
    }

    const { rmsFrames, frameDurSec, roomNoiseDb, durationSec } = vocalsFramesData;
    const clipAttack = clipStartSec + (onsetOffsetSec || 0);
    const fStart = Math.max(0, Math.floor(Math.max(0, clipStartSec - 1.0) / frameDurSec));
    const fEnd = Math.min(rmsFrames.length, Math.ceil(Math.min(durationSec, Math.max(clipEndSec + 1.0, clipStartSec + 3.5)) / frameDurSec));
    if (fEnd - fStart < 12) return { found: false };

    let peakRms = 0;
    for (let f = fStart; f < fEnd; f++) {
      if (rmsFrames[f] > peakRms) peakRms = rmsFrames[f];
    }
    if (peakRms < Math.pow(10, -47 / 20)) return { found: false };

    const noisePlus10Amp = Math.pow(10, (roomNoiseDb + 10) / 20);
    const threshold = Math.max(noisePlus10Amp, peakRms * 0.14, Math.pow(10, -44 / 20));
    const len = fEnd - fStart;
    const active = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const gf = fStart + i;
      if (rmsFrames[gf] > threshold) {
        const adj =
          (gf + 1 < fEnd && rmsFrames[gf + 1] > threshold * 0.8) ||
          (gf - 1 >= fStart && rmsFrames[gf - 1] > threshold * 0.8) ||
          rmsFrames[gf] > peakRms * 0.30;
        if (adj) active[i] = 1;
      }
    }

    const maxMergeDip = Math.max(2, Math.round(0.12 / frameDurSec));
    let zeroRun = 0;
    for (let i = 0; i < len; i++) {
      if (active[i] === 0) {
        zeroRun++;
      } else {
        if (zeroRun > 0 && zeroRun <= maxMergeDip) {
          for (let k = i - zeroRun; k < i; k++) active[k] = 1;
        }
        zeroRun = 0;
      }
    }

    const bursts = [];
    let inBurst = false;
    let bStartIdx = 0;
    for (let i = 0; i <= len; i++) {
      const isAct = i < len && active[i] === 1;
      if (isAct && !inBurst) {
        inBurst = true;
        bStartIdx = i;
      } else if (!isAct && inBurst) {
        inBurst = false;
        const bStart = Number(((fStart + bStartIdx) * frameDurSec).toFixed(3));
        const bEnd = Number(((fStart + i) * frameDurSec).toFixed(3));
        const bDur = Number((bEnd - bStart).toFixed(3));
        if (
          bDur >= TIMING_RULES.PHYSICS_MIN_BURST_SEC &&
          bDur <= TIMING_RULES.PHYSICS_MAX_BURST_SEC &&
          Math.abs(bStart - clipAttack) <= TIMING_RULES.PHYSICS_SEARCH_WINDOW_SEC
        ) {
          const isOccupied = occupiedWindows.some(occ => {
            const ov = Math.min(bEnd, occ.endSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) - Math.max(bStart, occ.startSec - TIMING_RULES.MIN_SAME_TRACK_GAP_SEC);
            return ov >= Math.min(0.08, bDur * 0.25);
          });
          if (!isOccupied) {
            bursts.push({ startSec: bStart, endSec: bEnd, durationSec: bDur, dist: Math.abs(bStart - clipAttack) });
          }
        }
      }
    }

    if (bursts.length === 0) return { found: false };
    bursts.sort((a, b) => a.dist - b.dist);
    return {
      found: true,
      burstStartSec: bursts[0].startSec,
      burstEndSec: bursts[0].endSec,
      burstDurationSec: bursts[0].durationSec
    };
  }

  /**
   * Правило 1: Умная синхронизация «Физики» (вздохи, смех, реакции без субтитров) по ±1.0с окну original_vocals.wav.
   */
  static applyPhysicsSmartSync(trackPhraseResults, vocalsFramesData, collisionLogs) {
    if (!vocalsFramesData) return 0;

    const occupiedWindows = [];
    for (const tr of trackPhraseResults) {
      for (const s of (tr.track?.lines || [])) {
        occupiedWindows.push({ startSec: s.startSec, endSec: s.endSec });
      }
      for (const p of tr.phrases) {
        if (p.isPhysics) continue;
        occupiedWindows.push({
          startSec: p.refVocalStartSec ?? p.targetStartSec,
          endSec: p.refVocalEndSec ?? p.targetEndSec
        });
      }
    }

    let syncedCount = 0;
    for (const tr of trackPhraseResults) {
      if (tr.track?.isFix) continue;
      const phrases = tr.phrases;
      phrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

      for (let i = 0; i < phrases.length; i++) {
        const p = phrases[i];
        if (!p.isPhysics) continue;

        const burst = this.findOriginalVocalsBurstForPhysics(
          vocalsFramesData,
          p.targetStartSec,
          p.targetEndSec,
          p.speechOnsetOffsetSec || 0,
          occupiedWindows
        );

        if (!burst.found) {
          p.physicsSynced = false;
          continue;
        }

        const desiredStart = Math.max(0, burst.burstStartSec - (p.speechOnsetOffsetSec || 0));
        const maxWin = TIMING_RULES.PHYSICS_SEARCH_WINDOW_SEC;
        const clampedWindow = Math.max(p.sourceStartSec - maxWin, Math.min(p.sourceStartSec + maxWin, desiredStart));
        const prevEnd = i > 0 ? (phrases[i - 1].targetEndSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) : 0;
        const nextStart = i + 1 < phrases.length ? (phrases[i + 1].targetStartSec - TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) : Infinity;
        const safeStart = Number(Math.max(0, Math.max(prevEnd, Math.min(clampedWindow, Math.max(prevEnd, nextStart - p.durationSec)))).toFixed(3));

        if (Math.abs(safeStart - p.targetStartSec) >= TIMING_RULES.MIN_EFFECTIVE_SHIFT_SEC && Math.abs(safeStart - desiredStart) < Math.abs(p.targetStartSec - desiredStart) - 0.02) {
          p.physicsBurstStartSec = burst.burstStartSec;
          p.physicsBurstEndSec = burst.burstEndSec;
          p.refVocalStartSec = burst.burstStartSec;
          p.refVocalEndSec = burst.burstEndSec;
          p.hasRefVocalAnchor = true;
          p.physicsSynced = true;
          p.targetStartSec = safeStart;
          p.targetEndSec = Number((safeStart + p.durationSec).toFixed(3));
          p.shiftDeltaSec = Number((safeStart - p.sourceStartSec).toFixed(3));
          occupiedWindows.push({ startSec: burst.burstStartSec, endSec: burst.burstEndSec });
          syncedCount++;
          if (collisionLogs) {
            collisionLogs.push(`[${formatSeconds(safeStart)}] ⚡ Умная синхронизация «Физики» (${tr.track?.characterName || tr.track?.dubberNick}): атака подтянута к всплеску сейю на ${formatSeconds(burst.burstStartSec)}.`);
          }
        } else {
          p.physicsSynced = false;
        }
      }
    }

    return syncedCount;
  }

  /**
   * Правило 4: Кросс-спасение пропущенных фраз (crossRoleMatched: true).
   */
  static rescueCrossRoleMissingPhrases(trackPhraseResults, vocalsFramesData, collisionLogs) {
    let rescuedCount = 0;
    const nonFixTracks = trackPhraseResults.filter(t => !t.track?.isFix);

    for (const trA of nonFixTracks) {
      const charLines = [...(trA.track?.lines || [])].sort((a, b) => a.startSec - b.startSec);
      const aCharacter = trA.track?.characterName || trA.track?.dubberNick || 'Персонаж';

      for (let sIdx = 0; sIdx < charLines.length; sIdx++) {
        const sub = charLines[sIdx];
        const subIdStr = String(sub.id ?? sub.rawLineIndex ?? sIdx);
        const subDur = Math.max(0.25, sub.endSec - sub.startSec);

        const coveredOnA = trA.phrases.some(p => {
          if (String(p.subId) === subIdStr) return true;
          if (p.isPhysics) return false;
          const ov = Math.min(p.targetEndSec, sub.endSec + 0.25) - Math.max(p.targetStartSec, sub.startSec - 0.25);
          return ov >= Math.min(0.28, subDur * 0.35);
        });
        if (coveredOnA) continue;

        const coveredByOtherDialogue = nonFixTracks.some(otherTr => {
          if (otherTr.track.trackId === trA.track.trackId) return false;
          return otherTr.phrases.some(op => {
            if (op.isPhysics || op.durationSec >= 90) return false;
            const ov = Math.min(op.targetEndSec, sub.endSec + 0.25) - Math.max(op.targetStartSec, sub.startSec - 0.25);
            return ov >= Math.min(0.28, subDur * 0.35);
          });
        });
        if (coveredByOtherDialogue) continue;

        const anchor = this.findOriginalVocalsAnchor(vocalsFramesData, sub.startSec, sub.endSec);
        const refDur = Math.max(0.20, anchor.anchorEndSec - anchor.anchorStartSec);

        let bestMatch = null;
        for (const trB of nonFixTracks) {
          if (trB.track.trackId === trA.track.trackId) continue;
          for (let pIdx = 0; pIdx < trB.phrases.length; pIdx++) {
            const cand = trB.phrases[pIdx];
            const isUnassigned = cand.isPhysics || !cand.hasMatchedSub;
            if (!isUnassigned || cand.crossRoleMatched || cand.physicsSynced) continue;

            const vocalAttack = cand.targetStartSec + (cand.speechOnsetOffsetSec || 0);
            const startDist = Math.abs(vocalAttack - anchor.anchorStartSec);
            const searchWin = TIMING_RULES.CROSS_ROLE_SEARCH_WINDOW_SEC;
            if (startDist > searchWin || cand.targetEndSec < sub.startSec - searchWin || cand.targetStartSec > sub.endSec + searchWin) {
              continue;
            }

            const speechDur = typeof cand.speechOffsetSec === 'number' && cand.speechOffsetSec > (cand.speechOnsetOffsetSec || 0)
              ? Math.max(0.12, cand.speechOffsetSec - (cand.speechOnsetOffsetSec || 0))
              : cand.durationSec;
            const minDurDiff = Math.min(
              Math.abs(cand.durationSec - refDur) / Math.max(0.25, refDur),
              Math.abs(speechDur - refDur) / Math.max(0.25, refDur)
            );
            if (minDurDiff > TIMING_RULES.CROSS_ROLE_MAX_DUR_DIFF_RATIO) continue;

            const score = startDist + minDurDiff * 1.5;
            if (!bestMatch || score < bestMatch.score) {
              bestMatch = { trB, pIdx, cand, score };
            }
          }
        }

        if (bestMatch) {
          const bPhrases = bestMatch.trB.phrases;
          const targetP = bPhrases[bestMatch.pIdx];
          const desiredStart = Math.max(0, anchor.anchorStartSec - (targetP.speechOnsetOffsetSec || 0));
          const prevEnd = bestMatch.pIdx > 0 ? (bPhrases[bestMatch.pIdx - 1].targetEndSec + TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) : 0;
          const nextStart = bestMatch.pIdx + 1 < bPhrases.length ? (bPhrases[bestMatch.pIdx + 1].targetStartSec - TIMING_RULES.MIN_SAME_TRACK_GAP_SEC) : Infinity;
          const safeStart = Number(Math.max(0, Math.max(prevEnd, Math.min(desiredStart, Math.max(prevEnd, nextStart - targetP.durationSec)))).toFixed(3));

          targetP.isPhysics = false;
          targetP.hasMatchedSub = true;
          targetP.crossRoleMatched = true;
          targetP.crossRoleOriginalActor = aCharacter;
          targetP.subId = subIdStr;
          targetP.subStartSec = sub.startSec;
          targetP.subEndSec = sub.endSec;
          targetP.subText = sub.text || '';
          targetP.refVocalStartSec = anchor.refVocalStartSec;
          targetP.refVocalEndSec = anchor.refVocalEndSec;
          targetP.hasRefVocalAnchor = anchor.hasRefVocal;
          targetP.targetStartSec = safeStart;
          targetP.targetEndSec = Number((safeStart + targetP.durationSec).toFixed(3));
          targetP.shiftDeltaSec = Number((safeStart - targetP.sourceStartSec).toFixed(3));
          rescuedCount++;

          if (collisionLogs) {
            collisionLogs.push(`[${formatSeconds(safeStart)}] 🎭 Кросс-спасение реплики: пустой саб «${(sub.text || '').slice(0, 35)}» (${aCharacter}) закрыт непривязанным клипом «${bestMatch.trB.track?.dubberNick}».`);
          }
        }
      }
    }

    return rescuedCount;
  }

  /**
   * Правило 3: Мягкий Time-Fit (подгонка длительности длинных переводов):
   * 1) Сначала подрезает пустой хвост клипа в конце до speechOffsetSec + 40 мс;
   * 2) Включается при вылете хвоста > 25% И наезде на следующую фразу,
   *    задаёт безопасное pitch-preserving ускорение playbackRate / timeStretch в [1.0x .. 1.18x].
   */
  static applySoftTimeFitToTrackPhrases(
    phrases,
    allProjectPhrases,
    subOverlapMatrix,
    minGapSec = TIMING_RULES.MIN_SAME_TRACK_GAP_SEC,
    collisionLogs
  ) {
    if (!Array.isArray(phrases) || phrases.length === 0) return 0;
    phrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

    const interGapSec = TIMING_RULES.MIN_INTER_TRACK_GAP_SEC;
    let fitCount = 0;
    for (let i = 0; i < phrases.length; i++) {
      const p = phrases[i];
      if (p.isPhysics || p.isUnisonPhrase || p.isIntentionalSubOverlap || p.durationSec >= 25) {
        continue;
      }

      const anchorStart = p.refVocalStartSec ?? p.subStartSec;
      const anchorEnd = p.refVocalEndSec ?? p.subEndSec;
      if (anchorEnd === undefined) continue;

      const prevIntraEnd = i > 0 ? (phrases[i - 1].targetEndSec + minGapSec) : 0;
      const nextIntraStart = i + 1 < phrases.length ? (phrases[i + 1].targetStartSec - minGapSec) : Infinity;

      let nextInterStart = Infinity;
      for (const op of allProjectPhrases) {
        if (op.trackId === p.trackId || op.isPhysics || op.isIntentionalSubOverlap) continue;
        if (op.targetStartSec <= p.targetStartSec + interGapSec || op.targetStartSec >= p.targetEndSec + 0.5) continue;
        const ovKey = `${p.subId}:${op.subId}`;
        if (subOverlapMatrix && subOverlapMatrix.has(ovKey)) continue;
        if (op.targetStartSec - interGapSec < nextInterStart) {
          nextInterStart = op.targetStartSec - interGapSec;
        }
      }

      const nextPhraseCeiling = Math.min(nextIntraStart, nextInterStart);
      const evalInitial = evaluateSoftTimeFit({
        curStartSec: p.targetStartSec,
        clipDurationSec: p.durationSec,
        unscaledDurationSec: p.unscaledDurationSec,
        anchorStartSec: anchorStart,
        anchorEndSec: anchorEnd,
        speechOffsetSec: p.speechOffsetSec,
        nextPhraseCeilingSec: nextPhraseCeiling,
        playbackRate: p.playbackRate || p.timeStretch || 1.0,
      });

      if (!evalInitial.collidesNext && !evalInitial.hasOverhangOver25) continue;

      const alignedStart = Math.max(0, anchorStart - (p.speechOnsetOffsetSec || 0));
      const canPullLeft = Math.max(0, p.targetStartSec - Math.max(prevIntraEnd, alignedStart - 0.06));
      if (canPullLeft > TIMING_RULES.TARGET_ATTACK_ACCURACY_SEC && !evalInitial.hasOverhangOver25) continue;

      // Шаг 1: Подрезка пустого хвоста в конце до speechOffsetSec + 40мс
      const pauseSaved = p.internalPauseEdit
        ? Math.max(0, (p.internalPauseEdit.pauseEndSec - p.internalPauseEdit.pauseStartSec) - p.internalPauseEdit.targetPauseSec)
        : 0;
      const tailFloor = typeof p.speechOffsetSec === 'number' && p.speechOffsetSec > 0
        ? Math.max(0.20, p.speechOffsetSec + 0.04)
        : Math.max(0.25, p.durationSec - 0.08);

      if ((p.sourceEndSec - p.sourceStartSec - pauseSaved) > tailFloor + 0.015) {
        const newSrcEnd = Number((p.sourceStartSec + pauseSaved + tailFloor).toFixed(3));
        if (newSrcEnd < p.sourceEndSec) {
          p.sourceEndSec = newSrcEnd;
          p.unscaledDurationSec = Number(Math.max(0.20, tailFloor).toFixed(3));
          const curRate = p.playbackRate || p.timeStretch || 1.0;
          p.durationSec = Number((p.unscaledDurationSec / curRate).toFixed(3));
          p.targetEndSec = Number((p.targetStartSec + p.durationSec).toFixed(3));
        }
      }

      // Шаг 2: Безопасный pitch-preserving time compression [1.0x .. 1.18x] при вылете > 25% и наезде на следующую фразу
      const unscaledDur = p.unscaledDurationSec ?? Math.max(0.25, (p.sourceEndSec - p.sourceStartSec) - pauseSaved);
      const evalAfterTrim = evaluateSoftTimeFit({
        curStartSec: p.targetStartSec,
        clipDurationSec: p.durationSec,
        unscaledDurationSec: unscaledDur,
        anchorStartSec: anchorStart,
        anchorEndSec: anchorEnd,
        speechOffsetSec: p.speechOffsetSec,
        nextPhraseCeilingSec: nextPhraseCeiling,
        playbackRate: p.playbackRate || p.timeStretch || 1.0,
      });

      if (evalAfterTrim.shouldApply) {
        const clampedRate = evalAfterTrim.recommendedRate;
        p.unscaledDurationSec = Number(unscaledDur.toFixed(3));
        p.playbackRate = clampedRate;
        p.timeStretch = clampedRate;
        p.durationSec = Number((unscaledDur / clampedRate).toFixed(3));
        p.targetEndSec = Number((p.targetStartSec + p.durationSec).toFixed(3));
        p.timeFitApplied = true;
        fitCount++;
        if (collisionLogs) {
          collisionLogs.push(`[${formatSeconds(p.targetStartSec)}] ⏩ Soft Time-Fit ${clampedRate.toFixed(2)}x (${p.dubberNick}): длинный перевод сжат с ${unscaledDur.toFixed(2)}с до ${p.durationSec.toFixed(2)}с без изменения тона.`);
        }
      }
    }

    return fitCount;
  }

  /**
   * Выравнивание тайминга фраз и разведение коллизий диалогов.
   * Синхронизация строго по реальной атаке речи (speechOnsetOffsetSec) и эталону original_vocals.wav.
   */
  static async alignProjectAndResolveCollisions({
    subPath,
    matchedTracks,
    options = {}
  }) {
    const minGapSec = options.minGapSec !== undefined ? Number(options.minGapSec) : TIMING_RULES.MIN_INTER_TRACK_GAP_SEC; // 80ms inter-track
    const intraTrackMinGapSec = TIMING_RULES.MIN_SAME_TRACK_GAP_SEC; // 60ms post-shift intra-track guarantee
    const leadInSec = options.leadInSec !== undefined ? Number(options.leadInSec) : 0.090;
    const maxShiftEarlySec = options.maxShiftEarlySec !== undefined ? Number(options.maxShiftEarlySec) : 0.20;
    const silenceThresholdDb = options.silenceThresholdDb !== undefined ? Number(options.silenceThresholdDb) : (options.noiseDb !== undefined ? Number(options.noiseDb) : -45);
    const minSilenceDuration = options.minSilenceDuration !== undefined ? Number(options.minSilenceDuration) : 0.30;
    const preventCollisions = options.preventCollisions !== false;
    
    log.info(`[AutoTiming] Запуск автотайминга с minGap=${minGapSec}с, leadIn=${leadInSec}с, silenceThreshold=${silenceThresholdDb}dB, minSilence=${minSilenceDuration}с, preventCollisions=${preventCollisions}`);

    const subData = subPath ? await getRawSubtitles(subPath) : { lines: [] };
    const allSubtitleLines = (subData.lines || []).map(l => ({
      ...l,
      startSec: parseTimeToSeconds(l.start),
      endSec: parseTimeToSeconds(l.end)
    }));
    const subOverlapMatrix = this.buildSubtitleOverlapMatrix(allSubtitleLines);

    const analysisTmpDir = path.join(os.tmpdir(), 'adm_timing_rms');
    const origVocalsPath = this.resolveOriginalVocalsPath(options, subPath);
    const vocalsFramesData = origVocalsPath
      ? await this.analyzeAudioRmsFramesFromFile(origVocalsPath, analysisTmpDir)
      : null;
    if (vocalsFramesData) {
      log.info(`[AutoTiming] Эталон original_vocals.wav подключен: ${origVocalsPath} (шум: ${vocalsFramesData.roomNoiseDb.toFixed(1)} dB)`);
    }

    const trackPhraseResults = [];
    const allProjectPhrases = [];
    const edgeStats = {
      pausesSplitCount: 0,
      pausesCompressedCount: 0,
      physicsSyncedCount: 0,
      crossRoleRescuedCount: 0,
      softTimeFitCount: 0
    };

    for (const track of matchedTracks) {
      let intervals = [];
      try {
        const detectRes = await AutoTimingService.detectSpeechIntervals(track.trackPath, {
          noiseDb: silenceThresholdDb,
          minSilenceDuration
        });
        intervals = detectRes.speechIntervals || [];
      } catch (err) {
        intervals = [{ startSec: 0, endSec: 300, durationSec: 300 }];
      }

      const trackFramesData = await this.analyzeAudioRmsFramesFromFile(track.trackPath, analysisTmpDir);

      const charLines = track.lines || [];
      const phrases = [];
      const fixTargets = track.fixTargetLines || [];

      let isTrackInTimeline = !track.isFix;
      if (intervals.length > 0 && track.isFix) {
        const firstStart = intervals[0].startSec;
        const lastEnd = intervals[intervals.length - 1].endSec;
        const totalSpan = lastEnd - firstStart;
        const targets = fixTargets.length > 0 ? fixTargets : charLines;
        const matchCount = intervals.filter(inv => 
          targets.some(t => {
            const tSec = t.timestamp !== undefined ? t.timestamp : t.startSec;
            return tSec !== undefined && Math.abs(tSec - inv.startSec) < 8.0;
          })
        ).length;
        if ((matchCount >= Math.ceil(intervals.length / 2) && firstStart > 5.0) || totalSpan > 60.0) {
          isTrackInTimeline = true;
        }
      }

      if (isTrackInTimeline && charLines.length > 0 && trackFramesData) {
        intervals = this.refineAndAdaptIntervalsWithVocals(intervals, charLines, trackFramesData, vocalsFramesData, edgeStats);
      }

      // Monotonic corridor-guarded surgical subtitle matching for timeline tracks so no phrase ever steals an earlier unvoiced subtitle
      const matchedSubByInterval = new Array(intervals.length).fill(null);
      const matchedSubIdxByInterval = new Array(intervals.length).fill(-1);
      if (isTrackInTimeline && charLines.length > 0) {
        const usedSubIdx = new Set();
        const isMonotonicCompatible = (kIdx, sIdx) => {
          for (let i = 0; i < kIdx; i++) {
            if (matchedSubIdxByInterval[i] !== -1 && matchedSubIdxByInterval[i] >= sIdx) return false;
          }
          for (let i = kIdx + 1; i < intervals.length; i++) {
            if (matchedSubIdxByInterval[i] !== -1 && matchedSubIdxByInterval[i] <= sIdx) return false;
          }
          return true;
        };
        const isWithinCorridor = (kIdx, targetStartSec) => {
          const prevEnd = kIdx > 0 ? (intervals[kIdx - 1].endSec + 0.02) : 0;
          const nextStart = kIdx + 1 < intervals.length ? (intervals[kIdx + 1].startSec - 0.02) : Infinity;
          return targetStartSec >= prevEnd - 0.25 && (targetStartSec + Math.min(intervals[kIdx].durationSec, 1.0)) <= nextStart + 0.25;
        };

        const candidatePairs = [];
        for (let k = 0; k < intervals.length; k++) {
          if (intervals[k]._overrideSub) {
            matchedSubByInterval[k] = intervals[k]._overrideSub;
            const ovIdx = charLines.findIndex(cl => cl === intervals[k]._overrideSub || String(cl.id) === String(intervals[k]._overrideSub.id));
            if (ovIdx !== -1) {
              matchedSubIdxByInterval[k] = ovIdx;
              usedSubIdx.add(ovIdx);
            }
            continue;
          }
          const ivStart = intervals[k].startSec;
          for (let sIdx = 0; sIdx < charLines.length; sIdx++) {
            const sub = charLines[sIdx];
            const signedDiff = ivStart - sub.startSec;
            const diff = Math.abs(signedDiff);
            // Prevent a clip inside prevSub from matching next sub, or a clip after sub.endSec from being yanked back to an unvoiced earlier sub
            if (sIdx > 0 && ivStart <= charLines[sIdx - 1].endSec + 0.20 && sub.startSec - ivStart > 0.50) {
              continue;
            }
            if (sIdx + 1 < charLines.length && ivStart >= charLines[sIdx + 1].startSec - 0.15 && Math.abs(ivStart - charLines[sIdx + 1].startSec) < diff) {
              continue;
            }
            if (signedDiff >= -0.70 && signedDiff <= 1.35 && ivStart <= sub.endSec + 0.25 && isWithinCorridor(k, sub.startSec)) {
              candidatePairs.push({ k, sIdx, diff });
            }
          }
        }
        candidatePairs.sort((a, b) => a.diff - b.diff);
        for (const pair of candidatePairs) {
          if (matchedSubByInterval[pair.k] !== null || usedSubIdx.has(pair.sIdx)) continue;
          if (!isMonotonicCompatible(pair.k, pair.sIdx)) continue;
          matchedSubByInterval[pair.k] = charLines[pair.sIdx];
          matchedSubIdxByInterval[pair.k] = pair.sIdx;
          usedSubIdx.add(pair.sIdx);
        }
      }

      for (let k = 0; k < intervals.length; k++) {
        const interval = intervals[k];
        let subLine = matchedSubByInterval[k];

        if (track.isFix && !isTrackInTimeline) {
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
          if (!subLine && charLines.length > 0 && k < charLines.length) {
            subLine = charLines[k];
          }
        }

        const clipBounds = this.detectClipSpeechBoundsFromFrames(trackFramesData, interval.startSec, interval.endSec);
        const onsetOffsetSec = clipBounds.onsetOffsetSec;
        const speechOffsetSec = clipBounds.offsetSec;

        const hasMatchedSub = Boolean(subLine);
        const subStart = subLine ? subLine.startSec : interval.startSec;
        const subEnd = subLine ? subLine.endSec : interval.endSec;
        const subId = subLine ? String(subLine.id ?? subLine.rawLineIndex ?? k) : `track_${track.trackId}_${k}`;

        const anchor = interval._overrideAnchor
          ? interval._overrideAnchor
          : (subLine
            ? this.findOriginalVocalsAnchor(vocalsFramesData, subStart, subEnd)
            : { anchorStartSec: interval.startSec, anchorEndSec: interval.endSec, hasRefVocal: false });

        let initialStart = interval.startSec;
        if (!isTrackInTimeline && track.isFix) {
          initialStart = computeTargetClipStartSec({
            anchorStartSec: anchor.anchorStartSec,
            anchorEndSec: anchor.anchorEndSec,
            speechOnsetOffsetSec: onsetOffsetSec,
            hasRefVocal: anchor.hasRefVocal,
          });
        } else if (subLine) {
          const timingExempt = this.isPhraseTimingNotRequired(
            interval.startSec,
            interval.durationSec,
            anchor.anchorStartSec,
            anchor.anchorEndSec,
            onsetOffsetSec,
            speechOffsetSec,
            anchor.hasRefVocal
          );
          if (!timingExempt.notRequired) {
            const desiredClipStart = computeTargetClipStartSec({
              anchorStartSec: anchor.anchorStartSec,
              anchorEndSec: anchor.anchorEndSec,
              speechOnsetOffsetSec: onsetOffsetSec,
              hasRefVocal: anchor.hasRefVocal,
            });
            const rawDelta = desiredClipStart - interval.startSec;
            const maxAutoShift = getMaxSafeShiftSec(anchor.hasRefVocal);
            const prevEnd = k > 0 ? (phrases[k - 1].targetEndSec + intraTrackMinGapSec) : 0;
            const nextStart = (k + 1 < intervals.length) ? (intervals[k + 1].startSec - intraTrackMinGapSec) : Infinity;
            const clampedDelta = Math.max(-maxAutoShift, Math.min(maxAutoShift, rawDelta));
            let desiredStart = interval.startSec + clampedDelta;
            desiredStart = Math.max(prevEnd, Math.min(desiredStart, Math.max(prevEnd, nextStart - interval.durationSec)));
            desiredStart = Number(Math.max(0, desiredStart).toFixed(3));
            if (Math.abs(desiredStart - interval.startSec) >= TIMING_RULES.MIN_EFFECTIVE_SHIFT_SEC && Math.abs(desiredStart - desiredClipStart) < Math.abs(interval.startSec - desiredClipStart) - 0.02) {
              initialStart = desiredStart;
            }
          }
        }
        const effectiveDuration = interval.unscaledDurationSec ?? interval.durationSec;
        const initialEnd = Number((initialStart + effectiveDuration).toFixed(3));

        const phraseObj = {
          id: `phrase_${track.trackId}_${k}`,
          trackId: track.trackId,
          trackPath: track.trackPath,
          dubberNick: track.dubberNick,
          dubberId: track.dubberId,
          characterName: track.characterName,
          isFix: track.isFix || false,
          isPhysics: !track.isFix && isTrackInTimeline && !hasMatchedSub && charLines.length > 0,
          hasMatchedSub,
          indexInTrack: k,
          sourceStartSec: interval.startSec,
          sourceEndSec: interval.endSec,
          durationSec: effectiveDuration,
          unscaledDurationSec: effectiveDuration,
          internalPauseEdit: interval.internalPauseEdit || undefined,
          speechOnsetOffsetSec: onsetOffsetSec,
          speechOffsetSec: interval.internalPauseEdit
            ? Math.max(0.15, speechOffsetSec - ((interval.internalPauseEdit.pauseEndSec - interval.internalPauseEdit.pauseStartSec) - interval.internalPauseEdit.targetPauseSec))
            : speechOffsetSec,
          refVocalStartSec: anchor.refVocalStartSec,
          refVocalEndSec: anchor.refVocalEndSec,
          hasRefVocalAnchor: anchor.hasRefVocal,
          subStartSec: subStart,
          subEndSec: subEnd,
          subId: subId,
          subText: subLine?.text || '',
          targetStartSec: initialStart,
          targetEndSec: initialEnd,
          shiftDeltaSec: Number((initialStart - interval.startSec).toFixed(3)),
          collisionResolved: false,
          collisionDetails: null,
          isUnisonPhrase: false,
          isIntentionalSubOverlap: false
        };

        phrases.push(phraseObj);
        if (!track.isFix) {
          allProjectPhrases.push(phraseObj);
        }
      }

      this.enforceSameTrackMinGap(phrases, intraTrackMinGapSec);
      trackPhraseResults.push({
        track,
        phrases
      });
    }

    const collisionLogs = [];
    let totalCollisionsFound = 0;
    let totalCollisionsResolved = 0;
    let totalIntentionalOverlapsPreserved = 0;
    let unisonPhrasesCount = 0;

    // Правило 1 (Граничный случай): Умная синхронизация «Физики» по окну ±1.0с на original_vocals.wav
    edgeStats.physicsSyncedCount = this.applyPhysicsSmartSync(trackPhraseResults, vocalsFramesData, collisionLogs);

    // Правило 4 (Граничный случай): Кросс-спасение пропущенных фраз между актёрами
    edgeStats.crossRoleRescuedCount = this.rescueCrossRoleMissingPhrases(trackPhraseResults, vocalsFramesData, collisionLogs);

    // ПРАВИЛО 1: Если в сабах назначена на несколько дабберов ОДНА И ТА ЖЕ ФРАЗА,
    // такие фразы выравниваются в унисон по атаке голоса и эталону original_vocals.wav.
    const visitedUnison = new Set();
    for (let i = 0; i < allProjectPhrases.length; i++) {
      const pA = allProjectPhrases[i];
      if (visitedUnison.has(pA.id)) continue;

      const unisonGroup = [pA];
      for (let j = i + 1; j < allProjectPhrases.length; j++) {
        const pB = allProjectPhrases[j];
        if (pB.trackId === pA.trackId) continue;
        if (this.isSameSubtitlePhrase(pA, pB)) {
          unisonGroup.push(pB);
        }
      }

      if (unisonGroup.length >= 2) {
        const unisonAnchor = this.findOriginalVocalsAnchor(vocalsFramesData, pA.subStartSec, pA.subEndSec);
        for (const p of unisonGroup) {
          visitedUnison.add(p.id);
          const trResult = trackPhraseResults.find(tr => tr.track.trackId === p.trackId);
          const trPhrases = trResult ? trResult.phrases : [];
          const idx = p.indexInTrack;
          const prevEnd = idx > 0 && trPhrases[idx - 1] ? (trPhrases[idx - 1].targetEndSec + intraTrackMinGapSec) : 0;
          const nextStart = (idx + 1 < trPhrases.length && trPhrases[idx + 1]) ? (trPhrases[idx + 1].targetStartSec - intraTrackMinGapSec) : Infinity;
          const syncStartSec = Number(Math.max(0, unisonAnchor.anchorStartSec - (p.speechOnsetOffsetSec || 0)).toFixed(3));

          if (syncStartSec >= prevEnd && syncStartSec + p.durationSec <= nextStart && Math.abs(syncStartSec - p.sourceStartSec) <= 2.2) {
            p.targetStartSec = syncStartSec;
            p.targetEndSec = Number((syncStartSec + p.durationSec).toFixed(3));
            p.shiftDeltaSec = Number((p.targetStartSec - p.sourceStartSec).toFixed(3));
          }
          p.isUnisonPhrase = true;
        }
        unisonPhrasesCount += unisonGroup.length;
        const dubbersList = unisonGroup.map(u => `${u.dubberNick} (${u.characterName})`).join(', ');
        collisionLogs.push(`[${formatSeconds(unisonAnchor.anchorStartSec)}] 🔗 Синхронный унисон (атака голоса): «${(pA.subText || '').slice(0, 45)}» синхронизирована для: ${dubbersList}.`);
      }
    }

    // Сортируем все фразы хронологически после синхронизации унисонов
    allProjectPhrases.sort((a, b) => a.targetStartSec - b.targetStartSec);

    // ПРАВИЛО 2: Если РАЗНЫЕ фразы разных людей накладываются друг на друга и ЭТО ТАК В САБАХ —
    // это НЕ считается конфликтом, таймится в обычном порядке, но записывается и передается в модуль сведения.
    const intentionalOverlapsMap = new Map();

    for (let i = 0; i < allProjectPhrases.length; i++) {
      const current = allProjectPhrases[i];

      for (let j = i + 1; j < allProjectPhrases.length; j++) {
        const next = allProjectPhrases[j];

        if (next.targetStartSec >= current.targetEndSec + minGapSec - 0.001) {
          break;
        }

        if (current.trackId === next.trackId) continue;

        // 1. Проверка на одну и ту же фразу (Унисон) — синхронизация по атаке голоса
        if (this.isSameSubtitlePhrase(current, next) || (current.isUnisonPhrase && next.isUnisonPhrase && Math.abs(current.subStartSec - next.subStartSec) <= 0.08)) {
          const curVocalStart = current.targetStartSec + (current.speechOnsetOffsetSec || 0);
          const alignedNextStart = Number(Math.max(0, curVocalStart - (next.speechOnsetOffsetSec || 0)).toFixed(3));
          next.targetStartSec = alignedNextStart;
          next.targetEndSec = Number((next.targetStartSec + next.durationSec).toFixed(3));
          next.shiftDeltaSec = Number((next.targetStartSec - next.sourceStartSec).toFixed(3));
          current.isUnisonPhrase = true;
          next.isUnisonPhrase = true;
          continue;
        }

        // 2. Проверка намеренного наложения по единым правилам:
        //    перекрытие > 0.35 с, ИЛИ > 35% короткой фразы, ИЛИ пересечение в .ass субтитрах
        const overlapKey = `${current.subId}:${next.subId}`;
        const actualOverlapSec = Math.max(0, Math.min(current.targetEndSec, next.targetEndSec) - Math.max(current.targetStartSec, next.targetStartSec));
        const subOriginallyOverlapped = isIntentionalOverlapDecision({
          overlapSec: actualOverlapSec,
          earlyDurSec: current.durationSec,
          lateDurSec: next.durationSec,
          sub1: { id: current.subId, startSec: current.subStartSec, endSec: current.subEndSec },
          sub2: { id: next.subId, startSec: next.subStartSec, endSec: next.subEndSec },
          hasGlobalAssOverlap: subOverlapMatrix.has(overlapKey),
        });

        if (subOriginallyOverlapped) {
          totalIntentionalOverlapsPreserved++;
          current.isIntentionalSubOverlap = true;
          next.isIntentionalSubOverlap = true;
          next.intentionalOverlapWith = current.id;

          const ovStart = Number(Math.max(current.targetStartSec, next.targetStartSec).toFixed(2));
          const ovEnd = Number(Math.min(current.targetEndSec, next.targetEndSec).toFixed(2));
          const subOvStart = Number(Math.min(current.subStartSec, next.subStartSec).toFixed(2));
          const subOvEnd = Number(Math.max(current.subEndSec, next.subEndSec).toFixed(2));

          let matchedGroup = null;
          for (const grp of intentionalOverlapsMap.values()) {
            if (Math.min(grp.endSec, ovEnd) > Math.max(grp.startSec, ovStart) - 0.25) {
              matchedGroup = grp;
              break;
            }
          }

          const entryA = {
            trackId: current.trackId,
            dubberNick: current.dubberNick || 'Даббер 1',
            characterName: current.characterName || current.dubberNick || 'Персонаж 1',
            phraseId: current.id,
            subId: current.subId,
            text: current.subText || '',
            phraseStartSec: Number(current.targetStartSec.toFixed(2)),
            phraseEndSec: Number(current.targetEndSec.toFixed(2))
          };
          const entryB = {
            trackId: next.trackId,
            dubberNick: next.dubberNick || 'Даббер 2',
            characterName: next.characterName || next.dubberNick || 'Персонаж 2',
            phraseId: next.id,
            subId: next.subId,
            text: next.subText || '',
            phraseStartSec: Number(next.targetStartSec.toFixed(2)),
            phraseEndSec: Number(next.targetEndSec.toFixed(2))
          };

          if (!matchedGroup) {
            const groupId = `sub_overlap_${Math.round(subOvStart * 10)}_${current.subId}_${next.subId}`;
            matchedGroup = {
              id: groupId,
              startSec: Math.min(entryA.phraseStartSec, entryB.phraseStartSec),
              endSec: Math.max(entryA.phraseEndSec, entryB.phraseEndSec),
              overlapStartSec: ovStart,
              overlapEndSec: ovEnd,
              subStartSec: subOvStart,
              subEndSec: subOvEnd,
              priorityTrackKey: null,
              attenuationDb: -10,
              tracks: [entryA, entryB]
            };
            intentionalOverlapsMap.set(groupId, matchedGroup);
          } else {
            matchedGroup.startSec = Math.min(matchedGroup.startSec, entryA.phraseStartSec, entryB.phraseStartSec);
            matchedGroup.endSec = Math.max(matchedGroup.endSec, entryA.phraseEndSec, entryB.phraseEndSec);
            matchedGroup.overlapStartSec = Math.min(matchedGroup.overlapStartSec, ovStart);
            matchedGroup.overlapEndSec = Math.max(matchedGroup.overlapEndSec, ovEnd);
            if (!matchedGroup.tracks.some(t => t.dubberNick === entryA.dubberNick && t.phraseId === entryA.phraseId)) {
              matchedGroup.tracks.push(entryA);
            }
            if (!matchedGroup.tracks.some(t => t.dubberNick === entryB.dubberNick && t.phraseId === entryB.phraseId)) {
              matchedGroup.tracks.push(entryB);
            }
          }
          continue;
        }

        if (current.dubberNick && current.dubberNick === next.dubberNick && current.trackId !== next.trackId) {
          totalIntentionalOverlapsPreserved++;
          next.intentionalOverlapWith = current.id;
          continue;
        }

        if (!preventCollisions) {
          continue;
        }

        const collisionOverlapSec = (current.targetEndSec + minGapSec) - next.targetStartSec;
        // Защитный предел: разводим только случайные хвосты <= 1.25 с
        if (collisionOverlapSec > TIMING_RULES.MAX_SAFE_SHIFT_WITH_VOCALS_SEC) {
          continue;
        }

        totalCollisionsFound++;
        let remainingCollisionSec = collisionOverlapSec;

        // 1. Сначала подрезаем тихий post-roll хвост первой реплики (current), не затрагивая речь
        const currentSpeechEndFloor = typeof current.speechOffsetSec === 'number' && current.speechOffsetSec > 0
          ? Math.max(0.18, current.speechOffsetSec + 0.025)
          : Math.max(0.22, current.durationSec - 0.10);
        const maxCurrentTrim = Math.max(0, current.durationSec - currentSpeechEndFloor);
        if (maxCurrentTrim > 0.005) {
          const trim = Math.min(remainingCollisionSec, maxCurrentTrim);
          current.durationSec = Number((current.durationSec - trim).toFixed(3));
          current.sourceEndSec = Number((current.sourceStartSec + current.durationSec).toFixed(3));
          current.targetEndSec = Number((current.targetStartSec + current.durationSec).toFixed(3));
          remainingCollisionSec -= trim;
        }

        // 2. Сдвиг current влево разрешён ТОЛЬКО если current стоит правее своего эталонного якоря (не раньше оригинала!)
        if (remainingCollisionSec > 0.005 && i > 0) {
          const prev = allProjectPhrases[i - 1];
          const currentAnchorFloor = computeTargetClipStartSec({
            anchorStartSec: current.refVocalStartSec ?? current.subStartSec ?? current.targetStartSec,
            anchorEndSec: current.refVocalEndSec ?? current.subEndSec,
            speechOnsetOffsetSec: current.speechOnsetOffsetSec,
            hasRefVocal: Boolean(current.hasRefVocalAnchor),
          });
          const minAllowedCurrentStart = Math.max(prev.targetEndSec + minGapSec, currentAnchorFloor);
          const availableRoomBefore = Math.max(0, current.targetStartSec - minAllowedCurrentStart);
          if (availableRoomBefore > 0.02) {
            const earlyShiftSec = Math.min(availableRoomBefore, maxShiftEarlySec, remainingCollisionSec * 0.45);
            current.targetStartSec = Number(Math.max(0, current.targetStartSec - earlyShiftSec).toFixed(3));
            current.targetEndSec = Number((current.targetStartSec + current.durationSec).toFixed(3));
            remainingCollisionSec -= earlyShiftSec;
          }
        }

        const finalNextStart = current.targetEndSec + minGapSec;
        const delta = finalNextStart - next.targetStartSec;
        if (delta > 0 && delta <= TIMING_RULES.MAX_SAFE_SHIFT_WITH_VOCALS_SEC) {
          next.targetStartSec = Number(finalNextStart.toFixed(3));
          next.targetEndSec = Number((next.targetStartSec + next.durationSec).toFixed(3));
          next.shiftDeltaSec = Number((next.targetStartSec - next.sourceStartSec).toFixed(3));
          next.collisionResolved = true;
          totalCollisionsResolved++;

          const logMsg = `[${formatSeconds(current.targetStartSec)} - ${formatSeconds(next.targetEndSec)}] Хирургически разведена коллизия: фраза «${current.dubberNick}» (${current.characterName}) и «${next.dubberNick}» (${next.characterName}). Сдвиг: +${delta.toFixed(2)}с.`;
          collisionLogs.push(logMsg);
        }
      }
    }

    // Правило 3 (Граничный случай): Мягкий Time-Fit для длинных фраз с заблокированным сдвигом влево
    for (const trResult of trackPhraseResults) {
      if (!trResult.track?.isFix) {
        edgeStats.softTimeFitCount += this.applySoftTimeFitToTrackPhrases(
          trResult.phrases,
          allProjectPhrases,
          subOverlapMatrix,
          intraTrackMinGapSec,
          collisionLogs
        );
      }
    }

    // Финальная пост-проверка 40 мс зазоров внутри каждой дорожки после всех сдвигов и разведений коллизий
    for (const trResult of trackPhraseResults) {
      this.enforceSameTrackMinGap(trResult.phrases, intraTrackMinGapSec);
    }

    const intentionalOverlaps = Array.from(intentionalOverlapsMap.values()).sort((a, b) => a.startSec - b.startSec);
    if (intentionalOverlaps.length > 0) {
      collisionLogs.push(`📋 Зафиксировано ${intentionalOverlaps.length} моментов наложения разных фраз по субтитрам — переданы в Сведение для выбора приоритетной дорожки (-10 дБ остальным).`);
    }

    return {
      trackPhraseResults,
      allProjectPhrases,
      subOverlapMatrix,
      intentionalOverlaps,
      unisonPhrasesCount,
      hasOriginalVocalsAnchor: Boolean(vocalsFramesData),
      stats: {
        totalTracks: matchedTracks.length,
        totalPhrases: allProjectPhrases.length,
        totalCollisionsFound,
        totalCollisionsResolved,
        totalIntentionalOverlapsPreserved,
        unisonPhrasesCount,
        intentionalOverlapsCount: intentionalOverlaps.length,
        ...edgeStats
      },
      collisionLogs
    };
  }

  /**
   * Слияние правок (FIX) с оригинальными дорожками с защитой от хвостов и каскадным сдвигом.
   */
  static smartApplyFixesToTimedTracks(timingResult, options = {}) {
    const minGapSec = Number(options.minGapSec ?? TIMING_RULES.MIN_SAME_TRACK_GAP_SEC);
    const cleanLeftoverTails = options.cleanLeftoverTails !== false;
    const adjustLongerCollisions = options.adjustLongerCollisions !== false;
    const safetyPaddingMs = Number(options.safetyPaddingMs ?? 80);
    const fadeDurationMs = Number(options.fadeDurationMs ?? 8);
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

      // Находим все дорожки этого актёра (если их 2: дорожка 1 и дорожка 2)
      const actorOrigItems = originalTracks.filter(t => 
        (fixTrack.dubberId && t.track.dubberId === fixTrack.dubberId) ||
        (t.track.characterName === fixTrack.characterName) ||
        (t.track.dubberNick && fixTrack.dubberNick && isNameMatch(t.track.dubberNick, fixTrack.dubberNick))
      );

      if (actorOrigItems.length === 0) {
        const standaloneItem = {
          track: { ...fixTrack, isFix: false },
          phrases: fixPhrases
        };
        originalTracks.push(standaloneItem);
        continue;
      }

      for (const fixPhrase of fixPhrases) {
        let bestOrigItem = null;
        let matchedOrigIdx = -1;
        let minDiff = Infinity;

        // Ищем, в какой именно из дорожек даббера присутствует эта фраза (по subId или таймкоду)
        for (const origItem of actorOrigItems) {
          const origPhrases = origItem.phrases;
          for (let i = 0; i < origPhrases.length; i++) {
            const origP = origPhrases[i];
            if (origP.subId && fixPhrase.subId && origP.subId === fixPhrase.subId) {
              bestOrigItem = origItem;
              matchedOrigIdx = i;
              minDiff = 0;
              break;
            }
            const diff = Math.abs(origP.subStartSec - fixPhrase.subStartSec);
            if (diff < minDiff && diff < 3.0) {
              minDiff = diff;
              bestOrigItem = origItem;
              matchedOrigIdx = i;
            }
          }
          if (minDiff === 0) break;
        }

        if (bestOrigItem && matchedOrigIdx >= 0) {
          const origPhrases = bestOrigItem.phrases;
          const oldOrigPhrase = origPhrases[matchedOrigIdx];
          fixesAppliedCount++;

          const origDuration = oldOrigPhrase.durationSec;
          const fixDuration = fixPhrase.durationSec;
          const durDiff = fixDuration - origDuration;

          if (cleanLeftoverTails && durDiff < -0.05) {
            leftoverTailsCleanedCount++;
            const tailSec = Math.abs(durDiff);
            const tailMsg = `Фраза фикса короче оригинала на ${tailSec.toFixed(2)}с. Старая фраза полностью обнулена/заглушена (защитный интервал ${safetyPaddingMs}мс), хвост удален.`;
            fixLogs.push(`[${formatSeconds(oldOrigPhrase.targetStartSec)}] Даббер «${bestOrigItem.track.dubberNick}»: ${tailMsg}`);
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
            fixDurationSec: fixDuration,
            cleanLeftoverTails,
            safetyPaddingMs,
            fadeDurationMs
          };

          origPhrases[matchedOrigIdx] = replacedPhrase;

          // Каскадный сдвиг (Ripple Shift) при удлинении дубля фикса
          if (adjustLongerCollisions && durDiff > 0.05 && matchedOrigIdx + 1 < origPhrases.length) {
            const nextPhrase = origPhrases[matchedOrigIdx + 1];
            if (replacedPhrase.targetEndSec + minGapSec > nextPhrase.targetStartSec) {
              longerFixCollisionsAdjustedCount++;
              const pushDelta = (replacedPhrase.targetEndSec + minGapSec) - nextPhrase.targetStartSec;
              
              const logMsg = `Фраза фикса длиннее оригинала на ${durDiff.toFixed(2)}с и перекрывала следующую фразу. Каскадный сдвиг (ripple shift) на +${pushDelta.toFixed(2)}с вперед.`;
              fixLogs.push(`[${formatSeconds(nextPhrase.targetStartSec)}] Даббер «${bestOrigItem.track.dubberNick}»: ${logMsg}`);
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

    for (const item of originalTracks) {
      this.enforceSameTrackMinGap(item.phrases, TIMING_RULES.MIN_SAME_TRACK_GAP_SEC);
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
   * Декодирует срез аудиофайла с pitch-preserving изменением темпа (-af atempo=...) в .raw PCM файл.
   */
  static decodeStretchedSliceToPcmFile(audioPath, startSec, durationSec, rate, outRawPath, sampleRate = 48000, channels = 2) {
    return new Promise((resolve, reject) => {
      let killed = false;
      const safeRate = Math.max(0.5, Math.min(2.0, Number(rate || 1.0)));
      const ffmpegCmd = ffmpeg(audioPath)
        .noVideo()
        .inputOptions(['-ss', String(Math.max(0, startSec)), '-t', String(Math.max(0.05, durationSec))])
        .audioFilters(`atempo=${safeRate.toFixed(4)}`)
        .audioCodec('pcm_s16le')
        .audioFrequency(sampleRate)
        .audioChannels(channels)
        .outputOptions(['-ar', String(sampleRate), '-ac', String(channels), '-f', 's16le'])
        .output(outRawPath);

      const timeout = setTimeout(() => {
        killed = true;
        try { ffmpegCmd.kill('SIGKILL'); } catch (e) {}
        reject(new Error(`Таймаут atempo декодирования PCM slice: ${audioPath}`));
      }, 60000);

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
   * ПОТОКОВАЯ СБОРКА АУДИОДОРОЖКИ С МИНИМАЛЬНЫМ ПОТРЕБЛЕНИЕМ RAM (< 20 МБ):
   * 1. Исходные файлы стримятся в 48kHz 16-bit stereo .raw файлы на диске.
   * 2. Аудио рендерится блоками (чанками по 10 секунд) непосредственно в выходной WAV файл.
   * 3. Поддерживает сжатие внутренних пауз (Rule 2B internalPauseEdit) и pitch-preserving atempo (Rule 3 playbackRate).
   * 4. Адаптивный pre-roll / post-roll с Hann window fade-in / fade-out.
   */
  static async assembleMultiSourceTrack(defaultInputPath, phrases, outputAudioPath, options = {}) {
    const sampleRate = 48000;
    const channels = 2;
    const bytesPerSampleFrame = 4; // 2 канала * 2 байта (16-bit)
    const bytesPerSec = sampleRate * bytesPerSampleFrame; // 192,000 байт/сек

    // 0. Раскрытие фраз с internalPauseEdit в два бесшовных склеиваемых суб-сегмента
    const renderPhrases = [];
    for (const p of (phrases || [])) {
      const rate = Number(p.playbackRate || p.timeStretch || 1.0);
      const srcStart = typeof p.sourceStartSec === 'number' ? p.sourceStartSec : 0;
      const srcEnd = typeof p.sourceEndSec === 'number' ? p.sourceEndSec : (srcStart + (p.durationSec || 1.0));
      const trgStart = typeof p.targetStartSec === 'number' ? p.targetStartSec : 0;

      if (p.internalPauseEdit && p.internalPauseEdit.pauseEndSec > p.internalPauseEdit.pauseStartSec) {
        const halfTargetPause = Math.max(0.02, (p.internalPauseEdit.targetPauseSec ?? 0.12) * 0.5);
        const s1End = Math.min(srcEnd, p.internalPauseEdit.pauseStartSec + halfTargetPause);
        const s2Start = Math.max(s1End, p.internalPauseEdit.pauseEndSec - halfTargetPause);
        const s1Unscaled = Math.max(0.05, s1End - srcStart);
        const s2Unscaled = Math.max(0.05, srcEnd - s2Start);
        const s1Dur = Number((s1Unscaled / (rate > 1.005 ? rate : 1.0)).toFixed(3));
        const s2Dur = Number((s2Unscaled / (rate > 1.005 ? rate : 1.0)).toFixed(3));

        renderPhrases.push({
          ...p,
          id: `${p.id}_ps1`,
          sourceStartSec: srcStart,
          sourceEndSec: Number(s1End.toFixed(3)),
          durationSec: s1Dur,
          targetStartSec: trgStart,
          targetEndSec: Number((trgStart + s1Dur).toFixed(3)),
          suppressPostSafety: true
        });
        renderPhrases.push({
          ...p,
          id: `${p.id}_ps2`,
          sourceStartSec: Number(s2Start.toFixed(3)),
          sourceEndSec: srcEnd,
          durationSec: s2Dur,
          targetStartSec: Number((trgStart + s1Dur).toFixed(3)),
          targetEndSec: Number((trgStart + s1Dur + s2Dur).toFixed(3)),
          suppressPreSafety: true
        });
      } else {
        renderPhrases.push({ ...p });
      }
    }

    // 1. Сбор всех уникальных исходных путей
    const sourcePaths = new Set([defaultInputPath]);
    for (const p of renderPhrases) {
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

      // 2B. Предрендеринг сегментов с pitch-preserving atempo (Rule 3: Soft Time-Fit [1.03..1.18])
      for (let rIdx = 0; rIdx < renderPhrases.length; rIdx++) {
        const seg = renderPhrases[rIdx];
        const rate = Number(seg.playbackRate || seg.timeStretch || 1.0);
        if (rate <= 1.005) continue;

        const origSrc = seg.sourceAudioPath || defaultInputPath;
        if (!origSrc || !fs.existsSync(origSrc)) continue;

        const sStart = typeof seg.sourceStartSec === 'number' ? seg.sourceStartSec : 0;
        const sEnd = typeof seg.sourceEndSec === 'number' ? seg.sourceEndSec : (sStart + (seg.durationSec || 1.0));
        const rawSliceDur = Math.max(0.05, sEnd - sStart);
        const stretchedRawPath = path.join(tempDir, `temp_atempo_${Date.now()}_${rIdx}_${Math.random().toString(36).slice(2, 6)}.raw`);

        try {
          await this.decodeStretchedSliceToPcmFile(origSrc, sStart, rawSliceDur, rate, stretchedRawPath, sampleRate, channels);
          const statSize = fs.statSync(stretchedRawPath).size;
          const actualStretchedSec = Math.floor(statSize / bytesPerSampleFrame) / sampleRate;
          if (actualStretchedSec > 0.04) {
            const syntheticKey = `__atempo_${rIdx}_${stretchedRawPath}`;
            rawPcmFilesMap.set(syntheticKey, stretchedRawPath);
            tempRawFilesToCleanup.push(stretchedRawPath);
            seg.sourceAudioPath = syntheticKey;
            seg.sourceStartSec = 0;
            seg.sourceEndSec = Number(actualStretchedSec.toFixed(4));
            seg.durationSec = Number(actualStretchedSec.toFixed(4));
            seg.targetEndSec = Number(((seg.targetStartSec || 0) + actualStretchedSec).toFixed(4));
            seg.suppressPreSafety = true;
            seg.suppressPostSafety = true;
          }
        } catch (atempoErr) {
          log.warn(`[AutoTiming] Ошибка atempo x${rate} для сегмента ${seg.id}:`, atempoErr.message);
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
      for (const p of renderPhrases) {
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

      // 6. Потоковый рендеринг чанками по 10 секунд (Float32 микширование с нулевым искажением)
      const CHUNK_DURATION_SEC = 10.0;
      const samplesPerChunk = Math.round(CHUNK_DURATION_SEC * sampleRate);
      const bytesPerChunk = samplesPerChunk * bytesPerSampleFrame;
      const totalChunks = Math.ceil(maxSec / CHUNK_DURATION_SEC);
      const chunkBuffer = Buffer.alloc(bytesPerChunk, 0);
      const floatChunk = new Float32Array(samplesPerChunk * channels);

      // Параметры атак и затуханий:
      // При экспорте из тайминга (renderFromClips / exactTimelineRender) границы фраз УЖЕ точно выставлены
      // пользователем/детектором тишины. Смещение назад (pre-roll) и вперед (post-roll) отключаются,
      // чтобы фразы не наезжали друг на друга и не создавали искусственных перегрузок звука.
      const isExactTimingExport = Boolean(options.renderFromClips || options.exactTimelineRender);
      const customSafetySec = options.safetyPaddingMs !== undefined
        ? Math.max(0.0, Number(options.safetyPaddingMs) / 1000.0)
        : (isExactTimingExport ? 0.0 : 0.090);
      const safetyPreSec = customSafetySec;
      const safetyPostSec = options.safetyPaddingMs !== undefined
        ? Math.max(0.0, (Number(options.safetyPaddingMs) * 1.8) / 1000.0)
        : (isExactTimingExport ? 0.0 : 0.180);
      const customFadeSec = options.fadeDurationMs !== undefined
        ? Math.max(0.001, Number(options.fadeDurationMs) / 1000.0)
        : null;
      const fadeSamplesIn = customFadeSec !== null
        ? Math.max(48, Math.floor(sampleRate * customFadeSec))
        : (isExactTimingExport
            ? Math.min(384, Math.floor(sampleRate * 0.008))
            : Math.min(480, Math.floor(sampleRate * 0.010)));
      const fadeSamplesOut = customFadeSec !== null
        ? Math.max(48, Math.floor(sampleRate * customFadeSec * 1.25))
        : (isExactTimingExport
            ? Math.min(384, Math.floor(sampleRate * 0.008))
            : Math.min(720, Math.floor(sampleRate * 0.015)));
      const cleanLeftoverTails = options.cleanLeftoverTails !== false;

      let totalPcmBytesWritten = 0;

      for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
        const chunkStartSec = cIdx * CHUNK_DURATION_SEC;
        const chunkEndSec = Math.min(maxSec, chunkStartSec + CHUNK_DURATION_SEC);
        const currentChunkSec = chunkEndSec - chunkStartSec;
        const currentChunkBytes = Math.round(currentChunkSec * sampleRate) * bytesPerSampleFrame;

        if (currentChunkBytes <= 0) break;

        // Очищаем плавающий и PCM буферы чанка
        chunkBuffer.fill(0, 0, currentChunkBytes);
        floatChunk.fill(0.0);

        // Шаг А: Если таймлайн-дорожка, читаем базовый непрерывный PCM из файла и переводим в Float32
        if (isTimelineTrack && defaultFdInfo) {
          const startByteOffset = Math.floor(chunkStartSec * bytesPerSec);
          const availableBytes = Math.max(0, Math.min(currentChunkBytes, defaultFdInfo.size - startByteOffset));
          if (availableBytes > 0) {
            const rawTimelineBuf = Buffer.alloc(availableBytes);
            fs.readSync(defaultFdInfo.fd, rawTimelineBuf, 0, availableBytes, startByteOffset);
            const availableFrames = Math.floor(availableBytes / bytesPerSampleFrame);
            for (let s = 0; s < availableFrames; s++) {
              floatChunk[s * 2] = rawTimelineBuf.readInt16LE(s * 4) / 32768.0;
              floatChunk[s * 2 + 1] = rawTimelineBuf.readInt16LE(s * 4 + 2) / 32768.0;
            }
          }
        }

        // Шаг Б: Зануление областей заменяемых правок в таймлайн-дорожках
        if (isTimelineTrack && cleanLeftoverTails) {
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
                  floatChunk[s * 2] = 0.0;
                  floatChunk[s * 2 + 1] = 0.0;
                }
              }
            }
          }
        }

        // Шаг В: Наложение фраз, пересекающих текущий чанк (в 32-битном Float формате)
        for (const p of renderPhrases) {
          if (isTimelineTrack && !p.isReplacedByFix && (!p.collisionResolved || Math.abs(p.shiftDeltaSec) <= 0.03)) {
            // Фраза уже находится на своем месте в базовом таймлайн-аудио
            continue;
          }

          const srcFdInfo = fdsMap.get(p.sourceAudioPath || defaultInputPath) || defaultFdInfo;
          if (!srcFdInfo) continue;

          // Расчет исходных границ считывания с учетом доступных пред- и пост-интервалов
          const srcTotalFrames = Math.floor(srcFdInfo.size / bytesPerSampleFrame);
          const srcDurationSec = srcTotalFrames / sampleRate;
          const srcStart = typeof p.sourceStartSec === 'number' ? p.sourceStartSec : 0;
          const srcEnd = typeof p.sourceEndSec === 'number' ? p.sourceEndSec : (srcStart + (p.durationSec || 1.0));
          const trgStart = typeof p.targetStartSec === 'number' ? p.targetStartSec : 0;

          const effPreSafety = p.suppressPreSafety ? 0 : safetyPreSec;
          const effPostSafety = p.suppressPostSafety ? 0 : safetyPostSec;
          const availablePreSec = Math.max(0, Math.min(effPreSafety, srcStart, trgStart));
          const availablePostSec = Math.max(0, Math.min(effPostSafety, srcDurationSec - srcEnd));

          const rawSrcStartSec = srcStart - availablePreSec;
          const rawSrcEndSec = srcEnd + availablePostSec;
          const totalPhraseDuration = Math.max(0, rawSrcEndSec - rawSrcStartSec);
          const totalPhraseSamples = Math.round(totalPhraseDuration * sampleRate);
          if (totalPhraseSamples <= 0) continue;

          const phraseTargetStart = trgStart - availablePreSec;
          const phraseTargetEnd = phraseTargetStart + totalPhraseDuration;

          // Проверяем пересечение с текущим чанком
          if (phraseTargetEnd <= chunkStartSec || phraseTargetStart >= chunkEndSec) {
            continue;
          }

          // Расчет относительного смещения внутри чанка (строго в целых сэмплах!)
          const overlapStartSec = Math.max(chunkStartSec, phraseTargetStart);
          const overlapEndSec = Math.min(chunkEndSec, phraseTargetEnd);

          const phraseSampleOffsetStart = Math.max(0, Math.round((overlapStartSec - phraseTargetStart) * sampleRate));
          const phraseSampleOffsetEnd = Math.min(totalPhraseSamples, Math.round((overlapEndSec - phraseTargetStart) * sampleRate));
          const samplesToProcess = phraseSampleOffsetEnd - phraseSampleOffsetStart;
          if (samplesToProcess <= 0) continue;

          // Строго фрейм-выровненный расчет байтов источника (кратно 4 байтам!)
          // Исключает чтение через границу сэмпла (главная причина дисторсии и треска перегруза)
          const rawSrcStartSample = Math.max(0, Math.round(rawSrcStartSec * sampleRate));
          const srcGlobalFrameIdx = rawSrcStartSample + phraseSampleOffsetStart;
          const srcStartByte = srcGlobalFrameIdx * bytesPerSampleFrame;

          if (srcStartByte >= srcFdInfo.size) continue;
          const bytesToRead = samplesToProcess * bytesPerSampleFrame;
          const availableBytes = srcFdInfo.size - srcStartByte;
          const safeFramesToRead = Math.min(samplesToProcess, Math.floor(availableBytes / bytesPerSampleFrame));
          if (safeFramesToRead <= 0) continue;
          const actualBytesToRead = safeFramesToRead * bytesPerSampleFrame;

          // Временный буфер для одной обрабатываемой фразы
          const phraseTempBuf = Buffer.alloc(actualBytesToRead);
          fs.readSync(srcFdInfo.fd, phraseTempBuf, 0, actualBytesToRead, srcStartByte);

          // Определение множителя громкости
          // При экспорте из тайминга строго сохраняем исходный 100% уровень дорожек без нормализаций и изменений
          let volScale = 1.0;
          if (!isExactTimingExport && !options.timingExport) {
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
            volScale = Math.max(0, (volPct ?? 100) / 100.0);
          }

          const curFadeIn = Math.min(fadeSamplesIn, Math.floor(totalPhraseSamples / 8));
          const curFadeOut = Math.min(fadeSamplesOut, Math.floor(totalPhraseSamples / 6));

          const chunkLocalStartSample = Math.max(0, Math.round((overlapStartSec - chunkStartSec) * sampleRate));

          for (let s = 0; s < safeFramesToRead; s++) {
            const globalPhraseSampleIdx = phraseSampleOffsetStart + s;
            const srcOffset = s * bytesPerSampleFrame;
            const dstSampleIdx = chunkLocalStartSample + s;

            if (srcOffset + 4 > actualBytesToRead || dstSampleIdx >= samplesPerChunk) break;

            // S-образное окно (Hann window) для атак и затуханий:
            let fade = 1.0;
            if (curFadeIn > 0 && globalPhraseSampleIdx < curFadeIn) {
              fade = 0.5 * (1 - Math.cos((Math.PI * globalPhraseSampleIdx) / curFadeIn));
            } else if (curFadeOut > 0 && globalPhraseSampleIdx > totalPhraseSamples - curFadeOut) {
              const outIdx = globalPhraseSampleIdx - (totalPhraseSamples - curFadeOut);
              fade = 0.5 * (1 + Math.cos((Math.PI * outIdx) / curFadeOut));
            }

            const rawLeft = phraseTempBuf.readInt16LE(srcOffset);
            const rawRight = phraseTempBuf.readInt16LE(srcOffset + 2);
            
            const fLeft = (rawLeft / 32768.0) * fade * volScale;
            const fRight = (rawRight / 32768.0) * fade * volScale;

            const dstOffset = dstSampleIdx * 2;
            if (isTimelineTrack) {
              floatChunk[dstOffset] = fLeft;
              floatChunk[dstOffset + 1] = fRight;
            } else if (isExactTimingExport || options.timingExport) {
              // Внутри отдельной дорожки не суммируем амплитуды, чтобы избежать клиппинга и искажений
              floatChunk[dstOffset] = fLeft;
              floatChunk[dstOffset + 1] = fRight;
            } else {
              floatChunk[dstOffset] += fLeft;
              floatChunk[dstOffset + 1] += fRight;
            }
          }
        }

        // Конвертация Float32 -> 16-bit PCM (Int16LE) с безопасным ограничением
        const totalFramesInChunk = Math.floor(currentChunkBytes / bytesPerSampleFrame);
        for (let s = 0; s < totalFramesInChunk; s++) {
          const pcmL = floatToPcm16(floatChunk[s * 2]);
          const pcmR = floatToPcm16(floatChunk[s * 2 + 1]);
          chunkBuffer.writeInt16LE(pcmL, s * bytesPerSampleFrame);
          chunkBuffer.writeInt16LE(pcmR, s * bytesPerSampleFrame + 2);
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

    const useMixingPrefix = Boolean(options?.forMixing || options?.useMixingPrefix || !baseVideoName);
    const rawDir = useMixingPrefix ? path.join(targetDir, '00_исходные') : null;
    if (rawDir && fs.existsSync(targetDir)) {
      try { fs.mkdirSync(rawDir, { recursive: true }); } catch (e) {}
    }

    const { sanitizeDubberNick } = require('../lib/pathSanitizer.cjs');

    const getCleanTrackNick = (rawNick) => {
      const stripped = String(rawNick || 'Даббер')
        .replace(/\[.*\]/g, '')
        .replace(/_?(дорожка|слой|take|layer|фикс|fix)\s*\d*/gi, '')
        .replace(/[`'"]/g, '')
        .replace(/[^\w\d\s\u0400-\u04FF_-]/g, '')
        .trim();
      return sanitizeDubberNick(stripped || 'dubber', 'dubber');
    };

    for (let tIdx = 0; tIdx < tracksToRender.length; tIdx++) {
      const item = tracksToRender[tIdx];
      const { track, phrases } = item;
      const nick = track.dubberNick || 'Даббер';
      const cleanNick = getCleanTrackNick(nick);

      const sameNickTracks = tracksToRender.filter(t => getCleanTrackNick(t.track?.dubberNick || 'Даббер').toLowerCase() === cleanNick.toLowerCase());
      const isMultiTrack = sameNickTracks.length > 1;
      const subIdx = track.subTrackIndex || (sameNickTracks.indexOf(item) + 1);

      const outFilename = useMixingPrefix
        ? (isMultiTrack ? `00_timed_${cleanNick}_дорожка${subIdx}.wav` : `00_timed_${cleanNick}.wav`)
        : (isMultiTrack ? `${baseVideoName}_[${cleanNick}]_дорожка${subIdx}.wav` : `${baseVideoName}_[${cleanNick}].wav`);
      const outFilePath = path.join(targetDir, outFilename);
      const outRawFilePath = rawDir ? path.join(rawDir, outFilename) : null;

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
        if (outRawFilePath) {
          try { await fs.promises.copyFile(outFilePath, outRawFilePath); } catch (e) {}
        }
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
        if (outRawFilePath) {
          try { await fs.promises.copyFile(outFilePath, outRawFilePath); } catch (e) {}
        }
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
        if (outRawFilePath) {
          try { await fs.promises.copyFile(outFilePath, outRawFilePath); } catch (e) {}
        }
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
    const cleanupDirs = [targetDir, rawDir].filter(Boolean);
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
      const timingJsonPath = path.join(targetDir, 'timing_metadata.json');
      let existingPriorities = {};
      if (fs.existsSync(timingJsonPath)) {
        try {
          const prevMeta = JSON.parse(await fs.promises.readFile(timingJsonPath, 'utf-8'));
          if (Array.isArray(prevMeta.intentionalOverlaps)) {
            for (const ov of prevMeta.intentionalOverlaps) {
              if (ov && ov.id && ov.priorityTrackKey) {
                existingPriorities[ov.id] = ov.priorityTrackKey;
              }
            }
          }
        } catch (e) {}
      }

      const intentionalOverlaps = (mergedResult.intentionalOverlaps || []).map(ov => ({
        ...ov,
        priorityTrackKey: ov.priorityTrackKey || existingPriorities[ov.id] || null,
        attenuationDb: -10
      }));

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        baseVideoName,
        unisonPhrasesCount: mergedResult.unisonPhrasesCount || 0,
        intentionalOverlaps,
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
              isUnisonPhrase: Boolean(p.isUnisonPhrase),
              isIntentionalSubOverlap: Boolean(p.isIntentionalSubOverlap),
              volumePercent: volPct,
              volumeGainDb: Number((20 * Math.log10(Math.max(10, volPct) / 100)).toFixed(2))
            };
          });
        })
      };

      const volumeJsonPath = path.join(targetDir, 'phrase_volume_map.json');
      const analysisJsonPath = path.join(targetDir, 'timing_project.analysis.json');
      await fs.promises.writeFile(timingJsonPath, JSON.stringify(timingMetadata, null, 2), 'utf-8');
      await fs.promises.writeFile(volumeJsonPath, JSON.stringify(timingMetadata, null, 2), 'utf-8');
      await fs.promises.writeFile(analysisJsonPath, JSON.stringify(timingMetadata, null, 2), 'utf-8');
      log.info(`[AutoTiming] Сохранены timing_metadata.json, phrase_volume_map.json и timing_project.analysis.json в: ${targetDir} (пересечений фраз: ${intentionalOverlaps.length})`);
      if (onLog) onLog(`Карта громкостей фраз и ${intentionalOverlaps.length} моментов наложения субтитров сохранены в сведение: timing_metadata.json`);
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
