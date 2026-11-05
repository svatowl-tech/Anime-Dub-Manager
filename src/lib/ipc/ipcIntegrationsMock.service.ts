import { getLocalData, saveLocalData } from './ipcProjectsAndMediaMock.service';

export function handleIntegrationsIpcMock(channel: string, args: any[]): { handled: boolean; result?: any } {
  // Anime365 Mock fallbacks for web preview
  if (channel === 'anime365-search-series') {
    const _q = (args[0]?.query || '').toLowerCase();
    return {
      handled: true,
      result: [
        {
          id: 4242,
          title: "Sousou no Frieren",
          titles: { ru: "Фрирен, провожающая в последний путь", romaji: "Sousou no Frieren", ja: "葬送のフリーレン", en: "Frieren: Beyond Journey's End" },
          posterUrl: "https://shikimori.io/system/animes/original/52991.jpg",
          numberOfEpisodes: 28,
          year: 2023,
          typeTitle: "TV Сериал",
          isAiring: 0
        },
        {
          id: 8484,
          title: "Chainsaw Man",
          titles: { ru: "Человек-бензопила", romaji: "Chainsaw Man", ja: "チェンソーマン", en: "Chainsaw Man" },
          posterUrl: "https://shikimori.io/system/animes/original/44511.jpg",
          numberOfEpisodes: 12,
          year: 2022,
          typeTitle: "TV Сериал",
          isAiring: 0
        }
      ]
    };
  }

  if (channel === 'anime365-get-series-details') {
    const id = args[0]?.id;
    return {
      handled: true,
      result: {
        id: id || 4242,
        title: "Sousou no Frieren",
        titles: { ru: "Фрирен, провожающая в последний путь", romaji: "Sousou no Frieren", ja: "葬送のフリーレン", en: "Frieren: Beyond Journey's End" },
        posterUrl: "https://shikimori.io/system/animes/original/52991.jpg",
        numberOfEpisodes: 28,
        year: 2023,
        typeTitle: "TV Сериал",
        isAiring: 0,
        descriptions: [{ source: "Anime365", value: "История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов." }],
        episodes: Array.from({ length: 28 }).map((_, idx) => ({
          id: 1000 + idx,
          episodeInt: String(idx + 1),
          episodeFull: `Серия ${idx + 1}`,
          episodeTitle: `Начало пути ${idx + 1}`
        }))
      }
    };
  }

  if (channel === 'anime365-get-episode-translations') {
    return {
      handled: true,
      result: [
        {
          id: 5001,
          title: "Оригинал (RAW)",
          type: "raw",
          typeLang: "jpn",
          qualityType: "1080p",
          url: "https://smotret-anime.ru/translations/raw/5001.mp4",
          embedUrl: "https://smotret-anime.ru/translations/embed/5001",
          authorsSummary: "Original Audio",
          duration: "24:00"
        },
        {
          id: 5002,
          title: "Субтитры (Альянс)",
          type: "subtitles",
          typeLang: "rus",
          qualityType: "ass",
          url: "https://smotret-anime.ru/translations/sub/5002.ass",
          embedUrl: "",
          authorsSummary: "Альянс",
          duration: ""
        },
        {
          id: 5003,
          title: "Японские субтитры",
          type: "subtitles",
          typeLang: "jpn",
          qualityType: "ass",
          url: "https://smotret-anime.ru/translations/sub/5003.ass",
          embedUrl: "",
          authorsSummary: "Kitsunekko / Official Ja",
          duration: ""
        },
        {
          id: 5004,
          title: "Субтитры (Anilibria)",
          type: "subtitles",
          typeLang: "rus",
          qualityType: "srt",
          url: "https://smotret-anime.ru/translations/sub/5004.srt",
          embedUrl: "",
          authorsSummary: "Anilibria Subs Team",
          duration: ""
        }
      ]
    };
  }

  if (channel === 'anime365-update-project-data') {
    const projectId = args[0]?.projectId;
    const projects = getLocalData('projects');
    const project = projects.find((p: any) => p.id === projectId);
    if (project) {
      project.synopsis = "История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов. (Обновлено из Anime365!)";
      project.posterUrl = "https://shikimori.io/system/animes/original/52991.jpg";
      project.totalEpisodes = 28;
      project.isOngoing = true;
      project.anime365Id = 4242;
      project.typeAndSeason = "TV-1";
      saveLocalData('projects', projects);
      return { handled: true, result: project };
    }
    return { handled: true, result: null };
  }

  if (channel === 'anime365-download-subtitle') {
    return { handled: true, result: { success: true, subPath: "/mock/user_data/projects/proj1/subs/episode_1_subs.ass" } };
  }

  if (channel === 'anime365-check-new-episodes') {
    const projects = getLocalData('projects');
    const project = projects.find((p: any) => p.id === args[0]?.projectId);
    if (project) {
      const currentMax = (project.episodes || []).reduce((max: number, ep: any) => Math.max(max, ep.number), 0) || 0;
      return { handled: true, result: { maxEpisode: currentMax + 1, source: 'anime365' } };
    }
    return { handled: true, result: { maxEpisode: null, source: 'none' } };
  }

  // DIARIZATION, OLLAMA, AND VOICE BASE MOCKS FOR WEB COMPATIBILITY
  if (channel === 'get-whisper-system-status') {
    const requestedModel = (args[0] && args[0].model) || 'small';
    return {
      handled: true,
      result: {
        isReady: true,
        canLoadModel: true,
        statusText: `Система Whisper готова к загрузке модели «${requestedModel}»`,
        backendType: 'web',
        availableModels: ['small', 'base', 'tiny'],
        activeModel: requestedModel,
        isModelDownloaded: true,
        details: 'Среда веб-превью: движок Whisper ASR инициализирован и готов к работе.'
      }
    };
  }

  if (channel === 'get-downloaded-whisper-models') {
    return { handled: true, result: ['small', 'base', 'tiny'] };
  }

  if (channel === 'qa-whisper-check-lines') {
    const inputData = args[0] || {};
    const lines = inputData.lines || [];
    const results = lines.map((line: any, idx: number) => {
      let recognizedText = line.text;
      if (idx % 6 === 2 && line.text.length > 20) {
        const words = line.text.split(' ');
        if (words.length > 4) {
          recognizedText = words.slice(0, words.length - 2).join(' ') + ' ладно';
        }
      } else if (idx % 8 === 4 && line.text.length > 15) {
        recognizedText = line.text.split(' ')[0] + '... ' + line.text;
      }
      return {
        lineIndex: line.lineIndex,
        expectedText: line.text,
        recognizedText
      };
    });
    return { handled: true, result: { results } };
  }

  if (channel === 'timing-whisper-transcribe-clips') {
    const inputData = args[0] || {};
    const clips = inputData.clips || [];
    const results = clips.map((c: any) => ({
      id: c.id,
      text: c.hint || ''
    }));
    return { handled: true, result: { results } };
  }

  if (channel === 'check-diarization-status') {
    return { handled: true, result: { isLoaded: true, isLoading: false, downloadProgress: 100, loadingStatus: 'Ready' } };
  }

  if (channel === 'check-ollama-status') {
    return { handled: true, result: { success: true, running: true } };
  }

  if (channel === 'get-ollama-models') {
    return { handled: true, result: { success: true, models: ["qwen2.5:7b", "llama3.1:8b", "gemma2:9b", "mistral:7b"] } };
  }

  if (channel === 'get-voice-base-characters') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    let saved = getLocalData(key);
    if (!saved || saved.length === 0) {
      saved = ["Танджиро", "Незуко", "Зеницу"];
      saveLocalData(key, saved);
    }
    return { handled: true, result: { success: true, characters: saved } };
  }

  if (channel === 'delete-voice-profile') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    let saved = getLocalData(key) || [];
    saved = saved.filter((c: string) => c !== args[0]?.characterName);
    saveLocalData(key, saved);
    return { handled: true, result: { success: true } };
  }

  if (channel === 'learn-voice-from-interval') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    const saved = getLocalData(key) || [];
    if (!saved.includes(args[0]?.characterName)) {
      saved.push(args[0]?.characterName);
      saveLocalData(key, saved);
    }
    return { handled: true, result: { success: true, character: args[0]?.characterName } };
  }

  if (channel === 'auto-train-voice-base') {
    const key = `voice_base_${args[0]?.projectName || 'default'}`;
    const saved = getLocalData(key) || [];
    const newChars = ["Танджиро", "Незуко", "Иноске", "Зеницу"];
    newChars.forEach(c => {
      if (!saved.includes(c)) saved.push(c);
    });
    saveLocalData(key, saved);
    return { handled: true, result: { success: true, count: newChars.length } };
  }

  if (channel === 'run-advanced-diarization-pipeline') {
    return {
      handled: true,
      result: (async () => {
        await new Promise(r => setTimeout(r, 1500));

        const subLines = args[0]?.subtitleLines || [];
        const speakerMapping: Record<string, string> = {};

        subLines.forEach((l: any, idx: number) => {
          speakerMapping[l.id] = idx % 2 === 0 ? 'Speaker 1' : 'Speaker 2';
        });

        return {
          success: true,
          speakerMapping,
          characterAssignments: {
            'Speaker 1': 'Незуко',
            'Speaker 2': 'Танджиро'
          },
          detectedSpeakersCount: 2
        };
      })()
    };
  }

  // Telegram channels are always handled by the real Node/Electron backend (TelegramController.cjs)
  if (channel.startsWith('telegram-')) {
    return { handled: false };
  }

  if (channel === 'timing-load-state') {
    const ep = args?.[0]?.episode;
    const key = `timing_state_ep_${ep?.projectId || 'p'}_${ep?.id || ep?.number || '1'}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { handled: true, result: { success: true, exists: true, timingDir: 'Тайминг', filePath: 'Тайминг/timing_state.json', state: parsed } };
      }
    } catch (e) {}
    return { handled: true, result: { success: true, exists: false, timingDir: 'Тайминг', filePath: 'Тайминг/timing_state.json', state: null } };
  }

  if (channel === 'timing-save-state') {
    const ep = args?.[0]?.episode;
    const state = args?.[0]?.state;
    const key = `timing_state_ep_${ep?.projectId || 'p'}_${ep?.id || ep?.number || '1'}`;
    try {
      if (state) {
        localStorage.setItem(key, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
      }
    } catch (e) {}
    return { handled: true, result: { success: true, timingDir: 'Тайминг', filePath: 'Тайминг/timing_state.json', updatedAt: new Date().toISOString() } };
  }

  if (channel === 'timing-reset-state') {
    const ep = args?.[0]?.episode;
    const key = `timing_state_ep_${ep?.projectId || 'p'}_${ep?.id || ep?.number || '1'}`;
    try {
      localStorage.removeItem(key);
    } catch (e) {}
    return { handled: true, result: { success: true, timingDir: 'Тайминг' } };
  }

  if (channel === 'export-get-default-dir') {
    const ep = args?.[0]?.episode;
    const role = args?.[0]?.role;
    const epName = `Episode_${ep?.number || 1}`;
    const defaultDir = role === 'DABBER' ? `${epName}_Для_даберов` : `${epName} для звукорежиссёра`;
    return { handled: true, result: { success: true, defaultDir, epDir: epName, projDir: '' } };
  }

  return { handled: false };
}
