const fs = require("fs").promises;
const fsPromises = fs;
const fsSync = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const log = require("electron-log");
const { app, shell } = require("electron");
const ExportService = require("../ExportService.cjs");
const ffmpegService = require("../ffmpegService.cjs");
const AutoTimingService = require("../AutoTimingService.cjs");
const AudioNeuralService = require("../AudioNeuralService.cjs");
const AudioAnalysisService = require("../AudioAnalysisService.cjs");
const { trackProcess, killAllActiveProcesses } = require("../../lib/ProcessTracker.cjs");
const { sanitizeProjectTitle, sanitizePath } = require("../../lib/pathSanitizer.cjs");
const { MODULE_DATABASE, createDefaultPipeline } = require("./MixingModuleDatabase.cjs");

class MixingManifestRouter {
  /**
   * Immediately aborts any running step or full pipeline execution
   */
  async abortProcessing({ episode, targetDir, baseDir } = {}) {
    this.isAborted = true;
    log.warn('[Mixing] 🛑 Получен сигнал принудительной остановки (Abort) процесса сведения!');

    // 1. Kill all active FFmpeg commands
    for (const cmd of Array.from(this._activeFfmpegCommands)) {
      try {
        cmd.kill('SIGKILL');
      } catch (e) {}
    }
    this._activeFfmpegCommands.clear();

    // 2. Kill all active Python AI processes
    try {
      AudioNeuralService.abortAll();
    } catch (e) {}

    // 3. Kill any other registered child processes
    try {
      killAllActiveProcesses();
    } catch (e) {}

    // 4. Reset 'processing' status in manifest if episode is provided
    if (episode) {
      try {
        const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
        const manifestPath = path.join(workingDir, 'mixing_manifest.json');
        if (fsSync.existsSync(manifestPath)) {
          const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
          if (Array.isArray(manifest.pipeline)) {
            manifest.pipeline.forEach(s => {
              if (s.status === 'processing') {
                s.status = 'idle';
                s.error = 'Остановлено пользователем';
              }
            });
          }
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);
        }
        return await this.getStatus({ episode, targetDir: workingDir, baseDir });
      } catch (e) {
        log.warn('[Mixing] Error updating manifest after abort:', e.message);
      }
    }

    return { success: true, aborted: true };
  }

  /**
   * Clears processed output files for a specific step (or deletes a single output file if trackPath is passed)
   */
  async clearStepOutput({ episode, targetDir, baseDir, stepId, trackPath = null, filePath = null }) {
    if (!episode) throw new Error('Episode parameter is required');
    if (!stepId) throw new Error('stepId parameter is required');

    const singleTrackPath = trackPath || filePath || null;
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = (manifest.pipeline || []).findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг ${stepId} не найден в конвейере`);
    }

    const step = manifest.pipeline[stepIndex];
    const stepDir = path.join(workingDir, `${String(stepIndex + 1).padStart(2, '0')}_${step.moduleId}`);

    if (singleTrackPath) {
      // Delete only the specified output file
      try {
        if (fsSync.existsSync(singleTrackPath)) {
          await fs.unlink(singleTrackPath);
        }
      } catch (e) {
        log.warn(`[Mixing] Could not delete track file ${singleTrackPath}:`, e.message);
      }
      step.outputFiles = (step.outputFiles || []).filter(f => f.path !== singleTrackPath && f.name !== path.basename(singleTrackPath));
      if (step.outputFiles.length === 0) {
        step.status = 'idle';
        step.error = null;
      }
    } else {
      // Delete all output files of this step
      for (const f of (step.outputFiles || [])) {
        if (f && f.path && fsSync.existsSync(f.path)) {
          try { await fs.unlink(f.path); } catch (e) {}
        }
      }
      if (fsSync.existsSync(stepDir)) {
        try {
          const entries = fsSync.readdirSync(stepDir);
          for (const entry of entries) {
            const fullP = path.join(stepDir, entry);
            try { fsSync.unlinkSync(fullP); } catch (e) {}
          }
        } catch (e) {}
      }
      if (step.prefix && fsSync.existsSync(workingDir)) {
        try {
          const rootEntries = fsSync.readdirSync(workingDir);
          for (const rFile of rootEntries) {
            if (rFile.startsWith(step.prefix)) {
              try { fsSync.unlinkSync(path.join(workingDir, rFile)); } catch (e) {}
            }
          }
        } catch (e) {}
      }
      if (step.moduleId === 'video_mux') {
        manifest.finalVideo = null;
      }
      step.outputFiles = [];
      step.status = 'idle';
      step.error = null;
    }

    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  /**
   * Updates per-step track selection (supports action-based or direct array updates)
   */
  async updateStepTracks({ episode, targetDir, baseDir, stepId, action, trackKey, trackPaths, excludedTrackKeys, customInputTracks, applyToAllSteps = false }) {
    if (!episode) throw new Error('Episode parameter is required');
    if (!stepId) throw new Error('stepId parameter is required');

    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    const stepIndex = (manifest.pipeline || []).findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Шаг ${stepId} не найден в конвейере`);
    }

    const updateTarget = (stepObj) => {
      if (!Array.isArray(stepObj.excludedTrackKeys)) stepObj.excludedTrackKeys = [];
      if (!Array.isArray(stepObj.customInputTracks)) stepObj.customInputTracks = [];

      if (action === 'toggle_exclude' && trackKey) {
        const idx = stepObj.excludedTrackKeys.indexOf(trackKey);
        if (idx >= 0) {
          stepObj.excludedTrackKeys.splice(idx, 1);
        } else {
          stepObj.excludedTrackKeys.push(trackKey);
        }
      } else if (action === 'clear_exclusions') {
        stepObj.excludedTrackKeys = [];
      } else if (action === 'add_custom' && Array.isArray(trackPaths)) {
        for (const p of trackPaths) {
          if (!p || !fsSync.existsSync(p)) continue;
          const existsAlready = stepObj.customInputTracks.some(ct => ct.path === p);
          if (!existsAlready) {
            let sz = 0;
            try { sz = fsSync.statSync(p).size; } catch (e) {}
            const name = path.basename(p);
            const nick = this._deriveDubberNickFromFilename(name);
            stepObj.customInputTracks.push({
              id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name,
              dubberNick: nick,
              path: p,
              size: sz,
              exists: true,
              isCustom: true
            });
          }
        }
      } else if (action === 'remove_custom' && trackKey) {
        stepObj.customInputTracks = stepObj.customInputTracks.filter(
          ct => ct.path !== trackKey && ct.name !== trackKey && this._getTrackKey(ct) !== trackKey
        );
      }

      if (Array.isArray(excludedTrackKeys)) {
        stepObj.excludedTrackKeys = excludedTrackKeys;
      }
      if (Array.isArray(customInputTracks)) {
        stepObj.customInputTracks = customInputTracks.map(tr => {
          const p = tr.path || '';
          let sz = tr.size || 0;
          if (!sz && p && fsSync.existsSync(p)) {
            try { sz = fsSync.statSync(p).size; } catch (e) {}
          }
          const name = tr.name || (p ? path.basename(p) : 'track.wav');
          const nick = tr.dubberNick || this._deriveDubberNickFromFilename(name);
          return {
            id: tr.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            dubberNick: nick,
            path: p,
            size: sz,
            exists: p ? fsSync.existsSync(p) : false,
            isCustom: true
          };
        });
      }
    };

    if (applyToAllSteps) {
      manifest.pipeline.forEach(s => updateTarget(s));
    } else {
      updateTarget(manifest.pipeline[stepIndex]);
    }

    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir);

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }

  createFactoryPipeline() {
    return createDefaultPipeline();
  }

  getModuleDatabase() {
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    const uvrModelsDir = path.join(rootUserData, 'models', 'uvr');

    return this.moduleDatabase.map(mod => {
      if (mod.filename && /\.(pth|ckpt|onnx|bin)$/i.test(mod.filename)) {
        const localModelFile = path.join(uvrModelsDir, mod.filename);
        const isInstalled = fsSync.existsSync(localModelFile);
        let bytes = null;
        if (isInstalled) {
          try {
            bytes = fsSync.statSync(localModelFile).size;
          } catch (e) {}
        }
        return {
          ...mod,
          is_installed: isInstalled,
          installed_bytes: bytes,
          local_path: isInstalled ? localModelFile : null
        };
      }
      return mod;
    });
  }

  getBaseRoot(baseDir = '', episode = null) {
    if (baseDir && typeof baseDir === 'string' && baseDir.trim()) {
      return path.resolve(baseDir.trim());
    }
    // Try to derive base root from episode rawPath or subPath (e.g. I:\YandexDisk\Озвучка\Project\Episode_11\raw_video.mkv)
    const refPath = episode?.rawPath || episode?.subPath;
    if (refPath && typeof refPath === 'string' && path.isAbsolute(refPath)) {
      try {
        const epDir = path.dirname(refPath);
        const projDir = path.dirname(epDir);
        const parentDir = path.dirname(projDir);
        if (parentDir && parentDir !== projDir && parentDir !== path.parse(parentDir).root) {
          return parentDir;
        }
        if (projDir && projDir !== path.parse(projDir).root) {
          return projDir;
        }
      } catch (e) {}
    }
    if (app && typeof app.getPath === 'function') {
      try {
        return app.getPath('userData');
      } catch (e) {}
    }
    try {
      const os = require('os');
      return path.join(os.homedir(), '.anime-dub-manager');
    } catch (e) {
      return process.cwd();
    }
  }

  getEpisodeDir(episode, baseDir = '') {
    if (!episode) return '';
    const epNum = episode.number !== undefined ? episode.number : 1;

    // 1. Try to derive directly from rawPath or subPath
    const refPath = episode?.rawPath || episode?.subPath;
    if (refPath && typeof refPath === 'string' && path.isAbsolute(refPath)) {
      try {
        const fileDir = path.dirname(refPath);
        const fileDirName = path.basename(fileDir).toLowerCase();
        
        // Check if fileDir is directly the episode folder (e.g. Episode_1, Ep1, Серия_1, 01, ep_01, or contains epNum)
        const isExplicitEpFolder = /^(episode|ep|серия|выпуск)[\s_.-]*\d+/i.test(fileDirName) ||
                                   /^\d+$/.test(fileDirName) ||
                                   fileDirName.includes(String(epNum));
        
        if (isExplicitEpFolder) {
          return fileDir;
        }

        // If fileDir is the project folder, check if an episode subfolder exists
        const candidates = [
          path.join(fileDir, `Episode_${epNum}`),
          path.join(fileDir, `Серия_${epNum}`),
          path.join(fileDir, `Ep_${epNum}`),
          path.join(fileDir, `ep_${epNum}`),
          path.join(fileDir, String(epNum).padStart(2, '0')),
          path.join(fileDir, String(epNum))
        ];
        for (const cand of candidates) {
          if (fsSync.existsSync(cand)) {
            return cand;
          }
        }

        // If fileDir is where media files are stored directly, check if fileDir has raw video
        if (fsSync.existsSync(refPath)) {
          return path.join(fileDir, `Episode_${epNum}`);
        }
        return fileDir;
      } catch (e) {}
    }

    // 2. Derive using baseDir and project title
    const root = this.getBaseRoot(baseDir, episode);
    const projectTitle = sanitizeProjectTitle(episode?.project?.title || 'Project');
    
    const projDir = path.join(root, projectTitle);
    const candFolders = [
      path.join(projDir, `Episode_${epNum}`),
      path.join(projDir, `Серия_${epNum}`),
      path.join(projDir, `Ep_${epNum}`),
      path.join(projDir, String(epNum).padStart(2, '0')),
      path.join(projDir, String(epNum))
    ];
    for (const cand of candFolders) {
      if (fsSync.existsSync(cand)) {
        return cand;
      }
    }

    return path.join(projDir, `Episode_${epNum}`);
  }

  getDefaultTargetDir(episode, baseDir = '') {
    const epDir = this.getEpisodeDir(episode, baseDir);
    // User request:
    // "все данные по работе со звуком сохранялись в папке текущей серии проекта.
    // Просто там подпапка создалась Сведения, и в этой же папке всё сохранялось, чтобы всё хранилось в одном месте и не было разношёрстности."
    const svedeniyaPath = path.join(epDir, 'Сведения');
    const svedenieLegacyPath = path.join(epDir, 'Сведение');
    if (!fsSync.existsSync(svedeniyaPath) && fsSync.existsSync(svedenieLegacyPath)) {
      return svedenieLegacyPath;
    }
    return svedeniyaPath;
  }

  resolveWorkingDir(targetDir, episode, baseDir = '') {
    if (!targetDir || typeof targetDir !== 'string' || !targetDir.trim()) {
      return this.getDefaultTargetDir(episode, baseDir);
    }
    const trimmed = targetDir.trim();
    if (!path.isAbsolute(trimmed)) {
      const epDir = this.getEpisodeDir(episode, baseDir);
      return path.resolve(epDir, trimmed);
    }
    return trimmed;
  }

  async ensureDirectory(dirPath, logFn = null) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return dirPath;
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        const errDetail = `Ошибка доступа EPERM/EACCES при создании папки «${dirPath}». Пробуем безопасную пользовательскую директорию...`;
        if (logFn) logFn(errDetail, 'warn');
        log.warn(`[Mixing] ${errDetail}: ${err.message}`);
        const fallbackRoot = (app && typeof app.getPath === 'function')
          ? app.getPath('userData')
          : path.join(require('os').homedir(), '.anime-dub-manager');
        const fallbackDir = path.join(fallbackRoot, 'Сведения', path.basename(path.dirname(dirPath)), path.basename(dirPath));
        await fs.mkdir(fallbackDir, { recursive: true });
        if (logFn) logFn(`Директория перенаправлена в безопасную пользовательскую папку: «${fallbackDir}»`, 'info');
        return fallbackDir;
      }
      throw err;
    }
  }

  /**
   * Helper to resolve saved pipeline file locations
   */
  getPipelineConfigFiles(workingDir, episode, baseDir = '') {
    const files = [];
    if (workingDir) {
      files.push(path.join(workingDir, 'mixing_pipeline.json'));
    }
    const epDir = this.getEpisodeDir(episode, baseDir);
    if (epDir) {
      files.push(path.join(epDir, 'mixing_pipeline.json'));
      // Project root fallback (shared between episodes of the same title)
      const projDir = path.dirname(epDir);
      if (projDir && projDir !== epDir && projDir !== path.parse(projDir).root) {
        files.push(path.join(projDir, 'mixing_pipeline.json'));
      }
    }
    const rootUserData = app ? app.getPath('userData') : process.cwd();
    files.push(path.join(rootUserData, 'config', 'mixing_last_active_pipeline.json'));
    return files;
  }

  /**
   * Load preserved pipeline from dedicated JSON files
   */
  loadPersistedPipeline(workingDir, episode, baseDir = '') {
    const candidateFiles = this.getPipelineConfigFiles(workingDir, episode, baseDir);
    for (const filePath of candidateFiles) {
      try {
        if (fsSync.existsSync(filePath)) {
          const raw = fsSync.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          const pipelineArray = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pipeline) ? parsed.pipeline : null);
          if (pipelineArray && pipelineArray.length > 0) {
            log.info(`[Mixing] Загружен сохраненный конвейер модулей из файла: ${filePath} (${pipelineArray.length} модулей)`);
            return pipelineArray;
          }
        }
      } catch (e) {
        log.warn(`[Mixing] Ошибка чтения сохраненного файла конвейера ${filePath}:`, e.message);
      }
    }
    return null;
  }

  /**
   * Save preserved pipeline to dedicated JSON files
   */
  async persistPipeline(pipeline, workingDir, episode, baseDir = '') {
    if (!Array.isArray(pipeline) || pipeline.length === 0) return;
    const candidateFiles = this.getPipelineConfigFiles(workingDir, episode, baseDir);
    const content = JSON.stringify(pipeline, null, 2);

    for (const filePath of candidateFiles) {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
      } catch (e) {
        log.warn(`[Mixing] Не удалось записать файл конвейера ${filePath}:`, e.message);
      }
    }
    log.info(`[Mixing] Конвейер модулей успешно сохранен в файлы конфигурации (${pipeline.length} модулей)`);
  }

  async getStatus({ episode, targetDir, baseDir }) {
    if (!episode) throw new Error('Episode parameter is required');

    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    const manifestPath = path.join(workingDir, 'mixing_manifest.json');

    let manifest = null;
    if (fsSync.existsSync(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(raw);
      } catch (e) {
        log.warn('[Mixing] Failed reading manifest:', e.message);
      }
    }

    // Load user-customized pipeline from dedicated config files with project & global fallback
    const persistedPipeline = this.loadPersistedPipeline(workingDir, episode, baseDir);

    if (!manifest) {
      manifest = {
        episodeId: episode.id,
        projectId: episode.projectId,
        workingDir,
        createdAt: new Date().toISOString(),
        isImported: false,
        sourceFiles: {
          video: null,
          originalAudio: null,
          subtitles: null,
          dubberTracks: []
        },
        pipeline: persistedPipeline || createDefaultPipeline(),
        modulesState: {},
        finalVideo: null
      };
    } else {
      // If workingDir has a direct mixing_pipeline.json file, merge it while preserving runtime step state & track selections
      const workingPipelineFile = path.join(workingDir, 'mixing_pipeline.json');
      if (fsSync.existsSync(workingPipelineFile)) {
        try {
          const raw = fsSync.readFileSync(workingPipelineFile, 'utf8');
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pipeline) ? parsed.pipeline : null);
          if (arr && arr.length > 0) {
            const prevById = new Map((manifest.pipeline || []).map(s => [s.stepId, s]));
            manifest.pipeline = arr.map(s => {
              const prev = prevById.get(s.stepId);
              if (!prev) return s;
              return {
                ...s,
                status: prev.status || s.status || 'idle',
                error: prev.error !== undefined ? prev.error : s.error,
                outputFiles: (Array.isArray(prev.outputFiles) && prev.outputFiles.length > 0) ? prev.outputFiles : (s.outputFiles || []),
                excludedTrackKeys: Array.isArray(s.excludedTrackKeys) ? s.excludedTrackKeys : (prev.excludedTrackKeys || []),
                customInputTracks: Array.isArray(s.customInputTracks) ? s.customInputTracks : (prev.customInputTracks || [])
              };
            });
          }
        } catch (e) {}
      } else if (!Array.isArray(manifest.pipeline) || manifest.pipeline.length === 0) {
        manifest.pipeline = persistedPipeline || createDefaultPipeline();
      } else if (persistedPipeline && persistedPipeline.length > 0) {
        // If manifest pipeline was just unconfigured factory default, adopt the persisted custom pipeline
        const isFactoryDefault = manifest.pipeline.length === 6 &&
          manifest.pipeline[0]?.moduleId === 'silence_gate' &&
          manifest.pipeline[1]?.moduleId === 'phrase_norm' &&
          manifest.pipeline[2]?.moduleId === 'glue_compress' &&
          manifest.pipeline[3]?.moduleId === 'ducking' &&
          manifest.pipeline[4]?.moduleId === 'master_audio_mix' &&
          manifest.pipeline[5]?.moduleId === 'video_mux';
        if (isFactoryDefault && JSON.stringify(manifest.pipeline) !== JSON.stringify(persistedPipeline)) {
          manifest.pipeline = persistedPipeline;
        }
      }
    }

    // Ensure dedicated config file is synchronized with manifest
    if (Array.isArray(manifest.pipeline) && manifest.pipeline.length > 0) {
      this.persistPipeline(manifest.pipeline, workingDir, episode, baseDir).catch(() => {});
    }

    await this._refreshManifestFiles(manifest, workingDir, episode);

    const timingMeta = await this.getTimingMetadata(workingDir).catch(() => null);
    const rolesVolumeMap = (timingMeta && timingMeta.rolesVolumeMap) ? timingMeta.rolesVolumeMap : {};

    return {
      success: true,
      workingDir,
      manifest,
      rolesVolumeMap,
      timingMetadata: timingMeta,
      moduleDatabase: this.getModuleDatabase()
    };
  }

  async savePipelineConfig({ episode, targetDir, baseDir, pipeline }) {
    if (!episode) throw new Error('Episode parameter is required');
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const manifestPath = path.join(workingDir, 'mixing_manifest.json');
    let manifest = null;
    if (fsSync.existsSync(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(raw);
      } catch (e) {}
    }
    if (!manifest) {
      const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
      manifest = statusData.manifest;
    }

    manifest.pipeline = pipeline;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // Also write directly to dedicated pipeline configuration files (workingDir, epDir, projDir, userData)
    await this.persistPipeline(pipeline, workingDir, episode, baseDir);

    return {
      success: true,
      manifest
    };
  }

  async rescanAndExtractSources({ episode, targetDir, baseDir }) {
    if (!episode) throw new Error('Episode parameter is required');
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);
    const rawDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(rawDir);

    const statusData = await this.getStatus({ episode, targetDir: workingDir, baseDir });
    const manifest = statusData.manifest;

    // Force extraction if audio was not yet ready
    const epDir = this.getEpisodeDir(episode);
    const parentDir = path.dirname(workingDir);
    let vPath = manifest.sourceFiles?.video?.path || episode?.rawPath;
    if (!vPath || !fsSync.existsSync(vPath)) {
      const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;
      const searchDirs = [workingDir, rawDir, parentDir, epDir].filter(d => d && fsSync.existsSync(d));
      for (const dir of searchDirs) {
        try {
          const files = fsSync.readdirSync(dir);
          const vid = files.find(f => videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
          if (vid) {
            vPath = path.join(dir, vid);
            break;
          }
        } catch (e) {}
      }
    }

    if (vPath && fsSync.existsSync(vPath)) {
      const origAudioOut = path.join(rawDir, '00_original_audio.wav');
      if (!fsSync.existsSync(origAudioOut) || fsSync.statSync(origAudioOut).size < 1000) {
        await this._extractAudioFromVideo(vPath, origAudioOut);
      }
      if (fsSync.existsSync(origAudioOut)) {
        manifest.sourceFiles.originalAudio = {
          name: '00_original_audio.wav',
          path: origAudioOut,
          size: fsSync.statSync(origAudioOut).size,
          exists: true
        };
        // Also copy to root of workingDir
        try {
          const rootTarget = path.join(workingDir, '00_original_audio.wav');
          if (path.resolve(rootTarget) !== path.resolve(origAudioOut)) {
            await fs.copyFile(origAudioOut, rootTarget);
          }
        } catch (e) {}
      }
      manifest.sourceFiles.video = {
        name: path.basename(vPath),
        path: vPath,
        size: fsSync.statSync(vPath).size,
        exists: true
      };
    }

    await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    const timingMeta = await this.getTimingMetadata(workingDir);
    return {
      success: true,
      workingDir,
      manifest,
      timingMeta,
      rolesVolumeMap: timingMeta?.rolesVolumeMap || {}
    };
  }

  async _refreshManifestFiles(manifest, workingDir, episode) {
    if (!fsSync.existsSync(workingDir)) return;

    const isTempOrHiddenFile = (filename) => {
      if (!filename) return true;
      const base = path.basename(filename);
      const lower = base.toLowerCase();
      return (
        base.startsWith('.tmp_') ||
        base.startsWith('.trash_') ||
        base.startsWith('.') ||
        lower.startsWith('temp_') ||
        lower.endsWith('.tmp') ||
        lower.endsWith('.part') ||
        lower.includes('.preview_proxy.')
      );
    };

    const entries = await fs.readdir(workingDir, { withFileTypes: true }).catch(() => []);
    const fileNames = entries.filter(e => e.isFile() && !isTempOrHiddenFile(e.name)).map(e => e.name);

    const rawDir = path.join(workingDir, '00_исходные');
    const parentDir = path.dirname(workingDir);

    // 1. Поиск видеофайла (в workingDir, 00_исходные, parentDir, epDir, episode.rawPath, episode.folderPath)
    const epDir = this.getEpisodeDir(episode);
    const searchVideoDirs = [workingDir, rawDir, parentDir, epDir, episode?.folderPath].filter(d => d && typeof d === 'string' && fsSync.existsSync(d));
    const videoExtRegex = /\.(mp4|mkv|mov|avi|webm)$/i;

    let videoFile = null;
    let videoPath = null;

    // Check direct candidate: episode.rawPath (absolute or relative)
    if (episode?.rawPath) {
      const candidates = [
        episode.rawPath,
        path.resolve(workingDir, episode.rawPath),
        path.resolve(parentDir, episode.rawPath),
        path.resolve(epDir, episode.rawPath),
        path.resolve(process.cwd(), episode.rawPath)
      ];
      for (const cand of candidates) {
        if (cand && fsSync.existsSync(cand) && !isTempOrHiddenFile(cand) && videoExtRegex.test(cand) && !cand.includes('[СВЕДЕНО]') && !cand.includes('video_mux')) {
          videoPath = cand;
          videoFile = path.basename(cand);
          break;
        }
      }
    }

    // If not found yet, scan directories
    if (!videoPath) {
      for (const dir of searchVideoDirs) {
        try {
          const dirFiles = fsSync.readdirSync(dir);
          const found = dirFiles.find(f => !isTempOrHiddenFile(f) && videoExtRegex.test(f) && !f.includes('[СВЕДЕНО]') && !f.includes('video_mux'));
          if (found) {
            videoPath = path.join(dir, found);
            videoFile = found;
            break;
          }
        } catch (e) {}
      }
    }

    if (videoPath && fsSync.existsSync(videoPath)) {
      const st = fsSync.statSync(videoPath);
      manifest.sourceFiles.video = { name: videoFile || path.basename(videoPath), path: videoPath, size: st.size, exists: true };
    }

    // 2. Поиск оригинального аудио
    const origAudioCandidates = [
      path.join(rawDir, '00_original_audio.wav'),
      path.join(workingDir, '00_original_audio.wav'),
      path.join(workingDir, 'original_audio.wav'),
      path.join(parentDir, '00_original_audio.wav'),
      path.join(parentDir, 'original_audio.wav'),
      path.join(rawDir, 'original_audio.wav'),
      path.join(epDir, '00_original_audio.wav'),
      path.join(epDir, 'original_audio.wav')
    ];
    let foundOrigAudio = origAudioCandidates.find(p => p && fsSync.existsSync(p));

    // Если аудио нет, но есть видео — извлекаем автоматически в 00_исходные и workingDir!
    if (!foundOrigAudio && videoPath && fsSync.existsSync(videoPath)) {
      const targetAudio = path.join(rawDir, '00_original_audio.wav');
      try {
        if (!fsSync.existsSync(rawDir)) fsSync.mkdirSync(rawDir, { recursive: true });
        await this._extractAudioFromVideo(videoPath, targetAudio);
        if (fsSync.existsSync(targetAudio)) {
          foundOrigAudio = targetAudio;
          // Также дублируем в корень workingDir для мгновенной доступности
          try {
            const copyTarget = path.join(workingDir, '00_original_audio.wav');
            if (path.resolve(copyTarget) !== path.resolve(targetAudio)) {
              await fs.copyFile(targetAudio, copyTarget);
            }
          } catch (e) {}
          log.info(`[Mixing] Автоматически извлечена оригинальная аудиодорожка: ${targetAudio}`);
        }
      } catch (extractErr) {
        log.warn(`[Mixing] Ошибка автоматического извлечения звука из ${videoPath}:`, extractErr.message);
      }
    }

    if (foundOrigAudio && fsSync.existsSync(foundOrigAudio)) {
      const st = fsSync.statSync(foundOrigAudio);
      manifest.sourceFiles.originalAudio = { name: path.basename(foundOrigAudio), path: foundOrigAudio, size: st.size, exists: true };
    }

    const subFile = fileNames.find(f => /\.(ass|srt|vtt)$/i.test(f));
    if (subFile) {
      const sPath = path.join(workingDir, subFile);
      const st = fsSync.statSync(sPath);
      manifest.sourceFiles.subtitles = { name: subFile, path: sPath, size: st.size, exists: true };
    } else if (episode?.subPath && fsSync.existsSync(episode.subPath)) {
      const st = fsSync.statSync(episode.subPath);
      manifest.sourceFiles.subtitles = { name: path.basename(episode.subPath), path: episode.subPath, size: st.size, exists: true };
    }

    const audioExts = /\.(wav|mp3|flac|ogg|m4a|aac)$/i;
    const backupDir = path.join(workingDir, 'бэкап', 'исходные_дорожки_до_автотайминга');
    const backupRoot = path.join(workingDir, 'бэкап');

    const primaryDirs = [rawDir, workingDir].filter(d => fsSync.existsSync(d));
    let hasPrimaryFiles = false;
    for (const pDir of primaryDirs) {
      try {
        if (fsSync.readdirSync(pDir).some(f => audioExts.test(f))) {
          hasPrimaryFiles = true;
          break;
        }
      } catch (e) {}
    }

    const searchDirs = hasPrimaryFiles ? primaryDirs : [rawDir, workingDir, backupDir, backupRoot].filter(d => fsSync.existsSync(d));

    // Pipeline step output prefixes that should not be considered original dubber source files
    const pipelinePrefixes = (manifest.pipeline || []).map((s, idx) => {
      const numPrefix = `${String(idx + 1).padStart(2, '0')}_${s.moduleId}`;
      return [s.prefix, numPrefix, `${s.moduleId}_`];
    }).flat().filter(Boolean);

    const isStepOutputFile = (filename) => {
      const lower = filename.toLowerCase();
      if (lower.includes('00_original_audio') || lower.includes('[сведено]') || lower.includes('video_mux')) return true;
      if (/^(0[1-9]|1[0-9])_(denoise|deepfilter|glue|compress|master|video_mux|eq|limiter|reverb|delay|mix)/i.test(filename)) return true;
      return pipelinePrefixes.some(pfx => pfx && filename.startsWith(pfx));
    };

    const foundDubberTracks = [];
    for (const sDir of searchDirs) {
      const dirFiles = fsSync.readdirSync(sDir).filter(f => !isTempOrHiddenFile(f) && audioExts.test(f));
      for (const f of dirFiles) {
        if (isStepOutputFile(f)) {
          continue;
        }

        const lowerF = f.toLowerCase();
        // STRICT: Never include phrase slice micro-files or temporary files in mixing manifest
        if (lowerF.includes('slice') || lowerF.includes('whisper_slice') || lowerF.startsWith('temp_') || lowerF.startsWith('snippet_')) {
          continue;
        }

        const baseNoExt = f.replace(audioExts, '');

        const fullP = path.join(sDir, f);
        const st = fsSync.statSync(fullP);
        
        let dubberNick = f;
        const bracketMatch = f.match(/\[(.*?)\]/);
        const trackMatch = f.match(/_дорожка(\d+)/i) || f.match(/_layer(\d+)/i) || f.match(/_take(\d+)/i);
        const trackNum = trackMatch ? trackMatch[1] : null;

        if (f.startsWith('00_timed_')) {
          dubberNick = f.replace(/^00_timed_/, '').replace(audioExts, '');
        } else if (bracketMatch && bracketMatch[1]) {
          dubberNick = bracketMatch[1];
        } else {
          dubberNick = baseNoExt.replace(/^dub_/i, '').replace(/^.*?_/, '');
        }

        // Clean out track/layer/fix suffixes from base nickname
        dubberNick = dubberNick
          .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
          .replace(/_дорожка\d+/gi, '')
          .replace(/[_\s-]+$/, '')
          .trim();

        // Check if dubberNick is a numeric participant ID or upload ID and resolve real nickname
        if (Array.isArray(episode?.uploads)) {
          const matchingUpload = episode.uploads.find(u => 
            (u.path && path.basename(u.path) === f) || 
            (u.uploadedById && (u.uploadedById === dubberNick || String(u.uploadedById) === String(dubberNick)))
          );
          if (matchingUpload) {
            const nick = matchingUpload.dubberNick || matchingUpload.dubberName;
            if (nick && /[a-zA-Zа-яА-ЯёЁ]/.test(nick)) {
              dubberNick = nick;
            }
          }
        }

        // Check against global participants if still numeric or not resolved
        if ((!dubberNick || /^\d+$/.test(dubberNick) || dubberNick.startsWith('0.')) && Array.isArray(episode?.assignments)) {
          const matchingAssignment = episode.assignments.find(a => 
            a.dubberId === dubberNick || String(a.dubberId) === String(dubberNick) ||
            a.substituteId === dubberNick || String(a.substituteId) === String(dubberNick)
          );
          if (matchingAssignment) {
            const pId = matchingAssignment.dubberId || matchingAssignment.substituteId;
            const p = (Array.isArray(episode?.project?.assignedDubbers) ? episode.project.assignedDubbers : []).find(part => String(part.id) === String(pId));
            if (p && p.nickname) {
              dubberNick = p.nickname;
            }
          }
        }

        if (!dubberNick || dubberNick.trim().length === 0) {
          dubberNick = baseNoExt || 'Даббер';
        }

        let displayNick = dubberNick;
        const fixMatch = f.match(/(?:^|[_[\s-])(?:fix|фикс)\s*(\d*)(?:[_\]\s.-]|$)/i);
        const isFixTrack = Boolean(fixMatch);
        const fixNum = fixMatch && fixMatch[1] ? fixMatch[1] : '';
        if (isFixTrack) {
          displayNick = `${dubberNick} (Фикс${fixNum ? ' ' + fixNum : ''})`;
        } else if (trackNum) {
          displayNick = `${dubberNick} (Дорожка ${trackNum})`;
        }

        if (foundDubberTracks.some(t => t.path === fullP || (t.name === f && t.size === st.size))) {
          continue;
        }

        foundDubberTracks.push({
          id: f,
          name: f,
          dubberNick: displayNick.trim(),
          baseDubberNick: dubberNick.trim(),
          trackNumber: trackNum ? parseInt(trackNum, 10) : 1,
          isFix: isFixTrack,
          path: fullP,
          size: st.size,
          exists: true,
          isTimedMaster: f.startsWith('00_timed_')
        });
      }
    }

    // Fallback: If no files found on disk yet, but episode has QA uploads, use episode uploads (excluding slice files)
    const episodeUploads = (episode?.uploads && episode.uploads.length > 0) ? episode.uploads : [];
    if (foundDubberTracks.length === 0 && Array.isArray(episodeUploads) && episodeUploads.length > 0) {
      const qaUploads = episodeUploads.filter(u => 
        (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
        u.path && 
        fsSync.existsSync(u.path) &&
        !u.path.toLowerCase().includes('slice') &&
        !(u.fileName || '').toLowerCase().includes('slice')
      );
      const dubberTrackCounts = new Map();
      const dubberFixCounts = new Map();
      for (const u of qaUploads) {
        const f = path.basename(u.path);
        const baseNick = (u.dubberNick || u.dubberName || u.name || f)
          .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
          .replace(/^00_timed_/i, '')
          .replace(/\.wav$/i, '')
          .trim() || 'Даббер';
        const key = String(u.uploadedById || baseNick).toLowerCase();
        const isFix = u.type === 'FIXES' || /(?:^|[_[\s-])(?:fix|фикс)\d*(?:[_\]\s.-]|$)/i.test(f);
        if (isFix) dubberFixCounts.set(key, (dubberFixCounts.get(key) || 0) + 1);
        else dubberTrackCounts.set(key, (dubberTrackCounts.get(key) || 0) + 1);
      }
      const dubberTrackIdx = new Map();
      const dubberFixIdx = new Map();
      for (const u of qaUploads) {
        const f = path.basename(u.path);
        const st = fsSync.statSync(u.path);
        const trackMatch = f.match(/_(дорожка\d+|track\d+|layer\d+|take\d+)/i);
        const baseNick = (u.dubberNick || u.dubberName || u.name || f)
          .replace(/\[?(дорожка|слой|take|layer|фикс|fix)\s*\d*\]?/gi, '')
          .replace(/^00_timed_/i, '')
          .replace(/\.wav$/i, '')
          .trim() || 'Даббер';
        const key = String(u.uploadedById || baseNick).toLowerCase();
        const isFix = u.type === 'FIXES' || /(?:^|[_[\s-])(?:fix|фикс)\d*(?:[_\]\s.-]|$)/i.test(f);
        let dubberNick = baseNick;
        if (isFix) {
          const curFixIdx = (dubberFixIdx.get(key) || 0) + 1;
          dubberFixIdx.set(key, curFixIdx);
          const totalFixes = dubberFixCounts.get(key) || 1;
          dubberNick = totalFixes > 1 ? `${baseNick} (Фикс ${curFixIdx})` : `${baseNick} (Фикс)`;
        } else if (trackMatch) {
          const tn = parseInt(trackMatch[1].replace(/\D+/g, ''), 10) || 1;
          dubberNick = `${baseNick} (Дорожка ${tn})`;
        } else {
          const curTrkIdx = (dubberTrackIdx.get(key) || 0) + 1;
          dubberTrackIdx.set(key, curTrkIdx);
          if ((dubberTrackCounts.get(key) || 1) > 1) {
            dubberNick = `${baseNick} (Дорожка ${curTrkIdx})`;
          }
        }
        foundDubberTracks.push({
          id: u.id || f,
          name: f,
          dubberNick: dubberNick || 'Даббер',
          path: u.path,
          size: st.size,
          exists: true,
          isTimedMaster: f.startsWith('00_timed_')
        });
      }
    }

    // If 00_timed_ master tracks are present, strictly prefer ONLY 00_timed_ master tracks!
    let filteredDubberTracks = foundDubberTracks;
    const timedMasters = foundDubberTracks.filter(t => t.isTimedMaster);
    if (timedMasters.length > 0) {
      filteredDubberTracks = timedMasters;
    }

    // Deduplicate only by exact path so all distinct dubber tracks (Track 1, Track 2, Fix) are preserved
    const deduplicatedTracks = [];
    const seenPaths = new Set();
    for (const tr of filteredDubberTracks) {
      const key = tr.path || tr.name;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        deduplicatedTracks.push(tr);
      }
    }

    const finalDubberTracks = deduplicatedTracks.map(tr => ({
      id: tr.id,
      name: tr.name,
      dubberNick: tr.dubberNick,
      path: tr.path,
      size: tr.size,
      exists: true
    }));

    if (finalDubberTracks.length > 0) {
      manifest.sourceFiles.dubberTracks = finalDubberTracks;
      manifest.isImported = true;
    }

    // Reset finalVideo if it currently points to a missing or temporary .tmp_ file
    if (manifest.finalVideo && (!manifest.finalVideo.path || isTempOrHiddenFile(manifest.finalVideo.path) || !fsSync.existsSync(manifest.finalVideo.path))) {
      manifest.finalVideo = null;
    }

    const hasActiveFfmpeg = Boolean(this._activeFfmpegCommands && this._activeFfmpegCommands.size > 0);

    const glueStepIdx = (manifest.pipeline || []).findIndex(s => s && s.enabled && s.moduleId === 'glue_compress');

    // Refresh outputs for each step (preserving dubberNick and type metadata)
    for (let sIdx = 0; sIdx < manifest.pipeline.length; sIdx++) {
      const step = manifest.pipeline[sIdx];
      step.excludedTrackKeys = Array.isArray(step.excludedTrackKeys) ? step.excludedTrackKeys : [];
      step.customInputTracks = Array.isArray(step.customInputTracks) ? step.customInputTracks : [];
      const prevOutMap = new Map((step.outputFiles || []).map(of => [of.name || path.basename(of.path || ''), of]));

      const stepDir = path.join(workingDir, `${String(sIdx + 1).padStart(2, '0')}_${step.moduleId}`);
      let stepFiles = [];
      const isPostGlueVoiceStep = glueStepIdx !== -1 && sIdx >= glueStepIdx && this._isVoiceChainStep(step);

      const buildStepFileObj = (fName, fPath, sizeBytes, mtimeMs = 0) => {
        const prevMeta = prevOutMap.get(fName);
        const derivedNick = isPostGlueVoiceStep
          ? 'Склеенная шина голосов'
          : (prevMeta?.dubberNick || this._deriveDubberNickFromFilename(fName, step.prefix));
        return {
          name: fName,
          path: fPath,
          size: sizeBytes,
          exists: true,
          dubberNick: derivedNick,
          ...(isPostGlueVoiceStep ? { trackKey: 'voices_master' } : (prevMeta?.trackKey ? { trackKey: prevMeta.trackKey } : {})),
          ...(prevMeta?.type ? { type: prevMeta.type } : {}),
          _mtimeMs: mtimeMs
        };
      };

      if (fsSync.existsSync(stepDir)) {
        // First pass: if no FFmpeg is currently running, heal any orphaned .tmp_ files or clean up .trash_ files
        if (!hasActiveFfmpeg) {
          try {
            const rawEntries = fsSync.readdirSync(stepDir);
            for (const rf of rawEntries) {
              if (rf.startsWith('.trash_')) {
                try { fsSync.unlinkSync(path.join(stepDir, rf)); } catch (_) {}
              } else if (rf.startsWith('.tmp_')) {
                const cleanedName = rf.replace(/^\.tmp_[0-9]+_[a-z0-9]+_/i, '');
                const tmpFullPath = path.join(stepDir, rf);
                const cleanFullPath = path.join(stepDir, cleanedName);
                try {
                  if (fsSync.existsSync(cleanFullPath)) {
                    fsSync.unlinkSync(tmpFullPath);
                  } else {
                    const tmpSt = fsSync.statSync(tmpFullPath);
                    if (tmpSt.size > 1024) {
                      fsSync.renameSync(tmpFullPath, cleanFullPath);
                    }
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }

        const dirEntries = fsSync.readdirSync(stepDir);
        for (const f of dirEntries) {
          if (isTempOrHiddenFile(f)) continue;
          if (audioExts.test(f) || /\.(mp4|mkv)$/i.test(f)) {
            const fPath = path.join(stepDir, f);
            try {
              const st = fsSync.statSync(fPath);
              if (st.size > 0) {
                stepFiles.push(buildStepFileObj(f, fPath, st.size, st.mtimeMs || 0));
              }
            } catch (_) {}
          }
        }
      }

      const rootMatches = fileNames.filter(f => !isTempOrHiddenFile(f) && f.startsWith(step.prefix) && (audioExts.test(f) || /\.(mp4|mkv)$/i.test(f)));
      for (const rmf of rootMatches) {
        const fullP = path.join(workingDir, rmf);
        try {
          const st = fsSync.statSync(fullP);
          if (st.size > 0 && !stepFiles.some(sf => sf.name === rmf)) {
            stepFiles.push(buildStepFileObj(rmf, fullP, st.size, st.mtimeMs || 0));
          }
        } catch (_) {}
      }

      // If this is a post-glue voice processing step (without custom tracks) and has duplicate files on disk from older runs,
      // strictly keep only the single newest processed voice bus file so earlier glue_compress duplicates never leak downstream.
      if (isPostGlueVoiceStep && (!step.customInputTracks || step.customInputTracks.length === 0) && stepFiles.length > 1) {
        stepFiles.sort((a, b) => (b._mtimeMs || 0) - (a._mtimeMs || 0));
        stepFiles = [stepFiles[0]];
      }

      stepFiles = stepFiles.map(({ _mtimeMs, ...cleanObj }) => cleanObj);

      step.outputFiles = stepFiles;
      if (stepFiles.length > 0 && step.status === 'idle') {
        step.status = 'completed';
      } else if (stepFiles.length === 0 && step.status === 'completed') {
        step.status = 'idle';
      }

      if (step.moduleId === 'video_mux' && stepFiles.length > 0) {
        const videoOut = stepFiles.find(sf => /\.(mp4|mkv)$/i.test(sf.name)) || stepFiles[0];
        manifest.finalVideo = videoOut;
      }
    }

    // Populate candidateInputs for every step so UI can display and toggle tracks per step
    for (let sIdx = 0; sIdx < manifest.pipeline.length; sIdx++) {
      manifest.pipeline[sIdx].candidateInputs = this._resolveCandidateInputsForStep(manifest, sIdx);
    }

    if (!manifest.finalVideo) {
      const rootMixedVideo = fileNames.find(f => !isTempOrHiddenFile(f) && (f.includes('[СВЕДЕНО]') || f.includes('video_mux')) && /\.(mp4|mkv)$/i.test(f));
      if (rootMixedVideo) {
        const fullP = path.join(workingDir, rootMixedVideo);
        try {
          const st = fsSync.statSync(fullP);
          manifest.finalVideo = { name: rootMixedVideo, path: fullP, size: st.size, exists: true };
        } catch (_) {}
      }
    }

    try {
      await fs.writeFile(path.join(workingDir, 'mixing_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    } catch (e) {}
  }

  async importSoundEngineerFiles({
    episode,
    targetDir,
    baseDir,
    config,
    projectsData,
    participantsData,
    skipConversion = false,
    smartExport = true,
    additionalProcessing = false,
    autoApplyFixes = true,
    includeSubtitles = true,
    autoTiming = true,
    onProgress,
    onLog
  }) {
    const workingDir = this.resolveWorkingDir(targetDir, episode, baseDir);
    await this.ensureDirectory(workingDir);

    const rawDir = path.join(workingDir, '00_исходные');
    await this.ensureDirectory(rawDir);

    const logFn = (msg, level = 'info') => {
      log.info(`[Mixing Import] ${msg}`);
      if (onLog) onLog(msg, level);
      if (onProgress) onProgress({ message: msg, percent: undefined });
    };

    logFn(`Запуск экспорта звукорежиссеру в папку сведения: ${workingDir}`);

    await ExportService.exportSoundEngineerFiles(
      episode,
      workingDir,
      skipConversion,
      smartExport,
      additionalProcessing,
      autoApplyFixes,
      config,
      projectsData,
      participantsData,
      (p) => {
        if (onProgress && p && typeof p.percent === 'number') {
          onProgress({ percent: Math.round(p.percent * 0.85), message: p.message || 'Экспорт дорожек...' });
        }
      },
      undefined,
      includeSubtitles,
      autoTiming
    );

    logFn('Экспорт завершен. Анализ полученных дорожек...');

    // If autoTiming is disabled (direct QA import), clear any stale 00_timed_ master tracks from prior timing runs
    if (!autoTiming && fsSync.existsSync(workingDir)) {
      try {
        const existingFiles = fsSync.readdirSync(workingDir);
        for (const f of existingFiles) {
          if (f.startsWith('00_timed_') && /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f)) {
            try { fsSync.unlinkSync(path.join(workingDir, f)); } catch (e) {}
          }
        }
      } catch (e) {}
    }

    const videoSource = episode?.rawPath;
    const origAudioOut = path.join(rawDir, '00_original_audio.wav');

    if (videoSource && fsSync.existsSync(videoSource) && !fsSync.existsSync(origAudioOut)) {
      logFn('Извлечение оригинальной аудиодорожки из видеоряда серии...');
      try {
        await this._extractAudioFromVideo(videoSource, origAudioOut);
        logFn('Оригинальная аудиодорожка успешно извлечена');
      } catch (err) {
        log.warn('[Mixing] Could not extract original audio track:', err.message);
        logFn(`Внимание: не удалось извлечь аудиодорожку оригинала: ${err.message}`, 'warn');
      }
    }

    if (onProgress) onProgress({ percent: 100, message: 'Импорт дорожек звукорежиссера завершен!' });

    return await this.getStatus({ episode, targetDir: workingDir, baseDir });
  }
}

module.exports = MixingManifestRouter;
