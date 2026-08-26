const axios = require('axios');
const { ipcMain, BrowserWindow, session } = require('electron');
const log = require('electron-log');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const { translateText } = require('../services/translateService.cjs');
const { searchAnime, getAnimeDetails, getAnimeCharacters, getNextEpisodeDate } = require('../services/animeApiService.cjs');

function registerApiHandlers(getData, saveData) {
  ipcMain.handle('translate-text', wrapIpcHandler(async (event, { text, sourceLang, destLang }) => {
    if (!text) throw new Error('Missing text to translate');
    return await translateText(text, sourceLang, destLang);
  }));

  // Anime 365 Handlers
  ipcMain.handle('anime365-search-series', wrapIpcHandler(async (event, { query }) => {
    if (!query) throw new Error('Missing search query');
    const Anime365Service = require('../services/Anime365Service.cjs');
    return await Anime365Service.getSeries({ query, limit: 10 });
  }));

  ipcMain.handle('anime365-get-series-details', wrapIpcHandler(async (event, { id }) => {
    if (!id) throw new Error('Missing series ID');
    const Anime365Service = require('../services/Anime365Service.cjs');
    return await Anime365Service.getSeriesByID(id);
  }));

  ipcMain.handle('anime365-get-episode-translations', wrapIpcHandler(async (event, { seriesId, episodeNumber }) => {
    if (!seriesId || episodeNumber === undefined) throw new Error('Missing required arguments');
    const Anime365Service = require('../services/Anime365Service.cjs');
    const series = await Anime365Service.getSeriesByID(seriesId);
    if (!series || !series.episodes) return [];
    
    // Find matching episode
    const epNumStr = String(episodeNumber);
    const episodeObj = series.episodes.find(e => e.episodeInt === epNumStr || parseFloat(e.episodeInt) === parseFloat(episodeNumber));
    if (!episodeObj) return [];
    
    return await Anime365Service.getTranslations({ episodeId: episodeObj.id, limit: 100 });
  }));

  ipcMain.handle('anime365-update-project-data', wrapIpcHandler(async (event, { projectId }) => {
    if (!projectId) throw new Error('Missing project ID');
    const Anime365Service = require('../services/Anime365Service.cjs');
    const { getNextEpisodeDate, getEpisodesMetadata } = require('../services/animeApiService.cjs');
    const projects = await getData('projects.json');
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) throw new Error('Project not found');
    
    const project = projects[projectIndex];
    let anime365Id = project.anime365Id;
    
    if (!anime365Id) {
      log.info(`[Anime365] Attempting auto-matching for project: ${project.title}`);
      const matchedSeries = await Anime365Service.matchProjectToSeries(project.title, project.originalTitle);
      if (matchedSeries) {
        anime365Id = matchedSeries.id;
        project.anime365Id = anime365Id;
      }
    }
    
    if (anime365Id) {
      log.info(`[Anime365] Fetching details for matched series: ${anime365Id}`);
      const seriesDetails = await Anime365Service.getSeriesByID(anime365Id);
      if (seriesDetails) {
        project.synopsis = seriesDetails.descriptions?.[0]?.value || project.synopsis;
        project.posterUrl = seriesDetails.posterUrl || project.posterUrl;
        project.totalEpisodes = seriesDetails.numberOfEpisodes || project.totalEpisodes;
        project.isOngoing = seriesDetails.isAiring === 1 || seriesDetails.isAiring === true || project.isOngoing;
        project.typeAndSeason = seriesDetails.typeTitle || project.typeAndSeason;
        
        if (seriesDetails.year) {
          project.year = seriesDetails.year;
        }

        let existingLinks = {};
        try {
          if (project.links) existingLinks = JSON.parse(project.links);
        } catch(e) {}
        
        if (seriesDetails.url) {
          existingLinks['anime365'] = seriesDetails.url;
        }
        
        if (Array.isArray(seriesDetails.links)) {
          seriesDetails.links.forEach((l) => {
            const titleUpper = (l.title || '').trim().toUpperCase();
            if (titleUpper.includes('ШИКИМОРИ') || titleUpper.includes('SHIKIMORI')) {
              existingLinks['shikimori'] = l.url;
            } else if (titleUpper.includes('MYANIMELIST')) {
              existingLinks['mal'] = l.url;
            } else if (titleUpper.includes('ANILIST')) {
              existingLinks['anilist'] = l.url;
            } else if (titleUpper.includes('ANIDB')) {
              existingLinks['animedb'] = l.url;
            }
          });
        }
        
        project.links = JSON.stringify(existingLinks);
      }
    }

    // 1. Fetch next episode date automatically of this anime
    try {
      log.info(`[Anime365] Fetching next episode date for project: ${project.originalTitle || project.title}`);
      const nextEp = await getNextEpisodeDate(project.originalTitle || project.title);
      if (nextEp) {
        project.nextEpisodeDate = nextEp;
      }
    } catch (e) {
      log.error('[Anime365] Error fetching next episode date:', e.message);
    }

    // 2. Fetch metadata (titles, real broadcast dates) for ALL episodes
    try {
      log.info(`[Anime365] Fetching episodes metadata for project: ${project.title}`);
      const meta = await getEpisodesMetadata(project.title, project.originalTitle, project.anime365Id);
      
      const episodes = await getData('episodes.json');
      let updatedEpisodesCount = 0;
      
      const updatedEpisodes = episodes.map(ep => {
        if (ep.projectId === projectId) {
          const episodeMeta = meta[ep.number];
          if (episodeMeta) {
            let changed = false;
            if (episodeMeta.title && ep.title !== episodeMeta.title) {
              ep.title = episodeMeta.title;
              changed = true;
            }
            if (episodeMeta.airingDate && ep.airingDate !== episodeMeta.airingDate) {
              ep.airingDate = episodeMeta.airingDate;
              changed = true;

              // Re-calculate deadline based on airingDate if available
              const parts = episodeMeta.airingDate.split('.');
              if (parts.length === 3) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1;
                const year = parseInt(parts[2]);
                const airDateObj = new Date(year, month, day, 18, 0, 0);
                if (!isNaN(airDateObj.getTime())) {
                  let offset = 7;
                  if (project.isOngoing) {
                    if (project.releaseType === 'VOICEOVER') offset = 2;
                    else if (project.releaseType === 'RECAST' || project.releaseType === 'REDUB') offset = 3;
                  }
                  const deadlineDate = new Date(airDateObj.getTime());
                  deadlineDate.setDate(airDateObj.getDate() + offset);
                  ep.deadline = deadlineDate.toISOString();
                }
              }
            }

            // Deduplicate assignments and keep the latest (last) assignment for each character
            if (ep.assignments && Array.isArray(ep.assignments)) {
              let newAssignments = [];
              const seenChars = new Map();
              for (let i = ep.assignments.length - 1; i >= 0; i--) {
                const as = ep.assignments[i];
                if (as.substituteId) {
                  newAssignments.unshift(as); // Keep substitutes always
                } else {
                  if (!seenChars.has(as.characterName)) {
                    seenChars.set(as.characterName, true);
                    newAssignments.unshift(as);
                  }
                }
              }
              if (newAssignments.length !== ep.assignments.length) {
                ep.assignments = newAssignments;
                changed = true;
              }
            }

            if (changed) {
              ep.updatedAt = new Date().toISOString();
              updatedEpisodesCount++;
            }
          }
        }
        return ep;
      });

      if (updatedEpisodesCount > 0) {
        log.info(`[Anime365] Successfully updated ${updatedEpisodesCount} existing episodes with titles/dates`);
        await saveData('episodes.json', updatedEpisodes);
      }
    } catch (e) {
      log.error('[Anime365] Error updating existing episodes metadata:', e.message);
    }
    
    project.updatedAt = new Date().toISOString();
    projects[projectIndex] = project;
    await saveData('projects.json', projects);
    
    return project;
  }));

  // Anime 365 Direct Video/Raw Downloader map
  const activeDirectDownloads = new Map();

  function timemarkToSeconds(timemark) {
    if (!timemark || typeof timemark !== 'string') return 0;
    const parts = timemark.split(':');
    if (parts.length === 3) {
      const hrs = parseFloat(parts[0]) || 0;
      const mins = parseFloat(parts[1]) || 0;
      const secs = parseFloat(parts[2]) || 0;
      return hrs * 3600 + mins * 60 + secs;
    }
    return 0;
  }

  async function syncAnime365Cookies(targetOrigin) {
    if (typeof session === 'undefined' || !session.defaultSession || typeof session.defaultSession.cookies?.get !== 'function') {
      return;
    }
    try {
      const KNOWN_MIRRORS = [
        'https://smotret-anime.app',
        'https://smotret-anime.ru',
        'https://smotret-anime-365.ru',
        'https://smotret-anime.org',
        'https://smotret-anime.com'
      ];

      // 1. Replicate manually entered config cookies across all known mirrors
      try {
        const config = await getData('config.json');
        if (config && config.anime365_cookie) {
          const manualCookieStr = config.anime365_cookie.trim();
          if (manualCookieStr) {
            const parsedPairs = manualCookieStr.split(';').map(p => p.trim());
            for (const pair of parsedPairs) {
              const eqIdx = pair.indexOf('=');
              if (eqIdx !== -1) {
                const name = pair.substring(0, eqIdx).trim();
                const value = pair.substring(eqIdx + 1).trim();
                if (name && value) {
                  for (const mirror of KNOWN_MIRRORS) {
                    try {
                      await session.defaultSession.cookies.set({
                        url: mirror,
                        name,
                        value,
                        path: '/',
                        secure: true,
                        httpOnly: false,
                        expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 3600) // 1 year
                      });
                    } catch (e) {}
                  }
                }
              }
            }
          }
        }
      } catch (configEx) {
        log.warn(`[Anime365 Cookie Sync] Could not parse config cookies: ${configEx.message}`);
      }

      // 2. Fetch all cookies in the session store
      const allCookies = await session.defaultSession.cookies.get({});
      if (!allCookies || allCookies.length === 0) return;
      
      const animeCookies = allCookies.filter(c => {
        const domain = c.domain || '';
        return domain.includes('smotret-anime') || domain.includes('anime365');
      });
      if (animeCookies.length === 0) return;

      // 3. Find the mirror domain that currently holds are logged-in token
      let loggedInMirror = null;
      let loggedInCookies = [];

      for (const mirror of KNOWN_MIRRORS) {
        const mirrorHost = new URL(mirror).hostname;
        const mirrorCookies = animeCookies.filter(c => {
          const cd = (c.domain || '').replace(/^\./, '');
          return mirrorHost.endsWith(cd);
        });
        
        const hasLoginToken = mirrorCookies.some(c => c.name === 'remember_user_token' && c.value);
        if (hasLoginToken) {
          loggedInMirror = mirror;
          loggedInCookies = mirrorCookies;
          break;
        }
      }

      // Fallback check: find mirror with PHPSESSID if no remember_user_token
      if (!loggedInMirror) {
        for (const mirror of KNOWN_MIRRORS) {
          const mirrorHost = new URL(mirror).hostname;
          const mirrorCookies = animeCookies.filter(c => {
            const cd = (c.domain || '').replace(/^\./, '');
            return mirrorHost.endsWith(cd);
          });
          const hasSession = mirrorCookies.some(c => c.name === 'PHPSESSID' && c.value);
          if (hasSession) {
            loggedInMirror = mirror;
            loggedInCookies = mirrorCookies;
            break;
          }
        }
      }

      // 4. Replicate from authority mirror to all other known mirrors
      if (loggedInMirror && loggedInCookies.length > 0) {
        log.info(`[Anime365 Cookie Sync] Found logged-in authority mirror: ${loggedInMirror}. Syncing active session cookies to other mirrors.`);
        
        for (const mirror of KNOWN_MIRRORS) {
          if (mirror === loggedInMirror) continue;
          
          for (const cookie of loggedInCookies) {
            // Only synchronize essential auth and session state cookies
            const isAuthCookie = ['remember_user_token', 'PHPSESSID', 'csrf', 'guestId'].includes(cookie.name);
            if (!isAuthCookie) continue;

            const newCookie = {
              url: mirror,
              name: cookie.name,
              value: cookie.value,
              path: '/',
              secure: true,
              httpOnly: !!cookie.httpOnly
            };
            if (cookie.expirationDate) {
              newCookie.expirationDate = cookie.expirationDate;
            }
            try {
              await session.defaultSession.cookies.set(newCookie);
            } catch (setErr) {
              log.warn(`[Anime365 Cookie Sync] Failed to sync cookie ${cookie.name} to ${mirror}: ${setErr.message}`);
            }
          }
        }
      }
    } catch (err) {
      log.error(`[Anime365 Cookie Sync] General error: ${err.message}`);
    }
  }

  async function extractDirectStreamUrl(url, depth = 0, jobLog = null) {
    const logger = {
      info: (msg) => {
        log.info(msg);
        if (jobLog) jobLog(`[INFO] [Depth ${depth}] ${msg}`);
      },
      warn: (msg) => {
        log.warn(msg);
        if (jobLog) jobLog(`[WARN] [Depth ${depth}] ${msg}`);
      },
      error: (msg) => {
        log.error(msg);
        if (jobLog) jobLog(`[ERROR] [Depth ${depth}] ${msg}`);
      }
    };

    if (depth > 2) {
      logger.info(`Max depth reached at depth=${depth}. Stopping.`);
      return null;
    }
    try {
      logger.info(`Inspecting URL: ${url}`);
      const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': url
      };

      // 1. Try to fetch cookies from active Electron session
      let sessionCookieStr = '';
      try {
        const urlParsed = new URL(url);
        const origin = urlParsed.origin;
        await syncAnime365Cookies(origin);
        if (typeof session !== 'undefined' && session.defaultSession && typeof session.defaultSession.cookies?.get === 'function') {
          const sessionCookies = await session.defaultSession.cookies.get({ url: origin });
          if (sessionCookies && sessionCookies.length > 0) {
            sessionCookieStr = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
            logger.info(`Extracted ${sessionCookies.length} cookies from default Electron session for ${origin}`);
          }
        }
      } catch (cookieEx) {
        logger.warn(`Could not extract session cookies: ${cookieEx.message}`);
      }

      // 2. Try to fetch manually entered cookies from configuration
      let manualCookieStr = '';
      try {
        const config = await getData('config.json');
        if (config && config.anime365_cookie) {
          manualCookieStr = config.anime365_cookie.trim();
          logger.info(`Loaded custom cookie from configuration`);
        }
      } catch (configEx) {
        logger.warn(`Could not load custom cookie: ${configEx.message}`);
      }

      // 3. Combine both cookie sets
      const combinedCookies = [sessionCookieStr, manualCookieStr].filter(Boolean).join('; ');
      if (combinedCookies) {
        requestHeaders['Cookie'] = combinedCookies;
        logger.info(`Injected cookies into request headers.`);
      } else {
        logger.info(`No cookies found for request.`);
      }
      
      logger.info(`Request Headers: ${JSON.stringify(requestHeaders, null, 2)}`);

      const axiosInstance = axios.create({
        headers: requestHeaders,
        timeout: 12000,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400
      });

      let response;
      try {
        response = await axiosInstance({
          method: 'get',
          url: url,
          responseType: 'stream'
        });
      } catch (getErr) {
        logger.error(`GET request failed: ${getErr.message}`);
        if (getErr.response) {
          logger.error(`Error response status: ${getErr.response.status}`);
          logger.error(`Error response headers: ${JSON.stringify(getErr.response.headers, null, 2)}`);
        }
        return null;
      }

      const status = response.status;
      const statusText = response.statusText;
      const responseHeaders = response.headers;
      const contentType = responseHeaders['content-type'] || '';
      const finalUrl = response.request?.res?.responseUrl || url;
      
      logger.info(`Response Status: ${status} ${statusText}`);
      logger.info(`Response Headers: ${JSON.stringify(responseHeaders, null, 2)}`);
      logger.info(`Content-Type: ${contentType}, Final URL: ${finalUrl}`);

      if (
        contentType.toLowerCase().startsWith('video/') ||
        finalUrl.split('?')[0].endsWith('.mp4') ||
        finalUrl.split('?')[0].endsWith('.m3u8')
      ) {
        logger.info(`Direct stream link detected! returning: ${finalUrl}`);
        if (response.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
        return finalUrl;
      }

      let html = '';
      try {
        html = await new Promise((resolve, reject) => {
          let accumulated = '';
          const stream = response.data;
          stream.on('data', chunk => {
            accumulated += chunk.toString('utf8');
            if (accumulated.length > 2 * 1024 * 1024) {
              logger.warn(`Response body exceeded 2MB, destroying stream.`);
              stream.destroy();
              resolve(accumulated);
            }
          });
          stream.on('end', () => resolve(accumulated));
          stream.on('error', err => reject(err));
          setTimeout(() => {
            logger.warn(`Response body timeout reached (4s), partial body size: ${accumulated.length} bytes`);
            stream.destroy();
            resolve(accumulated);
          }, 4000);
        });
      } catch (streamErr) {
        logger.warn(`Stream read warning: ${streamErr.message}`);
      }

      if (!html) {
        logger.warn(`Failed to retrieve HTML body content from: ${url}`);
        return null;
      }

      logger.info(`Read body size: ${html.length} bytes.`);
      logger.info(`Body snippet (first 1500 chars):\n${html.substring(0, 1500)}`);

      const foundUrls = [];

      // Helper function to resolve relative URLs using active domain context
      const resolveUrl = (foundUrl) => {
        if (!foundUrl) return null;
        if (foundUrl.startsWith('//')) {
          return 'https:' + foundUrl;
        }
        if (foundUrl.startsWith('/') && !foundUrl.startsWith('//')) {
          try {
            const parsedOrigin = new URL(url);
            return parsedOrigin.origin + foundUrl;
          } catch (e) {
            return null;
          }
        }
        if (foundUrl.startsWith('http')) {
          return foundUrl;
        }
        // Relative reference without leading slash like "upload/video"
        if (!foundUrl.startsWith('http') && !foundUrl.startsWith('/') && !foundUrl.includes('javascript:')) {
          try {
            const parsedOrigin = new URL(url);
            return parsedOrigin.origin + '/' + foundUrl;
          } catch (e) {
            return null;
          }
        }
        return null;
      };

      // Pattern 1: Match any absolute links to m3u8 or mp4
      const directPattern = /(https?:)?\/\/[^"'\s$<>#]+?\.(?:m3u8|mp4)(?:\?[^"'\s$<>#]*)?/gi;
      let match;
      let pattern1Count = 0;
      while ((match = directPattern.exec(html)) !== null) {
        const resolved = resolveUrl(match[0]);
        if (resolved) {
          pattern1Count++;
          if (!foundUrls.includes(resolved)) {
            foundUrls.push(resolved);
          }
        }
      }
      logger.info(`Pattern 1 (direct links) matched: ${pattern1Count} matches.`);

      // Pattern 2: Match flexible JSON configurations like file: "..." or "file": "..." or src: "..." or "src": "..."
      const playerConfigPattern = /(?:"file"|'file'|\bfile|'src'|"src"|\bsrc)\s*:\s*["']([^"']+)["']/gi;
      let pattern2Count = 0;
      while ((match = playerConfigPattern.exec(html)) !== null) {
        const resolved = resolveUrl(match[1]);
        if (resolved) {
          pattern2Count++;
          if (!foundUrls.includes(resolved)) {
            foundUrls.push(resolved);
          }
        }
      }
      logger.info(`Pattern 2 (JSON file/src) matched: ${pattern2Count} matches.`);

      // Pattern 3: Universal quoted strings ending with .mp4 or .m3u8
      const quotedMediaPattern = /(?:"|')([^"'\s$<>#]+\.(?:m3u8|mp4)(?:\?[^"'\s$<>#]*)?)(?:"|')/gi;
      let pattern3Count = 0;
      while ((match = quotedMediaPattern.exec(html)) !== null) {
        const resolved = resolveUrl(match[1]);
        if (resolved) {
          pattern3Count++;
          if (!foundUrls.includes(resolved)) {
            foundUrls.push(resolved);
          }
        }
      }
      logger.info(`Pattern 3 (quoted media) matched: ${pattern3Count} matches.`);

      logger.info(`Current accumulated direct candidates on URL ${url}: ${JSON.stringify(foundUrls)}`);

      if (foundUrls.length > 0) {
        const m3u8s = foundUrls.filter(u => u.includes('.m3u8'));
        const mp4s = foundUrls.filter(u => u.includes('.mp4'));

        const sortByQuality = (arr) => {
          return arr.sort((a, b) => {
            const scoreA = (a.includes('1080') || a.includes('1085')) ? 3 : (a.includes('720') ? 2 : (a.includes('480') ? 1 : 0));
            const scoreB = (b.includes('1080') || b.includes('1085')) ? 3 : (b.includes('720') ? 2 : (b.includes('480') ? 1 : 0));
            return scoreB - scoreA;
          });
        };

        if (m3u8s.length > 0) {
          const chosen = sortByQuality(m3u8s)[0];
          logger.info(`Choosing highest quality m3u8 candidate: ${chosen}`);
          return chosen;
        }
        if (mp4s.length > 0) {
          const chosen = sortByQuality(mp4s)[0];
          logger.info(`Choosing highest quality mp4 candidate: ${chosen}`);
          return chosen;
        }
      }

      // Pattern 4: Recursively follow iframe elements
      const iframePattern = /<iframe[^>]+src=["']([^"']+)["']/gi;
      const iframeUrls = [];
      while ((match = iframePattern.exec(html)) !== null) {
        const resolvedIframe = resolveUrl(match[1]);
        if (resolvedIframe && !iframeUrls.includes(resolvedIframe)) {
          iframeUrls.push(resolvedIframe);
        }
      }

      logger.info(`Pattern 4 (iframe sources) found: ${iframeUrls.length} frames. Frame list: ${JSON.stringify(iframeUrls)}`);

      for (const iframeUrl of iframeUrls) {
        logger.info(`Recursing into iframe: ${iframeUrl}`);
        const nestedUrl = await extractDirectStreamUrl(iframeUrl, depth + 1, jobLog);
        if (nestedUrl) {
          logger.info(`Found nested stream URL in iframe recursive call! URL: ${nestedUrl}`);
          return nestedUrl;
        }
      }

      logger.info(`No video stream URL extracted from URL: ${url}`);
      return null;
    } catch (err) {
      logger.error(`Error extracting at depth ${depth}: ${err.stack || err.message}`);
      return null;
    }
  }

  // Start Direct Download
  ipcMain.handle('anime365-start-direct-download', wrapIpcHandler(async (event, { url, fallbackUrl, fallbackUrls, targetDir, fileName, episodeId }) => {
    if (!url || !targetDir || !fileName) throw new Error('Missing required downloader parameters');
    
    const dlId = 'direct-dl-' + Date.now();
    const jobLogs = [];
    
    const state = {
      id: dlId,
      fileName,
      status: 'searching',
      progress: 0,
      downloadSpeed: '0 KB/s',
      downloadedBytes: '0 MB',
      totalBytes: 'Unknown',
      error: null,
      ffmpegCommand: null,
      logs: jobLogs
    };

    const jobLog = (msg) => {
      const formatted = `[${new Date().toLocaleTimeString()}] ${msg}`;
      jobLogs.push(formatted);
      state.logs = jobLogs;
      activeDirectDownloads.set(dlId, state);
      try {
        event.sender.send('direct-download-progress-event', state);
      } catch (e) {}
    };

    activeDirectDownloads.set(dlId, state);

    // Запуск фоновой загрузки с динамическим переключением источников
    (async () => {
      try {
        jobLog(`Starting download job: ${dlId}`);
        
        // Формируем список всех доступных URL-зеркал для последовательного скачивания в случае низкой скорости/зависания
        const urlsToTry = [url];
        if (Array.isArray(fallbackUrls)) {
          fallbackUrls.forEach(u => {
            if (u && !urlsToTry.includes(u)) urlsToTry.push(u);
          });
        } else if (fallbackUrl) {
          if (!urlsToTry.includes(fallbackUrl)) urlsToTry.push(fallbackUrl);
        }

        jobLog(`Список доступных источников для скачивания (всего: ${urlsToTry.length}):`);
        urlsToTry.forEach((u, i) => jobLog(`[Источник #${i + 1}] ${u}`));

        let currentUrlIndex = 0;
        let downloadSuccess = false;
        let lastError = null;

        const fsPromises = require('fs/promises');
        const path = require('path');
        const app = require('electron').app;
        const config = await getData('config.json');
        const baseDir = config.baseDir || app.getPath('userData');
        const fullTargetDir = path.isAbsolute(targetDir) ? targetDir : path.join(baseDir, targetDir);

        jobLog(`Создание директории: ${fullTargetDir}`);
        await fsPromises.mkdir(fullTargetDir, { recursive: true });
        const fullTargetFile = path.join(fullTargetDir, fileName);

        while (currentUrlIndex < urlsToTry.length && !downloadSuccess) {
          const currentSourceUrl = urlsToTry[currentUrlIndex];
          jobLog(`[Запуск] Попытка #${currentUrlIndex + 1}/${urlsToTry.length} скачивания с URL: ${currentSourceUrl}`);
          
          let streamUrl = null;
          try {
            jobLog(`Извлечение прямого потока для источника #${currentUrlIndex + 1}...`);
            streamUrl = await extractDirectStreamUrl(currentSourceUrl, 0, jobLog);
          } catch (e) {
            jobLog(`[Ошибка извлечения] Источник #${currentUrlIndex + 1} вернул ошибку: ${e.message}`);
          }

          if (!streamUrl) {
            jobLog(`[Пропуск] Не удалось извлечь рабочий поток из источника #${currentUrlIndex + 1}. Переход к следующему...`);
            currentUrlIndex++;
            continue;
          }

          jobLog(`[Поток найден] Успешно извлечён медиа-поток: ${streamUrl}`);
          state.status = 'downloading';
          state.downloadSpeed = '0 KB/s';
          activeDirectDownloads.set(dlId, state);

          // Удаляем остатки предыдущего файла при смене источника
          try {
            await fsPromises.unlink(fullTargetFile);
            jobLog(`Удалён временный файл от предыдущей попытки.`);
          } catch (e) {}

          const ffmpeg = require('fluent-ffmpeg');
          let duration = 0;
          let headersString = `Referer: ${currentSourceUrl}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\n`;

          try {
            let sessionCookieStr = '';
            const streamUrlObj = new URL(streamUrl);
            const origin = streamUrlObj.origin;
            if (typeof session !== 'undefined' && session.defaultSession && typeof session.defaultSession.cookies?.get === 'function') {
              const sessionCookies = await session.defaultSession.cookies.get({ url: origin });
              if (sessionCookies && sessionCookies.length > 0) {
                sessionCookieStr = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
              }
            }
            let customCookieStr = (config && config.anime365_cookie) || '';
            const combinedCookies = [sessionCookieStr, customCookieStr].filter(Boolean).join('; ');
            if (combinedCookies) {
              headersString += `Cookie: ${combinedCookies}\r\n`;
              jobLog(`Куки авторизации успешно инжектированы в заголовки ffmpeg.`);
            }
          } catch (cookieEx) {
            jobLog(`Ошибка инжектирования куки: ${cookieEx.message}`);
          }

          jobLog(`Зондирование параметров потока...`);
          try {
            await new Promise((resolve) => {
              ffmpeg.ffprobe(streamUrl, ['-headers', headersString], (probeErr, metadata) => {
                if (!probeErr && metadata && metadata.format) {
                  duration = metadata.format.duration || 0;
                  jobLog(`Длительность медиа: ${duration.toFixed(1)} сек.`);
                } else {
                  jobLog(`Предупреждение ffprobe: ${probeErr ? probeErr.message : 'Метаданные пусты'}`);
                }
                resolve();
              });
            });
          } catch (probeEx) {
            jobLog(`Ошибка ffprobe: ${probeEx.message}`);
          }

          const cmd = ffmpeg(streamUrl);
          if (streamUrl.startsWith('http')) {
            cmd.inputOptions(['-headers', headersString]);
          }
          cmd.outputOptions('-c copy')
            .outputOptions('-bsf:a aac_adtstoasc')
            .output(fullTargetFile);

          state.ffmpegCommand = cmd;
          activeDirectDownloads.set(dlId, state);

          let lastLoggedProgress = -10;
          let lastProgressTime = Date.now();
          let lastTargetSize = 0;
          let lastNonZeroProgressTime = Date.now();
          let downloadStartTime = Date.now();
          let ffmpegKillTriggered = false;

          const downloadPromise = new Promise((resolve, reject) => {
            cmd.on('start', (commandLine) => {
              jobLog(`Запущен процесс ffmpeg для источника #${currentUrlIndex + 1}`);
            })
            .on('progress', (prog) => {
              if (state.status === 'cancelled') {
                reject(new Error('USER_CANCELLED'));
                return;
              }
              if (ffmpegKillTriggered) return;

              state.status = 'downloading';
              
              if (duration > 0 && prog.timemark) {
                const currentSecs = timemarkToSeconds(prog.timemark);
                state.progress = Math.min(99, Math.round((currentSecs / duration) * 100));
              } else if (prog.percent) {
                state.progress = Math.min(99, Math.round(prog.percent));
              } else {
                state.progress = Math.min(99, Math.max(state.progress, Math.min(95, (state.progress || 0) + 1)));
              }

              if (prog.targetSize) {
                state.downloadedBytes = `${(prog.targetSize / 1024).toFixed(1)} MB`;
              }

              // Вычисление скорости скачивания и детекция зависания (stall)
              const now = Date.now();
              const timeDiffSec = (now - lastProgressTime) / 1000;
              if (timeDiffSec >= 1.0) {
                const bytesDiff = (prog.targetSize || 0) - lastTargetSize;
                let speedKBps = 0;
                if (bytesDiff >= 0) {
                  speedKBps = bytesDiff / timeDiffSec;
                }
                
                lastProgressTime = now;
                lastTargetSize = prog.targetSize || 0;

                if (speedKBps > 1024) {
                  state.downloadSpeed = `${(speedKBps / 1024).toFixed(2)} MB/s`;
                } else {
                  state.downloadSpeed = `${speedKBps.toFixed(1)} KB/s`;
                }

                // Если скорость выше 15 KB/s, обновляем метку времени активной загрузки
                if (speedKBps > 15) {
                  lastNonZeroProgressTime = now;
                }

                // Проверка зависания: если прошло более 12 секунд со старта
                // и скорость скачивания упала до критически малой (< 15 KB/s) на протяжении более 10 секунд
                const elapsedSinceStart = now - downloadStartTime;
                if (elapsedSinceStart > 12000) {
                  const stallDuration = now - lastNonZeroProgressTime;
                  if (stallDuration > 12000 || (speedKBps < 15 && (now - lastNonZeroProgressTime) > 10000)) {
                    jobLog(`[Stall Warning] Скорость упала до ${state.downloadSpeed}. Зависание в течение ${Math.round(stallDuration / 1000)} сек. Автоматически переключаем источник...`);
                    ffmpegKillTriggered = true;
                    reject(new Error('SPEED_STALL'));
                    return;
                  }
                }
              }

              activeDirectDownloads.set(dlId, state);

              const roundedProgress = Math.floor(state.progress / 10) * 10;
              if (roundedProgress >= lastLoggedProgress + 10) {
                lastLoggedProgress = roundedProgress;
                jobLog(`Скачивание: ${state.progress}% (Размер: ${state.downloadedBytes}, Скорость: ${state.downloadSpeed})`);
              }

              try {
                event.sender.send('direct-download-progress-event', state);
              } catch (sendEx) {}
            })
            .on('end', () => {
              jobLog(`Источник #${currentUrlIndex + 1} успешно скачан на 100%!`);
              resolve();
            })
            .on('error', (err) => {
              if (state.status === 'cancelled') {
                reject(new Error('USER_CANCELLED'));
                return;
              }
              if (ffmpegKillTriggered) return;
              reject(err);
            })
            .run();

            // Периодическая проверка полной остановки прогресс-событий (зависание сокета)
            const fallbackCheckInterval = setInterval(() => {
              if (state.status === 'cancelled' || downloadSuccess) {
                clearInterval(fallbackCheckInterval);
                return;
              }
              const now = Date.now();
              const elapsedSinceStart = now - downloadStartTime;
              const timeSinceLastProgress = now - lastProgressTime;
              
              if (elapsedSinceStart > 15000 && timeSinceLastProgress > 12000 && !ffmpegKillTriggered) {
                jobLog(`[Stall Warning] Нет прогресс-событий более 12 сек. Переключаем на альтернативный источник...`);
                ffmpegKillTriggered = true;
                clearInterval(fallbackCheckInterval);
                reject(new Error('SPEED_STALL'));
              }
            }, 5000);
          });

          try {
            await downloadPromise;
            downloadSuccess = true;
          } catch (err) {
            // Принудительно убиваем запущенный ffmpeg перед переходом к следующему зеркалу
            if (cmd && typeof cmd.kill === 'function') {
              try { cmd.kill('SIGKILL'); } catch (killErr) {}
            }

            if (err.message === 'USER_CANCELLED') {
              jobLog(`Загрузка отменена пользователем.`);
              state.status = 'cancelled';
              activeDirectDownloads.set(dlId, state);
              return;
            }

            lastError = err;
            jobLog(`[Внимание] Ошибка/зависание на источнике #${currentUrlIndex + 1}: ${err.message}`);
            currentUrlIndex++; // Переходим к следующему индексу
          }
        }

        if (downloadSuccess) {
          jobLog(`Все потоки обработаны. Файл сохранен: ${fullTargetFile}`);
          state.status = 'completed';
          state.progress = 100;
          state.filePath = fullTargetFile;
          activeDirectDownloads.set(dlId, state);
          try {
            event.sender.send('direct-download-progress-event', state);
          } catch (sendEx) {}
        } else {
          throw lastError || new Error('Все доступные источники вернули ошибку или имели слишком низкую скорость скачивания.');
        }

      } catch (err) {
        jobLog(`Download job execution failed. Error: ${err.message}`);
        state.status = 'error';
        state.error = err.message || 'Ошибка потокового скачивания';
        activeDirectDownloads.set(dlId, state);
        try {
          event.sender.send('direct-download-progress-event', state);
        } catch (sendEx) {}
      }
    })();

    return { downloadId: dlId };
  }));

  // Get status of current direct download
  ipcMain.handle('anime365-get-direct-download-status', wrapIpcHandler(async (event, { downloadId }) => {
    if (!downloadId) throw new Error('Download ID is required');
    const state = activeDirectDownloads.get(downloadId);
    if (!state) throw new Error('Download job not found');
    
    // Create copy without command reference to avoid IPC serializer crash
    const { ffmpegCommand, ...serializable } = state;
    return serializable;
  }));

  // Cancel direct download
  ipcMain.handle('anime365-cancel-direct-download', wrapIpcHandler(async (event, { downloadId }) => {
    if (!downloadId) throw new Error('Download ID is required');
    const state = activeDirectDownloads.get(downloadId);
    if (state) {
      log.info(`[Anime365] Cancelling direct download: ${downloadId}`);
      state.status = 'cancelled';
      if (state.ffmpegCommand && typeof state.ffmpegCommand.kill === 'function') {
        try {
          state.ffmpegCommand.kill('SIGKILL');
        } catch (e) {
          log.warn(`Could not kill ffmpeg download for ${downloadId}:`, e.message);
        }
      }
      activeDirectDownloads.set(downloadId, state);
    }
    return { success: true };
  }));

  ipcMain.handle('anime365-open-auth-window', wrapIpcHandler(async (event, { url }) => {
    let authUrl = url;
    if (!authUrl) {
      let activeHost = 'https://smotret-anime.app';
      try {
        const Anime365Service = require('../services/Anime365Service.cjs');
        const activeApiBase = await Anime365Service.getActiveApiBase();
        activeHost = activeApiBase.replace('/api', '');
      } catch (e) {
        log.warn(`Could not get active host for login window: ${e.message}`);
      }
      authUrl = `${activeHost}/users/login`;
    }
    
    log.info(`[Anime365 Auth] Opening auth window for: ${authUrl}`);
    
    // Check if we are running the real Electron BrowserWindow
    if (typeof BrowserWindow === 'undefined' || typeof BrowserWindow.prototype.loadURL !== 'function') {
      log.info(`[Anime365 Auth] Detected mock environment (Express/web). Cannot open native BrowserWindow. Returning URL.`);
      return { success: false, url: authUrl, message: 'Пожалуйста, откройте ссылку во вкладке браузера и выполните вход.' };
    }

    return new Promise((resolve) => {
      let win = new BrowserWindow({
        width: 1024,
        height: 768,
        title: 'Авторизация Anime365',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      win.loadURL(authUrl);

      win.on('closed', () => {
        win = null;
        resolve({ success: true, message: 'Окно авторизации закрыто' });
      });
    });
  }));

  ipcMain.handle('anime365-get-auth-status', wrapIpcHandler(async (event, { url }) => {
    let targetUrl = url;
    if (!targetUrl) {
      let activeHost = 'https://smotret-anime.app';
      try {
        const Anime365Service = require('../services/Anime365Service.cjs');
        const activeApiBase = await Anime365Service.getActiveApiBase();
        activeHost = activeApiBase.replace('/api', '');
      } catch (e) {
        log.warn(`Could not get active host for auth status check: ${e.message}`);
      }
      targetUrl = activeHost;
    }

    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    
    // First synchronize cookies before we retrieve them
    await syncAnime365Cookies(origin);
    
    let isMock = typeof session === 'undefined' || !session.defaultSession || typeof session.defaultSession.cookies?.get !== 'function';
    
    let sessionCookies = [];
    if (!isMock) {
      try {
        sessionCookies = await session.defaultSession.cookies.get({ url: origin });
      } catch (err) {
        log.error(`[Anime365 Auth Check] Failed to check cookies: ${err.message}`);
      }
    }

    const sessionCookieStr = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    let configCookie = '';
    try {
      const config = await getData('config.json');
      if (config && config.anime365_cookie) {
        configCookie = config.anime365_cookie.trim();
      }
    } catch (e) {}

    const hasCookiesStr = [sessionCookieStr, configCookie].filter(Boolean).join('; ');

    return {
      loggedIn: hasCookiesStr.length > 5,
      cookieCount: sessionCookies.length,
      hasSessionCookies: sessionCookies.length > 0,
      hasConfigCookies: configCookie.length > 0,
      isMockMode: isMock,
      activeHost: origin
    };
  }));

  ipcMain.handle('anime365-download-subtitle', wrapIpcHandler(async (event, { url, episodeId }) => {
    if (!url || !episodeId) throw new Error('Missing required arguments for downloading subtitle');
    
    const fs = require('fs/promises');
    const path = require('path');
    const axios = require('axios');
    
    log.info(`[Anime365] Downloading subtitle for episode ${episodeId} from: ${url}`);
    
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': url
    };

    // 1. Try to fetch cookies from active Electron session for subtitle URL
    try {
      const urlParsed = new URL(url);
      const origin = urlParsed.origin;
      await syncAnime365Cookies(origin);
      if (typeof session !== 'undefined' && session.defaultSession && typeof session.defaultSession.cookies?.get === 'function') {
        const sessionCookies = await session.defaultSession.cookies.get({ url: origin });
        if (sessionCookies && sessionCookies.length > 0) {
          const sessionCookieStr = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
          requestHeaders['Cookie'] = sessionCookieStr;
          log.info(`[Anime365 Subs] Injected ${sessionCookies.length} session cookies for ${origin}`);
        }
      }
    } catch (cookieEx) {
      log.warn(`[Anime365 Subs] Could not extract session cookies: ${cookieEx.message}`);
    }

    // 2. Load custom config cookies
    try {
      const config = await getData('config.json');
      if (config && config.anime365_cookie) {
        const manualCookieStr = config.anime365_cookie.trim();
        if (manualCookieStr) {
          const existing = requestHeaders['Cookie'] || '';
          requestHeaders['Cookie'] = [existing, manualCookieStr].filter(Boolean).join('; ');
          log.info(`[Anime365 Subs] Added custom config cookies to subtitle request`);
        }
      }
    } catch (configEx) {
      log.warn(`[Anime365 Subs] Could not load custom cookie configuration: ${configEx.message}`);
    }

    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      headers: requestHeaders
    });
    const buffer = Buffer.from(response.data);
    
    const episodes = await getData('episodes.json');
    const epIndex = episodes.findIndex(e => e.id === episodeId);
    if (epIndex === -1) throw new Error('Episode not found');
    
    const episode = episodes[epIndex];
    const app = require('electron').app;
    const baseDir = app ? app.getPath('userData') : path.join(process.cwd(), 'mock_user_data');
    const subDir = path.join(baseDir, 'projects', episode.projectId, 'subs');
    await fs.mkdir(subDir, { recursive: true });
    
    let extension = '.ass';
    if (url.includes('.srt')) extension = '.srt';
    const fileName = `episode_${episode.number}_subs${extension}`;
    const fullPath = path.join(subDir, fileName);
    
    await fs.writeFile(fullPath, buffer);
    
    episode.subPath = fullPath;
    episode.updatedAt = new Date().toISOString();
    episodes[epIndex] = episode;
    await saveData('episodes.json', episodes);
    
    log.info(`[Anime365] Subtitle saved to ${fullPath}`);
    return { success: true, subPath: fullPath };
  }));

  ipcMain.handle('anime365-check-new-episodes', wrapIpcHandler(async (event, { projectId }) => {
    if (!projectId) throw new Error('Missing project ID');
    const Anime365Service = require('../services/Anime365Service.cjs');
    const projects = await getData('projects.json');
    const project = projects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    
    let anime365Id = project.anime365Id;
    if (!anime365Id) {
      const match = await Anime365Service.matchProjectToSeries(project.title, project.originalTitle);
      if (match) {
        anime365Id = match.id;
        project.anime365Id = anime365Id;
        await saveData('projects.json', projects);
      }
    }
    
    if (anime365Id) {
      log.info(`[Anime365] Checking new episodes for series ID: ${anime365Id}`);
      const series = await Anime365Service.getSeriesByID(anime365Id);
      if (series && series.episodes && series.episodes.length > 0) {
        const episodeNumbers = series.episodes.map(e => parseFloat(e.episodeInt) || 0).filter(n => n > 0);
        if (episodeNumbers.length > 0) {
          const maxEp = Math.max(...episodeNumbers);
          return { maxEpisode: maxEp, source: 'anime365' };
        }
      }
    }
    
    return { maxEpisode: null, source: 'none' };
  }));

  ipcMain.handle('search-anime', wrapIpcHandler(async (event, { query }) => {
    if (!query) throw new Error('Missing search query');
    return await searchAnime(query);
  }));

  ipcMain.handle('get-anime-details', wrapIpcHandler(async (event, { id, source }) => {
    if (!id || !source) throw new Error('Missing required parameters');
    return await getAnimeDetails(id, source);
  }));

  ipcMain.handle('get-anime-characters', wrapIpcHandler(async (event, { id, source }) => {
    if (!id || !source) throw new Error('Missing required parameters');
    return await getAnimeCharacters(id, source);
  }));

  ipcMain.handle('get-next-episode-date', wrapIpcHandler(async (event, { title }) => {
    if (!title) throw new Error('Missing anime title');
    return await getNextEpisodeDate(title);
  }));

  ipcMain.handle('get-episode-title', wrapIpcHandler(async (event, { title, originalTitle, episodeNumber, anime365Id }) => {
    const { getEpisodeTitle } = require('../services/animeApiService.cjs');
    return await getEpisodeTitle(title, originalTitle, episodeNumber, anime365Id);
  }));

  ipcMain.handle('ai-process-subtitles', wrapIpcHandler(async (event, { lines, glossary, modelName, allowProfanity, genre }) => {
    if (!lines || !Array.isArray(lines)) throw new Error('Missing or invalid subtitle lines');
    log.info(`AI processing started for ${lines.length} lines. Genre: ${genre}, Profanity: ${allowProfanity}`);
    
    const config = await getData('config.json');
    const provider = config?.aiProvider || 'transformers';
    const effectiveModel = modelName || config?.translationModel || 'Xenova/nllb-200-distilled-600M';
    
    if (provider === 'transformers') {
      log.info(`AI processing: transformers selected. Using local translation with model: ${effectiveModel}`);
      const processed = [];
      
      let localTranslator = null;
      try {
        const LocalTranslateService = require('../services/LocalTranslateService.cjs');
        const service = LocalTranslateService.getInstance(require('electron').app.getPath('userData'));
        service.setModelName(effectiveModel);
        localTranslator = service;
      } catch (err) {
        log.error('Failed to init LocalTranslateService:', err.message);
      }

      const total = lines.length;
      let current = 0;
      const batchSize = 16;

      for (let i = 0; i < total; i += batchSize) {
        const batchLines = lines.slice(i, i + batchSize);
        const batchTexts = batchLines.map(l => l.text);

        try {
          let translatedTexts;
          if (localTranslator) {
            // Translate the entire batch of 16 text items at once for massive speedup
            translatedTexts = await localTranslator.translate(batchTexts, 'ja', 'ru');
          } else {
            // Fallback line by line if localTranslator was not initialized
            translatedTexts = [];
            const { translateText } = require('../services/translateService.cjs');
            for (const text of batchTexts) {
              const result = await translateText(text, 'ja', 'ru');
              translatedTexts.push(result['destination-text']);
            }
          }

          for (let j = 0; j < batchLines.length; j++) {
            let resultText = translatedTexts[j] || batchLines[j].text;

            // Apply profanity filter if disabled
            if (allowProfanity === false) {
              resultText = filterProfanity(resultText);
            }

            processed.push({ ...batchLines[j], text: resultText });
          }
        } catch (e) {
          log.error(`Local/Fallback translation failed for batch starting at index ${i}:`, e.message);
          for (const line of batchLines) {
            processed.push({ ...line });
          }
        }

        current += batchLines.length;
        // Send real-time progress updates back to the UI
        try {
          event.sender.send('local-translate-progress', { current, total });
        } catch (sendErr) {
          log.warn('Could not send local-translate-progress:', sendErr.message);
        }
      }

      return processed;
    }
 else {
      // Fallback for everything else
      const { translateText } = require('../services/translateService.cjs');
      const processed = [];
      
      for (const line of lines) {
        try {
          const result = await translateText(line.text, 'ja', 'ru');
          processed.push({ ...line, text: result['destination-text'] });
        } catch (err) {
          log.error('Fallback translation failed for line:', line.text, err.message);
          processed.push({ ...line });
        }
      }
      return processed;
    }
  }));

  ipcMain.handle('save-translated-subtitles', wrapIpcHandler(async (event, { assFilePath, translatedLines }) => {
    if (!assFilePath || !translatedLines) throw new Error('Missing required parameters');
    const { saveTranslatedSubtitles } = require('../services/subtitleService.cjs');
    return await saveTranslatedSubtitles(assFilePath, translatedLines);
  }));
}

function filterProfanity(text) {
  if (!text) return text;
  // Very basic list of Russian and English bad words to replace/mask
  const badWords = [
    /\bхуй\b/gi, /\bхуя\b/gi, /\bхули\b/gi, /\bхуё\b/gi,
    /\bпизд\b/gi, /\bбля\b/gi, /\bблядь\b/gi, /\bблять\b/gi,
    /\bсука\b/gi, /\bёб\b/gi, /\bеба\b/gi, /\bебя\b/gi,
    /\bfuck\b/gi, /\bshit\b/gi, /\bass\b/gi, /\bbitch\b/gi
  ];
  let filtered = text;
  for (const regex of badWords) {
    filtered = filtered.replace(regex, (match) => '*'.repeat(match.length));
  }
  return filtered;
}

module.exports = { registerApiHandlers };
