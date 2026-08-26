const { createWorker } = require('tesseract.js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');
const { cleanAssFile } = require('./subtitleService.cjs');
const { addProcess, removeProcess } = require('./ffmpegService.cjs');

async function extractHardsub(videoPath, outputAssPath, onProgress, options = {}) {
  const { 
    language = 'rus+eng', 
    preprocess = false,
    fps = 0.5,
    crop = null
  } = options;

  const tempDir = path.join(path.dirname(videoPath), 'temp_ocr_' + Date.now());
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // 1. Extract frames
    log.info('Extracting frames for OCR...');
    
    // Construct crop filter if specified
    let cropFilter = null;
    if (crop) {
      if (typeof crop === 'string') {
        cropFilter = crop;
      } else if (typeof crop === 'object') {
        const { x = 0, y = 75, w = 100, h = 25 } = crop;
        cropFilter = `crop=in_w*${w/100}:in_h*${h/100}:in_w*${x/100}:in_h*${y/100}`;
      }
    }

    // Choose filter chain based on preprocess flag
    // For subtitles, we want high contrast and sharpness
    // format=gray: converts to grayscale
    // curves=strong_contrast: increases contrast
    // threshold: binarizes the image (black and white only) - helpful for clear text
    const vf = [
      `fps=${fps}`,
      cropFilter,
      preprocess ? 'format=gray,curves=strong_contrast,unsharp=5:5:1.0:5:5:0.0' : null
    ].filter(Boolean).join(',');

    await new Promise((resolve, reject) => {
      let processId = null;
      const command = ffmpeg(videoPath)
        .outputOptions('-vf', vf)
        .output(path.join(tempDir, 'frame_%04d.png'))
        .on('start', (commandLine) => {
          processId = addProcess(commandLine, command);
        })
        .on('end', () => {
          if (processId) removeProcess(processId);
          resolve();
        })
        .on('error', (err) => {
          log.error('FFmpeg extraction error:', err);
          if (processId) removeProcess(processId);
          reject(err);
        });
      command.run();
    });

    // 2. Perform OCR
    log.info(`Performing OCR with language: ${language}...`);
    const files = (await fs.readdir(tempDir)).filter(f => f.endsWith('.png')).sort();
    log.info(`Extracted ${files.length} frames for processing.`);
    let worker = await createWorker(language);
    const subtitles = [];

    if (files.length === 0) {
      log.error('OCR Error: No frames extracted from video');
      throw new Error('No frames extracted from video');
    }

    const interval = 1 / fps;

    for (let i = 0; i < files.length; i++) {
      if (i % 10 === 0) log.info(`OCR progress: ${i}/${files.length} frames processed.`);
      const framePath = path.join(tempDir, files[i]);
      
      try {
        const { data: { text } } = await worker.recognize(framePath);
        
        if (text && text.trim()) {
          subtitles.push({
            start: i * interval,
            end: (i + 1) * interval,
            text: text.trim()
          });
        }
      } catch (recErr) {
        log.warn(`OCR failed on frame ${files[i]}:`, recErr.message || recErr);
      } finally {
        // Immediately unlink processed frame to free disk/cache memory
        await fs.unlink(framePath).catch(() => {});
      }

      // Re-create worker every 80 frames to flush Emscripten Wasm heap memory leak
      if ((i + 1) % 80 === 0 && i < files.length - 1) {
        log.info('Recycling Tesseract worker to free memory...');
        await worker.terminate().catch(() => {});
        worker = await createWorker(language);
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }

      if (onProgress) onProgress(Math.round(((i + 1) / files.length) * 100));
    }
    await worker.terminate().catch(() => {});
    log.info(`OCR complete. Found ${subtitles.length} lines.`);

    // 3. Save to ASS
    log.info('Saving subtitles...');
    let assContent = `[Script Info]
Title: Hardsub Extraction
ScriptType: v4.00+
PlayResX: 384
PlayResY: 288

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;

    function formatAssTime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const cs = Math.floor((seconds % 1) * 100);
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    }

    const newLines = subtitles.map(sub => ({
      start: formatAssTime(sub.start),
      end: formatAssTime(sub.end),
      style: 'Default',
      name: '',
      text: sub.text.replace(/\n/g, '\\N')
    }));

    // Check if file already exists & has lines
    let existingLines = [];
    try {
      await fs.access(outputAssPath);
      const { getRawSubtitles } = require('./subtitleService.cjs');
      const existing = await getRawSubtitles(outputAssPath);
      existingLines = existing.lines || [];
    } catch (e) {
      // ignore
    }

    if (existingLines.length > 0) {
      log.info(`[OCR] Merging ${newLines.length} new OCR lines with ${existingLines.length} existing lines...`);
      const { mergeSubtitles, saveRawSubtitles } = require('./subtitleService.cjs');
      const mergedLines = mergeSubtitles(existingLines, newLines);
      await saveRawSubtitles(outputAssPath, mergedLines, true);
    } else {
      subtitles.forEach(sub => {
        const start = formatAssTime(sub.start);
        const end = formatAssTime(sub.end);
        assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${sub.text.replace(/\n/g, '\\N')}\n`;
      });
      await fs.writeFile(outputAssPath, assContent);
      await cleanAssFile(outputAssPath);
    }

    return { success: true };
  } catch (error) {
    log.error('OCR Error:', error);
    return { success: false, error: error.message };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { extractHardsub };
