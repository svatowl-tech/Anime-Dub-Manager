const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');
const iconv = require('iconv-lite');
const jschardet = require('jschardet');

const SIGN_KEYWORDS = ["НАДПИСЬ", "Надпись", "надпись", "НАДПИСИ", "Надписи", "надписи", "SIGNS", "Signs", "signs", "SIGN", "Sign", "sign", "TEXT", "Text", "text", "ТЕКСТ", "Текст", "текст", '"текст"'];

// Cache for parsed subtitles to avoid memory spikes when multiple components request the same file concurrently
const subtitleCache = new Map();
const groupKeywords = ["гуры", "все"];

/**
 * Чтение текстового файла с автоопределением кодировки (UTF-8, UTF-16, Windows-1251 и т.д.)
 */
async function readTextFileWithAutoEncoding(filePath) {
  const startTime = Date.now();
  const buffer = await fs.readFile(filePath);
  if (!buffer || buffer.length === 0) {
    log.info(`[SubtitleService] File ${filePath} is empty (0 bytes).`);
    return '';
  }

  // Check UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    log.debug(`[SubtitleService] Detected UTF-8 BOM for ${filePath} (${buffer.length} bytes, ${Date.now() - startTime}ms)`);
    return buffer.subarray(3).toString('utf-8');
  }
  // Check UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    log.debug(`[SubtitleService] Detected UTF-16 LE BOM for ${filePath}`);
    return iconv.decode(buffer.subarray(2), 'utf16-le');
  }
  // Check UTF-16 BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    log.debug(`[SubtitleService] Detected UTF-16 BE BOM for ${filePath}`);
    return iconv.decode(buffer.subarray(2), 'utf16-be');
  }

  // Detect encoding via jschardet
  const detected = jschardet.detect(buffer);
  let encoding = detected && detected.encoding ? detected.encoding.toLowerCase() : 'utf-8';

  // Fallback heuristics for Cyrillic legacy encodings (Windows-1251)
  const isCyrillicEncoding = encoding.includes('1251') || encoding.includes('cp1251') || encoding.includes('ibm866') || encoding.includes('iso-8859-5');

  if (!detected || detected.confidence < 0.4 || encoding === 'ascii') {
    // If utf-8 string contains replacement character '\uFFFD', test win1251
    const utf8Str = buffer.toString('utf-8');
    if (utf8Str.includes('\uFFFD')) {
      encoding = 'win1251';
    } else {
      encoding = 'utf-8';
    }
  } else if (isCyrillicEncoding) {
    encoding = 'win1251';
  }

  try {
    log.debug(`[SubtitleService] Decoded ${filePath} using ${encoding} (confidence: ${detected?.confidence || 'N/A'}, size: ${buffer.length}B in ${Date.now() - startTime}ms)`);
    if (encoding === 'utf-8' || encoding === 'utf8') {
      return buffer.toString('utf-8');
    }
    if (iconv.encodingExists(encoding)) {
      return iconv.decode(buffer, encoding);
    }
    return iconv.decode(buffer, 'win1251');
  } catch (err) {
    log.warn(`[SubtitleService] Failed to decode file ${filePath} with encoding ${encoding}, falling back to utf-8:`, err.message);
    return buffer.toString('utf-8');
  }
}

function assTimeToSrtTime(assTime) {
  const parts = assTime.split(':');
  if (parts.length !== 3) return '00:00:00,000';
  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  const sParts = parts[2].split('.');
  const s = sParts[0].padStart(2, '0');
  const ms = (sParts[1] || '00').padEnd(3, '0').substring(0, 3);
  return `${h}:${m}:${s},${ms}`;
}

function timeToMs(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const sParts = parts[2].split('.');
  const s = parseInt(sParts[0], 10) || 0;
  const cs = parseInt(sParts[1] || '00', 10) || 0;
  return h * 3600000 + m * 60000 + s * 1000 + cs * 10;
}

function msToTime(ms) {
  if (ms < 0) ms = 0;
  const cs = Math.floor((ms % 1000) / 10);
  const s = Math.floor((ms / 1000) % 60);
  const m = Math.floor((ms / 60000) % 60);
  const h = Math.floor(ms / 3600000);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

async function autoFixSubtitles(assFilePath) {
  log.info(`[SubtitleService] Starting auto-fix for subtitles: ${assFilePath}`);
  const startTime = Date.now();
  const data = await getRawSubtitles(assFilePath);
  let lines = data.lines || [];
  
  let removedCount = 0;
  let overlappingCount = 0;
  let spaceCount = 0;
  let updates = [];

  // Track valid lines to fix overlapping later
  let validLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = { ...lines[i] };
    const textClean = cleanAssText(line.text || '').trim();

    // 1. Remove empty lines
    if (!textClean) {
      removedCount++;
      updates.push({ rawLineIndex: line.rawLineIndex, delete: true });
      continue;
    }

    // 2. Fix double spaces (ignoring ASS tags for simplicity or fixing inside text)
    let needsUpdate = false;
    if (line.text && line.text.includes('  ')) {
      const oldText = line.text;
      line.text = line.text.replace(/ {2,}/g, ' ');
      if (oldText !== line.text) {
        spaceCount++;
        needsUpdate = true;
      }
    }

    validLines.push({ line, needsUpdate });
  }

  // 3. Fix overlapping times
  validLines.sort((a, b) => timeToMs(a.line.start) - timeToMs(b.line.start));
  for (let i = 0; i < validLines.length - 1; i++) {
    const currentEndMs = timeToMs(validLines[i].line.end);
    const nextStartMs = timeToMs(validLines[i + 1].line.start);
    if (currentEndMs > nextStartMs) {
      validLines[i].line.end = msToTime(Math.max(timeToMs(validLines[i].line.start), nextStartMs - 10)); // 10ms gap
      validLines[i].needsUpdate = true;
      overlappingCount++;
    }
  }

  for (const { line, needsUpdate } of validLines) {
    if (needsUpdate) {
      updates.push({
        rawLineIndex: line.rawLineIndex,
        text: line.text,
        start: line.start,
        end: line.end
      });
    }
  }

  // Save the cleaned up lines without destroying ASS file headers
  if (updates.length > 0) {
    await saveRawSubtitles(assFilePath, updates, false);
  }
  
  log.info(`[SubtitleService] Auto-fix completed in ${Date.now() - startTime}ms: removed ${removedCount} empty lines, fixed ${spaceCount} spaces, resolved ${overlappingCount} overlaps.`);
  return {
    success: true,
    removedCount,
    overlappingCount,
    spaceCount
  };
}

async function shiftSubtitlesTime(assFilePath, offsetMs, selectedLineIds = null) {
  log.info(`[SubtitleService] Shifting subtitles time for ${assFilePath} by ${offsetMs}ms (selected: ${selectedLineIds ? selectedLineIds.length : 'ALL'} lines)`);
  const startTime = Date.now();
  const data = await getRawSubtitles(assFilePath);
  let lines = data.lines || [];
  
  const selectedSet = selectedLineIds ? new Set(selectedLineIds) : null;
  
  const updatedLines = lines.map(line => {
    if (selectedSet && !selectedSet.has(line.id)) return line;
    return {
      ...line,
      start: msToTime(timeToMs(line.start) + offsetMs),
      end: msToTime(timeToMs(line.end) + offsetMs)
    };
  });
  
  // Save only the updated lines without overwriting file structure
  await saveRawSubtitles(assFilePath, updatedLines, false);
  log.info(`[SubtitleService] Shifted time for ${updatedLines.length} lines in ${Date.now() - startTime}ms`);
  return { success: true };
}

function cleanAssText(text) {
  return text.replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n');
}

/**
 * Вспомогательная функция для безопасного парсинга строки Dialogue/Comment в ASS файле.
 * Гарантированно сохраняет теги оформления, запятые в тексте и переносы.
 */
function parseDialogueLine(line, formatParts) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;

  const totalFields = (formatParts && formatParts.length > 0) ? formatParts.length : 10;
  const nameIndex = (formatParts && formatParts.indexOf('Name') !== -1) ? formatParts.indexOf('Name') : 4;
  const textIndex = (formatParts && formatParts.indexOf('Text') !== -1) ? formatParts.indexOf('Text') : (totalFields - 1);
  const startIndex = (formatParts && formatParts.indexOf('Start') !== -1) ? formatParts.indexOf('Start') : 1;
  const endIndex = (formatParts && formatParts.indexOf('End') !== -1) ? formatParts.indexOf('End') : 2;
  const styleIndex = (formatParts && formatParts.indexOf('Style') !== -1) ? formatParts.indexOf('Style') : 3;

  const data = line.substring(colonIndex + 1);
  
  // Разбиваем данные только по первому (totalFields - 1) вхождению запятой,
  // чтобы весь остаток строки был прочитан как Text без повреждения запятых внутри тегов {\pos(x,y)}
  const parts = [];
  let currentPos = 0;
  for (let i = 0; i < totalFields - 1; i++) {
    const commaIndex = data.indexOf(',', currentPos);
    if (commaIndex === -1) {
      parts.push(data.substring(currentPos));
      currentPos = data.length;
      break;
    } else {
      parts.push(data.substring(currentPos, commaIndex));
      currentPos = commaIndex + 1;
    }
  }
  if (currentPos <= data.length) {
    parts.push(data.substring(currentPos));
  }
  while (parts.length < totalFields) {
    parts.push('');
  }

  return {
    start: parts[startIndex]?.trim() || '',
    end: parts[endIndex]?.trim() || '',
    style: parts[styleIndex]?.trim() || '',
    name: parts[nameIndex]?.trim() || '',
    text: parts[textIndex] !== undefined ? parts[textIndex] : '',
    standardParts: parts,
    prefix: line.substring(0, colonIndex + 1) + ' ',
    formatInfo: { nameIndex, textIndex, startIndex, endIndex, styleIndex, totalFields }
  };
}

/**
 * Создает техническую строку "ШУМЫ" для ASS.
 */
function createNoiseLine(formatParts) {
  const fields = (formatParts && formatParts.length > 0) ? formatParts : ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  const dataParts = new Array(fields.length).fill('0');
  const startIndex = fields.indexOf('Start');
  const endIndex = fields.indexOf('End');
  const nameIndex = fields.indexOf('Name');
  const textIndex = fields.indexOf('Text');
  const styleIndex = fields.indexOf('Style');
  
  fields.forEach((part, i) => {
    if (i === startIndex || i === endIndex) dataParts[i] = '0:00:00.00';
    else if (i === nameIndex || i === textIndex) dataParts[i] = 'ШУМЫ';
    else if (i === styleIndex) dataParts[i] = 'Default';
    else dataParts[i] = '0';
  });
  
  return 'Dialogue: ' + dataParts.join(',');
}

async function cleanAssFile(assFilePath) {
  try {
    const content = await readTextFileWithAutoEncoding(assFilePath);
    const lines = content.split('\n');
    let currentSection = '';
    let formatParts = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('[')) {
        currentSection = trimmedLine;
        continue;
      }

      if (currentSection === '[Events]' && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        continue;
      }
      
      if (currentSection === '[Script Info]') {
        if (trimmedLine.startsWith('Video Zoom Percent:') || 
            trimmedLine.startsWith('Scroll Position:') || 
            trimmedLine.startsWith('Active Line:')) {
          lines[i] = null; // Mark for deletion
          continue;
        }
      }
      
      if (currentSection === '[Events]') {
        const prefixMatch = line.match(/^(Dialogue|Comment):/);
        if (prefixMatch) {
          const parsed = parseDialogueLine(line, formatParts);
          if (parsed) {
            const trimmedParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
            lines[i] = `${parsed.prefix}${trimmedParts.join(',')}`;
          }
        }
      }
    }
    
    const newContent = lines.filter(l => l !== null).join('\n');
    await fs.writeFile(assFilePath, newContent, 'utf-8');
    subtitleCache.delete(assFilePath);
    return { success: true };
  } catch (error) {
    log.error('Error cleaning ASS file:', error);
    return { success: false, error: error.message };
  }
}

async function getRawSubtitles(assFilePath) {
  const startTime = Date.now();
  try {
    try {
      await fs.access(assFilePath);
    } catch {
      log.info(`[SubtitleService] Subtitle file does not exist: ${assFilePath}`);
      return { lines: [], actors: [] };
    }

    let filePathToParse = assFilePath;
    let isTemp = false;
    
    if (assFilePath.toLowerCase().endsWith('.srt')) {
      log.info(`[SubtitleService] Converting SRT file for parsing: ${assFilePath}`);
      const tempAssPath = assFilePath.slice(0, -4) + '_temp_converted.ass';
      await convertSrtToAss(assFilePath, tempAssPath);
      filePathToParse = tempAssPath;
      isTemp = true;
    }

    const stats = await fs.stat(filePathToParse);
    const mtime = stats.mtimeMs;
    
    if (!isTemp && subtitleCache.has(assFilePath)) {
      const cached = subtitleCache.get(assFilePath);
      if (cached.mtime === mtime) {
        log.debug(`[SubtitleService] Returning cached subtitles for ${assFilePath} (${cached.data.lines.length} lines, ${cached.data.actors.length} actors)`);
        return cached.data;
      }
    }

    const content = await readTextFileWithAutoEncoding(filePathToParse);
    const lines = content.split('\n');
    const result = [];
    
    let inEvents = false;
    let formatParts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          result.push({
            id: i,
            start: parsed.start,
            end: parsed.end,
            style: parsed.style,
            name: parsed.name,
            text: parsed.text,
            rawLineIndex: i,
            standardParts: parsed.standardParts,
            prefix: parsed.prefix,
            formatInfo: parsed.formatInfo
          });
        }
      } else if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
    }

    const actors = new Set();
    
    for (const line of result) {
      if (line.name) {
        const names = line.name.split(',').map(n => n.trim()).filter(n => n !== '');
        names.forEach(n => {
          if (!SIGN_KEYWORDS.includes(n)) {
            actors.add(n);
          }
        });
      }
    }

    const data = {
      lines: result,
      actors: Array.from(actors)
    };

    log.info(`[SubtitleService] Parsed ${assFilePath}: ${result.length} dialogue lines, ${data.actors.length} unique actors in ${Date.now() - startTime}ms`);

    if (isTemp) {
      try {
        await fs.unlink(filePathToParse);
      } catch (err) {
        log.error("[SubtitleService] Failed to delete temp ASS file:", err);
      }
    } else {
      subtitleCache.set(assFilePath, { mtime, data });
      
      // Keep cache size manageable
      if (subtitleCache.size > 10) {
        const firstKey = subtitleCache.keys().next().value;
        subtitleCache.delete(firstKey);
      }
    }

    return data;
  } catch (error) {
    log.error(`[SubtitleService] Error reading subtitles from ${assFilePath}:`, error);
    throw error;
  }
}

async function saveRawSubtitles(assFilePath, updates, overwrite = false) {
  const startTime = Date.now();
  log.info(`[SubtitleService] Saving subtitles to ${assFilePath} (overwrite=${overwrite}, updates=${updates?.length || 0})`);
  let content = '';
  let lines = [];
  
  if (overwrite) {
    const assLines = [];
    assLines.push('[Script Info]');
    assLines.push('Title: Generated Subtitles');
    assLines.push('ScriptType: v4.00+');
    assLines.push('PlayResX: 640');
    assLines.push('PlayResY: 360');
    assLines.push('');
    assLines.push('[V4+ Styles]');
    assLines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
    assLines.push('Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1');
    assLines.push('');
    assLines.push('[Events]');
    assLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
    
    for (const line of updates) {
      const start = line.start || '0:00:00.00';
      const end = line.end || '0:00:00.00';
      const style = line.style || 'Default';
      const name = (line.name || '').replace(/,/g, ';');
      const text = line.text || '';
      assLines.push(`Dialogue: 0,${start},${end},${style},${name},0,0,0,,${text}`);
    }
    
    const newContent = assLines.join('\n');
    await fs.writeFile(assFilePath, newContent, 'utf-8');
    subtitleCache.delete(assFilePath);
    await cleanAssFile(assFilePath);
    subtitleCache.delete(assFilePath);
    return;
  }

  try {
    content = await readTextFileWithAutoEncoding(assFilePath);
    lines = content.split('\n');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File does not exist! We will generate it from scratch using updates
      const assLines = [];
      assLines.push('[Script Info]');
      assLines.push('Title: Generated Subtitles');
      assLines.push('ScriptType: v4.00+');
      assLines.push('PlayResX: 640');
      assLines.push('PlayResY: 360');
      assLines.push('');
      assLines.push('[V4+ Styles]');
      assLines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
      assLines.push('Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1');
      assLines.push('');
      assLines.push('[Events]');
      assLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
      
      for (const line of updates) {
        const start = line.start || '0:00:00.00';
        const end = line.end || '0:00:00.00';
        const style = line.style || 'Default';
        const name = (line.name || '').replace(/,/g, ';');
        const text = line.text || '';
        assLines.push(`Dialogue: 0,${start},${end},${style},${name},0,0,0,,${text}`);
      }
      
      const newContent = assLines.join('\n');
      await fs.writeFile(assFilePath, newContent, 'utf-8');
      subtitleCache.delete(assFilePath);
      return;
    } else {
      throw err;
    }
  }
  
  let inEvents = false;
  let formatParts = [];

  const updatesMap = new Map();
  for (const update of updates) {
    updatesMap.set(update.rawLineIndex, { 
      name: update.name, 
      text: update.text,
      start: update.start,
      end: update.end,
      delete: update.delete
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (updatesMap.has(i)) {
        const update = updatesMap.get(i);
        if (update.delete) {
          lines[i] = null;
          continue;
        }
        
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          
          if (update.name !== undefined) {
            standardParts[parsed.formatInfo.nameIndex] = (update.name || '').replace(/,/g, ';');
          }
          if (update.text !== undefined) {
            standardParts[parsed.formatInfo.textIndex] = update.text;
          }
          if (update.start !== undefined) {
            standardParts[parsed.formatInfo.startIndex] = update.start;
          }
          if (update.end !== undefined) {
            standardParts[parsed.formatInfo.endIndex] = update.end;
          }
          
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  const finalLines = lines.filter(l => l !== null);
  await fs.writeFile(assFilePath, finalLines.join('\n'), 'utf-8');
    subtitleCache.delete(assFilePath);
  await cleanAssFile(assFilePath);
  subtitleCache.delete(assFilePath);
}

async function splitSubsByActor(assFilePath, outputDirectory, options) {
  const startTime = Date.now();
  log.info(`[SubtitleService] Splitting subtitles by actor: ${assFilePath} -> ${outputDirectory}`);
  const {
    distributeGroups = false,
    distributeMultipleRoles = false,
    saveSignsInAss = false,
    outputFormat = 'ass' // 'ass' or 'srt'
  } = options || {};

  const content = await readTextFileWithAutoEncoding(assFilePath);
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];

  const parsedLines = [];
  const uniqueActors = new Set();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      parsedLines.push({ type: 'header', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      parsedLines.push({ type: 'format', text: line });
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        parsedLines.push({ 
          type: 'dialogue', 
          text: line, 
          names: currentNames,
          start: parsed.start,
          end: parsed.end,
          textContent: parsed.text
        });

        for (const name of currentNames) {
          if (SIGN_KEYWORDS.includes(name)) continue;
          if (groupKeywords.includes(name)) continue;
          if (name.startsWith('!')) continue;
          uniqueActors.add(name);
        }
      } else {
        parsedLines.push({ type: 'other', text: line });
      }
    } else {
      if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
      parsedLines.push({ type: 'other', text: line });
    }
  }

  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });
  const originalFileName = path.basename(assFilePath, '.ass');

  const totalActors = uniqueActors.size;
  log.info(`[SubtitleService] Found ${totalActors} actors to split for ${originalFileName}`);
  let currentActorIdx = 0;

  for (const actor of uniqueActors) {
    currentActorIdx++;
    if (options && options.onProgress) {
      options.onProgress({ percent: Math.round((currentActorIdx / totalActors) * 100) });
    }
    const actorLines = [];
    let lineCount = 0;
    let srtIndex = 1;

    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        let include = false;
        const names = parsed.names;

        if (names.length === 0) continue;

        if (names.some(n => SIGN_KEYWORDS.includes(n))) {
          continue;
        }

        if (names.some(n => n.startsWith('!'))) {
          const exclusions = names.map(n => n.startsWith('!') ? n.substring(1).trim() : n);
          if (!exclusions.includes(actor)) include = true;
        } else if (names.some(n => groupKeywords.includes(n))) {
           if (distributeGroups) include = true;
        } else if (names.length > 1) {
           if (distributeMultipleRoles && names.includes(actor)) include = true;
        } else if (names.length === 1 && names[0] === actor) {
           include = true;
        }

        if (include) {
          if (outputFormat === 'ass') {
            actorLines.push(parsed.text);
          } else {
            if (srtIndex === 1) {
               actorLines.push('1\n00:00:00,000 --> 00:00:00,000\nШУМЫ\n');
               srtIndex++;
            }
            actorLines.push(`${srtIndex}\n${assTimeToSrtTime(parsed.start)} --> ${assTimeToSrtTime(parsed.end)}\n${cleanAssText(parsed.textContent)}\n`);
            srtIndex++;
          }
          lineCount++;
        }
      } else {
        if (outputFormat === 'ass') {
          actorLines.push(parsed.text);
          if (parsed.type === 'format') {
            actorLines.push(createNoiseLine(formatParts));
          }
        }
      }
    }

    if (lineCount > 0) {
      const ext = outputFormat === 'ass' ? '.ass' : '.srt';
      const outputPath = path.join(outputDirectory, `${originalFileName} - ${actor} - (${lineCount})${ext}`);
      log.info(`[SubtitleService] Writing split file for actor ${actor} (${lineCount} lines): ${outputPath}`);
      await fs.writeFile(outputPath, actorLines.join('\n'), 'utf-8');
      if (ext === '.ass') await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  if (saveSignsInAss) {
    log.info('[SubtitleService] Extracting signs to separate file...');
    const signLines = [];
    let signCount = 0;
    for (const parsed of parsedLines) {
      if (parsed.type === 'dialogue') {
        if (parsed.names.some(n => SIGN_KEYWORDS.includes(n))) {
          signLines.push(parsed.text);
          signCount++;
        }
      } else {
        signLines.push(parsed.text);
      }
    }
    if (signCount > 0) {
      const outputPath = path.join(outputDirectory, `${originalFileName} - Надписи.ass`);
      log.info(`[SubtitleService] Saved ${signCount} signs to ${outputPath}`);
      await fs.writeFile(outputPath, signLines.join('\n'), 'utf-8');
      await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  log.info(`[SubtitleService] Split by actor finished in ${Date.now() - startTime}ms. Created ${generatedFiles.length} files.`);
  return { success: true, generatedFiles };
}

async function splitSubsByDubber(assFilePath, outputDirectory, assignments, dubbersData, options) {
  const startTime = Date.now();
  log.info(`[SubtitleService] Splitting subtitles by dubber: ${assFilePath} -> ${outputDirectory} (assignments: ${assignments?.length || 0})`);
  const {
    saveSignsInAss = false,
    outputFormat = 'ass', // 'ass' or 'srt'
    baseFileName = path.basename(assFilePath, '.ass'),
    characterAliases
  } = options || {};

  const aliases = typeof characterAliases === 'string' ? JSON.parse(characterAliases || '{}') : (characterAliases || {});
  const getMainName = (name) => {
    const trimmed = name.trim();
    return aliases[trimmed] || trimmed;
  };

  const content = await readTextFileWithAutoEncoding(assFilePath);
  const lines = content.split('\n');
  
  const dubberIds = Array.from(new Set(assignments.map(a => a.substituteId || a.dubberId).filter(id => id)));
  const dubbers = dubbersData.filter(d => dubberIds.includes(d.id));
  
  const dubberMap = new Map();
  for (const dubber of dubbers) {
    dubberMap.set(dubber.id, dubber);
  }

  const generatedFiles = [];
  await fs.mkdir(outputDirectory, { recursive: true });
  const originalFileName = path.basename(assFilePath, '.ass');

  const totalDubbers = dubberIds.length;
  log.info(`[SubtitleService] Processing ${totalDubbers} unique dubbers`);
  let currentDubberIdx = 0;

  for (const dubberId of dubberIds) {
    currentDubberIdx++;
    if (options && options.onProgress) {
      options.onProgress({ percent: Math.round((currentDubberIdx / totalDubbers) * 100) });
    }
    const dubber = dubberMap.get(dubberId);
    if (!dubber) continue;

    const assignedCharacters = assignments
      .filter(a => (a.substituteId || a.dubberId) === dubberId)
      .map(a => a.characterName.trim());

    const mapping = {};
    for (const assignment of assignments) {
      const targetId = assignment.substituteId || assignment.dubberId;
      if (targetId === dubberId) {
        const charName = assignment.characterName.trim();
        const d = dubberMap.get(targetId);
        if (d) {
          if (!mapping[charName]) mapping[charName] = [];
          mapping[charName].push(d.nickname);
        }
      }
    }

    const newLines = [];
    let inEvents = false;
    let formatParts = [];
    let lineCount = 0;
    let srtIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        if (outputFormat === 'ass') newLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        if (outputFormat === 'ass') {
          newLines.push(line);
          newLines.push(createNoiseLine(formatParts));
        }
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
          const isAssigned = currentNames.some(name => assignedCharacters.includes(getMainName(name)));

          if (isAssigned) {
            const mappedNames = currentNames.flatMap(name => {
              const mainName = getMainName(name);
              if (mapping[mainName] && mapping[mainName].length > 0) {
                return mapping[mainName];
              }
              return [name];
            });

            if (outputFormat === 'ass') {
              const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
              standardParts[parsed.formatInfo.nameIndex] = mappedNames.join('; ');
              newLines.push(`${parsed.prefix}${standardParts.join(',')}`);
            } else {
              if (srtIndex === 1) {
                newLines.push('1\n00:00:00,000 --> 00:00:00,000\nШУМЫ\n');
                srtIndex++;
              }
              newLines.push(`${srtIndex}\n${assTimeToSrtTime(parsed.start)} --> ${assTimeToSrtTime(parsed.end)}\n${cleanAssText(parsed.textContent)}\n`);
              srtIndex++;
            }
            lineCount++;
          }
        } else if (outputFormat === 'ass') {
          newLines.push(line);
        }
      } else {
        if (trimmedLine.startsWith('[')) {
          if (trimmedLine !== '[Events]') inEvents = false;
        }
        if (outputFormat === 'ass') newLines.push(line);
      }
    }

    const ext = outputFormat === 'ass' ? '.ass' : '.srt';
    const outputPath = path.join(outputDirectory, `${baseFileName}_[${dubber.nickname}]_${lineCount}${ext}`);
    log.info(`[SubtitleService] Writing file for dubber ${dubber.nickname} (${lineCount} lines): ${outputPath}`);
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    if (outputFormat === 'ass') await cleanAssFile(outputPath);
    generatedFiles.push(outputPath);
  }

  if (saveSignsInAss) {
    log.info('[SubtitleService] Extracting signs to separate file...');
    const signLines = [];
    let signCount = 0;
    let inEvents = false;
    let formatParts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('[Events]')) {
        inEvents = true;
        signLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
        signLines.push(line);
        continue;
      }

      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        const parsed = parseDialogueLine(line, formatParts);
        if (parsed) {
          const names = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
          if (names.some(n => SIGN_KEYWORDS.includes(n))) {
            signLines.push(line);
            signCount++;
          }
        }
      } else {
        if (trimmedLine.startsWith('[')) {
          if (trimmedLine !== '[Events]') inEvents = false;
        }
        signLines.push(line);
      }
    }

    if (signCount > 0) {
      const outputPath = path.join(outputDirectory, `${originalFileName} - Надписи.ass`);
      log.info(`[SubtitleService] Saved ${signCount} signs to ${outputPath}`);
      await fs.writeFile(outputPath, signLines.join('\n'), 'utf-8');
      await cleanAssFile(outputPath);
      generatedFiles.push(outputPath);
    }
  }

  log.info(`[SubtitleService] Split by dubber finished in ${Date.now() - startTime}ms. Created ${generatedFiles.length} files.`);
  return { success: true, generatedFiles };
}

async function exportFullAssWithRoles(assFilePath, outputPath, assignments, participantsData, characterAliases) {
  const startTime = Date.now();
  log.info(`[SubtitleService] Exporting full ASS with roles: ${assFilePath} -> ${outputPath} (assignments: ${assignments?.length || 0})`);
  const content = await readTextFileWithAutoEncoding(assFilePath);
  const lines = content.split('\n');
  
  const aliases = typeof characterAliases === 'string' ? JSON.parse(characterAliases || '{}') : (characterAliases || {});
  const getMainName = (name) => {
    const trimmed = name.trim();
    return aliases[trimmed] || trimmed;
  };

  const mapping = {};
  for (const assignment of assignments) {
    const targetId = assignment.substituteId || assignment.dubberId;
    if (!targetId) continue;
    const dubber = participantsData.find(p => p.id === targetId);
    if (dubber) {
      const charName = assignment.characterName.trim();
      if (!mapping[charName]) {
        mapping[charName] = [];
      }
      mapping[charName].push(dubber.nickname);
    }
  }

  let inEvents = false;
  let formatParts = [];
  let replacedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      lines[i] = line + '\n' + createNoiseLine(formatParts);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        
        let changed = false;
        const mappedNames = currentNames.flatMap(name => {
          const mainName = getMainName(name);
          if (mapping[mainName] && mapping[mainName].length > 0) {
            changed = true;
            return mapping[mainName];
          }
          return [name];
        });
        
        if (changed) {
          const standardParts = parsed.standardParts.map((p, idx) => idx === parsed.formatInfo.textIndex ? p : p.trim());
          standardParts[parsed.formatInfo.nameIndex] = mappedNames.join('; ');
          lines[i] = `${parsed.prefix}${standardParts.join(',')}`;
          replacedCount++;
        }
      }
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  await cleanAssFile(outputPath);
  log.info(`[SubtitleService] Exported full ASS with roles in ${Date.now() - startTime}ms: replaced ${replacedCount} role names -> ${outputPath}`);
  return outputPath;
}

async function saveTranslatedSubtitles(assFilePath, translatedLines) {
  const content = await readTextFileWithAutoEncoding(assFilePath);
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  let firstDialogueIndex = -1;
  let lastDialogueIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (trimmedLine.startsWith('[Events]')) inEvents = true;
    else if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
    } else if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      if (firstDialogueIndex === -1) firstDialogueIndex = i;
      lastDialogueIndex = i;
    } else if (trimmedLine.startsWith('[')) {
      if (trimmedLine !== '[Events]') inEvents = false;
    }
  }

  if (firstDialogueIndex === -1) firstDialogueIndex = lines.length;
  if (lastDialogueIndex === -1) lastDialogueIndex = firstDialogueIndex - 1;

  const newDialogueLines = [];
  for (const line of translatedLines) {
    if (line.standardParts && line.prefix && line.formatInfo) {
      const parts = [...line.standardParts];
      parts[line.formatInfo.textIndex] = line.text;
      if (line.start) parts[line.formatInfo.startIndex] = line.start;
      if (line.end) parts[line.formatInfo.endIndex] = line.end;
      if (line.name !== undefined) parts[line.formatInfo.nameIndex] = line.name.replace(/,/g, ';');
      newDialogueLines.push(`${line.prefix}${parts.join(',')}`);
    } else {
      // Fallback for new lines or missing format info
      const start = line.start || '0:00:00.00';
      const end = line.end || '0:00:00.00';
      const style = line.style || 'Default';
      const name = (line.name || '').replace(/,/g, ';');
      const text = line.text || '';
      newDialogueLines.push(`Dialogue: 0,${start},${end},${style},${name},0,0,0,,${text}`);
    }
  }

  const preLines = lines.slice(0, firstDialogueIndex);
  const postLines = lines.slice(lastDialogueIndex + 1);
  
  // Filter out any stray old Dialogues between first and last if we slice
  // Actually, we just need to drop ALL Dialogue lines from preLines and postLines
  const filterOutDialogue = (l) => !l.trim().startsWith('Dialogue:');
  
  const finalLines = [
    ...preLines.filter(filterOutDialogue),
    ...newDialogueLines,
    ...postLines.filter(filterOutDialogue)
  ];

  await fs.writeFile(assFilePath, finalLines.join('\n'), 'utf-8');
    subtitleCache.delete(assFilePath);
  await cleanAssFile(assFilePath);
}

async function extractSignsAss(assFilePath, outputPath) {
  log.info(`[SubtitleService] Extracting signs from ${assFilePath} to ${outputPath}`);
  const startTime = Date.now();
  const content = await readTextFileWithAutoEncoding(assFilePath);
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatParts = [];
  const newLines = [];
  let signCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        // Explicitly ignore technical "ШУМЫ" line
        if (parsed.name === 'ШУМЫ') {
          continue;
        }
        
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        if (currentNames.some(n => SIGN_KEYWORDS.includes(n))) {
          newLines.push(line);
          signCount++;
        }
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  if (signCount > 0) {
    await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
    await cleanAssFile(outputPath);
    log.info(`[SubtitleService] Extracted ${signCount} signs to ${outputPath} in ${Date.now() - startTime}ms`);
    return true;
  }
  log.info(`[SubtitleService] No signs found in ${assFilePath} (checked in ${Date.now() - startTime}ms)`);
  return false;
}

async function convertSrtToAss(srtFilePath, assFilePath) {
  try {
    log.info(`[SubtitleService] Converting SRT to ASS: ${srtFilePath} -> ${assFilePath}`);
    const startTime = Date.now();
    const content = await readTextFileWithAutoEncoding(srtFilePath);
    // Normalize line endings and split into blocks
    const normalized = content.replace(/\r\n/g, '\n');
    const blocks = normalized.split(/\n\s*\n/);
    const assEvents = [];
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length >= 3) {
        // Try to find the time line (usually second line, but can be preceded by index)
        const timeLineIdx = lines.findIndex(l => l.includes(' --> '));
        if (timeLineIdx === -1) continue;
        
        const timeLine = lines[timeLineIdx];
        const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,. ]\d{2,3}) --> (\d{1,2}:\d{2}:\d{2}[,. ]\d{2,3})/);
        
        if (match) {
          const srtToAssTime = (t) => {
            // SRT: 00:00:00,000 or 0:00:00.00
            const cleanT = t.replace(',', '.');
            const parts = cleanT.split(':');
            const h = parseInt(parts[0]);
            const m = parts[1];
            const sParts = parts[2].split('.');
            const s = sParts[0];
            const ms = (sParts[1] || '0').padEnd(2, '0').substring(0, 2);
            return `${h}:${m}:${s}.${ms}`;
          };
          
          const startTime = srtToAssTime(match[1]);
          const endTime = srtToAssTime(match[2]);
          const text = lines.slice(timeLineIdx + 1).join('\\N');
          assEvents.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
        }
      }
    }

    const assHeader = `[Script Info]
Title: Converted from SRT
ScriptType: v4.00+
Collisions: Normal
PlayResX: 640
PlayResY: 360
Timer: 100.0000

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:00.00,Default,ШУМЫ,0,0,0,,ШУМЫ
`;

    await fs.writeFile(assFilePath, assHeader + assEvents.join('\n'), 'utf-8');
    subtitleCache.delete(assFilePath);
    log.info(`[SubtitleService] Converted ${assEvents.length} dialogue blocks from SRT to ASS in ${Date.now() - startTime}ms`);
    return { success: true };
  } catch (err) {
    log.error('[SubtitleService] SRT to ASS conversion failed:', err);
    throw err;
  }
}

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2].replace(',', '.')) || 0;
    return (h * 3600) + (m * 60) + s;
  }
  return 0;
}

function mergeSubtitles(existingLines, newLines) {
  const merged = [...existingLines];
  
  for (const newLine of newLines) {
    const newStart = timeToSeconds(newLine.start);
    const newEnd = timeToSeconds(newLine.end);
    const newDuration = newEnd - newStart;
    
    let matched = false;
    
    for (const existingLine of merged) {
      const extStart = timeToSeconds(existingLine.start);
      const extEnd = timeToSeconds(existingLine.end);
      const extDuration = extEnd - extStart;
      
      const overlap = Math.max(0, Math.min(newEnd, extEnd) - Math.max(newStart, extStart));
      const isOverlapping = (overlap > 0.5) || (newDuration > 0 && (overlap / Math.min(newDuration, extDuration)) > 0.4);
      
      if (isOverlapping) {
        matched = true;
        
        // 1. Supplement speaker name if existing line has no speaker (or Default)
        if ((!existingLine.name || existingLine.name === 'Default') && newLine.name && newLine.name !== 'Default') {
          existingLine.name = newLine.name;
        }
        
        // 2. Supplement text if existing line is empty/placeholder
        const cleanExistingText = (existingLine.text || '').trim();
        if (!cleanExistingText || cleanExistingText === 'ШУМЫ' || cleanExistingText === '[Без звука]' || cleanExistingText === '[Без звука / Silent]') {
          existingLine.text = newLine.text;
        } else {
          const cleanNewText = (newLine.text || '').trim();
          if (cleanNewText && cleanNewText !== cleanExistingText && !cleanExistingText.includes(cleanNewText)) {
            if (cleanNewText.toLowerCase() !== cleanExistingText.toLowerCase()) {
              matched = false; // Add as separate line so we don't lose information
            }
          }
        }
        break;
      }
    }
    
    if (!matched) {
      merged.push({
        ...newLine,
        id: undefined,
        rawLineIndex: undefined
      });
    }
  }
  
  // Sort merged lines by start time
  merged.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
  
  // Re-index
  return merged.map((line, idx) => ({
    ...line,
    id: idx,
    rawLineIndex: idx
  }));
}

async function exportCharacterSubtitles(assFilePath, outputPath, characterName, characterAliases, format = 'ass') {
  log.info(`Exporting character subtitles: ${characterName} from ${assFilePath} to ${outputPath} (${format})`);
  const content = await readTextFileWithAutoEncoding(assFilePath);
  const lines = content.split('\n');
  
  const aliases = typeof characterAliases === 'string' ? JSON.parse(characterAliases || '{}') : (characterAliases || {});
  const getMainName = (name) => {
    const trimmed = name.trim();
    return aliases[trimmed] || trimmed;
  };

  const targetNameTrimmed = characterName.trim();
  const targetMainName = getMainName(targetNameTrimmed);

  const newLines = [];
  let inEvents = false;
  let formatParts = [];
  let srtIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('[Events]')) {
      inEvents = true;
      if (format === 'ass') newLines.push(line);
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Format:')) {
      formatParts = trimmedLine.substring(7).split(',').map(s => s.trim());
      if (format === 'ass') {
        newLines.push(line);
      }
      continue;
    }

    if (inEvents && trimmedLine.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (parsed) {
        const currentNames = parsed.name.split(/[,;]/).map(n => n.trim()).filter(n => n !== '');
        const isMatched = currentNames.some(name => {
          const mainName = getMainName(name);
          return mainName === targetMainName || name === targetNameTrimmed;
        });

        if (isMatched) {
          if (format === 'ass') {
            newLines.push(line);
          } else {
            newLines.push(`${srtIndex}\n${assTimeToSrtTime(parsed.start)} --> ${assTimeToSrtTime(parsed.end)}\n${cleanAssText(parsed.textContent)}\n`);
            srtIndex++;
          }
        }
      } else if (format === 'ass') {
        newLines.push(line);
      }
    } else {
      if (trimmedLine.startsWith('[')) {
        if (trimmedLine !== '[Events]') inEvents = false;
      }
      if (format === 'ass') newLines.push(line);
    }
  }

  await fs.writeFile(outputPath, newLines.join('\n'), 'utf-8');
  if (format === 'ass') {
    await cleanAssFile(outputPath);
  }
  return { path: outputPath };
}

async function writeAssFileWithHeader(outputPath, header, lines) {
  let content = '';
  if (!header || !header.includes('[Events]')) {
    const defaultAssHeader = [
      '[Script Info]',
      'Title: Merged Subtitles',
      'ScriptType: v4.00+',
      'PlayResX: 640',
      'PlayResY: 360',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ].join('\n');
    content = defaultAssHeader + '\n';
  } else {
    content = header.trimEnd() + '\n';
  }

  const dialogueLines = lines.map(line => {
    const start = line.start || '0:00:00.00';
    const end = line.end || '0:00:00.00';
    const style = line.style || 'Default';
    const name = (line.name || '').replace(/,/g, ';');
    const text = line.text || '';
    return `Dialogue: 0,${start},${end},${style},${name},0,0,0,,${text}`;
  });

  content += dialogueLines.join('\n') + '\n';
  await fs.writeFile(outputPath, content, 'utf-8');
  await cleanAssFile(outputPath);
}

/**
 * Merges multiple subtitle files (.ass, .srt, .vtt) into one target ASS file.
 */
async function mergeMultipleSubtitles(filePaths, options = {}) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error('Не указаны файлы субтитров');
  }

  const {
    mode = 'component',
    textSourceIndex = 0,
    styleSourceIndex = 0,
    actorSourceIndex = -1,
    outputPath
  } = options;

  if (!outputPath) {
    throw new Error('Не указан выходной путь файла');
  }

  log.info(`[SubtitleService] Merging ${filePaths.length} subtitle files (mode=${mode}) -> ${outputPath}`);
  const startTime = Date.now();

  const parsedFiles = [];
  for (const fp of filePaths) {
    const rawData = await getRawSubtitles(fp);
    let rawText = '';
    try {
      rawText = await readTextFileWithAutoEncoding(fp);
    } catch (e) {}
    parsedFiles.push({
      path: fp,
      data: rawData,
      rawText
    });
  }

  function extractHeaderAndStyles(rawText) {
    if (!rawText) return null;
    const lines = rawText.split('\n');
    const headerLines = [];
    let inEvents = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmed = line.trim();
      if (trimmed.startsWith('[Events]')) {
        headerLines.push('[Events]');
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('Format:')) {
          headerLines.push(lines[i + 1].trimEnd());
        } else {
          headerLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
        }
        break;
      }
      headerLines.push(line);
    }
    return headerLines.join('\n');
  }

  if (mode === 'component') {
    const textFile = parsedFiles[textSourceIndex] || parsedFiles[0];
    let baseLines = (textFile.data.lines || []).map(l => ({ ...l }));

    const styleFile = parsedFiles[styleSourceIndex] || parsedFiles[0];
    let header = extractHeaderAndStyles(styleFile.rawText);

    if (actorSourceIndex >= 0 && actorSourceIndex < parsedFiles.length) {
      const actorFile = parsedFiles[actorSourceIndex];
      const actorLines = actorFile.data.lines || [];

      baseLines.forEach((baseLine) => {
        // If the target line already has a role assigned (not empty, not 'Default', not signs), DO NOT overwrite it!
        const existingRole = (baseLine.name || '').trim();
        if (existingRole && existingRole !== 'Default' && !SIGN_KEYWORDS.includes(existingRole)) {
          return;
        }

        const bStart = timeToMs(baseLine.start);
        const bEnd = timeToMs(baseLine.end);

        let bestMatch = null;
        let maxOverlap = 0;

        for (const aLine of actorLines) {
          if (!aLine.name || aLine.name === 'Default' || SIGN_KEYWORDS.includes(aLine.name)) continue;
          
          const aStart = timeToMs(aLine.start);
          const aEnd = timeToMs(aLine.end);

          const overlap = Math.max(0, Math.min(bEnd, aEnd) - Math.max(bStart, aStart));
          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestMatch = aLine;
          }
        }

        if (bestMatch && bestMatch.name) {
          baseLine.name = bestMatch.name;
        }
      });
    }

    await writeAssFileWithHeader(outputPath, header, baseLines);

  } else if (mode === 'combine') {
    let combinedLines = [];
    let styleFile = parsedFiles[0];
    let header = extractHeaderAndStyles(styleFile.rawText);

    for (const pf of parsedFiles) {
      if (pf.data && pf.data.lines) {
        combinedLines.push(...pf.data.lines.map(l => ({ ...l })));
      }
    }

    combinedLines.sort((a, b) => timeToMs(a.start) - timeToMs(b.start));
    await writeAssFileWithHeader(outputPath, header, combinedLines);

  } else if (mode === 'smart') {
    let baseLines = (parsedFiles[0].data.lines || []).map(l => ({ ...l }));
    let header = extractHeaderAndStyles(parsedFiles[0].rawText);

    for (let k = 1; k < parsedFiles.length; k++) {
      const secLines = parsedFiles[k].data.lines || [];
      baseLines = mergeSubtitles(baseLines, secLines);
    }

    await writeAssFileWithHeader(outputPath, header, baseLines);
  }

  subtitleCache.delete(outputPath);
  log.info(`[SubtitleService] Merged subtitles successfully written to ${outputPath} in ${Date.now() - startTime}ms`);
  return { success: true, outputPath };
}

module.exports = {
  getRawSubtitles,
  saveRawSubtitles,
  saveTranslatedSubtitles,
  splitSubsByActor,
  splitSubsByDubber,
  exportFullAssWithRoles,
  extractSignsAss,
  cleanAssFile,
  convertSrtToAss,
  mergeSubtitles,
  mergeMultipleSubtitles,
  timeToSeconds,
  autoFixSubtitles,
  shiftSubtitlesTime,
  exportCharacterSubtitles
};

