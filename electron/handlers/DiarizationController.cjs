const { ipcMain, app } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const WhisperXDiarizationService = require('../services/WhisperXDiarizationService.cjs');
const WhisperLiveKitDiarizationService = require('../services/WhisperLiveKitDiarizationService.cjs');
const WhisperLiveKitService = require('../services/WhisperLiveKitService.cjs');
const DiarizationService = require('../services/DiarizationService.cjs');
const OllamaService = require('../services/OllamaService.cjs');
const VoiceSignatureService = require('../services/VoiceSignatureService.cjs');
const log = require('electron-log');

function registerDiarizationHandlers(getData) {
  // Standard WhisperX Diarization Handler
  ipcMain.handle('run-diarization', wrapIpcHandler(async (event, { videoPath, subtitleLines, expectedSpeakersCount, diarizationMethod }) => {
    log.info(`IPC: starting diarization for track: ${videoPath}, lines: ${subtitleLines?.length || 0}, method: ${diarizationMethod}`);
    
    const config = getData ? (await getData('config.json')) || {} : {};
    const language = 'auto';
    const model = 'base';
    let hfToken = config.hfToken || process.env.HF_TOKEN || '';

    if (diarizationMethod === 'onnx_transformers') {
      const diarService = DiarizationService.getInstance(app.getPath('userData'));
      return await diarService.diarize(videoPath, subtitleLines, expectedSpeakersCount, (prog) => {
        try {
          event.sender.send('diarization-step', prog);
        } catch (e) {}
      });
    }

    if (diarizationMethod === 'wlk_sortformer' || diarizationMethod === 'wlk_diart') {
      const backend = diarizationMethod === 'wlk_diart' ? 'diart' : 'sortformer';
      return await WhisperLiveKitDiarizationService.diarize(videoPath, subtitleLines, hfToken, backend, (prog) => {
        try {
          event.sender.send('diarization-step', prog);
        } catch (e) {}
      });
    }

    return await WhisperXDiarizationService.diarize(videoPath, subtitleLines, language, model, expectedSpeakersCount, hfToken, (progress) => {
      try {
        event.sender.send('diarization-step', progress);
      } catch (err) {
        log.warn('Could not emit diarization-step progress:', err.message);
      }
    });
  }));

  // Full Video Transcription + Diarization from Scratch
  ipcMain.handle('transcribe-and-diarize', wrapIpcHandler(async (event, { videoPath, language = 'auto', model = 'base', hfToken: customHfToken }) => {
    log.info(`IPC: starting transcribe-and-diarize for: ${videoPath}`);
    const config = getData ? (await getData('config.json')) || {} : {};
    const hfToken = customHfToken || config.hfToken || process.env.HF_TOKEN || '';
    return await WhisperXDiarizationService.transcribeAndDiarize(videoPath, language, model, (percent) => {
      try {
        event.sender.send('transcribe-diarize-progress', percent);
      } catch (e) {}
    }, hfToken);
  }));

  // Check Ollama daemon status and auto-start if down
  ipcMain.handle('check-ollama-status', wrapIpcHandler(async () => {
    try {
      const running = await OllamaService.ensureOllamaRunning();
      return { success: true, running };
    } catch (err) {
      log.error('IPC: check-ollama-status error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  // Fetch all installed Ollama models
  ipcMain.handle('get-ollama-models', wrapIpcHandler(async () => {
    try {
      const models = await OllamaService.getInstalledModels();
      return { success: true, models };
    } catch (err) {
      log.error('IPC: get-ollama-models error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  // Translate subtitle batch using Ollama
  ipcMain.handle('translate-ollama-batch', wrapIpcHandler(async (event, { modelName, linesBatch, sourceLang, destLang }) => {
    try {
      const translatedBatch = await OllamaService.translateBatch(modelName, linesBatch, sourceLang, destLang);
      return { success: true, batch: translatedBatch };
    } catch (err) {
      log.error('IPC: translate-ollama-batch error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  // Context Analysis using Ollama for Character Mapping
  ipcMain.handle('analyze-dialogue-context', wrapIpcHandler(async (event, { projectDetails, episodeDetails, subtitleLines, modelName }) => {
    try {
      log.info(`IPC: analyze-dialogue-context starting with model ${modelName}`);
      const mapping = await OllamaService.analyzeDialogueContext(
        projectDetails, 
        episodeDetails, 
        subtitleLines, 
        modelName,
        (progress) => {
          try {
            event.sender.send('ollama-analysis-progress', progress);
          } catch (e) {}
        }
      );
      return { success: true, mapping };
    } catch (err) {
      log.error('IPC: analyze-dialogue-context error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  // Voice Base Handlers
  ipcMain.handle('get-voice-base-characters', wrapIpcHandler(async (event, { projectName }) => {
    try {
      const characters = await VoiceSignatureService.getSavedCharacters(projectName);
      return { success: true, characters };
    } catch (err) {
      log.error('IPC: get-voice-base-characters error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  ipcMain.handle('delete-voice-profile', wrapIpcHandler(async (event, { projectName, characterName }) => {
    try {
      return await VoiceSignatureService.deleteCharacterProfile(projectName, characterName);
    } catch (err) {
      log.error('IPC: delete-voice-profile error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  ipcMain.handle('learn-voice-from-interval', wrapIpcHandler(async (event, { projectName, characterName, videoPath, startSec, endSec }) => {
    try {
      return await VoiceSignatureService.addVoicePrintFromInterval(projectName, characterName, videoPath, startSec, endSec);
    } catch (err) {
      log.error('IPC: learn-voice-from-interval error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  ipcMain.handle('auto-train-voice-base', wrapIpcHandler(async (event, { projectName, videoPath, subtitleLines }) => {
    try {
      return await VoiceSignatureService.autoTrainFromEpisode(projectName, videoPath, subtitleLines, (prog) => {
        try {
          event.sender.send('voice-base-training-progress', prog);
        } catch (e) {}
      });
    } catch (err) {
      log.error('IPC: auto-train-voice-base error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  // Advanced Multi-Step Diarization Pipeline Handler
  ipcMain.handle('run-advanced-diarization-pipeline', wrapIpcHandler(async (event, {
    projectName,
    videoPath,
    projectDetails,
    episodeDetails,
    subtitleLines,
    expectedSpeakersCount,
    ollamaModel, 
    useVoiceBase,
    correctionMode,
    diarizationMethod
  }) => {
    log.info(`IPC: starting advanced diarization pipeline for project: ${projectName}, video: ${videoPath}, method: ${diarizationMethod}`);
    
    const sendProgress = (step, totalSteps, message, current = 0, total = 100) => {
      try {
        event.sender.send('advanced-diarization-progress', { step, totalSteps, message, current, total });
      } catch (e) {
        log.warn('Could not send advanced-diarization-progress:', e.message);
      }
    };

    try {
      const totalSteps = 1 + (ollamaModel ? 1 : 0) + (useVoiceBase ? 1 : 0);
      let currentStep = 1;

      // 1. STEP 1: Running Diarization to cluster speakers
      const config = getData ? (await getData('config.json')) || {} : {};
      const language = 'auto';
      const model = 'base';
      let hfToken = config.hfToken || process.env.HF_TOKEN || '';

      let diarResult;
      const isWLK = diarizationMethod === 'wlk_sortformer' || diarizationMethod === 'wlk_diart';

      if (diarizationMethod === 'onnx_transformers') {
        sendProgress(currentStep, totalSteps, 'Запуск встроенной ONNX модели для сегментации спикеров...', 0, 100);
        const diarService = DiarizationService.getInstance(app.getPath('userData'));
        diarResult = await diarService.diarize(videoPath, subtitleLines, expectedSpeakersCount, (prog) => {
          sendProgress(currentStep, totalSteps, prog.message || 'Анализ аудио...', prog.step || 0, prog.totalSteps || 4);
        });
      } else if (isWLK) {
        const backend = diarizationMethod === 'wlk_diart' ? 'diart' : 'sortformer';
        sendProgress(currentStep, totalSteps, `Запуск WhisperLiveKit (${backend}) для сегментации спикеров...`, 0, 100);
        diarResult = await WhisperLiveKitDiarizationService.diarize(videoPath, subtitleLines, hfToken, backend, (prog) => {
          sendProgress(currentStep, totalSteps, prog.message || 'Анализ аудио...', prog.current || 0, prog.total || 100);
        });
      } else {
        sendProgress(currentStep, totalSteps, 'Запуск WhisperX для сегментации и кластеризации спикеров...', 0, 100);
        try {
          diarResult = await WhisperXDiarizationService.diarize(videoPath, subtitleLines, language, model, expectedSpeakersCount, hfToken, (prog) => {
            sendProgress(currentStep, totalSteps, prog.message || 'Анализ аудио...', prog.current || 0, prog.total || 100);
          });
        } catch (wxErr) {
          log.warn('[AdvancedPipeline] WhisperX failed, attempting ONNX fallback:', wxErr.message);
          sendProgress(currentStep, totalSteps, 'WhisperX недоступен. Переключение на встроенный ONNX движок...', 50, 100);
          const diarService = DiarizationService.getInstance(app.getPath('userData'));
          diarResult = await diarService.diarize(videoPath, subtitleLines, expectedSpeakersCount, (prog) => {
            sendProgress(currentStep, totalSteps, prog.message || 'Анализ аудио...', prog.step || 0, prog.totalSteps || 4);
          });
        }
      }

      const rawSpeakerMapping = diarResult.speakerMapping; // lineId -> "Speaker X"
      log.info(`[AdvancedPipeline] Diarization (${diarizationMethod || 'whisperx'}) finished. Unique speakers found:`, diarResult.detectedSpeakersCount);

      // Construct working line state mapping
      const mappedLinesForLlm = subtitleLines.map(line => ({
        ...line,
        name: rawSpeakerMapping[line.id] || 'Speaker 1'
      }));

      let finalAssignments = {}; // Speaker Name -> Character Name
      
      // Initialize mappings
      for (let i = 1; i <= diarResult.detectedSpeakersCount; i++) {
        finalAssignments[`Speaker ${i}`] = '';
      }

      // 2. STEP 2: Ollama Context Analysis
      if (ollamaModel) {
        currentStep++;
        sendProgress(currentStep, totalSteps, 'Подключение к Ollama и анализ контекста реплик...', 0, 100);
        
        try {
          const llmMappings = await OllamaService.analyzeDialogueContext(
            projectDetails, 
            episodeDetails, 
            mappedLinesForLlm, 
            ollamaModel,
            (prog) => {
              sendProgress(currentStep, totalSteps, prog.message, prog.current, prog.total);
            }
          );
          
          for (const [speaker, char] of Object.entries(llmMappings)) {
            if (char && char.trim()) {
              finalAssignments[speaker] = char.trim();
            }
          }
        } catch (llmErr) {
          log.error('[AdvancedPipeline] Ollama analysis failed:', llmErr.message);
        }
      }

      // 3. STEP 3: Voice Base Verification
      if (useVoiceBase) {
        currentStep++;
        sendProgress(currentStep, totalSteps, 'Проверка голосов по базе голосовых отпечатков проекта...', 0, 100);

        try {
          const uniqueSpeakers = Object.keys(finalAssignments);
          for (let sIdx = 0; sIdx < uniqueSpeakers.length; sIdx++) {
            const speakerName = uniqueSpeakers[sIdx];
            
            const speakerLines = subtitleLines.filter(line => rawSpeakerMapping[line.id] === speakerName);
            
            sendProgress(
              currentStep, 
              totalSteps, 
              `Сравнение голоса ${speakerName} (${sIdx + 1} из ${uniqueSpeakers.length})...`, 
              sIdx + 1, 
              uniqueSpeakers.length
            );

            const voiceMatch = await VoiceSignatureService.matchSpeakerAgainstVoiceBase(
              projectName, 
              videoPath, 
              speakerLines
            );

            if (voiceMatch) {
              log.info(`[AdvancedPipeline] Speaker ${speakerName} matched via Voice Base with high confidence to: ${voiceMatch.character} (${voiceMatch.similarity})`);
              finalAssignments[speakerName] = voiceMatch.character;
            }
          }
        } catch (voiceErr) {
          log.error('[AdvancedPipeline] Voice Base verification failed:', voiceErr.message);
        }
      }

      sendProgress(totalSteps, totalSteps, 'Готово!', 100, 100);
      
      return {
        success: true,
        speakerMapping: rawSpeakerMapping,
        characterAssignments: finalAssignments,
        detectedSpeakersCount: diarResult.detectedSpeakersCount
      };

    } catch (err) {
      log.error('[AdvancedPipeline] Pipeline crashed:', err);
      return { success: false, error: err.message };
    }
  }));

  // WhisperLiveKit sidecar server control handlers
  ipcMain.handle('start-whisper-livekit-server', wrapIpcHandler(async (event, { model, port, backend }) => {
    try {
      log.info(`IPC: starting WhisperLiveKit sidecar server with model ${model} on port ${port}`);
      const res = await WhisperLiveKitService.startServer(model, port);
      return res;
    } catch (err) {
      log.error('IPC: start-whisper-livekit-server error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  ipcMain.handle('stop-whisper-livekit-server', wrapIpcHandler(async () => {
    try {
      log.info('IPC: stopping WhisperLiveKit sidecar server');
      const res = await WhisperLiveKitService.stopServer();
      return res;
    } catch (err) {
      log.error('IPC: stop-whisper-livekit-server error:', err.message);
      return { success: false, error: err.message };
    }
  }));

  ipcMain.handle('get-whisper-livekit-status', wrapIpcHandler(async () => {
    try {
      const running = await WhisperLiveKitService.isServerRunning();
      return { success: true, isRunning: running, port: WhisperLiveKitService.serverPort };
    } catch (err) {
      return { success: false, error: err.message, isRunning: false };
    }
  }));
}

module.exports = { registerDiarizationHandlers };
