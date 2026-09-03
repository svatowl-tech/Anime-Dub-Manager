const { ipcMain, dialog, app, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');
const log = require('electron-log');
const AdmZip = require('adm-zip');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { setCustomFfmpegPath, getActiveProcesses } = require('../services/ffmpegService.cjs');

function registerSystemHandlers(getData, saveData, mainWindow, taskQueue) {
  const getWin = () => (typeof mainWindow === 'function' ? mainWindow() : mainWindow) || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

  ipcMain.handle('open-external', wrapIpcHandler(async (event, url) => {
    if (!url) throw new Error('Missing URL');
    await shell.openExternal(url);
    return true;
  }));

  ipcMain.handle('open-path', wrapIpcHandler(async (event, filePath) => {
    if (!filePath) throw new Error('Missing path');
    const config = (await getData('config.json')) || {};
    const baseDir = config.baseDir || app.getPath('userData');
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    await shell.openPath(fullPath);
    return true;
  }));

  ipcMain.handle('get-config', wrapIpcHandler(async () => {
    const config = await getData('config.json');
    return config || { 
      baseDir: '', 
      ffmpegPath: '', 
      useNvenc: false, 
      gpuIndex: '0', 
      openRouterKey: '',
      aiModel: 'google/gemini-2.0-flash-lite-preview-02-05:free'
    };
  }));

  ipcMain.handle('save-config', wrapIpcHandler(async (event, newConfig) => {
    if (!newConfig) throw new Error('Invalid config data');
    log.info('Saving system configuration...');
    const currentConfig = await getData('config.json') || {};
    const mergedConfig = { ...currentConfig, ...newConfig };
    await saveData('config.json', mergedConfig);
    if (mergedConfig.ffmpegPath) {
      setCustomFfmpegPath(mergedConfig.ffmpegPath);
    }
    return true;
  }));

  ipcMain.handle('get-browser-preload-path', wrapIpcHandler(async () => {
    return path.join(__dirname, '..', 'lib', 'browser-preload.cjs');
  }));

  ipcMain.handle('clear-webview-storage', wrapIpcHandler(async () => {
    const { session } = require('electron');
    if (session && typeof session.fromPartition === 'function') {
      const pubSession = session.fromPartition('persist:publisher');
      await pubSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage', 'indexdb']
      });
      await pubSession.clearCache();
      log.info('[SystemController] Cleared webview storage and cache for persist:publisher');
      return true;
    }
    return false;
  }));

  ipcMain.handle('export-data-zip', wrapIpcHandler(async () => {
    if (!mainWindow) throw new Error('No main window');
    
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт резервной копии',
      defaultPath: `AnimeDubManager_Backup_${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    log.info(`Creating backup ZIP at: ${result.filePath}`);
    const zip = new AdmZip();
    const dataDir = app.getPath('userData');
    const jsonFiles = ['participants.json', 'projects.json', 'episodes.json', 'config.json'];
    
    for (const file of jsonFiles) {
      try {
        const fullPath = path.join(dataDir, file);
        await fs.access(fullPath);
        zip.addLocalFile(fullPath);
      } catch (e) {
        // file doesn't exist yet, ignore
      }
    }
    
    zip.writeZip(result.filePath);
    return { canceled: false, path: result.filePath };
  }));

  ipcMain.handle('select-folder', wrapIpcHandler(async (event, options = {}) => {
    const win = getWin();
    if (!win) throw new Error('No window available');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: options.defaultPath
    });
    if (win && win.webContents) {
      win.webContents.focus();
    }
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  }));

  const selectFileHandler = wrapIpcHandler(async (event, options = {}) => {
    const win = getWin();
    if (!win) throw new Error('No window available');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      ...options
    });
    if (win && win.webContents) {
      win.webContents.focus();
    }
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0], filePath: result.filePaths[0] };
  });

  ipcMain.handle('select-file', selectFileHandler);
  ipcMain.handle('dialog:openFile', selectFileHandler);
  ipcMain.handle('dialog:showOpenDialog', selectFileHandler);

  ipcMain.handle('show-save-dialog', wrapIpcHandler(async (event, options) => {
    let result;
    const win = getWin();
    if (win && dialog && typeof dialog.showSaveDialog === 'function') {
      result = await dialog.showSaveDialog(win, {
        title: 'Сохранить файл субтитров',
        filters: [{ name: 'Subtitle Files', extensions: ['ass', 'srt'] }],
        ...options
      });
      if (win && win.webContents) {
        win.webContents.focus();
      }
    } else {
      // Веб-превью / серверный фоллбек
      const defaultPath = options?.defaultPath || 'character_subtitles.ass';
      const baseDir = path.join(process.cwd(), 'mock_user_data');
      result = {
        canceled: false,
        filePath: path.isAbsolute(defaultPath) ? defaultPath : path.join(baseDir, defaultPath)
      };
    }

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    return { filePath: result.filePath };
  }));

  ipcMain.handle('delete-file', wrapIpcHandler(async (event, filePath) => {
    log.info(`Deleting file: ${filePath}`);
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (e) {
      log.warn(`Could not delete file ${filePath}:`, e.message);
      return { success: false, error: e.message };
    }
  }));

  ipcMain.handle('copy-file', wrapIpcHandler(async (event, { sourcePath, targetDir, fileName }) => {
    if (!sourcePath || !targetDir || !fileName) throw new Error('Missing required parameters');
    log.info(`Copying file: ${sourcePath} -> ${targetDir}/${fileName}`);
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(fullTargetDir, { recursive: true });

    const isRaw = fileName.includes('raw_video');
    const isSub = fileName.includes('subtitles');

    let targetFileName = fileName;
    const sourceExt = path.extname(sourcePath).toLowerCase();
    
    // Check if subtitle conversion will happen and change target filename accordingly
    if (isSub) {
      if (sourceExt === '.srt' || sourceExt === '.vtt' || sourceExt === '.ssa') {
        targetFileName = 'subtitles.ass';
      }
    }
    const targetPath = path.join(fullTargetDir, targetFileName);

    // If source and target are the exact same file, no need to copy or cleanup
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return { path: targetPath };
    }

    // Clean up existing versions of this file type (RAW or SUB) to avoid clutter
    const files = await fs.readdir(fullTargetDir);
    
    // Prefix to search for and delete
    const cleanupPrefix = isRaw ? 'raw_video' : (isSub ? 'subtitles' : null);
    
    if (cleanupPrefix) {
      for (const f of files) {
        if (f.startsWith(cleanupPrefix)) {
          const fileToDelete = path.join(fullTargetDir, f);
          // Do not delete the source file if it happens to be inside this directory!
          if (path.resolve(fileToDelete) !== path.resolve(sourcePath)) {
            await fs.unlink(fileToDelete).catch(() => {});
          }
        }
      }
    }

    // Subtitle conversion/normalization
    if (isSub && (sourceExt === '.srt' || sourceExt === '.vtt')) {
      const { convertSrtToAss } = require('../services/subtitleService.cjs');
      await convertSrtToAss(sourcePath, targetPath);
      return { path: targetPath };
    }

    await fs.copyFile(sourcePath, targetPath);
    
    if (targetPath.toLowerCase().endsWith('.ass')) {
      const { cleanAssFile } = require('../services/subtitleService.cjs');
      await cleanAssFile(targetPath);
    }
    
    return { path: targetPath };
  }));

  ipcMain.handle('save-file-buffer', wrapIpcHandler(async (event, { buffer, targetDir, fileName }) => {
    if (!buffer || !targetDir || !fileName) throw new Error('Missing required parameters');
    
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);
    
    await fs.mkdir(fullTargetDir, { recursive: true });
    const targetPath = path.join(fullTargetDir, fileName);
    
    await fs.writeFile(targetPath, Buffer.from(buffer));
    
    if (targetPath.toLowerCase().endsWith('.ass')) {
      const { cleanAssFile } = require('../services/subtitleService.cjs');
      await cleanAssFile(targetPath);
    }
    
    return { path: targetPath };
  }));

  ipcMain.handle('create-dir', wrapIpcHandler(async (event, dirPath) => {
    if (!dirPath) throw new Error('Missing directory path');
    const config = await getData('config.json');
    const baseDir = config.baseDir || app.getPath('userData');
    const fullDir = path.isAbsolute(dirPath) ? dirPath : path.join(baseDir, dirPath);
    await fs.mkdir(fullDir, { recursive: true });
    return { path: fullDir };
  }));

  ipcMain.handle('get-gpus', wrapIpcHandler(async () => {
    return new Promise((resolve) => {
      exec('nvidia-smi --query-gpu=name,index --format=csv,noheader', (error, stdout) => {
        if (error) {
          resolve([{ name: 'Default GPU', index: '0' }]);
          return;
        }
        const gpus = stdout.trim().split('\n').map(line => {
          const [name, index] = line.split(',').map(s => s.trim());
          return { name, index };
        });
        resolve(gpus.length > 0 ? gpus : [{ name: 'Default GPU', index: '0' }]);
      });
    });
  }));

  ipcMain.handle('get-debug-stats', wrapIpcHandler(async () => {
    const cpuUsage = process.getCPUUsage().percentCPUUsage;
    const memoryInfo = await process.getProcessMemoryInfo();
    const ffmpegProcesses = getActiveProcesses();
    
    return {
      cpu: cpuUsage,
      ram: memoryInfo.residentSet,
      ffmpeg: ffmpegProcesses
    };
  }));

  ipcMain.handle('check-services-status', wrapIpcHandler(async () => {
    const services = [
      { name: 'Anime365', url: 'https://smotret-anime.com', host: 'smotret-anime.com' },
      { name: 'Shikimori', url: 'https://shikimori.one', host: 'shikimori.one' },
      { name: 'Nyaa Tracker', url: 'https://nyaa.si', host: 'nyaa.si' },
      { name: 'Yandex Disk', url: 'https://cloud-api.yandex.net/v1/disk/', host: 'cloud-api.yandex.net' },
      { name: 'Telegram API', url: 'https://api.telegram.org', host: 'api.telegram.org' }
    ];

    const results = {};
    for (const service of services) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const start = Date.now();
        
        let res;
        try {
          res = await fetch(service.url, { 
            method: 'HEAD', 
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
        } catch (fetchErr) {
          // If HEAD fails (some APIs don't support HEAD), try a quick GET
          res = await fetch(service.url, { 
            method: 'GET', 
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
        }
        
        clearTimeout(timeoutId);
        const latency = Date.now() - start;
        results[service.name] = {
          status: res && (res.status >= 200 && res.status < 500) ? 'online' : 'offline',
          latency,
          code: res ? res.status : null
        };
      } catch (err) {
        results[service.name] = {
          status: 'offline',
          latency: 0,
          error: err.message
        };
      }
    }
    return results;
  }));

  ipcMain.handle('get-temp-path', wrapIpcHandler(async () => {
    return app.getPath('temp');
  }));

  ipcMain.handle('select-directory', wrapIpcHandler(async () => {
    const win = getWin();
    if (!win) throw new Error('No window available');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    if (win && win.webContents) {
      win.webContents.focus();
    }
    if (result.canceled) throw new Error('Selection canceled');
    return result;
  }));

  ipcMain.handle('get-tasks', wrapIpcHandler(async () => taskQueue.getTasksSummary()));
  ipcMain.handle('abort-task', wrapIpcHandler(async (event, taskId) => taskQueue.abort(taskId)));
  ipcMain.handle('clear-task-history', wrapIpcHandler(async () => taskQueue.clearHistory()));

  // Search Nyaa Torrents
  ipcMain.handle('search-nyaa-torrents', wrapIpcHandler(async (event, { query, category = 'anime', subCategory = 'raw', sort = 'seeders', order = 'desc' }) => {
    if (!query) throw new Error('Query is required');
    log.info(`Searching Nyaa & others for: "${query}", category: "${category}", subCategory: "${subCategory}", sort: "${sort}", order: "${order}"`);
    
    let results = [];
    
    // 1. Search Nyaa
    try {
      const url = new URL('https://nyaaapi.onrender.com/nyaa');
      url.searchParams.append('q', query);
      if (category) url.searchParams.append('category', category);
      if (subCategory) url.searchParams.append('sub_category', subCategory);
      if (sort) url.searchParams.append('sort', sort);
      if (order) url.searchParams.append('order', order);

      const res = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (res.ok) {
        const data = await res.json();
        let rawList = [];
        if (Array.isArray(data)) rawList = data;
        else if (data && Array.isArray(data.torrents)) rawList = data.torrents;
        else if (data && typeof data === 'object') {
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) { rawList = data[key]; break; }
          }
        }
        rawList.forEach(item => {
          if (item) {
            if (!item.magnet && item.hash) {
              item.magnet = `magnet:?xt=urn:btih:${item.hash}&dn=${encodeURIComponent(item.name || item.title || 'anime')}`;
            }
            results.push(item);
          }
        });
      }
    } catch (err) {
      log.error('Nyaa search error:', err.message);
    }
    
    // 2. Search TokyoTosho
    try {
      if (category === 'anime' || !category) {
        const ttUrl = `https://www.tokyotosho.info/rss.php?terms=${encodeURIComponent(query)}&type=1&searchName=true&searchFile=true`;
        const resTT = await fetch(ttUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (resTT.ok) {
          const xml = await resTT.text();
          const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
          items.forEach(item => {
            const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
            const linkMatch = item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/) || item.match(/<link>(.*?)<\/link>/);
            const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
            
            if (titleMatch && linkMatch) {
              const info = descMatch ? descMatch[1] : '';
              const sizeMatch = info.match(/Size: ([\d.,]+\s*[A-Za-z]+)/);
              const seedersMatch = info.match(/Seeders: (\d+)/);
              const leechersMatch = info.match(/Leechers: (\d+)/);
              
              const magnetInItem = item.match(/href=["'](magnet:\?[^"']+)["']/i) || 
                                   item.match(/(magnet:\?xt=urn:btih:[^\s<>"']+)/i) || 
                                   info.match(/href=["'](magnet:\?[^"']+)["']/i);
              const torrentInItem = item.match(/href=["'](https?:\/\/[^"']+\.torrent[^"']*)["']/i) || 
                                    info.match(/href=["'](https?:\/\/[^"']+\.torrent[^"']*)["']/i);
              
              const magnetVal = magnetInItem ? magnetInItem[1].replace(/&amp;/g, '&') : (linkMatch[1].startsWith('magnet') ? linkMatch[1] : null);
              const torrentVal = torrentInItem ? torrentInItem[1] : (linkMatch[1].endsWith('.torrent') ? linkMatch[1] : null);
              
              results.push({
                name: '[TokyoTosho] ' + titleMatch[1],
                title: '[TokyoTosho] ' + titleMatch[1],
                link: linkMatch[1],
                magnet: magnetVal,
                torrent: torrentVal,
                size: sizeMatch ? sizeMatch[1] : 'Unknown',
                seeders: seedersMatch ? parseInt(seedersMatch[1]) : 0,
                leechers: leechersMatch ? parseInt(leechersMatch[1]) : 0,
                category: 'Anime (TokyoTosho)'
              });
            }
          });
        }
      }
    } catch (err) {
      log.error('TokyoTosho search error:', err.message);
    }

    // 3. Search SubsPlease / Erai-Raws via Subsplease RSS directly if applicable
    try {
      if (query.toLowerCase().includes('subsplease')) {
         const spUrl = `https://subsplease.org/rss/?r=1080`;
         const resSP = await fetch(spUrl, {
           headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
         });
         if (resSP.ok) {
            const xml = await resSP.text();
            const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
            items.forEach(item => {
              const titleMatch = item.match(/<title>(.*?)<\/title>/);
              const linkMatch = item.match(/<link>(.*?)<\/link>/);
              if (titleMatch && linkMatch && titleMatch[1].toLowerCase().includes(query.toLowerCase().replace('subsplease','').trim())) {
                results.push({
                  name: '[SubsPlease RSS] ' + titleMatch[1],
                  title: '[SubsPlease RSS] ' + titleMatch[1],
                  link: linkMatch[1],
                  magnet: linkMatch[1], 
                  size: '1080p',
                  seeders: '-',
                  leechers: '-',
                  category: 'Anime (SubsPlease)'
                });
              }
            });
         }
      }
    } catch (err) {
      log.error('SubsPlease search error:', err.message);
    }
    
    // Sort combined results by Seeders desc
    results.sort((a, b) => {
      const sA = (a.seeders === '-' ? 0 : parseInt(a.seeders) || 0);
      const sB = (b.seeders === '-' ? 0 : parseInt(b.seeders) || 0);
      return sB - sA;
    });

    if (results.length === 0) {
      log.warn(`No results found on any tracker for ${query}`);
    }
    
    return results;
  }));

  ipcMain.handle('get-torrent-metadata', wrapIpcHandler(async (event, { torrentUrl, magnet }) => {
    let torrentId = magnet || torrentUrl;
    if (!torrentId) throw new Error('Torrent URL or Magnet is required');
    log.info(`[get-torrent-metadata] Fetching metadata for: ${typeof torrentId === 'string' && torrentId.length > 80 ? torrentId.slice(0, 80) + '...' : torrentId}`);
    
    const client = await getTorrentClient();
    
    return new Promise(async (resolve, reject) => {
      let resolved = false;
      let timeoutId = null;
      let checkIntervalId = null;
      
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (checkIntervalId) {
          clearInterval(checkIntervalId);
          checkIntervalId = null;
        }
      };
      
      const onMetadata = (t) => {
        if (resolved) return;
        
        // Ensure files array is populated
        if (!t || !t.files || t.files.length === 0) {
          if (!checkIntervalId) {
            let attempts = 0;
            checkIntervalId = setInterval(() => {
              attempts++;
              if (t && t.files && t.files.length > 0) {
                cleanup();
                onMetadata(t);
              } else if (attempts > 40) { // 4 seconds max
                cleanup();
                if (!resolved) {
                  resolved = true;
                  reject(new Error('Не удалось прочитать список файлов торрента (файлы отсутствуют в метаданных).'));
                }
              }
            }, 100);
          }
          return;
        }

        resolved = true;
        cleanup();

        const hasActiveSessions = Array.from(activeDownloads.values()).some(d => 
          (d.status === 'downloading' || d.status === 'completed') && 
          (d.torrentId === torrentId || d.torrentId === t.infoHash || d.torrentId === t.magnetURI)
        );
        if (!hasActiveSessions && t.files) {
          t.files.forEach(f => {
            try { f.deselect(); } catch (e) {}
          });
        }
        
        log.info(`[get-torrent-metadata] Successfully resolved metadata for: "${t.name || 'Торрент'}" (${t.files.length} files)`);
        resolve({
          name: t.name || 'Торрент',
          infoHash: t.infoHash,
          files: t.files.map((f, i) => ({
            index: i,
            name: f.name,
            path: f.path,
            length: f.length
          }))
        });
      };
      
      // Start 50s timeout immediately at the start of metadata acquisition
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('Время ожидания метаданных торрента истекло (50с). Пиры не найдены или трекер недоступен. Проверьте раздачу или используйте прямую Magnet-ссылку.'));
        }
      }, 50000);

      try {
        const config = (await getData('config.json')) || {};
        const baseDir = config.baseDir || app.getPath('userData');
        const torrentsDir = path.join(baseDir, 'torrents_temp');
        await fs.mkdir(torrentsDir, { recursive: true });

        let lastErr = null;
        let torrent = await getOrAddTorrent(client, torrentId, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS }, getData).catch(err => {
          log.warn(`[get-torrent-metadata] Primary getOrAddTorrent failed for ${torrentId}: ${err.message}`);
          lastErr = err;
          return null;
        });
        
        if ((!torrent || torrent.destroyed) && magnet && torrentId !== magnet) {
          log.info(`[get-torrent-metadata] Retrying with magnet link: ${magnet.slice(0, 60)}...`);
          torrent = await getOrAddTorrent(client, magnet, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS }, getData).catch(err => {
            lastErr = err;
            return null;
          });
        }

        if ((!torrent || torrent.destroyed) && torrentUrl && torrentId !== torrentUrl) {
          log.info(`[get-torrent-metadata] Retrying with torrentUrl: ${torrentUrl.slice(0, 60)}...`);
          torrent = await getOrAddTorrent(client, torrentUrl, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS }, getData).catch(err => {
            lastErr = err;
            return null;
          });
        }

        if (!torrent || torrent.destroyed) {
          const detail = lastErr?.message || 'Проверьте корректность Magnet/Torrent ссылки.';
          throw new Error(`Не удалось инициализировать торрент в клиенте WebTorrent: ${detail}`);
        }

        if (torrent.ready || (torrent.files && torrent.files.length > 0)) {
          onMetadata(torrent);
        } else {
          const onErr = (err) => {
            if (!resolved) {
              resolved = true;
              cleanup();
              reject(err || new Error('Ошибка при получении метаданных торрента'));
            }
          };
          torrent.once('metadata', () => onMetadata(torrent));
          torrent.once('ready', () => onMetadata(torrent));
          torrent.once('error', onErr);
        }
        
      } catch (e) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(e);
        }
      }
    });
  }));

  // Start Torrent Download
  ipcMain.handle('start-torrent-download', wrapIpcHandler(async (event, { torrentUrl, magnet, fileIndex }) => {
    let torrentId = magnet || torrentUrl;
    if (!torrentId) throw new Error('Torrent URL or Magnet is required');

    const dlId = `dl-${Date.now()}-${++downloadCounter}`;
    const config = await getData('config.json') || {};
    const baseDir = config.baseDir || app.getPath('userData');
    const torrentsDir = path.join(baseDir, 'torrents_temp');
    
    await fs.mkdir(torrentsDir, { recursive: true });

    // Set initial state
    activeDownloads.set(dlId, {
      id: dlId,
      torrentId: torrentId,
      fileIndex: fileIndex,
      name: 'Инициализация...',
      progress: 0,
      downloadSpeed: 0,
      numPeers: 0,
      status: 'downloading',
      filePath: null,
      error: null
    });
    saveTorrentsState();

    if (taskQueue) {
      taskQueue.registerExternalTask(
        dlId,
        'torrent-download',
        { title: 'Загрузка торрента', dlId, torrentId },
        () => {
          const d = activeDownloads.get(dlId);
          if (d) {
            d.status = 'cancelled';
            activeDownloads.set(dlId, d);
            saveTorrentsState();
          }
        }
      );
    }

    try {
      const client = await getTorrentClient();
      
      const torrent = await getOrAddTorrent(client, torrentId, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS }, getData);
      setupTorrentHandlers(dlId, torrentId, fileIndex, torrent, torrentsDir, taskQueue);
      
    } catch (err) {
      log.error(`Failed to start WebTorrent download:`, err);
      const state = activeDownloads.get(dlId);
      if (state) {
        state.status = 'error';
        state.error = err.message || String(err);
        activeDownloads.set(dlId, state);
        saveTorrentsState();
      }
      if (taskQueue) {
        taskQueue.failExternalTask(dlId, err.message || String(err));
      }
    }

    return { downloadId: dlId };
  }));

  // Get Torrent Download Status
  ipcMain.handle('get-torrent-download-status', wrapIpcHandler(async (event, { downloadId }) => {
    if (!downloadId) throw new Error('Download ID is required');
    const state = activeDownloads.get(downloadId);
    if (!state) throw new Error('Download session not found');
    return state;
  }));

  // Get All Active Downloads (for UI monitor)
  ipcMain.handle('get-active-downloads', wrapIpcHandler(async () => {
    return Array.from(activeDownloads.values());
  }));

  // Trigger loading state background
  loadTorrentsState(taskQueue);
}

const WELL_KNOWN_TRACKERS = [
  'http://nyaa.tracker.wf:7777/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.dler.org:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz'
];

async function resolveTorrentIdentifier(input) {
  let torrentId = input;
  if (!torrentId) return null;

  if (Buffer.isBuffer(torrentId)) {
    return torrentId;
  }

  if (typeof torrentId !== 'string') {
    return torrentId;
  }

  torrentId = torrentId.trim().replace(/^["']|["']$/g, '');

  // If already a clean magnet or infoHash, return it
  if (torrentId.startsWith('magnet:?') || /^[0-9a-fA-F]{40}$/.test(torrentId) || /^[A-Z2-7]{32}$/i.test(torrentId)) {
    return torrentId;
  }

  // If it is a local file path
  if (torrentId.endsWith('.torrent') && !torrentId.startsWith('http')) {
    try {
      const fileBuf = await fs.readFile(torrentId);
      if (fileBuf && fileBuf.length > 0) {
        if (fileBuf[0] === 100) return fileBuf;
        // Check gzip compressed .torrent
        if (fileBuf.length > 2 && fileBuf[0] === 0x1f && fileBuf[1] === 0x8b) {
          const zlib = require('zlib');
          const decompressed = zlib.gunzipSync(fileBuf);
          if (decompressed && decompressed[0] === 100) return decompressed;
        }
      }
    } catch(e) {}
  }

  // If it is an HTTP/HTTPS URL:
  if (torrentId.startsWith('http://') || torrentId.startsWith('https://')) {
    try {
      const axios = require('axios');
      const zlib = require('zlib');
      const https = require('https');

      const res = await axios.get(torrentId, {
        responseType: 'arraybuffer',
        timeout: 18000,
        maxRedirects: 10,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/x-bittorrent, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });

      let buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
      if (buf && buf.length > 2) {
        if (buf[0] === 0x1f && buf[1] === 0x8b) {
          try { buf = zlib.gunzipSync(buf); } catch (e) {}
        } else if (buf[0] === 0x78) {
          try { buf = zlib.inflateSync(buf); } catch (e) {}
        }
      }

      if (buf && buf.length > 0) {
        if (buf[0] === 100) { // 'd' in ASCII: valid bencoded .torrent dictionary
          log.info(`[resolveTorrentIdentifier] Successfully downloaded .torrent buffer from URL (${buf.length} bytes)`);
          return buf;
        }

        // It returned an HTML page (like TokyoTosho details.php or Nyaa view/XXXX)
        const text = buf.toString('utf-8');
        
        // 1. Try to extract Magnet URI from HTML
        const magnetMatch = text.match(/href=["'](magnet:\?[^"']+)["']/i) || 
                            text.match(/(magnet:\?xt=urn:btih:[a-zA-Z0-9%_\-\.\:\=\&]+)/i) ||
                            text.match(/(magnet:\?xt=urn:btmh:[a-zA-Z0-9%_\-\.\:\=\&]+)/i);
        if (magnetMatch) {
          const cleanMagnet = magnetMatch[1].replace(/&amp;/g, '&');
          log.info(`[resolveTorrentIdentifier] Extracted Magnet link from HTML page (${torrentId})`);
          return cleanMagnet;
        }

        // 2. Try to extract direct .torrent download link inside the page
        const torrentLinkMatch = text.match(/href=["'](https?:\/\/[^"']+\.torrent[^"']*)["']/i) ||
                                 text.match(/href=["'](\/download\/[^"']+\.torrent[^"']*)["']/i) ||
                                 text.match(/href=["']([^"']*download\.php\?[^"']+)["']/i);
        if (torrentLinkMatch) {
          let downloadUrl = torrentLinkMatch[1].replace(/&amp;/g, '&');
          if (downloadUrl.startsWith('/')) {
            const parsedOrigin = new URL(torrentId).origin;
            downloadUrl = parsedOrigin + downloadUrl;
          }
          log.info(`[resolveTorrentIdentifier] Extracted .torrent download URL (${downloadUrl}), downloading...`);
          const res2 = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            maxRedirects: 10,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'application/x-bittorrent, */*',
              'Accept-Encoding': 'gzip, deflate, br'
            }
          });
          let buf2 = Buffer.isBuffer(res2.data) ? res2.data : Buffer.from(res2.data);
          if (buf2 && buf2.length > 2) {
            if (buf2[0] === 0x1f && buf2[1] === 0x8b) {
              try { buf2 = zlib.gunzipSync(buf2); } catch (e) {}
            } else if (buf2[0] === 0x78) {
              try { buf2 = zlib.inflateSync(buf2); } catch (e) {}
            }
          }
          if (buf2 && buf2[0] === 100) {
            return buf2;
          }
        }

        // 3. Try to extract infoHash from HTML text
        const hashMatch = text.match(/xt=urn:btih:([0-9a-fA-F]{40})/i) ||
                          text.match(/data-hash=["']([0-9a-fA-F]{40})["']/i) ||
                          text.match(/info_hash=["']([0-9a-fA-F]{40})["']/i);
        if (hashMatch) {
          log.info(`[resolveTorrentIdentifier] Found infoHash ${hashMatch[1]} in HTML page`);
          return `magnet:?xt=urn:btih:${hashMatch[1]}`;
        }
      }
    } catch (err) {
      log.warn(`[resolveTorrentIdentifier] Failed to resolve URL "${torrentId}" manually:`, err.message);
    }

    // Fallback: If URL has a 40-char infoHash in path/query string, extract it
    const urlHashMatch = torrentId.match(/([0-9a-fA-F]{40})/i);
    if (urlHashMatch) {
      log.info(`[resolveTorrentIdentifier] Extracted infoHash ${urlHashMatch[1]} from URL path/query`);
      return `magnet:?xt=urn:btih:${urlHashMatch[1]}`;
    }
  }

  return torrentId;
}

function buildEnhancedTorrentId(torrentId) {
  if (typeof torrentId !== 'string') return torrentId;
  
  let hash = parseInfoHash(torrentId);
  if (!hash) return torrentId;

  if (torrentId.startsWith('magnet:?')) {
    // If it's already a magnet link, preserve all existing parameters and just append missing trackers
    let enhanced = torrentId;
    for (const tracker of WELL_KNOWN_TRACKERS) {
      const encoded = encodeURIComponent(tracker);
      if (!enhanced.includes(encoded) && !enhanced.includes(tracker)) {
        enhanced += `&tr=${encoded}`;
      }
    }
    return enhanced;
  }

  // If it is a raw hash
  const trackers = WELL_KNOWN_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(hash)}${trackers}`;
}

const activeDownloads = new Map();
const addingTorrents = new Map();
let downloadCounter = 0;
let torrentClientInstance = null;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(b32) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const c of b32.toUpperCase()) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out += ((value >>> bits) & 0xff).toString(16).padStart(2, "0");
      value &= (1 << bits) - 1;
    }
  }
  return out.length === 40 ? out : null;
}

function parseInfoHash(id) {
  if (!id || typeof id !== 'string') return null;
  // Raw 40 hex chars
  if (/^[0-9a-fA-F]{40}$/.test(id)) {
    return id.toLowerCase();
  }
  // Raw 32 base32 chars
  if (/^[A-Z2-7]{32}$/i.test(id)) {
    return base32ToHex(id) || id.toLowerCase();
  }
  // Magnet URI
  const match = id.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (match) {
    const hash = match[1];
    return hash.length === 32 ? base32ToHex(hash) : hash.toLowerCase();
  }
  return null;
}

function purgeStaleTorrents(client, targetHash, targetId) {
  if (!client || !Array.isArray(client.torrents)) return;
  const hash = (targetHash || parseInfoHash(targetId) || '').toLowerCase();

  for (let i = client.torrents.length - 1; i >= 0; i--) {
    const t = client.torrents[i];
    if (!t) {
      client.torrents.splice(i, 1);
      continue;
    }
    const tHash = (t.infoHash || '').toLowerCase();
    const isTarget = (hash && tHash === hash) || (targetId && (t.magnetURI === targetId || tHash === String(targetId).toLowerCase()));

    if (t.destroyed || (isTarget && t.destroyed)) {
      try {
        if (typeof t.destroy === 'function' && !t.destroyed) {
          t.destroy({ destroyStore: false });
        }
      } catch (e) {}
      client.torrents.splice(i, 1);
      if (client._torrents && tHash && client._torrents[tHash]) {
        delete client._torrents[tHash];
      }
    }
  }
}

function findMatchingTorrent(client, targetHash, targetId) {
  if (!client || !client.torrents) return null;
  const targetLower = (targetHash || parseInfoHash(targetId) || '').toLowerCase();

  for (let i = client.torrents.length - 1; i >= 0; i--) {
    const t = client.torrents[i];
    if (!t) {
      client.torrents.splice(i, 1);
      continue;
    }
    if (t.destroyed) {
      client.torrents.splice(i, 1);
      continue;
    }
    const tHash = (t.infoHash || '').toLowerCase();
    if (targetLower && tHash === targetLower) return t;
    if (t.magnetURI === targetId || (typeof targetId === 'string' && tHash === targetId.toLowerCase())) return t;
  }

  if (targetLower) {
    try {
      const byGet = client.get(targetLower);
      if (byGet && !byGet.destroyed) return byGet;
      if (byGet && byGet.destroyed) {
        try { client.remove(targetLower); } catch (e) {}
      }
    } catch (e) {}
  }
  if (targetId && typeof targetId === 'string') {
    try {
      const byGetId = client.get(targetId);
      if (byGetId && !byGetId.destroyed) return byGetId;
      if (byGetId && byGetId.destroyed) {
        try { client.remove(targetId); } catch (e) {}
      }
    } catch (e) {}
  }

  return null;
}

const activeGetOrAddPromises = new Map();

async function getOrAddTorrent(client, rawTorrentId, options, getData) {
  if (!client || client.destroyed) {
    throw new Error('WebTorrent client не инициализирован или был остановлен');
  }

  if (!rawTorrentId) {
    throw new Error('Не передан идентификатор торрента');
  }

  const normalizedRawId = typeof rawTorrentId === 'string' ? rawTorrentId.trim() : rawTorrentId;

  // 1. Check if we already have an active promise for this exact raw identifier
  if (activeGetOrAddPromises.has(normalizedRawId)) {
    log.info(`[getOrAddTorrent] Reusing active promise for rawTorrentId: ${normalizedRawId}`);
    return activeGetOrAddPromises.get(normalizedRawId);
  }

  const addPromise = (async () => {
    // A. Resolve raw identifier to magnet/buffer/filepath
    const torrentId = await resolveTorrentIdentifier(normalizedRawId);
    if (!torrentId) {
      throw new Error('Не передан валидный идентификатор торрента (URL, Magnet или .torrent файл).');
    }

    const hash = parseInfoHash(torrentId);

    // B. Check if we already have an active non-destroyed torrent in WebTorrent client
    let torrent = findMatchingTorrent(client, hash, torrentId);
    if (torrent && !torrent.destroyed) {
      log.info(`[getOrAddTorrent] Found existing active torrent in client for ${hash || torrentId}`);
      return torrent;
    }

    // Clean up any stale destroyed torrent from client internal collection
    purgeStaleTorrents(client, hash, torrentId);

    // C. Determine sourceId (use cached .torrent file if available)
    let sourceId = buildEnhancedTorrentId(torrentId);
    let isCached = false;

    if (hash) {
      try {
        const config = (await getData('config.json')) || {};
        const baseDir = config.baseDir || app.getPath('userData');
        const metaPath = path.join(baseDir, 'torrents_meta', `${hash}.torrent`);

        const stats = await fs.stat(metaPath).catch(() => null);
        if (stats && stats.isFile()) {
          sourceId = metaPath;
          isCached = true;
          log.info(`[getOrAddTorrent] Found cached .torrent metadata for ${hash}`);
        }
      } catch (e) {}
    }

    log.info(`[getOrAddTorrent] Adding torrent to client: ${isCached ? 'cached .torrent file' : (typeof sourceId === 'string' ? (sourceId.length > 100 ? sourceId.slice(0, 100) + '...' : sourceId) : 'buffer')}`);

    const addOptions = {
      ...options,
      announce: Array.from(new Set([...(options?.announce || []), ...WELL_KNOWN_TRACKERS]))
    };

    let t = null;
    try {
      t = client.add(sourceId, addOptions);
    } catch (syncErr) {
      const msg = syncErr.message || String(syncErr);
      const isDuplicate = /duplicate/i.test(msg) || /already/i.test(msg) || /exist/i.test(msg);

      if (isDuplicate) {
        log.warn(`[getOrAddTorrent] Caught sync duplicate torrent error for ${hash || torrentId}: ${msg}`);
        const match = msg.match(/([0-9a-fA-F]{40})/i);
        const resolvedHash = match ? match[1].toLowerCase() : hash;

        // 1. Check if an active living torrent exists
        const existing = findMatchingTorrent(client, resolvedHash, torrentId);
        if (existing && !existing.destroyed) {
          log.info(`[getOrAddTorrent] Reusing existing healthy torrent for duplicate ${resolvedHash || torrentId}`);
          return existing;
        }

        // 2. Otherwise purge the stale torrent and retry adding
        if (resolvedHash) {
          try { client.remove(resolvedHash); } catch (e) {}
        }
        purgeStaleTorrents(client, resolvedHash, torrentId);

        try {
          t = client.add(sourceId, addOptions);
        } catch (retryErr) {
          const finalCheck = findMatchingTorrent(client, resolvedHash, torrentId);
          if (finalCheck && !finalCheck.destroyed) return finalCheck;
          throw retryErr;
        }
      } else if (typeof sourceId === 'string' && sourceId.startsWith('http') && hash) {
        log.warn(`[getOrAddTorrent] Adding URL sourceId directly to client failed, falling back to constructed magnet URI with hash ${hash}: ${msg}`);
        const fallbackMagnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(hash)}${WELL_KNOWN_TRACKERS.map(tr => `&tr=${encodeURIComponent(tr)}`).join('')}`;
        try {
          t = client.add(fallbackMagnet, addOptions);
        } catch (magErr) {
          throw syncErr;
        }
      } else {
        throw syncErr;
      }
    }

    if (!t) {
      throw new Error('WebTorrent client.add() вернул пустой объект.');
    }

    // Attach non-fatal error handler so unhandled error events don't crash or reject
    t.on('error', (err) => {
      log.warn(`[WebTorrent Torrent Warning] ${t.infoHash || hash || ''}:`, err?.message || err);
    });

    const saveMetadata = async () => {
      if (!t.torrentFile || !t.infoHash) return;
      try {
        const config = (await getData('config.json')) || {};
        const baseDir = config.baseDir || app.getPath('userData');
        const metaDir = path.join(baseDir, 'torrents_meta');
        await fs.mkdir(metaDir, { recursive: true });
        const metaPath = path.join(metaDir, `${t.infoHash.toLowerCase()}.torrent`);
        await fs.writeFile(`${metaPath}.tmp`, t.torrentFile);
        await fs.rename(`${metaPath}.tmp`, metaPath);
        log.info(`[getOrAddTorrent] Cached metadata for ${t.infoHash}`);
      } catch (err) {
        log.warn(`[getOrAddTorrent] Failed to cache metadata for ${t.infoHash}`, err);
      }
    };

    if (t.metadata) {
      saveMetadata();
    } else {
      t.once('metadata', saveMetadata);
    }

    return t;
  })();

  activeGetOrAddPromises.set(normalizedRawId, addPromise);
  try {
    const t = await addPromise;
    if (!t || t.destroyed) {
      activeGetOrAddPromises.delete(normalizedRawId);
      // Double check if client has an active instance
      const living = findMatchingTorrent(client, parseInfoHash(normalizedRawId), normalizedRawId);
      if (living && !living.destroyed) {
        return living;
      }
      throw new Error('Экземпляр торрента равен null или был удален.');
    }
    return t;
  } catch (err) {
    activeGetOrAddPromises.delete(normalizedRawId);
    if (err && err.message) {
      if (err.message.includes('buffer[0] = 60') || err.message.includes('not a number: buffer[0] = 60')) {
        err.message = 'Сервер вернул HTML-страницу вместо торрент-файла (возможно, ссылка заблокирована, требует авторизации или защищена Cloudflare). Попробуйте скопировать Magnet-ссылку напрямую.';
      } else if (err.message.includes('not a number: buffer')) {
        err.message = 'Скачанный файл не является валидным торрент-файлом (неверный формат данных). Попробуйте использовать Magnet-ссылку.';
      } else if (err.message.includes('invalid bencode')) {
        err.message = 'Неверный формат торрент-файла (ошибка декодирования bencode).';
      }
    }
    throw err;
  } finally {
    activeGetOrAddPromises.delete(normalizedRawId);
    try {
      const torrentId = await resolveTorrentIdentifier(normalizedRawId);
      const hash = parseInfoHash(torrentId);
      if (hash) {
        activeGetOrAddPromises.delete(hash);
      }
    } catch (e) {}
  }
}

function setupTorrentHandlers(dlId, torrentId, fileIndex, torrent, torrentsDir, taskQueue) {
  let lastProgress = -1;
  let lastProgressTime = Date.now();
  let stalledInterval = null;
  let tickerInterval = null;

  const cleanupIntervals = () => {
    if (stalledInterval) { clearInterval(stalledInterval); stalledInterval = null; }
    if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
  };

  const handleMetadata = () => {
    if (!torrent || torrent.destroyed) return;
    log.info(`Torrent metadata loaded for session: ${dlId} / Name: ${torrent.name}`);
    const state = activeDownloads.get(dlId);
    if (state) {
      state.name = torrent.name || state.name;
      activeDownloads.set(dlId, state);
      if (taskQueue) {
        taskQueue.updateProgress(dlId, state.progress || 0, null, {
          title: `Торрент: ${state.name}`,
          filename: state.name
        });
      }
    }
    
    if (torrent.files) {
      torrent.files.forEach((file, index) => {
        // Select file if ANY active downloading or completed session of this torrent wants it
        const anyoneWants = Array.from(activeDownloads.values()).some(d => 
          (d.status === 'downloading' || d.status === 'resuming') && 
          (d.torrentId === torrentId || d.torrentId === torrent.infoHash || d.torrentId === torrent.magnetURI) && 
          (d.fileIndex === index || d.fileIndex === undefined || d.fileIndex === -1)
        );
        if (anyoneWants) {
          try { file.select(); } catch (e) {}
        } else {
          try { file.deselect(); } catch (e) {}
        }
      });
    }
  };

  if (torrent.ready || (torrent.files && torrent.files.length > 0)) {
    handleMetadata();
  } else {
    torrent.once('metadata', handleMetadata);
    torrent.once('ready', handleMetadata);
  }

  const updateProgress = () => {
    if (!torrent || torrent.destroyed) return;
    const state = activeDownloads.get(dlId);
    if (state && state.status === 'downloading') {
      let progress = 0;
      let speed = torrent.downloadSpeed || 0;
      let peers = torrent.numPeers || 0;
      
      if (torrent.files && fileIndex !== undefined && fileIndex >= 0 && fileIndex < torrent.files.length) {
        const f = torrent.files[fileIndex];
        progress = f.length > 0 ? Math.min(100, Math.round((f.downloaded / f.length) * 100)) : 0;
        if (f.name) state.name = f.name;
      } else {
        progress = Math.min(100, Math.round((torrent.progress || 0) * 100));
      }

      if (progress > lastProgress) {
        lastProgress = progress;
        lastProgressTime = Date.now();
      } else if (speed > 0) {
        lastProgressTime = Date.now();
      }
      
      state.progress = progress;
      state.downloadSpeed = speed;
      state.numPeers = peers;

      if (peers === 0) {
        state.warning = 'Поиск пиров (0 пиров)...';
      } else if (speed === 0 && progress < 100) {
        state.warning = 'Ожидание отдачи от пиров...';
      } else {
        state.warning = null;
      }

      activeDownloads.set(dlId, state);

      if (taskQueue) {
        taskQueue.updateProgress(dlId, progress, null, {
          title: `Торрент: ${state.name}`,
          speed: speed,
          numPeers: peers,
          filename: state.name
        });
      }
    }
  };

  const checkCompletion = async () => {
    if (!torrent || torrent.destroyed) return;
    const state = activeDownloads.get(dlId);
    if (!state || state.status !== 'downloading') return;
    
    let isDone = false;
    let targetFile = null;
    
    if (torrent.files && torrent.files.length > 0) {
      if (fileIndex !== undefined && fileIndex >= 0 && fileIndex < torrent.files.length) {
        targetFile = torrent.files[fileIndex];
        if (targetFile && targetFile.length > 0 && targetFile.downloaded >= targetFile.length) {
          isDone = true;
        }
      } else {
        if (torrent.progress >= 1 || (torrent.length > 0 && torrent.downloaded >= torrent.length)) {
          isDone = true;
          let maxSize = 0;
          for (const file of torrent.files) {
            if (file.length > maxSize) {
              maxSize = file.length;
              targetFile = file;
            }
          }
        }
      }
    }
    
    if (isDone && targetFile) {
      const fullPath = path.join(torrentsDir, targetFile.path);
      log.info(`Torrent download complete for session ${dlId}: ${fullPath}`);
      cleanupIntervals();
      state.progress = 100;
      state.downloadSpeed = 0;
      state.status = 'completed';
      state.warning = null;
      state.name = targetFile.name || state.name;
      state.filePath = fullPath;
      
      activeDownloads.set(dlId, state);
      saveTorrentsState();

      if (taskQueue) {
        taskQueue.completeExternalTask(dlId, { filePath: fullPath, fileName: state.name });
      }
    }
  };

  // Active progress ticker every 1s
  tickerInterval = setInterval(() => {
    updateProgress();
    checkCompletion();
  }, 1000);

  // Check for download stalling every 10 seconds (timeout after 10 minutes without speed/progress)
  const STALL_TIMEOUT_MS = 10 * 60 * 1000;
  stalledInterval = setInterval(() => {
    const state = activeDownloads.get(dlId);
    if (!state || state.status !== 'downloading') {
      cleanupIntervals();
      return;
    }

    const idleTime = Date.now() - lastProgressTime;
    if (idleTime > STALL_TIMEOUT_MS) {
      log.warn(`Torrent download session ${dlId} stalled for ${Math.round(idleTime / 1000)}s with 0 B/s. Cancelling.`);
      cleanupIntervals();
      state.status = 'error';
      state.error = 'Загрузка остановлена по таймауту: пропали пиры или разрыв соединения (10 минут без прогресса)';
      state.warning = null;
      activeDownloads.set(dlId, state);
      saveTorrentsState();
      if (taskQueue) {
        taskQueue.failExternalTask(dlId, state.error);
      }
    }
  }, 10000);

  torrent.on('download', () => {
    updateProgress();
    checkCompletion();
  });

  torrent.on('done', async () => {
    log.info(`Torrent done event received for session ${dlId}`);
    cleanupIntervals();
    updateProgress();
    await checkCompletion();
  });

  torrent.on('error', (err) => {
    log.error(`Torrent runtime error [Session: ${dlId} / Torrent: ${torrent.name}]:`, err);
    cleanupIntervals();
    const state = activeDownloads.get(dlId);
    if (state) {
      state.status = 'error';
      const msg = err ? (err.message || String(err)) : '';
      if (msg.includes('ENOENT') || msg.includes('no such file')) {
        state.error = 'Папка или файл торрента был удален пользователем.';
      } else {
        state.error = msg;
      }
      activeDownloads.set(dlId, state);
      saveTorrentsState();
      if (taskQueue) {
        taskQueue.failExternalTask(dlId, state.error);
      }
    }
  });

  // Run immediate checks in case the file is already fully loaded
  updateProgress();
  checkCompletion();
}

async function saveTorrentsState() {
  try {
    const data = Array.from(activeDownloads.values())
      .filter(d => d.status !== 'completed' && d.status !== 'error')
      .map(d => ({
        id: d.id,
        torrentId: d.torrentId,
        fileIndex: d.fileIndex
      }));
    await fs.writeFile(path.join(app.getPath('userData'), 'torrents_state.json'), JSON.stringify(data, null, 2));
  } catch (err) {
    log.error('Failed to save torrents state:', err);
  }
}

async function loadTorrentsState(taskQueue) {
  try {
    const p = path.join(app.getPath('userData'), 'torrents_state.json');
    const exists = await fs.access(p).then(()=>true).catch(()=>false);
    if (!exists) return;
    const raw = await fs.readFile(p, 'utf-8');
    let data = [];
    try {
      data = JSON.parse(raw);
    } catch (e) {
      log.error('Corrupt torrents_state.json:', e);
      return;
    }

    if (!Array.isArray(data)) return;

    for (const d of data) {
      if (d && d.torrentId && d.id) {
        log.info('Restoring resilient torrent download:', d.torrentId);
        // recreate activeDownload state
        activeDownloads.set(d.id, {
          id: d.id,
          torrentId: d.torrentId,
          fileIndex: d.fileIndex,
          name: 'Возобновление...',
          progress: 0,
          downloadSpeed: 0,
          numPeers: 0,
          status: 'downloading',
          filePath: null,
          error: null
        });

        if (taskQueue) {
          taskQueue.registerExternalTask(
            d.id,
            'torrent-download',
            { title: 'Загрузка торрента', dlId: d.id, torrentId: d.torrentId },
            () => {
              const state = activeDownloads.get(d.id);
              if (state) {
                state.status = 'cancelled';
                activeDownloads.set(d.id, state);
                saveTorrentsState();
              }
            }
          );
        }

        // Initialize download safely inside try/catch
        try {
          const client = await getTorrentClient();
          const config = await getData('config.json') || {};
          const baseDir = config.baseDir || app.getPath('userData');
          const torrentsDir = path.join(baseDir, 'torrents_temp');
          await fs.mkdir(torrentsDir, { recursive: true });

          const torrent = await getOrAddTorrent(client, d.torrentId, { path: torrentsDir, announce: WELL_KNOWN_TRACKERS }, getData);
          setupTorrentHandlers(d.id, d.torrentId, d.fileIndex, torrent, torrentsDir, taskQueue);
          
        } catch(e) {
           log.error('Failed restoring torrent download session:', e);
           const state = activeDownloads.get(d.id);
           if (state) {
              state.status = 'error';
              const msg = e.message || String(e);
              if (msg.includes('ENOENT') || msg.includes('no such file')) {
                state.error = 'Папка или файл торрента был удален пользователем.';
              } else {
                state.error = msg;
              }
              activeDownloads.set(d.id, state);
           }
           if (taskQueue) {
             taskQueue.failExternalTask(d.id, e.message || String(e));
           }
        }
      }
    }
    saveTorrentsState();
  } catch(err) {
    log.error('Failed to load torrents state:', err);
  }
}

async function getTorrentClient() {
  if (!torrentClientInstance || torrentClientInstance.destroyed) {
    try {
      const WebTorrentModule = await import('webtorrent');
      const WebTorrent = WebTorrentModule.default || WebTorrentModule;
      torrentClientInstance = new WebTorrent({
        maxConns: 500,
        dht: true,
        lsd: true,
        tracker: true,
        webSeeds: true
      });
      // Handle the global client-level errors to prevent unhandled node exceptions
      torrentClientInstance.on('error', (err) => {
        log.error('WebTorrent client encountered a general error:', err);
      });
    } catch (e) {
      log.error('Failed to load WebTorrent inside helper:', e);
      throw new Error(`Поддержка BitTorrent не установлена или не поддерживается на данной платформе: ${e.message}`);
    }
  }
  return torrentClientInstance;
}

async function cleanupSystemHandlers() {
  if (torrentClientInstance) {
    try {
      torrentClientInstance.destroy();
      torrentClientInstance = null;
      log.info('WebTorrent client destroyed.');
    } catch (e) {
      log.error('Error destroying WebTorrent client:', e);
    }
  }
}

module.exports = { registerSystemHandlers, cleanupSystemHandlers };
