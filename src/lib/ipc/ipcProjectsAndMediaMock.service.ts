import { readFromLocalFolder, writeToLocalFolder, selectBrowserDirectory, selectBrowserFile } from '../webFileSystem';
import { idb } from '../idb';

export function parseMemoryAss(text: string) {
  const lines: any[] = [];
  const actorsSet = new Set<string>();
  const stylesSet = new Set<string>();
  const textLines = text.split(/\r?\n/);
  let isEvents = false;
  let rawLineIndex = 0;

  for (const line of textLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[Events]')) {
      isEvents = true;
      continue;
    }
    if (trimmed.startsWith('[')) {
      isEvents = false;
    }

    if (isEvents && trimmed.startsWith('Dialogue:')) {
      rawLineIndex++;
      const prefixLength = 'Dialogue:'.length;
      const parts = trimmed.substring(prefixLength).split(',');
      if (parts.length >= 9) {
        const start = parts[1].trim();
        const end = parts[2].trim();
        const style = parts[3].trim();
        const name = parts[4].trim();
        const textVal = parts.slice(9).join(',').trim();
        lines.push({
          rawLineIndex,
          start,
          end,
          style,
          name,
          text: textVal
        });
        if (name) actorsSet.add(name);
        if (style) stylesSet.add(style);
      }
    }
  }

  return {
    lines,
    actors: Array.from(actorsSet),
    styles: Array.from(stylesSet)
  };
}

export function getLocalData(key: string) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

export function saveLocalData(key: string, data: any) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function seedDemoDataIfNeeded() {
  if (typeof window !== 'undefined' && (!localStorage.getItem('projects') || JSON.parse(localStorage.getItem('projects') || '[]').length === 0)) {
    const demoParticipants = [
      { id: 'p1', nickname: 'Kira', telegram: '@kira_dub', tgChannel: '@kira_channel', vkLink: 'vk.com/kira', roles: ['DUBBER'] },
      { id: 'p2', nickname: 'Anilibria_Enjoyer', telegram: '@ani_enjoyer', tgChannel: '', vkLink: '', roles: ['DUBBER', 'QA'] },
      { id: 'p3', nickname: 'Saber', telegram: '@saber_dub', tgChannel: '@saber_notes', vkLink: 'vk.com/saber', roles: ['DUBBER'] },
      { id: 'p4', nickname: 'OwlSound', telegram: '@owl_sound', tgChannel: '@owl_studio', vkLink: '', roles: ['SOUND_ENGINEER'] },
    ];

    const demoProjects = [
      {
        id: 'proj1',
        title: "Sousou no Frieren",
        originalTitle: "Frieren: Beyond Journey's End",
        status: 'ACTIVE',
        lastActiveEpisode: 1,
        totalEpisodes: 28,
        assignedDubberIds: ['p1', 'p2', 'p3'],
        soundEngineerId: 'p4',
        releaseType: 'VOICEOVER',
        emoji: '🧙‍♀️',
        isOngoing: true,
        synopsis: 'История эльфийки Фрирен, которая исследует новые земли и пытается понять человеческие эмоции после победы над Королём демонов.',
        typeAndSeason: 'TV-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    const demoEpisodes = [
      {
        id: 'ep1',
        projectId: 'proj1',
        number: 1,
        status: 'RECORDING',
        deadline: '2026-06-15',
        rawPath: 'Frieren_01_RAW.mp4',
        subPath: 'Frieren_01.ass',
        assignments: [
          { id: 'a1', episodeId: 'ep1', characterName: 'Frieren', dubberId: 'p1', status: 'RECORDED', lineCount: 154, isMain: true },
          { id: 'a2', episodeId: 'ep1', characterName: 'Himmel', dubberId: 'p2', status: 'PENDING', lineCount: 42, isMain: true },
          { id: 'a3', episodeId: 'ep1', characterName: 'Heiter', dubberId: 'p3', status: 'PENDING', lineCount: 28 }
        ],
        uploads: [
          { id: 'u1', episodeId: 'ep1', assignmentId: 'a1', type: 'DUBBER_FILE', path: '/mock/files/frieren_vox.wav', uploadedById: 'p1', createdAt: new Date().toISOString() }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    localStorage.setItem('participants', JSON.stringify(demoParticipants));
    localStorage.setItem('projects', JSON.stringify(demoProjects));
    localStorage.setItem('episodes', JSON.stringify(demoEpisodes));
  }
}

export function handleProjectsAndMediaIpcMock(channel: string, args: any[]): { handled: boolean; result?: any } {
  seedDemoDataIfNeeded();

  if (channel === 'search-nyaa-torrents') {
    const _q = (args[0]?.query || '').toLowerCase();
    return {
      handled: true,
      result: [
        {
          title: `[SubsPlease] Sousou no Frieren - 01 (1080p) [RAW]`,
          name: `[SubsPlease] Sousou no Frieren - 01 (1080p) [RAW]`,
          torrent: `https://nyaa.si/download/mock1.torrent`,
          magnet: `magnet:?xt=urn:btih:mockfrieren01raw1080p&dn=SousouNoFrieren01`,
          size: '1.2 GiB',
          date: '2026-05-20 12:00:00',
          timestamp: '2026-05-20',
          seeders: 245,
          seeds: 245,
          leechers: 12,
          leechs: 12,
          category: 'Anime - Raw'
        },
        {
          title: `[Erai-raws] Sousou no Frieren - 01 [720p] [RAW]`,
          name: `[Erai-raws] Sousou no Frieren - 01 [720p] [RAW]`,
          torrent: `https://nyaa.si/download/mock2.torrent`,
          magnet: `magnet:?xt=urn:btih:mockfrieren01raw720p&dn=SousouNoFrieren01_720`,
          size: '720.5 MiB',
          date: '2026-05-20 12:15:00',
          timestamp: '2026-05-20',
          seeders: 184,
          seeds: 184,
          leechers: 8,
          leechs: 8,
          category: 'Anime - Raw'
        },
        {
          title: `[AnimeTime] Sousou no Frieren - 01 (1080p HEVC x265 10bit) [RAW]`,
          name: `[AnimeTime] Sousou no Frieren - 01 (1080p HEVC x265 10bit) [RAW]`,
          torrent: `https://nyaa.si/download/mock3.torrent`,
          magnet: `magnet:?xt=urn:btih:mockfrieren01hevc&dn=SousouNoFrieren01_HEVC`,
          size: '450.2 MiB',
          date: '2026-05-20 13:40:00',
          timestamp: '2026-05-20',
          seeders: 95,
          seeds: 95,
          leechers: 4,
          leechs: 4,
          category: 'Anime - Raw'
        }
      ]
    };
  }

  if (channel === 'get-torrent-metadata') {
    const _rawName = args[0]?.torrentUrl || args[0]?.magnet || 'Sousou no Frieren - 01 (1080p) [RAW]';
    return {
      handled: true,
      result: {
        name: 'Sousou no Frieren - Season 1 [1080p]',
        files: [
          { index: 0, name: '[SubsPlease] Sousou no Frieren - 01 (1080p).mkv', path: '[SubsPlease] Sousou no Frieren - 01 (1080p).mkv', length: 1420000000 },
          { index: 1, name: '[SubsPlease] Sousou no Frieren - 02 (1080p).mkv', path: '[SubsPlease] Sousou no Frieren - 02 (1080p).mkv', length: 1390000000 },
          { index: 2, name: '[SubsPlease] Sousou no Frieren - 03 (1080p).mkv', path: '[SubsPlease] Sousou no Frieren - 03 (1080p).mkv', length: 1410000000 }
        ]
      }
    };
  }

  if (channel === 'start-torrent-download') {
    localStorage.setItem('mock_download_progress', '0');
    localStorage.setItem('mock_download_name', args[0]?.torrentUrl || args[0]?.magnet || 'Sousou no Frieren - 01 (1080p) [RAW]');
    return { handled: true, result: { downloadId: 'mock-dl-12345' } };
  }

  if (channel === 'get-torrent-download-status') {
    const currentProgress = parseInt(localStorage.getItem('mock_download_progress') || '0', 10);
    const downloadName = localStorage.getItem('mock_download_name') || 'Sousou no Frieren - 01 (1080p) [RAW]';

    let nextProgress = currentProgress + 20;
    if (nextProgress > 100) nextProgress = 100;

    localStorage.setItem('mock_download_progress', nextProgress.toString());

    return {
      handled: true,
      result: {
        id: 'mock-dl-12345',
        name: downloadName.substring(0, 60) + (downloadName.length > 60 ? '...' : ''),
        progress: nextProgress,
        downloadSpeed: nextProgress === 100 ? 0 : 8500000 + Math.random() * 2000000,
        numPeers: nextProgress === 100 ? 0 : 38,
        status: nextProgress === 100 ? 'completed' : 'downloading',
        filePath: nextProgress === 100 ? 'Frieren_01_RAW.mp4' : null,
        error: null
      }
    };
  }

  if (channel === 'get-active-downloads') {
    const currentProgress = parseInt(localStorage.getItem('mock_download_progress') || '-1', 10);
    if (currentProgress >= 0 && currentProgress < 100) {
      const downloadName = localStorage.getItem('mock_download_name') || 'Sousou no Frieren - 01 (1080p) [RAW]';
      return {
        handled: true,
        result: [{
          id: 'mock-dl-12345',
          name: downloadName.substring(0, 60) + (downloadName.length > 60 ? '...' : ''),
          progress: currentProgress,
          downloadSpeed: 8500000,
          numPeers: 38,
          status: 'downloading',
          filePath: null,
          error: null
        }]
      };
    }
    return { handled: true, result: [] };
  }

  if (channel === 'get-episode-title') {
    return { handled: true, result: '' };
  }

  if (channel === 'get-config') {
    return {
      handled: true,
      result: (async () => {
        const config = localStorage.getItem('config');
        return config ? JSON.parse(config) : { baseDir: '' };
      })()
    };
  }

  if (channel === 'save-config') {
    return {
      handled: true,
      result: (async () => {
        const config = args[0] || {};
        localStorage.setItem('config', JSON.stringify(config));
        return { success: true };
      })()
    };
  }

  if (
    channel === 'yandex-get-auth-url' ||
    channel === 'yandex-exchange-token' ||
    channel === 'yandex-disconnect' ||
    channel === 'cloud-sync-status' ||
    channel === 'cloud-push' ||
    channel === 'cloud-pull'
  ) {
    return { handled: true, result: undefined };
  }

  const entityMatch = channel.match(/^(get|save|delete)-(project|episode|participant)s?$/);
  if (entityMatch) {
    const action = entityMatch[1];
    const entity = entityMatch[2];
    const key = `${entity}s`;

    if (action === 'get') {
      return {
        handled: true,
        result: (async () => {
          if (entity === 'project') {
            const projects = getLocalData('projects');
            const episodes = getLocalData('episodes');
            const participants = getLocalData('participants');

            return projects.map((project: any) => {
              const projectEpisodes = episodes.filter((ep: any) => ep.projectId === project.id).map((ep: any) => {
                const assignments = (ep.assignments || []).map((assignment: any) => {
                  const dubber = participants.find((p: any) => p.id === assignment.dubberId);
                  return { ...assignment, dubber };
                });
                const uploads = (ep.uploads || []).map((upload: any) => {
                  const uploadedBy = participants.find((p: any) => p.id === upload.uploadedById);
                  return { ...upload, uploadedBy };
                });
                return { ...ep, assignments, uploads };
              });
              return { ...project, episodes: projectEpisodes };
            });
          }
          return getLocalData(key);
        })()
      };
    }

    if (action === 'save') {
      return {
        handled: true,
        result: (async () => {
          const items = getLocalData(key);
          const item = args[0];
          const index = items.findIndex((i: any) => i.id === item.id);

          const dataToSave = { ...item };
          if (entity === 'episode') {
            delete dataToSave.project;
            if (dataToSave.assignments) {
              dataToSave.assignments = dataToSave.assignments.map((a: any) => {
                const { dubber: _d, substitute: _s, ...rest } = a;
                return rest;
              });
            }
            if (dataToSave.uploads) {
              dataToSave.uploads = dataToSave.uploads.map((u: any) => {
                const { uploadedBy: _u, ...rest } = u;
                return rest;
              });
            }
          } else if (entity === 'project') {
            delete dataToSave.episodes;
          }

          if (index !== -1) {
            items[index] = dataToSave;
          } else {
            items.push(dataToSave);
          }
          saveLocalData(key, items);

          return { success: true };
        })()
      };
    }

    if (action === 'delete') {
      return {
        handled: true,
        result: (async () => {
          const items = getLocalData(key);
          const id = args[0];
          const filtered = items.filter((i: any) => i.id !== id);
          saveLocalData(key, filtered);

          return { success: true };
        })()
      };
    }
  }

  if (channel === 'get-gpus') {
    return { handled: true, result: [{ name: 'Mock GPU 0', index: '0' }] };
  }

  if (channel === 'import-participants') {
    return {
      handled: true,
      result: (async () => {
        saveLocalData('participants', args[0]);
        return { success: true };
      })()
    };
  }

  if (channel === 'select-directory') {
    return {
      handled: true,
      result: (async () => {
        try {
          const dirName = await selectBrowserDirectory();
          return { canceled: false, filePaths: [dirName] };
        } catch (e: any) {
          console.warn('Select directory canceled or failed:', e);
          return { canceled: false, filePaths: ['/mock/release/directory'] };
        }
      })()
    };
  }

  if (channel === 'select-folder') {
    return {
      handled: true,
      result: (async () => {
        try {
          const dirName = await selectBrowserDirectory();
          return { success: true, data: { path: dirName } };
        } catch (e: any) {
          console.warn('Select folder canceled or failed:', e);
          return { success: true, data: { path: '/mock/path' } };
        }
      })()
    };
  }

  if (channel === 'select-file' || channel === 'dialog:openFile' || channel === 'dialog:showOpenDialog') {
    return {
      handled: true,
      result: (async () => {
        try {
          const fileInfo = await selectBrowserFile();
          return { success: true, path: fileInfo.path, filePath: fileInfo.path, data: { path: fileInfo.path } };
        } catch (e: any) {
          console.warn('Select file canceled or failed, using mock path:', e);
          return { success: true, path: '/mock/selected/file.ass', filePath: '/mock/selected/file.ass', data: { path: '/mock/selected/file.ass' } };
        }
      })()
    };
  }

  if (channel === 'get-video-metadata') {
    return {
      handled: true,
      result: {
        format: {
          filename: args[0] || 'video.mkv',
          nb_streams: 7,
          duration: '1420.5'
        },
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
          { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'jpn', title: 'Оригинал (Japanese)' }, disposition: { default: 1 } },
          { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { language: 'rus', title: 'Озвучка (Russian Dub)' } },
          {
            index: 3,
            codec_type: 'subtitle',
            codec_name: 'ass',
            tags: { language: 'rus', title: 'Полные субтитры (по ролям для озвучки)' },
            disposition: { default: 1 }
          },
          {
            index: 4,
            codec_type: 'subtitle',
            codec_name: 'ass',
            tags: { language: 'rus', title: 'Сплошной перевод (без разделения на персонажей)' }
          },
          {
            index: 5,
            codec_type: 'subtitle',
            codec_name: 'ass',
            tags: { language: 'rus', title: 'Надписи и караоке (только знаки)' }
          },
          {
            index: 6,
            codec_type: 'subtitle',
            codec_name: 'subrip',
            tags: { language: 'eng', title: 'English Subtitles (Partially split)' }
          }
        ]
      }
    };
  }

  if (channel === 'analyze-mkv-subtitles') {
    const streamIndices: number[] = args[0]?.streamIndices || [3, 4, 5, 6];
    const mockMap: Record<number, any> = {
      3: {
        splitStatus: 'full',
        statusLabel: 'Разделены на персонажей',
        totalLines: 382,
        namedLines: 363,
        unnamedLines: 19,
        namedPercentage: 95,
        characterCount: 12,
        topCharacters: [
          { name: 'Эрен', count: 124 },
          { name: 'Микаса', count: 88 },
          { name: 'Армин', count: 64 },
          { name: 'Леви', count: 42 },
          { name: 'Ханджи', count: 28 },
          { name: 'Жан', count: 17 }
        ],
        allCharacters: ['Эрен', 'Микаса', 'Армин', 'Леви', 'Ханджи', 'Жан', 'Конни', 'Саша', 'Эрвин', 'Райнер', 'Бертольд', 'Энни'],
        isRecommendedForDubbing: true
      },
      4: {
        splitStatus: 'none',
        statusLabel: 'Вообще не разделены',
        totalLines: 395,
        namedLines: 0,
        unnamedLines: 395,
        namedPercentage: 0,
        characterCount: 0,
        topCharacters: [],
        allCharacters: [],
        isRecommendedForDubbing: false
      },
      5: {
        splitStatus: 'none',
        statusLabel: 'Только надписи / Без диалогов',
        totalLines: 0,
        namedLines: 0,
        unnamedLines: 0,
        namedPercentage: 0,
        characterCount: 0,
        topCharacters: [],
        allCharacters: [],
        isRecommendedForDubbing: false
      },
      6: {
        splitStatus: 'partial',
        statusLabel: 'Частично разделены',
        totalLines: 380,
        namedLines: 125,
        unnamedLines: 255,
        namedPercentage: 33,
        characterCount: 3,
        topCharacters: [
          { name: 'Narrator', count: 76 },
          { name: 'Eren', count: 36 },
          { name: 'Commander', count: 13 }
        ],
        allCharacters: ['Narrator', 'Eren', 'Commander'],
        isRecommendedForDubbing: false
      }
    };

    const res: Record<number, any> = {};
    for (const idx of streamIndices) {
      if (mockMap[idx]) {
        res[idx] = mockMap[idx];
      } else {
        res[idx] = {
          splitStatus: 'none',
          statusLabel: 'Вообще не разделены',
          totalLines: 300,
          namedLines: 0,
          unnamedLines: 300,
          namedPercentage: 0,
          characterCount: 0,
          topCharacters: [],
          allCharacters: []
        };
      }
    }
    return { handled: true, result: res };
  }

  if (channel === 'extract-subtitle-track') {
    return { handled: true, result: { path: args[0]?.outputPath || '/mock/extracted_sub.ass' } };
  }

  if (channel === 'get-raw-subtitles') {
    return {
      handled: true,
      result: (async () => {
        const filePath = args[0];
        if (filePath === 'standalone.ass') {
          const text = await idb.get('standalone_sub_text');
          if (text) {
            return parseMemoryAss(text);
          }
        }

        if (filePath) {
          try {
            const file = await readFromLocalFolder(filePath);
            if (file instanceof File) {
              const text = await file.text();
              const parsed = parseMemoryAss(text);
              if (parsed.lines.length > 0) {
                return parsed;
              }
            }
          } catch (e) {
            console.warn('Failed to natively parse local .ass sub file, using fallback mock:', e);
          }
        }
        return {
          lines: [
            { rawLineIndex: 1, start: '0:00:00.00', end: '0:00:05.00', style: 'Default', name: 'Actor1', text: 'Hello world' },
            { rawLineIndex: 2, start: '0:00:05.00', end: '0:00:10.00', style: 'Default', name: 'Actor2', text: 'Hi there' },
            { rawLineIndex: 3, start: '0:00:10.00', end: '0:00:15.00', style: 'Default', name: 'Actor3', text: 'Testing' },
            { rawLineIndex: 4, start: '0:00:15.00', end: '0:00:20.00', style: 'Default', name: 'Actor4', text: 'More lines' },
            { rawLineIndex: 5, start: '0:00:20.00', end: '0:00:25.00', style: 'Default', name: 'Actor1', text: 'Another one' }
          ],
          actors: ['Actor1', 'Actor2', 'Actor3', 'Actor4'],
          styles: []
        };
      })()
    };
  }

  if (channel === 'save-raw-subtitles') {
    return {
      handled: true,
      result: (async () => {
        const payload = args[0];
        const filePath = payload.filePath || payload.assFilePath;
        const lines = payload.lines;
        if (filePath && Array.isArray(lines)) {
          try {
            const header = `[Script Info]\nTitle: Anime Dub Manager\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
            const eventLines = lines.map(l => {
              return `Dialogue: 0,${l.start},${l.end},${l.style || 'Default'},${l.name || 'Actor'},0,0,0,,${l.text}`;
            }).join('\n');
            await writeToLocalFolder(filePath, header + eventLines);
            return { success: true };
          } catch (e) {
            console.error("Could not write edited subtitles to disk:", e);
          }
        }
        return { success: true };
      })()
    };
  }

  if (channel === 'save-translated-subtitles') {
    return {
      handled: true,
      result: (async () => {
        const { assFilePath, translatedLines } = args[0] || {};
        if (assFilePath && Array.isArray(translatedLines)) {
          try {
            const header = `[Script Info]\nTitle: Anime Dub Manager\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
            const eventLines = translatedLines.map(l => {
              return `Dialogue: 0,${l.start},${l.end},${l.style || 'Default'},${l.name || 'Actor'},0,0,0,,${l.text}`;
            }).join('\n');
            await writeToLocalFolder(assFilePath, header + eventLines);
            return { success: true };
          } catch (e) {
            console.error("Could not write translated subtitles to disk:", e);
          }
        }
        return { success: true };
      })()
    };
  }

  if (channel === 'silence-audio-intervals') {
    return { handled: true, result: { success: true } };
  }

  if (channel === 'split-subs-by-dubber') {
    return { handled: true, result: { success: true, generatedFiles: ['actor1.ass', 'actor2.ass'] } };
  }

  if (channel === 'split-subs-by-actor') {
    return { handled: true, result: { success: true, generatedFiles: ['actor1.ass', 'actor2.ass'] } };
  }

  if (channel === 'export-full-ass-with-roles') {
    return { handled: true, result: { success: true, path: args[0].outputPath } };
  }

  if (channel === 'clipboard-write-text') {
    return {
      handled: true,
      result: (async () => {
        const text = String(args[0] ?? '');
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch (e) {
          // Fallback
        }
        try {
          if (typeof document !== 'undefined') {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
          }
        } catch (e) {
          // Fallback failed
        }
        return false;
      })()
    };
  }

  if (channel === 'copy-file') {
    return {
      handled: true,
      result: (async () => {
        const { fileName, targetDir } = args[0] || {};
        const pathValue = `${targetDir}/${fileName}`;
        try {
          const file = await readFromLocalFolder(fileName);
          if (file instanceof File) {
            await writeToLocalFolder(pathValue, file);
          }
          return { success: true, data: { path: pathValue } };
        } catch (e) {
          return { success: true, data: { path: pathValue } };
        }
      })()
    };
  }

  if (channel === 'save-file-buffer') {
    return {
      handled: true,
      result: (async () => {
        const { fileName, targetDir, buffer } = args[0] || {};
        const pathValue = `${targetDir}/${fileName}`;
        try {
          if (buffer) {
            const blob = new Blob([buffer]);
            await writeToLocalFolder(pathValue, blob);
          }
          return { success: true, data: { path: pathValue } };
        } catch (e) {
          return { success: true, data: { path: pathValue } };
        }
      })()
    };
  }

  if (channel === 'get-debug-stats') {
    return { handled: true, result: { cpu: 0, ram: 0, ffmpeg: [] } };
  }

  if (channel === 'get-tasks') {
    return { handled: true, result: [] };
  }

  if (channel === 'abort-task') {
    return { handled: true, result: true };
  }

  if (channel === 'clear-task-history') {
    return { handled: true, result: true };
  }

  return { handled: false };
}
