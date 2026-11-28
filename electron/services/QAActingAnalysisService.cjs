const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const log = require('electron-log');
const { app } = require('electron');
const EnvironmentManager = require('./EnvironmentManager.cjs');
const AudioAnalysisService = require('./AudioAnalysisService.cjs');
const AudioNeuralService = require('./AudioNeuralService.cjs');
const { getFfmpegPath } = require('./ffmpegService.cjs');
const { trackProcess } = require('../lib/ProcessTracker.cjs');

const SETTINGS_FILE = 'qa_detection_settings.json';
const STRESS_DICT_FILE = 'qa_stress_dictionary.json';
const PROFILES_FILE = 'qa_character_profiles.json';

class QAActingAnalysisService {
  getDataDir() {
    if (process.env.ADM_DATA_DIR) return process.env.ADM_DATA_DIR;
    if (typeof app !== 'undefined' && app.getPath) {
      try {
        return app.getPath('userData');
      } catch {}
    }
    return process.cwd();
  }

  getSidecarScriptPath() {
    const userData = this.getDataDir();
    const targetScript = path.join(userData, 'sidecars', 'qa_acting_analyzer.py');
    const aiEnvSidecarScript = path.join(userData, 'ai_env', 'sidecars', 'qa_acting_analyzer.py');

    const candidates = [
      path.join(__dirname, '..', 'sidecars', 'qa_acting_analyzer.py'),
      path.join(__dirname, 'qa_acting_analyzer.py'),
      path.join(process.cwd(), 'electron', 'sidecars', 'qa_acting_analyzer.py'),
    ];
    if (process.resourcesPath) {
      candidates.unshift(
        path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'sidecars', 'qa_acting_analyzer.py')
      );
      candidates.push(path.join(process.resourcesPath, 'electron', 'sidecars', 'qa_acting_analyzer.py'));
    }

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        try {
          const content = fs.readFileSync(cand, 'utf8');
          if (content && content.length > 500) {
            fs.mkdirSync(path.dirname(targetScript), { recursive: true });
            fs.writeFileSync(targetScript, content, 'utf8');
            if (fs.existsSync(path.dirname(aiEnvSidecarScript))) {
              fs.writeFileSync(aiEnvSidecarScript, content, 'utf8');
            }
            return targetScript;
          }
        } catch (e) {
          log.warn(`[QAActingAnalysisService] Could not sync sidecar from ${cand}: ${e.message}`);
        }
      }
    }

    if (fs.existsSync(targetScript)) return targetScript;
    if (fs.existsSync(aiEnvSidecarScript)) return aiEnvSidecarScript;
    return path.join(__dirname, '..', 'sidecars', 'qa_acting_analyzer.py');
  }

  async checkModels(profile = 'full_acting') {
    const pythonPath = EnvironmentManager.getPythonPath();
    const scriptPath = this.getSidecarScriptPath();
    const safeProfile = profile === 'fast_diction' ? 'fast_diction' : 'full_acting';

    try {
      const res = await EnvironmentManager.spawnPythonProcess(
        pythonPath,
        [scriptPath, '--mode', 'check_models', '--profile', safeProfile],
        { operationName: 'QA Acting Check Models' }
      );
      return res;
    } catch (err) {
      log.warn('[QAActingAnalysisService] checkModels failed:', err.message);
      return {
        profile: safeProfile,
        ready: false,
        missingCount: 0,
        totalMissingMb: 0,
        models: [],
        error: err.message
      };
    }
  }

  async downloadModels(profile = 'full_acting', onProgress) {
    const pythonPath = EnvironmentManager.getPythonPath();
    const scriptPath = this.getSidecarScriptPath();
    const safeProfile = profile === 'fast_diction' ? 'fast_diction' : 'full_acting';

    return await EnvironmentManager.spawnPythonProcess(
      pythonPath,
      [scriptPath, '--mode', 'download_models', '--profile', safeProfile],
      {
        operationName: 'Загрузка моделей AI QA',
        onProgress: (p) => {
          if (onProgress) onProgress({ stage: 'models', percent: p.percent, message: p.message });
        }
      }
    );
  }

  async getDetectionSettings(getData) {
    try {
      const data = await getData(SETTINGS_FILE);
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  async saveDetectionSettings(saveData, settings) {
    await saveData(SETTINGS_FILE, settings || {});
    return { success: true, settings };
  }

  async getStressDictionary(getData, projectId = null) {
    try {
      const raw = await getData(STRESS_DICT_FILE);
      const list = Array.isArray(raw) ? raw : [];
      if (!projectId) return list;
      return list.filter((e) => !e.projectId || e.projectId === projectId);
    } catch {
      return [];
    }
  }

  async saveStressEntry(getData, saveData, entry) {
    const list = await this.getStressDictionary(getData, null);
    const cleanWord = String(entry?.word || '').trim().toLowerCase();
    const cleanStressed = String(entry?.stressedForm || '').trim();
    if (!cleanWord || !cleanStressed) {
      throw new Error('Необходимо указать слово и форму с ударением.');
    }

    const scope = entry.scope === 'global' ? 'global' : 'project';
    const projectId = scope === 'global' ? null : (entry.projectId || null);
    const id = entry.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const existingIdx = list.findIndex(
      (item) =>
        item.id === id ||
        (item.word === cleanWord && (item.projectId || null) === projectId)
    );

    const record = {
      id,
      word: cleanWord,
      stressedForm: cleanStressed,
      scope,
      projectId,
      notes: entry.notes || '',
      updatedAt: now
    };

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...record };
    } else {
      list.unshift(record);
    }

    await saveData(STRESS_DICT_FILE, list);
    return record;
  }

  async deleteStressEntry(getData, saveData, entryId) {
    const list = await this.getStressDictionary(getData, null);
    const next = list.filter((e) => e.id !== entryId);
    await saveData(STRESS_DICT_FILE, next);
    return { success: true, id: entryId };
  }

  async getCharacterProfiles(getData, projectId = null) {
    try {
      const raw = await getData(PROFILES_FILE);
      const list = Array.isArray(raw) ? raw : [];
      if (!projectId) return list;
      return list.filter((p) => !p.projectId || p.projectId === projectId);
    } catch {
      return [];
    }
  }

  async saveCharacterProfile(getData, saveData, profile) {
    const list = await this.getCharacterProfiles(getData, null);
    const characterName = String(profile?.characterName || '').trim();
    if (!characterName) {
      throw new Error('Необходимо указать имя персонажа.');
    }
    const projectId = profile.projectId || null;
    const id = profile.id || crypto.randomUUID();
    const existingIdx = list.findIndex(
      (p) =>
        p.id === id ||
        (String(p.characterName || '').trim().toLowerCase() === characterName.toLowerCase() &&
          (p.projectId || null) === projectId)
    );

    const record = {
      id,
      projectId,
      characterName,
      ageGroup: profile.ageGroup || 'any',
      expectedGender: profile.expectedGender || 'any',
      targetF0MinHz: profile.targetF0MinHz ? Number(profile.targetF0MinHz) : null,
      targetF0MaxHz: profile.targetF0MaxHz ? Number(profile.targetF0MaxHz) : null,
      emotionTolerance: profile.emotionTolerance || 'standard',
      notes: profile.notes || '',
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...record };
    } else {
      list.unshift(record);
    }
    await saveData(PROFILES_FILE, list);
    return record;
  }

  _runFfmpeg(args) {
    const ffmpegPath = getFfmpegPath() || 'ffmpeg';
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      trackProcess(child);
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
    });
  }

  async _resolveEpisodeContext(episode, episodeId, getData) {
    let ep = episode || null;
    if ((!ep || !ep.rawPath) && episodeId && typeof getData === 'function') {
      try {
        const episodes = await getData('episodes.json');
        if (Array.isArray(episodes)) {
          ep = episodes.find((e) => e.id === episodeId) || ep;
        }
      } catch {}
    }

    const config = (await getData?.('config.json').catch(() => ({}))) || {};
    const baseDir = config.baseDir || this.getDataDir();
    const projectsData = (await getData?.('projects.json').catch(() => [])) || [];
    const project = ep && Array.isArray(projectsData)
      ? projectsData.find((p) => p.id === ep.projectId)
      : null;

    const MixingPipelineService = require('./MixingPipelineService.cjs');
    let epDir = null;
    let timingDir = null;
    let stemsDir = null;
    if (ep) {
      const enriched = { ...ep, project: ep.project || project || { title: 'Project' } };
      epDir = MixingPipelineService.getEpisodeDir(enriched, baseDir);
      timingDir = path.join(epDir, 'Тайминг');
      stemsDir = path.join(timingDir, 'stems');
    }

    return { episode: ep, project, epDir, timingDir, stemsDir };
  }

  _findEpisodeVideo(episode, videoPath, epDir) {
    if (videoPath && fs.existsSync(videoPath)) return videoPath;
    if (episode?.rawPath && fs.existsSync(episode.rawPath)) return episode.rawPath;
    const dirs = [epDir, epDir ? path.dirname(epDir) : null, episode?.folderPath].filter(
      (d) => d && typeof d === 'string' && fs.existsSync(d)
    );
    const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
    for (const dir of dirs) {
      try {
        const files = fs.readdirSync(dir);
        const found = files.find((f) => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
        if (found) return path.join(dir, found);
      } catch {}
    }
    return null;
  }

  /**
   * Stage 0: Find cached separated original_vocals.wav or perform stem separation automatically.
   */
  async ensureOriginalVocalsStem({ episode, episodeId, videoPath, settings, lines, getData, onProgress }) {
    const mode = settings?.originalStemMode || 'full_cached';
    const modelId = settings?.originalStemModel || 'htdemucs';

    const { episode: ep, project, epDir, timingDir, stemsDir } = await this._resolveEpisodeContext(
      episode,
      episodeId,
      getData
    );

    const candidateDirs = [
      stemsDir,
      timingDir,
      epDir,
      epDir ? path.join(epDir, 'Сведение') : null,
      ep?.folderPath,
    ].filter(Boolean);

    const cachedVocals = AudioAnalysisService.findOriginalVocalsTrack(candidateDirs, null, null, {});
    if (cachedVocals && fs.existsSync(cachedVocals)) {
      if (onProgress) {
        onProgress({ stage: 'stems', percent: 100, message: `Найден кешированный вокальный стем оригинала: ${path.basename(cachedVocals)}` });
      }
      return {
        vocalsPath: cachedVocals,
        stemsDir,
        project,
        episode: ep,
        tempDir: null,
        tempDialogueMap: null,
      };
    }

    if (mode === 'none') {
      return {
        vocalsPath: null,
        stemsDir,
        project,
        episode: ep,
        tempDir: null,
        tempDialogueMap: null,
      };
    }

    const effectiveVideo = this._findEpisodeVideo(ep, videoPath, epDir);
    if (!effectiveVideo) {
      log.warn('[QAActingAnalysisService] Original video not found for Stage 0 stem separation.');
      return {
        vocalsPath: null,
        stemsDir,
        project,
        episode: ep,
        tempDir: null,
        tempDialogueMap: null,
      };
    }

    // Ensure UVR model weights if uvr_mdx_voc_ft is chosen
    let modelPath = null;
    if (modelId === 'uvr_mdx_voc_ft') {
      const MixingPipelineService = require('./MixingPipelineService.cjs');
      const modelDef = MixingPipelineService.moduleDatabase?.find((m) => m.id === 'uvr_mdx_voc_ft');
      const filename = modelDef?.filename || 'UVR-MDX-NET-Voc_FT.onnx';
      const uvrDir = path.join(this.getDataDir(), 'models', 'uvr');
      await fsPromises.mkdir(uvrDir, { recursive: true });
      const localFile = path.join(uvrDir, filename);
      if (!fs.existsSync(localFile) && modelDef?.urls?.length > 0) {
        if (onProgress) onProgress({ stage: 'stems', percent: 8, message: 'Загрузка модели разделения вокала UVR-MDX...' });
        await MixingPipelineService.downloadUvrModel({
          modelId: 'uvr_mdx_voc_ft',
          onProgress: (p) => {
            if (p && typeof p.percent === 'number' && onProgress) {
              onProgress({ stage: 'stems', percent: Math.round(8 + p.percent * 0.2), message: `Загрузка UVR: ${p.percent}%` });
            }
          }
        }).catch((e) => log.warn('[QAActingAnalysisService] UVR weights download warning:', e.message));
      }
      if (fs.existsSync(localFile)) {
        modelPath = localFile;
      }
    }

    if (mode === 'dialogue_windows' && Array.isArray(lines) && lines.length > 0) {
      const tempStemDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'adm_qa_stems_'));
      const concatWav = path.join(tempStemDir, 'orig_windows_concat.wav');
      const outSepDir = path.join(tempStemDir, 'sep_out');
      await fsPromises.mkdir(outSepDir, { recursive: true });

      try {
        if (onProgress) onProgress({ stage: 'stems', percent: 15, message: 'Вырезание диалоговых окон оригинала для быстрого разделения...' });
        const snippetList = [];
        const tempDialogueMap = {};
        let offsetCursor = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const s = Math.max(0, Number(line.startSec || 0) - 0.3);
          const e = Math.max(s + 0.3, Number(line.endSec || 0) + 0.3);
          const dur = e - s;
          const segPath = path.join(tempStemDir, `seg_${i}.wav`);
          await this._runFfmpeg([
            '-y', '-ss', s.toFixed(3), '-t', dur.toFixed(3), '-i', effectiveVideo,
            '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', segPath
          ]);
          snippetList.push(`file '${segPath.replace(/'/g, "'\\''")}'`);
          tempDialogueMap[line.id] = { startSec: offsetCursor + 0.3, endSec: offsetCursor + dur - 0.3 };
          offsetCursor += dur;
        }

        const listPath = path.join(tempStemDir, 'concat.txt');
        await fsPromises.writeFile(listPath, snippetList.join('\n'), 'utf8');
        await this._runFfmpeg([
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', concatWav
        ]);

        if (onProgress) onProgress({ stage: 'stems', percent: 35, message: `Выделение вокала из диалоговых окон (${modelId})...` });
        const neuralRes = await AudioNeuralService.separateStems({
          inputPath: concatWav,
          outputDir: outSepDir,
          modelName: modelId,
          modelPath,
          modelId,
          shifts: 1,
          overlap: 0.25,
          stems: 'vocals',
          prefix: 'win_',
          onProgress: (p) => {
            if (p && typeof p.percent === 'number' && onProgress) {
              onProgress({ stage: 'stems', percent: Math.round(35 + p.percent * 0.6), message: `Разделение окон оригинала: ${Math.round(p.percent)}%` });
            }
          }
        });

        let separatedVocals = Array.isArray(neuralRes)
          ? neuralRes.find((s) => s.type === 'vocals' || /vocal/i.test(s.path || s.name || ''))?.path
          : null;
        if (!separatedVocals) {
          const files = fs.readdirSync(outSepDir);
          const found = files.find((f) => /vocal/i.test(f) && !/no_vocal/i.test(f));
          if (found) separatedVocals = path.join(outSepDir, found);
        }

        return {
          vocalsPath: separatedVocals || null,
          stemsDir,
          project,
          episode: ep,
          tempDir: tempStemDir,
          tempDialogueMap,
        };
      } catch (err) {
        await fsPromises.rm(tempStemDir, { recursive: true, force: true }).catch(() => {});
        log.warn('[QAActingAnalysisService] dialogue_windows stem separation failed:', err.message);
        return { vocalsPath: null, stemsDir, project, episode: ep, tempDir: null, tempDialogueMap: null };
      }
    }

    // Default: full_cached mode — write into <timingDir>/stems/ just like AutoTiming so everything reuses it!
    const targetStemsDir = stemsDir || await fsPromises.mkdtemp(path.join(os.tmpdir(), 'adm_qa_fullstems_'));
    await fsPromises.mkdir(targetStemsDir, { recursive: true });
    const rawAudioPath = path.join(targetStemsDir, 'source_original_audio.wav');
    const vocalsPath = path.join(targetStemsDir, 'original_vocals.wav');
    const instrumentalPath = path.join(targetStemsDir, 'original_instrumental.wav');

    if (onProgress) onProgress({ stage: 'stems', percent: 12, message: 'Извлечение аудиодорожки оригинала из видео...' });
    if (!fs.existsSync(rawAudioPath) || fs.statSync(rawAudioPath).size < 1000) {
      await this._runFfmpeg([
        '-y', '-i', effectiveVideo,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', rawAudioPath
      ]);
    }

    const tempOut = path.join(targetStemsDir, 'temp_neural_out');
    await fsPromises.mkdir(tempOut, { recursive: true });

    if (onProgress) onProgress({ stage: 'stems', percent: 25, message: `Разделение оригинала на стемы (${modelId}) для QA и Автотайминга...` });
    const neuralRes = await AudioNeuralService.separateStems({
      inputPath: rawAudioPath,
      outputDir: tempOut,
      modelName: modelId,
      modelPath,
      modelId,
      shifts: 1,
      overlap: 0.25,
      stems: 'both',
      prefix: 'stem_',
      onProgress: (p) => {
        if (p && typeof p.percent === 'number' && onProgress) {
          onProgress({ stage: 'stems', percent: Math.round(25 + p.percent * 0.7), message: `Стемы оригинала (${modelId}): ${Math.round(p.percent)}%` });
        }
      }
    });

    let foundVocals = null;
    let foundInst = null;
    if (Array.isArray(neuralRes)) {
      foundVocals = neuralRes.find((s) => s.type === 'vocals' || (!/no_vocal|instrumental|other/i.test(s.path || '') && /vocal/i.test(s.path || '')))?.path;
      foundInst = neuralRes.find((s) => s.type === 'instrumental' || /instrumental|no_vocal|other/i.test(s.path || ''))?.path;
    }
    if (!foundVocals || !foundInst) {
      const files = fs.readdirSync(tempOut);
      for (const f of files) {
        const full = path.join(tempOut, f);
        if (/instrumental|no_vocal|other/i.test(f)) {
          if (!foundInst) foundInst = full;
        } else if (/vocal/i.test(f)) {
          if (!foundVocals) foundVocals = full;
        }
      }
    }

    if (foundVocals && fs.existsSync(foundVocals)) {
      await fsPromises.copyFile(foundVocals, vocalsPath);
    }
    if (foundInst && fs.existsSync(foundInst)) {
      await fsPromises.copyFile(foundInst, instrumentalPath);
    }
    await fsPromises.rm(tempOut, { recursive: true, force: true }).catch(() => {});

    return {
      vocalsPath: fs.existsSync(vocalsPath) ? vocalsPath : null,
      stemsDir: targetStemsDir,
      project,
      episode: ep,
      tempDir: stemsDir ? null : targetStemsDir,
      tempDialogueMap: null,
    };
  }

  async analyzeEpisode(payload, getData, onProgress) {
    const {
      projectId,
      projectTitle,
      episodeId,
      episode,
      videoPath,
      lines = [],
      trackPaths = {},
      settings = {},
    } = payload || {};

    if (!Array.isArray(lines) || lines.length === 0) {
      return { issues: [], originalVocalsPath: null, analyzedLines: 0 };
    }

    // 1. Stage 0: Ensure Original Vocal Stem
    const stemInfo = await this.ensureOriginalVocalsStem({
      episode,
      episodeId,
      videoPath,
      settings,
      lines,
      getData,
      onProgress,
    });

    const resolvedProjectTitle = projectTitle || stemInfo.project?.title || 'Project';
    const stressDictionary = await this.getStressDictionary(getData, projectId || stemInfo.episode?.projectId);
    const characterProfiles = await this.getCharacterProfiles(getData, projectId || stemInfo.episode?.projectId);

    const VoiceSignatureService = require('./VoiceSignatureService.cjs');
    const voiceBaseDir = await VoiceSignatureService.getVoiceBaseDir(resolvedProjectTitle);

    const workDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'adm_qa_acting_'));
    try {
      if (onProgress) onProgress({ stage: 'acting', percent: 5, message: 'Подготовка 16kHz аудиофрагментов реплик для локального анализа...' });

      const manifestLines = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trackFile = line.trackFilePath || trackPaths[line.dubberId] || trackPaths[line.trackId] || null;
        if (!trackFile || !fs.existsSync(trackFile)) continue;

        const startSec = Math.max(0, Number(line.startSec || 0));
        const endSec = Math.max(startSec + 0.1, Number(line.endSec || 0));
        const dur = endSec - startSec;
        const dubWavPath = path.join(workDir, `dub_${i}.wav`);

        try {
          await this._runFfmpeg([
            '-y', '-ss', startSec.toFixed(3), '-t', dur.toFixed(3), '-i', trackFile,
            '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', dubWavPath
          ]);
        } catch {
          continue;
        }

        let origWavPath = null;
        if (stemInfo.vocalsPath && fs.existsSync(stemInfo.vocalsPath)) {
          const origWindow = stemInfo.tempDialogueMap?.[line.id] || { startSec, endSec };
          const oStart = Math.max(0, Number(origWindow.startSec || 0));
          const oDur = Math.max(0.1, Number(origWindow.endSec || 0) - oStart);
          const candidateOrig = path.join(workDir, `orig_${i}.wav`);
          try {
            await this._runFfmpeg([
              '-y', '-ss', oStart.toFixed(3), '-t', oDur.toFixed(3), '-i', stemInfo.vocalsPath,
              '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', candidateOrig
            ]);
            origWavPath = candidateOrig;
          } catch {}
        }

        manifestLines.push({
          id: line.id,
          character: line.character || '',
          dubberId: line.dubberId || '',
          text: line.text || '',
          startSec,
          endSec,
          dubberWavPath: dubWavPath,
          origWavPath,
        });
      }

      const manifestPath = path.join(workDir, 'manifest.json');
      await fsPromises.writeFile(
        manifestPath,
        JSON.stringify({
          settings,
          stressDictionary,
          characterProfiles,
          voiceBaseDir,
          lines: manifestLines,
        }),
        'utf8'
      );

      const pythonPath = EnvironmentManager.getPythonPath();
      const scriptPath = this.getSidecarScriptPath();
      const profile = settings?.actingResourceProfile === 'fast_diction' ? 'fast_diction' : 'full_acting';

      const pyRes = await EnvironmentManager.spawnPythonProcess(
        pythonPath,
        [scriptPath, '--mode', 'analyze', '--profile', profile, '--manifest', manifestPath],
        {
          operationName: 'Актёрский и дикционный QA',
          onProgress: (p) => {
            if (onProgress) onProgress({ stage: 'acting', percent: p.percent, message: p.message });
          }
        }
      );

      const persistentOrigStem =
        stemInfo.tempDir ? null : (stemInfo.vocalsPath || null);

      return {
        issues: Array.isArray(pyRes?.issues) ? pyRes.issues : [],
        analyzedLines: manifestLines.length,
        originalVocalsPath: persistentOrigStem,
      };
    } finally {
      await fsPromises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (stemInfo.tempDir) {
        await fsPromises.rm(stemInfo.tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

module.exports = new QAActingAnalysisService();
