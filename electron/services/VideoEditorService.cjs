const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const log = require('electron-log');
const { app } = require('electron');
const {
  getVideoMetadata,
  getFfmpegPath
} = require('./ffmpegService.cjs');
const {
  getRawSubtitles,
  cleanAssFile,
  convertSrtToAss,
  clearSubtitleCache,
  readTextFileWithAutoEncoding,
  parseDialogueLine
} = require('./subtitleService.cjs');
const ProjectScanner = require('../lib/ProjectScanner.cjs');
const { trackProcess } = require('../lib/ProcessTracker.cjs');

/**
 * Normalizes a local media path (strips custom-media:// or file:// protocols)
 */
function normalizeLocalMediaPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return '';
  let raw = inputPath.trim();
  if (raw.startsWith('custom-media://')) {
    try {
      const u = new URL(raw);
      const qPath = u.searchParams.get('path');
      if (qPath) {
        raw = qPath;
      } else {
        const singleDrive = raw.match(/^custom-media:\/\/([a-zA-Z])\/(.+)$/);
        if (singleDrive) {
          raw = `${singleDrive[1].toUpperCase()}:/${decodeURIComponent(singleDrive[2])}`;
        } else {
          raw = decodeURIComponent(
            raw
              .replace(/^custom-media:\/\//, '')
              .replace(/^localhost\//, '')
              .replace(/^local\/media\/?/, '')
          );
        }
      }
    } catch (e) {
      raw = decodeURIComponent(raw.replace(/^custom-media:\/\//, ''));
    }
  } else if (raw.startsWith('file://')) {
    raw = decodeURIComponent(raw.replace(/^file:\/\//, ''));
  }
  if (/^\/[a-zA-Z]:/.test(raw)) {
    raw = raw.slice(1);
  }
  return process.platform === 'win32'
    ? raw.replace(/\//g, '\\')
    : raw.replace(/\\/g, '/');
}

function assTimeToSec(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length !== 3) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const sParts = parts[2].replace(',', '.').split('.');
  const s = parseInt(sParts[0], 10) || 0;
  const fracStr = (sParts[1] || '0').padEnd(3, '0').slice(0, 3);
  const ms = parseInt(fracStr, 10) || 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

function secToAssTime(sec) {
  const clamped = Math.max(0, Number(sec) || 0);
  const totalCs = Math.round(clamped * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function secToSrtTime(sec) {
  const clamped = Math.max(0, Number(sec) || 0);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatReadableTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${rem}`;
}

/**
 * Probes any video or image file and returns normalized stream info
 */
async function probeMediaFile(rawFilePath) {
  const filePath = normalizeLocalMediaPath(rawFilePath);
  if (!filePath || !fsSync.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath || rawFilePath}`);
  }

  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext);

  try {
    const meta = await getVideoMetadata(filePath);
    const vStream = (meta?.streams || []).find((s) => s.codec_type === 'video');
    const aStream = (meta?.streams || []).find((s) => s.codec_type === 'audio');

    let durationSec = parseFloat(meta?.format?.duration || '0');
    if ((!durationSec || isNaN(durationSec)) && vStream?.duration) {
      durationSec = parseFloat(vStream.duration);
    }
    if (isNaN(durationSec) || durationSec < 0) durationSec = 0;

    let fps = 24;
    let fpsStr = '24';
    if (vStream?.r_frame_rate && vStream.r_frame_rate !== '0/0') {
      fpsStr = vStream.r_frame_rate;
      const parts = fpsStr.split('/');
      if (parts.length === 2 && Number(parts[1]) > 0) {
        fps = Number(parts[0]) / Number(parts[1]);
      } else if (Number(fpsStr) > 0) {
        fps = Number(fpsStr);
      }
    }
    if (!fps || isNaN(fps) || fps <= 0 || fps > 240) {
      fps = 24;
      fpsStr = '24';
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      fileSize: stat.size,
      isImage,
      durationSec: isImage ? 5 : durationSec,
      width: vStream?.width || 1920,
      height: vStream?.height || 1080,
      videoCodec: vStream?.codec_name || 'h264',
      pixFmt: vStream?.pix_fmt || 'yuv420p',
      fps,
      fpsStr,
      hasAudio: Boolean(aStream),
      audioCodec: aStream?.codec_name || 'aac',
      sampleRate: parseInt(aStream?.sample_rate || '48000', 10) || 48000,
      channels: parseInt(aStream?.channels || '2', 10) || 2
    };
  } catch (err) {
    log.warn(`[VIDEO-EDITOR] Metadata probe fallback for ${filePath}:`, err.message);
    return {
      filePath,
      fileName: path.basename(filePath),
      fileSize: stat.size,
      isImage,
      durationSec: isImage ? 5 : 0,
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      fps: 24,
      fpsStr: '24',
      hasAudio: !isImage,
      audioCodec: 'aac',
      sampleRate: 48000,
      channels: 2
    };
  }
}

/**
 * Builds the deterministic piecewise-linear timeline plan for both FFmpeg and Subtitle Recalculation.
 */
function buildTimelinePlan(sourceDurationSec, operations = {}) {
  const D = Math.max(0.1, Number(sourceDurationSec) || 0.1);

  const trimStartSec = Math.max(0, Math.min(D, Number(operations.trimStartSec) || 0));
  const rawTrimEnd = operations.trimEndSec !== undefined && operations.trimEndSec !== null && Number(operations.trimEndSec) > 0
    ? Number(operations.trimEndSec)
    : D;
  const trimEndSec = Math.max(trimStartSec + 0.05, Math.min(D, rawTrimEnd));

  // 1. Collect all forbidden (cut) intervals in [0, D]
  const rawCuts = [];
  if (trimStartSec > 0.005) {
    rawCuts.push({ start: 0, end: trimStartSec, reason: 'trim-start' });
  }
  if (trimEndSec < D - 0.005) {
    rawCuts.push({ start: trimEndSec, end: D, reason: 'trim-end' });
  }

  if (Array.isArray(operations.cuts)) {
    for (const c of operations.cuts) {
      if (!c || c.enabled === false) continue;
      const s = Math.max(0, Math.min(D, Number(c.startSec) || 0));
      const e = Math.max(0, Math.min(D, Number(c.endSec) || 0));
      if (e > s + 0.01) {
        rawCuts.push({ start: s, end: e, reason: c.label || 'cut', id: c.id });
      }
    }
  }

  // Merge overlapping cut intervals
  rawCuts.sort((a, b) => a.start - b.start);
  const mergedCuts = [];
  for (const c of rawCuts) {
    if (mergedCuts.length === 0) {
      mergedCuts.push({ ...c });
    } else {
      const last = mergedCuts[mergedCuts.length - 1];
      if (c.start <= last.end + 0.005) {
        last.end = Math.max(last.end, c.end);
      } else {
        mergedCuts.push({ ...c });
      }
    }
  }

  // 2. Compute base kept intervals on [0, D]
  const baseKept = [];
  let cursor = 0;
  for (const cut of mergedCuts) {
    if (cut.start > cursor + 0.01) {
      baseKept.push({ origStart: cursor, origEnd: cut.start });
    }
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < D - 0.01) {
    baseKept.push({ origStart: cursor, origEnd: D });
  }

  // 3. Process mid-video image inserts (split kept segments if an image is inserted inside a kept segment)
  const midImages = (Array.isArray(operations.midImages) ? operations.midImages : [])
    .filter((img) => img && img.filePath && img.enabled !== false && Number(img.durationSec) > 0)
    .map((img) => ({
      ...img,
      filePath: normalizeLocalMediaPath(img.filePath),
      insertAtOriginalSec: Math.max(0, Math.min(D, Number(img.insertAtOriginalSec) || 0)),
      durationSec: Math.max(0.1, Number(img.durationSec) || 3)
    }))
    .sort((a, b) => a.insertAtOriginalSec - b.insertAtOriginalSec);

  // Split baseKept at any midImage.insertAtOriginalSec that falls strictly inside [origStart, origEnd]
  let splitKept = [...baseKept];
  for (const midImg of midImages) {
    const tIns = midImg.insertAtOriginalSec;
    const nextKept = [];
    for (const seg of splitKept) {
      if (tIns > seg.origStart + 0.02 && tIns < seg.origEnd - 0.02) {
        nextKept.push({ origStart: seg.origStart, origEnd: tIns });
        nextKept.push({ origStart: tIns, origEnd: seg.origEnd });
      } else {
        nextKept.push(seg);
      }
    }
    splitKept = nextKept;
  }

  // Also split kept segments at overlay boundaries? No need to split for subtitle mapping,
  // but splitting or attaching overlays to source-slices makes rendering super clean!
  const overlayImages = (Array.isArray(operations.overlayImages) ? operations.overlayImages : [])
    .filter((ov) => ov && ov.filePath && ov.enabled !== false && Number(ov.endSec) > Number(ov.startSec))
    .map((ov) => ({
      ...ov,
      filePath: normalizeLocalMediaPath(ov.filePath),
      startSec: Math.max(0, Math.min(D, Number(ov.startSec) || 0)),
      endSec: Math.max(0, Math.min(D, Number(ov.endSec) || 0)),
      xPercent: ov.xPercent !== undefined ? Number(ov.xPercent) : 50,
      yPercent: ov.yPercent !== undefined ? Number(ov.yPercent) : 50,
      widthPercent: ov.widthPercent !== undefined ? Math.max(2, Math.min(100, Number(ov.widthPercent))) : 30,
      opacity: ov.opacity !== undefined ? Math.max(0.05, Math.min(1, Number(ov.opacity))) : 1
    }));

  // 4. Assemble ordered timeline blocks
  const blocks = [];
  let outCursor = 0;

  // 4a. Intro videos
  const introVideos = (Array.isArray(operations.introVideos) ? operations.introVideos : [])
    .filter((v) => v && v.filePath && v.enabled !== false && Number(v.durationSec) > 0);
  for (const v of introVideos) {
    const dur = Math.max(0.1, Number(v.durationSec) || 1);
    blocks.push({
      type: 'external-video',
      role: 'intro',
      id: v.id || `intro_${blocks.length}`,
      name: v.name || path.basename(v.filePath),
      filePath: normalizeLocalMediaPath(v.filePath),
      durationSec: dur,
      outStart: outCursor,
      outEnd: outCursor + dur
    });
    outCursor += dur;
  }

  // 4b. Start images
  const startImages = (Array.isArray(operations.startImages) ? operations.startImages : [])
    .filter((img) => img && img.filePath && img.enabled !== false && Number(img.durationSec) > 0);
  for (const img of startImages) {
    const dur = Math.max(0.1, Number(img.durationSec) || 3);
    blocks.push({
      type: 'image-clip',
      role: 'start',
      id: img.id || `start_img_${blocks.length}`,
      name: img.name || path.basename(img.filePath),
      filePath: normalizeLocalMediaPath(img.filePath),
      durationSec: dur,
      outStart: outCursor,
      outEnd: outCursor + dur
    });
    outCursor += dur;
  }

  // 4c. Interleave splitKept segments and midImages
  const usedMidIds = new Set();
  for (let i = 0; i < splitKept.length; i++) {
    const seg = splitKept[i];

    // Any midImage whose insertAtOriginalSec <= seg.origStart + 0.025 and not yet placed goes before this segment
    for (const midImg of midImages) {
      if (!usedMidIds.has(midImg.id) && midImg.insertAtOriginalSec <= seg.origStart + 0.025) {
        usedMidIds.add(midImg.id);
        const dur = midImg.durationSec;
        blocks.push({
          type: 'image-clip',
          role: 'middle',
          id: midImg.id || `mid_img_${blocks.length}`,
          name: midImg.name || path.basename(midImg.filePath),
          filePath: midImg.filePath,
          insertAtOriginalSec: midImg.insertAtOriginalSec,
          durationSec: dur,
          outStart: outCursor,
          outEnd: outCursor + dur
        });
        outCursor += dur;
      }
    }

    const segDur = Math.max(0, seg.origEnd - seg.origStart);
    if (segDur > 0.01) {
      // Find overlays overlapping this source slice
      const sliceOverlays = [];
      for (const ov of overlayImages) {
        const ovStart = Math.max(seg.origStart, ov.startSec);
        const ovEnd = Math.min(seg.origEnd, ov.endSec);
        if (ovEnd > ovStart + 0.01) {
          sliceOverlays.push({
            ...ov,
            localStartSec: ovStart - seg.origStart,
            localEndSec: ovEnd - seg.origStart
          });
        }
      }

      blocks.push({
        type: 'source-slice',
        id: `slice_${i}`,
        origStart: seg.origStart,
        origEnd: seg.origEnd,
        durationSec: segDur,
        outStart: outCursor,
        outEnd: outCursor + segDur,
        overlays: sliceOverlays
      });
      outCursor += segDur;
    }
  }

  // Place any remaining midImages that were at or after the last kept segment
  for (const midImg of midImages) {
    if (!usedMidIds.has(midImg.id)) {
      usedMidIds.add(midImg.id);
      const dur = midImg.durationSec;
      blocks.push({
        type: 'image-clip',
        role: 'middle',
        id: midImg.id || `mid_img_${blocks.length}`,
        name: midImg.name || path.basename(midImg.filePath),
        filePath: midImg.filePath,
        insertAtOriginalSec: midImg.insertAtOriginalSec,
        durationSec: dur,
        outStart: outCursor,
        outEnd: outCursor + dur
      });
      outCursor += dur;
    }
  }

  // 4d. End images
  const endImages = (Array.isArray(operations.endImages) ? operations.endImages : [])
    .filter((img) => img && img.filePath && img.enabled !== false && Number(img.durationSec) > 0);
  for (const img of endImages) {
    const dur = Math.max(0.1, Number(img.durationSec) || 3);
    blocks.push({
      type: 'image-clip',
      role: 'end',
      id: img.id || `end_img_${blocks.length}`,
      name: img.name || path.basename(img.filePath),
      filePath: normalizeLocalMediaPath(img.filePath),
      durationSec: dur,
      outStart: outCursor,
      outEnd: outCursor + dur
    });
    outCursor += dur;
  }

  // 4e. Outro videos
  const outroVideos = (Array.isArray(operations.outroVideos) ? operations.outroVideos : [])
    .filter((v) => v && v.filePath && v.enabled !== false && Number(v.durationSec) > 0);
  for (const v of outroVideos) {
    const dur = Math.max(0.1, Number(v.durationSec) || 1);
    blocks.push({
      type: 'external-video',
      role: 'outro',
      id: v.id || `outro_${blocks.length}`,
      name: v.name || path.basename(v.filePath),
      filePath: normalizeLocalMediaPath(v.filePath),
      durationSec: dur,
      outStart: outCursor,
      outEnd: outCursor + dur
    });
    outCursor += dur;
  }

  const sourceSlices = blocks.filter((b) => b.type === 'source-slice');
  const totalCutSec = mergedCuts.reduce((acc, c) => acc + (c.end - c.start), 0);
  const totalAddedSec = blocks
    .filter((b) => b.type !== 'source-slice')
    .reduce((acc, b) => acc + b.durationSec, 0);

  return {
    sourceDurationSec: D,
    totalOutputDurationSec: outCursor,
    totalCutSec,
    totalAddedSec,
    mergedCuts,
    blocks,
    sourceSlices,
    overlayCount: overlayImages.length
  };
}

/**
 * Maps a single subtitle interval [origStartSec, origEndSec] through the timelinePlan's sourceSlices.
 * Returns an array of mapped output intervals [{ startSec, endSec, origStartSec, origEndSec }].
 */
function mapSubtitleInterval(origStartSec, origEndSec, sourceSlices) {
  // Preserve technical 0:00:00.00 -> 0:00:00.00 noise lines
  if (origStartSec === 0 && origEndSec === 0) {
    return [{ startSec: 0, endSec: 0, isTechnicalZero: true }];
  }

  const pieces = [];
  for (const slice of sourceSlices) {
    const ovStart = Math.max(origStartSec, slice.origStart);
    const ovEnd = Math.min(origEndSec, slice.origEnd);
    if (ovEnd > ovStart + 0.01) {
      const mappedStart = slice.outStart + (ovStart - slice.origStart);
      const mappedEnd = slice.outStart + (ovEnd - slice.origStart);
      pieces.push({
        startSec: mappedStart,
        endSec: mappedEnd,
        origSliceStart: ovStart,
        origSliceEnd: ovEnd
      });
    }
  }

  if (pieces.length === 0) {
    return [];
  }

  // Merge contiguous output pieces (e.g. when a cut occurred inside a subtitle line and two sourceSlices touch at outEnd == outStart)
  const merged = [pieces[0]];
  for (let i = 1; i < pieces.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = pieces[i];
    if (Math.abs(curr.startSec - prev.endSec) < 0.02) {
      prev.endSec = curr.endSec;
      prev.origSliceEnd = curr.origSliceEnd;
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Recalculates an ASS or SRT subtitle file according to timelinePlan.
 * If dryRun=true, does not write to disk and only returns statistics & preview rows.
 */
async function recalculateSubtitles(subPath, outputSubPath, timelinePlan, sendLog = () => {}, dryRun = false) {
  const cleanSubPath = normalizeLocalMediaPath(subPath);
  if (!cleanSubPath || !fsSync.existsSync(cleanSubPath)) {
    sendLog('warn', `[SUB-RECALC] Файл субтитров не найден или не прикреплен: ${cleanSubPath || 'нет'}`);
    return {
      hasSubtitles: false,
      totalLines: 0,
      keptLines: 0,
      shiftedLines: 0,
      trimmedLines: 0,
      removedLines: 0,
      splitLines: 0,
      sampleChanges: []
    };
  }

  let workingAssPath = cleanSubPath;
  const isSrt = cleanSubPath.toLowerCase().endsWith('.srt');
  let tempConvertedAss = null;

  if (isSrt) {
    tempConvertedAss = `${cleanSubPath}._ve_temp.ass`;
    await convertSrtToAss(cleanSubPath, tempConvertedAss);
    workingAssPath = tempConvertedAss;
  }

  const content = await readTextFileWithAutoEncoding(workingAssPath);
  if (tempConvertedAss) {
    await fs.unlink(tempConvertedAss).catch(() => {});
  }

  const rawLines = content.split(/\r?\n/);
  const outputLines = [];

  let inEvents = false;
  let formatParts = [];

  let totalLines = 0;
  let keptLines = 0;
  let shiftedLines = 0;
  let trimmedLines = 0;
  let removedLines = 0;
  let splitLines = 0;
  const sampleChanges = [];
  const actorLineCounts = {};

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('[Events]')) {
      inEvents = true;
      outputLines.push(line);
      continue;
    }

    if (inEvents && trimmed.startsWith('Format:')) {
      formatParts = trimmed.substring(7).split(',').map((s) => s.trim());
      outputLines.push(line);
      continue;
    }

    if (inEvents && trimmed.startsWith('Dialogue:')) {
      const parsed = parseDialogueLine(line, formatParts);
      if (!parsed) {
        outputLines.push(line);
        continue;
      }

      totalLines++;
      const origStartSec = assTimeToSec(parsed.start);
      const origEndSec = assTimeToSec(parsed.end);
      const origDur = Math.max(0, origEndSec - origStartSec);
      const cleanPreviewText = (parsed.text || '').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, ' ').trim();

      // Technical 0:00:00.00 noise line
      if (origStartSec === 0 && origEndSec === 0 && (parsed.name === 'ШУМЫ' || cleanPreviewText === 'ШУМЫ')) {
        outputLines.push(line);
        keptLines++;
        continue;
      }

      const mappedPieces = mapSubtitleInterval(origStartSec, origEndSec, timelinePlan.sourceSlices);

      if (mappedPieces.length === 0) {
        removedLines++;
        if (sampleChanges.length < 150) {
          sampleChanges.push({
            lineNumber: totalLines,
            actor: parsed.name || parsed.style || '—',
            text: cleanPreviewText.slice(0, 90),
            oldStart: parsed.start,
            oldEnd: parsed.end,
            newStart: null,
            newEnd: null,
            deltaSec: null,
            status: 'removed'
          });
        }
        if (!dryRun) {
          sendLog(
            'info',
            `[SUB-RECALC] Удалена реплика #${totalLines} [${parsed.start} - ${parsed.end}] (${parsed.name || 'без роли'}): попала в вырезанный участок`
          );
        }
        continue;
      }

      if (mappedPieces.length > 1) {
        splitLines++;
      }

      for (let pIdx = 0; pIdx < mappedPieces.length; pIdx++) {
        const piece = mappedPieces[pIdx];
        const newStartStr = secToAssTime(piece.startSec);
        const newEndStr = secToAssTime(piece.endSec);
        const newDur = Math.max(0, piece.endSec - piece.startSec);

        const startDelta = piece.startSec - origStartSec;
        const durDelta = newDur - origDur;
        const isShifted = Math.abs(startDelta) >= 0.015;
        const isTrimmed = Math.abs(durDelta) >= 0.025;

        if (pIdx === 0) {
          keptLines++;
          if (isShifted) shiftedLines++;
          if (isTrimmed) trimmedLines++;
        }

        const actorKey = (parsed.name || parsed.style || 'Unknown').trim();
        if (actorKey && actorKey !== 'ШУМЫ') {
          actorLineCounts[actorKey] = (actorLineCounts[actorKey] || 0) + 1;
        }

        if (sampleChanges.length < 150 && (isShifted || isTrimmed || sampleChanges.length < 30)) {
          sampleChanges.push({
            lineNumber: totalLines,
            actor: parsed.name || parsed.style || '—',
            text: cleanPreviewText.slice(0, 90),
            oldStart: parsed.start,
            oldEnd: parsed.end,
            newStart: newStartStr,
            newEnd: newEndStr,
            deltaSec: Number(startDelta.toFixed(2)),
            status: isTrimmed ? 'trimmed' : isShifted ? 'shifted' : 'unchanged'
          });
        }

        const updatedParts = parsed.standardParts.map((part, idx) =>
          idx === parsed.formatInfo.textIndex ? part : part.trim()
        );
        updatedParts[parsed.formatInfo.startIndex] = newStartStr;
        updatedParts[parsed.formatInfo.endIndex] = newEndStr;
        outputLines.push(`${parsed.prefix}${updatedParts.join(',')}`);
      }
    } else {
      if (trimmed.startsWith('[') && trimmed !== '[Events]') {
        inEvents = false;
      }
      outputLines.push(line);
    }
  }

  if (!dryRun && outputSubPath) {
    const cleanOutSubPath = normalizeLocalMediaPath(outputSubPath);
    await fs.mkdir(path.dirname(cleanOutSubPath), { recursive: true });
    await fs.writeFile(cleanOutSubPath, outputLines.join('\n'), 'utf-8');
    clearSubtitleCache(cleanOutSubPath);
    await cleanAssFile(cleanOutSubPath);
    clearSubtitleCache(cleanOutSubPath);
    clearSubtitleCache(cleanSubPath);

    sendLog(
      'info',
      `[SUB-RECALC] Субтитры успешно пересчитаны и сохранены: всего=${totalLines}, сохранено=${keptLines}, сдвинуто=${shiftedLines}, подрезано=${trimmedLines}, удалено=${removedLines}`
    );
  }

  return {
    hasSubtitles: true,
    totalLines,
    keptLines,
    shiftedLines,
    trimmedLines,
    removedLines,
    splitLines,
    actorLineCounts,
    sampleChanges
  };
}

/**
 * Spawns FFmpeg with given args, tracks progress and logs every command and stderr line on error.
 */
function runFfmpegArgs(args, expectedDurationSec, onProgress, sendLog, stepLabel = 'FFmpeg') {
  return new Promise((resolve, reject) => {
    const bin = getFfmpegPath() || 'ffmpeg';
    const cmdStr = `"${bin}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
    sendLog('info', `[FFMPEG] Запуск (${stepLabel}): ${cmdStr}`);
    log.info(`[VIDEO-EDITOR] Executing (${stepLabel}): ${cmdStr}`);

    const proc = spawn(bin, args, { windowsHide: true });
    trackProcess(proc);

    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      stderrBuf += str;
      if (stderrBuf.length > 32000) {
        stderrBuf = stderrBuf.slice(-24000);
      }

      if (onProgress && expectedDurationSec > 0) {
        const match = str.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
        if (match) {
          const curSec =
            parseInt(match[1], 10) * 3600 +
            parseInt(match[2], 10) * 60 +
            parseFloat(match[3]);
          const pct = Math.min(99, Math.max(0, Math.round((curSec / expectedDurationSec) * 100)));
          onProgress(pct);
        }
      }
    });

    proc.on('error', (err) => {
      sendLog('error', `[FFMPEG] Ошибка запуска процесса (${stepLabel}): ${err.message}`);
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        const tail = stderrBuf.split(/\r?\n/).slice(-12).join('\n');
        const err = new Error(`FFmpeg завершился с кодом ${code} (${stepLabel}): ${tail}`);
        err.stderr = stderrBuf;
        sendLog('error', `[FFMPEG] Сбой (${stepLabel}, код ${code}): ${tail}`);
        reject(err);
      }
    });
  });
}

/**
 * Renders a single source-slice WITH overlay images applied on top of the video.
 * Keeps audio stream copied (-c:a copy) and uses visually lossless fast encoding for video.
 */
async function renderOverlaidSourceSlice(sourcePath, slice, sourceInfo, outputPath, onProgress, sendLog) {
  const args = [
    '-y',
    '-ss',
    slice.origStart.toFixed(3),
    '-to',
    slice.origEnd.toFixed(3),
    '-i',
    sourcePath
  ];

  // Add each overlay image as an input
  for (const ov of slice.overlays) {
    args.push('-loop', '1', '-t', slice.durationSec.toFixed(3), '-i', ov.filePath);
  }

  // Build filter_complex chain
  const filterParts = [];
  let lastVideoLabel = '0:v:0';
  const W = sourceInfo.width || 1920;
  const H = sourceInfo.height || 1080;

  for (let i = 0; i < slice.overlays.length; i++) {
    const ov = slice.overlays[i];
    const inputIdx = i + 1;
    const targetW = Math.max(16, Math.round((W * (ov.widthPercent || 30)) / 100));
    const ovLabel = `ov${i}`;
    const outLabel = `vout${i}`;

    // Scale overlay image and apply opacity if < 1
    if (ov.opacity !== undefined && ov.opacity < 0.99) {
      filterParts.push(
        `[${inputIdx}:v]scale=${targetW}:-1,format=rgba,colorchannelmixer=aa=${ov.opacity.toFixed(2)}[${ovLabel}]`
      );
    } else {
      filterParts.push(`[${inputIdx}:v]scale=${targetW}:-1,format=rgba[${ovLabel}]`);
    }

    // Position center at (xPercent, yPercent) of frame, clamped to screen bounds
    const xExpr = `max(0,min(W-w,W*${(ov.xPercent / 100).toFixed(4)}-w/2))`;
    const yExpr = `max(0,min(H-h,H*${(ov.yPercent / 100).toFixed(4)}-h/2))`;
    const enableExpr = `between(t,${ov.localStartSec.toFixed(3)},${ov.localEndSec.toFixed(3)})`;

    filterParts.push(
      `[${lastVideoLabel}][${ovLabel}]overlay=x='${xExpr}':y='${yExpr}':enable='${enableExpr}':eof_action=pass[${outLabel}]`
    );
    lastVideoLabel = outLabel;
  }

  filterParts.push(`[${lastVideoLabel}]format=${sourceInfo.pixFmt || 'yuv420p'}[vfinal]`);

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vfinal]',
    '-map',
    '0:a?',
    '-c:v',
    sourceInfo.videoCodec === 'hevc' ? 'libx265' : 'libx264',
    '-crf',
    '16',
    '-preset',
    'veryfast',
    '-r',
    sourceInfo.fpsStr || '24',
    '-c:a',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    outputPath
  );

  await runFfmpegArgs(
    args,
    slice.durationSec,
    onProgress,
    sendLog,
    `Наложение картинки на участок [${formatReadableTime(slice.origStart)} - ${formatReadableTime(slice.origEnd)}]`
  );
}

/**
 * Generates a video clip segment from a still image matching the source video's resolution, FPS, and audio parameters.
 */
async function renderImageClipSegment(imageBlock, sourceInfo, outputPath, onProgress, sendLog) {
  const W = sourceInfo.width || 1920;
  const H = sourceInfo.height || 1080;
  const dur = Math.max(0.1, Number(imageBlock.durationSec) || 3);
  const fpsStr = sourceInfo.fpsStr || '24';
  const vEncoder = sourceInfo.videoCodec === 'hevc' ? 'libx265' : 'libx264';

  const args = [
    '-y',
    '-loop',
    '1',
    '-t',
    dur.toFixed(3),
    '-i',
    imageBlock.filePath
  ];

  if (sourceInfo.hasAudio) {
    const chLayout = sourceInfo.channels === 1 ? 'mono' : 'stereo';
    args.push(
      '-f',
      'lavfi',
      '-t',
      dur.toFixed(3),
      '-i',
      `anullsrc=channel_layout=${chLayout}:sample_rate=${sourceInfo.sampleRate || 48000}`
    );
  }

  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fpsStr},format=yuv420p`;

  args.push('-vf', vf, '-c:v', vEncoder, '-crf', '16', '-preset', 'veryfast');

  if (sourceInfo.hasAudio) {
    const aCodec = sourceInfo.audioCodec === 'flac' ? 'flac' : sourceInfo.audioCodec === 'mp3' ? 'libmp3lame' : 'aac';
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:a',
      aCodec,
      '-ar',
      String(sourceInfo.sampleRate || 48000),
      '-ac',
      String(sourceInfo.channels || 2),
      '-shortest'
    );
  } else {
    args.push('-an');
  }

  args.push(outputPath);

  await runFfmpegArgs(
    args,
    dur,
    onProgress,
    sendLog,
    `Генерация видео-сегмента из картинки "${imageBlock.name}" (${dur.toFixed(1)} сек)`
  );
}

/**
 * Prepares an external video segment (intro/outro) to match the main video's stream parameters.
 * Uses direct stream copy if parameters already match, otherwise normalizes to match main video.
 */
async function renderExternalVideoSegment(extBlock, sourceInfo, outputPath, onProgress, sendLog) {
  const extInfo = await probeMediaFile(extBlock.filePath);
  const dur = Math.max(0.1, Number(extBlock.durationSec) || extInfo.durationSec || 1);

  const sameVideo =
    extInfo.videoCodec === sourceInfo.videoCodec &&
    extInfo.width === sourceInfo.width &&
    extInfo.height === sourceInfo.height &&
    Math.abs(extInfo.fps - sourceInfo.fps) < 0.05;

  const sameAudio =
    extInfo.hasAudio === sourceInfo.hasAudio &&
    (!sourceInfo.hasAudio ||
      (extInfo.audioCodec === sourceInfo.audioCodec &&
        extInfo.sampleRate === sourceInfo.sampleRate &&
        extInfo.channels === sourceInfo.channels));

  if (sameVideo && sameAudio) {
    sendLog(
      'info',
      `[FFMPEG] Стороннее видео "${extBlock.name}" совпадает по кодеку/разрешению — используем прямое копирование (-c copy)`
    );
    const args = [
      '-y',
      '-i',
      extBlock.filePath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      outputPath
    ];
    await runFfmpegArgs(args, dur, onProgress, sendLog, `Прямое копирование видео "${extBlock.name}"`);
    return;
  }

  sendLog(
    'info',
    `[FFMPEG] Адаптация параметров стороннего видео "${extBlock.name}" (${extInfo.width}x${extInfo.height} -> ${sourceInfo.width}x${sourceInfo.height}, ${sourceInfo.fpsStr} fps) для бесшовной склейки без перекодирования основной серии`
  );

  const W = sourceInfo.width || 1920;
  const H = sourceInfo.height || 1080;
  const fpsStr = sourceInfo.fpsStr || '24';
  const vEncoder = sourceInfo.videoCodec === 'hevc' ? 'libx265' : 'libx264';
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fpsStr},format=yuv420p`;

  const args = ['-y', '-i', extBlock.filePath];

  if (sourceInfo.hasAudio && !extInfo.hasAudio) {
    const chLayout = sourceInfo.channels === 1 ? 'mono' : 'stereo';
    args.push(
      '-f',
      'lavfi',
      '-t',
      dur.toFixed(3),
      '-i',
      `anullsrc=channel_layout=${chLayout}:sample_rate=${sourceInfo.sampleRate || 48000}`
    );
  }

  args.push('-vf', vf, '-c:v', vEncoder, '-crf', '16', '-preset', 'veryfast');

  if (sourceInfo.hasAudio) {
    const aCodec = sourceInfo.audioCodec === 'flac' ? 'flac' : sourceInfo.audioCodec === 'mp3' ? 'libmp3lame' : 'aac';
    if (extInfo.hasAudio) {
      args.push(
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c:a',
        aCodec,
        '-ar',
        String(sourceInfo.sampleRate || 48000),
        '-ac',
        String(sourceInfo.channels || 2)
      );
    } else {
      args.push(
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:a',
        aCodec,
        '-ar',
        String(sourceInfo.sampleRate || 48000),
        '-ac',
        String(sourceInfo.channels || 2),
        '-shortest'
      );
    }
  } else {
    args.push('-an');
  }

  args.push(outputPath);

  await runFfmpegArgs(args, dur, onProgress, sendLog, `Подготовка видео "${extBlock.name}"`);
}

/**
 * Main entry point to render the edited video + recalculate subtitles + update episode in project.
 */
async function renderEditedVideo(payload, getData, saveData, onProgress = () => {}, sendLog = () => {}) {
  const startTime = Date.now();
  const { episodeId, projectId, videoPath, subPath, operations } = payload || {};

  const cleanSourceVideoPath = normalizeLocalMediaPath(videoPath);
  if (!cleanSourceVideoPath || !fsSync.existsSync(cleanSourceVideoPath)) {
    throw new Error(`Исходный видеофайл не найден: ${cleanSourceVideoPath || videoPath}`);
  }

  sendLog('info', `=============================================================`);
  sendLog('info', `[VIDEO-EDITOR] Старт обработки видео и пересчета субтитров`);
  sendLog('info', `[VIDEO-EDITOR] Исходное видео: ${cleanSourceVideoPath}`);
  sendLog('info', `[VIDEO-EDITOR] Исходные субтитры: ${subPath ? normalizeLocalMediaPath(subPath) : 'нет'}`);

  // 1. Probe source video
  const sourceInfo = await probeMediaFile(cleanSourceVideoPath);
  sendLog(
    'info',
    `[VIDEO-EDITOR] Параметры исходного видео: ${sourceInfo.width}x${sourceInfo.height}, кодек=${sourceInfo.videoCodec}, fps=${sourceInfo.fpsStr}, длительность=${sourceInfo.durationSec.toFixed(2)}с, аудио=${sourceInfo.hasAudio ? `${sourceInfo.audioCodec} ${sourceInfo.sampleRate}Hz ${sourceInfo.channels}ch` : 'нет'}`
  );

  // 2. Build deterministic timeline plan
  const plan = buildTimelinePlan(sourceInfo.durationSec, operations);
  sendLog(
    'info',
    `[VIDEO-EDITOR] План таймлайна построен: блоков=${plan.blocks.length}, кусков исходного видео=${plan.sourceSlices.length}, вырезано=${plan.totalCutSec.toFixed(2)}с, добавлено=${plan.totalAddedSec.toFixed(2)}с, итоговая длительность=${plan.totalOutputDurationSec.toFixed(2)}с`
  );

  if (plan.blocks.length === 0) {
    throw new Error('Итоговый таймлайн пуст (все видео было вырезано). Оставьте хотя бы один участок.');
  }

  // 3. Determine output directory (Project Episode folder or video's directory)
  const config = (await getData('config.json')) || {};
  const baseDir = config.baseDir || app.getPath('userData');
  const projects = (await getData('projects.json')) || [];
  const episodes = (await getData('episodes.json')) || [];

  const epIndex = episodeId ? episodes.findIndex((e) => e.id === episodeId) : -1;
  const episodeObj = epIndex !== -1 ? episodes[epIndex] : null;
  const projectObj = projectId
    ? projects.find((p) => p.id === projectId)
    : episodeObj
    ? projects.find((p) => p.id === episodeObj.projectId)
    : null;

  let targetEpisodeDir = path.dirname(cleanSourceVideoPath);
  if (projectObj && episodeObj) {
    const projDir = await ProjectScanner.findProjectDirectory(baseDir, projectObj);
    if (projDir) {
      targetEpisodeDir = path.join(projDir, ProjectScanner.sanitizeFolderName(`Episode_${episodeObj.number}`));
    }
  }
  await fs.mkdir(targetEpisodeDir, { recursive: true });
  sendLog('info', `[VIDEO-EDITOR] Рабочая папка серии: ${targetEpisodeDir}`);

  // 4. Preserve original video and subtitle backups on first edit
  let originalRawBackup = episodeObj?.originalRawPath || cleanSourceVideoPath;
  let originalSubBackup = episodeObj?.originalSubPath || null;

  const cleanSubPath = subPath ? normalizeLocalMediaPath(subPath) : (episodeObj?.subPath ? normalizeLocalMediaPath(episodeObj.subPath) : '');
  if (cleanSubPath && fsSync.existsSync(cleanSubPath)) {
    const backupSubFile = path.join(targetEpisodeDir, 'subtitles_original_backup.ass');
    if (!fsSync.existsSync(backupSubFile)) {
      await fs.copyFile(cleanSubPath, backupSubFile);
      sendLog('info', `[VIDEO-EDITOR] Создана резервная копия исходных субтитров: ${backupSubFile}`);
    }
    originalSubBackup = backupSubFile;
  }

  // 5. Render video via FFmpeg
  const timestamp = Date.now();
  const sourceExt = path.extname(cleanSourceVideoPath).toLowerCase() || '.mp4';
  const outExt = ['.mp4', '.mkv'].includes(sourceExt) ? sourceExt : '.mp4';
  const finalVideoPath = path.join(targetEpisodeDir, `raw_video_edited_${timestamp}${outExt}`);
  const tempWorkDir = path.join(targetEpisodeDir, `.temp_ve_${timestamp}`);

  const hasInsertedClips = plan.blocks.some((b) => b.type !== 'source-slice');
  const hasOverlays = plan.sourceSlices.some((s) => s.overlays && s.overlays.length > 0);

  try {
    // FAST PATH 1: Single source-slice, no inserts, no overlays -> single -c copy command!
    if (!hasInsertedClips && !hasOverlays && plan.sourceSlices.length === 1) {
      const slice = plan.sourceSlices[0];
      sendLog(
        'info',
        `[VIDEO-EDITOR] Режим: Быстрое прямое копирование потоков (-c copy) одного участка [${formatReadableTime(slice.origStart)} -> ${formatReadableTime(slice.origEnd)}]`
      );
      const args = [
        '-y',
        '-ss',
        slice.origStart.toFixed(3),
        '-to',
        slice.origEnd.toFixed(3),
        '-i',
        cleanSourceVideoPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero'
      ];
      if (outExt === '.mp4') {
        args.push('-movflags', '+faststart');
      }
      args.push(finalVideoPath);

      await runFfmpegArgs(args, slice.durationSec, onProgress, sendLog, 'Прямое копирование (-c copy)');
    } else {
      // MULTI-SEGMENT PATH: Create each block in tempWorkDir, then concatenate via -c copy!
      await fs.mkdir(tempWorkDir, { recursive: true });
      const segmentFiles = [];
      const totalBlocks = plan.blocks.length;

      for (let bIdx = 0; bIdx < totalBlocks; bIdx++) {
        const block = plan.blocks[bIdx];
        const segPath = path.join(tempWorkDir, `seg_${String(bIdx).padStart(3, '0')}${outExt}`);
        const blockBasePct = Math.round((bIdx / totalBlocks) * 85);
        const blockSpanPct = Math.round((1 / totalBlocks) * 85);

        const blockProgress = (pct) => {
          onProgress(Math.min(90, blockBasePct + Math.round((pct / 100) * blockSpanPct)));
        };

        if (block.type === 'source-slice') {
          if (block.overlays && block.overlays.length > 0) {
            sendLog(
              'info',
              `[VIDEO-EDITOR] Сегмент #${bIdx + 1}/${totalBlocks}: Участок видео [${formatReadableTime(block.origStart)} - ${formatReadableTime(block.origEnd)}] с наложением ${block.overlays.length} карт.`
            );
            await renderOverlaidSourceSlice(
              cleanSourceVideoPath,
              block,
              sourceInfo,
              segPath,
              blockProgress,
              sendLog
            );
          } else {
            sendLog(
              'info',
              `[VIDEO-EDITOR] Сегмент #${bIdx + 1}/${totalBlocks}: Прямое копирование (-c copy) участка [${formatReadableTime(block.origStart)} - ${formatReadableTime(block.origEnd)}]`
            );
            const args = [
              '-y',
              '-ss',
              block.origStart.toFixed(3),
              '-to',
              block.origEnd.toFixed(3),
              '-i',
              cleanSourceVideoPath,
              '-map',
              '0:v:0',
              '-map',
              '0:a?',
              '-c',
              'copy',
              '-avoid_negative_ts',
              'make_zero',
              segPath
            ];
            await runFfmpegArgs(
              args,
              block.durationSec,
              blockProgress,
              sendLog,
              `Копирование сегмента #${bIdx + 1}`
            );
          }
        } else if (block.type === 'image-clip') {
          sendLog(
            'info',
            `[VIDEO-EDITOR] Сегмент #${bIdx + 1}/${totalBlocks}: Вставка картинки "${block.name}" (${block.role}, ${block.durationSec.toFixed(2)}с)`
          );
          await renderImageClipSegment(block, sourceInfo, segPath, blockProgress, sendLog);
        } else if (block.type === 'external-video') {
          sendLog(
            'info',
            `[VIDEO-EDITOR] Сегмент #${bIdx + 1}/${totalBlocks}: Вставка стороннего видео "${block.name}" (${block.role}, ${block.durationSec.toFixed(2)}с)`
          );
          await renderExternalVideoSegment(block, sourceInfo, segPath, blockProgress, sendLog);
        }

        segmentFiles.push(segPath);
      }

      // Concatenate segments
      // If we mixed newly-encoded H.264 segments (images/overlays/normalized intro) with -c copy H.264 source segments,
      // remuxing each segment to MPEG-TS (.ts) with h264_mp4toannexb first guarantees 100% glitch-free SPS/PPS stream-copy concatenation!
      const isH264Family = sourceInfo.videoCodec === 'h264' || sourceInfo.videoCodec === 'avc1';
      let concatSucceeded = false;

      if ((hasInsertedClips || hasOverlays) && isH264Family) {
        try {
          sendLog(
            'info',
            `[VIDEO-EDITOR] Бесшовная склейка ${segmentFiles.length} сегментов через MPEG-TS Annex-B (-c copy без потери качества)...`
          );
          const tsFiles = [];
          for (let i = 0; i < segmentFiles.length; i++) {
            const tsPath = path.join(tempWorkDir, `seg_${String(i).padStart(3, '0')}.ts`);
            const tsArgs = [
              '-y',
              '-i',
              segmentFiles[i],
              '-c',
              'copy',
              '-bsf:v',
              'h264_mp4toannexb',
              '-f',
              'mpegts',
              tsPath
            ];
            await runFfmpegArgs(tsArgs, 0, null, sendLog, `Упаковка TS #${i + 1}`);
            tsFiles.push(tsPath);
          }

          const concatListPath = path.join(tempWorkDir, 'concat_ts.txt');
          const concatListContent = tsFiles
            .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
            .join('\n');
          await fs.writeFile(concatListPath, concatListContent, 'utf-8');

          const finalConcatArgs = [
            '-y',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            concatListPath,
            '-c',
            'copy'
          ];
          if (sourceInfo.hasAudio && sourceInfo.audioCodec === 'aac' && outExt === '.mp4') {
            finalConcatArgs.push('-bsf:a', 'aac_adtstoasc');
          }
          if (outExt === '.mp4') {
            finalConcatArgs.push('-movflags', '+faststart');
          }
          finalConcatArgs.push(finalVideoPath);

          await runFfmpegArgs(
            finalConcatArgs,
            plan.totalOutputDurationSec,
            (p) => onProgress(90 + Math.round(p * 0.1)),
            sendLog,
            'Финальная склейка TS -> контейнера (-c copy)'
          );
          concatSucceeded = true;
        } catch (tsErr) {
          sendLog(
            'warn',
            `[VIDEO-EDITOR] TS Annex-B склейка не подошла (${tsErr.message}), переключаемся на стандартный concat demuxer...`
          );
        }
      }

      if (!concatSucceeded) {
        const concatListPath = path.join(tempWorkDir, 'concat_list.txt');
        const concatListContent = segmentFiles
          .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
          .join('\n');
        await fs.writeFile(concatListPath, concatListContent, 'utf-8');

        sendLog('info', `[VIDEO-EDITOR] Склейка ${segmentFiles.length} сегментов через concat demuxer (-c copy)...`);
        const concatArgs = [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero'
        ];
        if (outExt === '.mp4') {
          concatArgs.push('-movflags', '+faststart');
        }
        concatArgs.push(finalVideoPath);

        await runFfmpegArgs(
          concatArgs,
          plan.totalOutputDurationSec,
          (p) => onProgress(90 + Math.round(p * 0.1)),
          sendLog,
          'Финальная склейка сегментов (-c copy)'
        );
      }
    }
  } finally {
    // Clean up temporary segments folder
    await fs.rm(tempWorkDir, { recursive: true, force: true }).catch(() => {});
  }

  sendLog('info', `[VIDEO-EDITOR] Видео успешно отрендерено: ${finalVideoPath}`);

  // 6. Recalculate subtitles if episode has subtitles
  let targetSubPath = cleanSubPath;
  let subStats = null;
  if (cleanSubPath && fsSync.existsSync(cleanSubPath)) {
    // Ensure output subtitle is stored in targetEpisodeDir as subtitles.ass (or existing subPath)
    if (cleanSubPath.toLowerCase().endsWith('.srt')) {
      targetSubPath = path.join(targetEpisodeDir, 'subtitles.ass');
    } else {
      targetSubPath = cleanSubPath;
    }
    subStats = await recalculateSubtitles(cleanSubPath, targetSubPath, plan, sendLog, false);
  } else {
    sendLog('warn', `[VIDEO-EDITOR] Субтитры не прикреплены к серии — пересчет субтитров пропущен.`);
  }

  // 7. Clean up older edited video files in targetEpisodeDir (keep originalRawBackup and the new finalVideoPath)
  try {
    const dirFiles = await fs.readdir(targetEpisodeDir);
    for (const f of dirFiles) {
      if (f.startsWith('raw_video_edited_')) {
        const fullP = path.join(targetEpisodeDir, f);
        if (
          path.resolve(fullP) !== path.resolve(finalVideoPath) &&
          path.resolve(fullP) !== path.resolve(originalRawBackup)
        ) {
          await fs.unlink(fullP).catch(() => {});
        }
      }
    }
  } catch (e) {}

  // 8. Update episode record in episodes.json and episode.json on disk
  let updatedEpisode = null;
  if (epIndex !== -1 && episodeObj) {
    const aliases = projectObj?.characterAliases ? JSON.parse(projectObj.characterAliases || '{}') : {};
    let updatedAssignments = Array.isArray(episodeObj.assignments) ? [...episodeObj.assignments] : [];

    // Update character line counts based on recalculated subtitles
    if (subStats && subStats.hasSubtitles && targetSubPath) {
      try {
        const rawSubData = await getRawSubtitles(targetSubPath);
        const lineCounts = {};
        for (const l of rawSubData.lines || []) {
          const rawName = (l.name || l.style || 'Unknown').trim();
          const mainName = aliases[rawName] || rawName;
          lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
        }
        updatedAssignments = updatedAssignments
          .map((a) => ({
            ...a,
            lineCount: lineCounts[a.characterName] || 0
          }))
          .filter((a) => (a.lineCount || 0) > 0);
      } catch (e) {
        log.warn('[VIDEO-EDITOR] Could not refresh assignment line counts:', e.message);
      }
    }

    updatedEpisode = {
      ...episodeObj,
      rawPath: finalVideoPath,
      subPath: targetSubPath || episodeObj.subPath,
      originalRawPath: originalRawBackup,
      originalSubPath: originalSubBackup || episodeObj.originalSubPath,
      assignments: updatedAssignments,
      updatedAt: new Date().toISOString()
    };

    episodes[epIndex] = updatedEpisode;
    await saveData('episodes.json', episodes);

    if (projectObj) {
      await ProjectScanner.saveEpisodeJsonOnDisk(baseDir, projectObj, updatedEpisode);
    }
    sendLog(
      'info',
      `[VIDEO-EDITOR] Серия #${episodeObj.number} обновлена в проекте (новое видео и пересчитанные субтитры привязаны к серии)`
    );
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  sendLog('info', `[VIDEO-EDITOR] Готово за ${elapsedSec} сек!`);
  sendLog('info', `=============================================================`);

  return {
    videoPath: finalVideoPath,
    subPath: targetSubPath,
    originalRawPath: originalRawBackup,
    originalSubPath: originalSubBackup,
    outputDurationSec: plan.totalOutputDurationSec,
    sourceDurationSec: sourceInfo.durationSec,
    subtitleStats: subStats,
    updatedEpisode,
    elapsedSec: Number(elapsedSec)
  };
}

/**
 * Restores the episode's unedited original video and subtitles from backup.
 */
async function restoreOriginalEpisodeMedia({ episodeId }, getData, saveData, sendLog = () => {}) {
  const config = (await getData('config.json')) || {};
  const baseDir = config.baseDir || app.getPath('userData');
  const projects = (await getData('projects.json')) || [];
  const episodes = (await getData('episodes.json')) || [];

  const epIndex = episodes.findIndex((e) => e.id === episodeId);
  if (epIndex === -1) {
    throw new Error('Серия не найдена в базе данных');
  }

  const ep = episodes[epIndex];
  const projectObj = projects.find((p) => p.id === ep.projectId);

  const origVideo = ep.originalRawPath ? normalizeLocalMediaPath(ep.originalRawPath) : null;
  if (!origVideo || !fsSync.existsSync(origVideo)) {
    throw new Error('Исходный видеофайл резервной копии не найден на диске');
  }

  let restoredSubPath = ep.subPath ? normalizeLocalMediaPath(ep.subPath) : null;
  const origSubBackup = ep.originalSubPath ? normalizeLocalMediaPath(ep.originalSubPath) : null;

  if (origSubBackup && fsSync.existsSync(origSubBackup) && restoredSubPath) {
    await fs.copyFile(origSubBackup, restoredSubPath);
    clearSubtitleCache(restoredSubPath);
    sendLog('info', `[VIDEO-EDITOR] Восстановлены исходные субтитры из ${origSubBackup}`);
  }

  const updatedEp = {
    ...ep,
    rawPath: origVideo,
    updatedAt: new Date().toISOString()
  };

  episodes[epIndex] = updatedEp;
  await saveData('episodes.json', episodes);

  if (projectObj) {
    await ProjectScanner.saveEpisodeJsonOnDisk(baseDir, projectObj, updatedEp);
  }

  sendLog('info', `[VIDEO-EDITOR] Восстановлено исходное видео серии: ${origVideo}`);
  return {
    videoPath: origVideo,
    subPath: restoredSubPath,
    updatedEpisode: updatedEp
  };
}

module.exports = {
  probeMediaFile,
  buildTimelinePlan,
  recalculateSubtitles,
  renderEditedVideo,
  restoreOriginalEpisodeMedia,
  normalizeLocalMediaPath
};
