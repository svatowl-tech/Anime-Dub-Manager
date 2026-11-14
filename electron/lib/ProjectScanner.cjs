const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');

const { sanitizeFolderName: safeSanitizeFolder, sanitizeProjectTitle } = require('./pathSanitizer.cjs');

function sanitizeFolderName(name) {
  return safeSanitizeFolder(name, 'Project');
}

const AUXILIARY_DIR_NAMES = new Set([
  'torrents_temp',
  'torrents_meta',
  'backups',
  'models',
  'subs',
  'audio',
  'dubs',
  'mix',
  'mixing',
  'renders',
  'covers',
  'export',
  'exports',
  'sound_engineer',
  'qa',
  'timing',
  'temp',
  'cache',
  'vst3_presets',
  '.git',
  'node_modules',
]);

function extractEpisodeNumberWithMeta(str, projectTitle, options = {}) {
  if (!str) return { number: null, confidence: 'none' };
  let clean = str.trim();

  // 1. Strip file extension if present
  clean = clean.replace(/\.[a-zA-Z0-9]{2,5}$/, '');

  // 2. Strip leading release group [Group] or (Group)
  clean = clean.replace(/^\[[^\]]+\]\s*/, '').replace(/^\([^)]+\)\s*/, '');

  // 3. Strip CRC32 tags and hex hashes
  clean = clean.replace(/\[[0-9a-fA-F]{8}\]/g, ' ');

  // 4. Strip video resolutions, dimensions, codecs, bitrates, and unit-suffixed numbers
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))\d{3,4}\s*[xх×]\s*\d{3,4}(?=$|[\s._\]\)-])/gi, ' ');
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))(?:2160p|1080p|720p|480p|360p|4k|8k|uhd|fhd|hd)(?=$|[\s._\]\)-])/gi, ' ');
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))(?:x264|x265|h264|h265|hevc|avc|av1|vp9|10bit|8bit|hi10p|aac\d?|flac\d?|mp3|opus|ac3|eac3|dts(?:-hd)?|truehd|ddp?5\.1|5\.1ch|2\.0ch|stereo)(?=$|[\s._\]\)-])/gi, ' ');
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))(?:WEBRip|WEB-DL|BDRip|BD-Rip|BluRay|HDTV|DVDRip|DVD|Remux)(?=$|[\s._\]\)-])/gi, ' ');
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))\d+(?:[.,]\d+)?\s*(?:ms|sec|fps|hz|khz|kbps|mbps|kb|mb|gb|tb|px|bit|ch)(?=$|[\s._\]\)-])/gi, ' ');
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))(?:id|aid|eid|shiki|shikimori|mal|anidb|a365|anime365|tg|msg|uid|pid)[_:#-]?\d+(?=$|[\s._\]\)-])/gi, ' ');

  // 5. Strip 4-digit years
  clean = clean.replace(/[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]/g, ' ');
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))(?:19|20)\d{2}(?=$|[\s._\]\)-])/g, ' ');

  // 6. Strip projectTitle if provided
  if (projectTitle && typeof projectTitle === 'string' && projectTitle.trim()) {
    const esc = projectTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp('(?:^|[\\s._\\[(-])' + esc + '(?:[\\s._\\])-]|$)', 'i'), ' ');
    const words = projectTitle.trim().split(/[^a-zA-Zа-яА-Я0-9]+/i).filter(w => w.length > 1);
    if (words.length > 0) {
      const phrase = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s._:-]+');
      clean = clean.replace(new RegExp(phrase, 'i'), ' ');
    }
  }

  // 7. Strip season markers
  clean = clean.replace(/(?:^|(?<=[\s._\[(-]))(?:season\s*\d{1,2}|\d{1,2}(?:st|nd|rd|th)\s*season|сезон\s*\d{1,2}|\d{1,2}\s*сезон|part\s*\d{1,2}|часть\s*\d{1,2}|cour\s*\d{1,2})(?=$|[\s._\]\)-])/gi, ' ');

  // 8. Pure digits like "1", "01", "12"
  if (/^\d+$/.test(clean.trim())) {
    const num = parseInt(clean.trim(), 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'strong' };
  }

  // 9. Russian batch/indicator [01 из 12], (01 из 24)
  const ruBatchMatch = clean.match(/\[?\b0*([1-9]\d{0,3})\s*(?:-|–|—)?\s*\d*\s*(?:из|of)\s*\d+(?=$|[\s._\]\)-])/i);
  if (ruBatchMatch && ruBatchMatch[1]) {
    const num = parseInt(ruBatchMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'strong' };
  }

  // 10. Standard S01E02 / E02 / E2 / 2x05 patterns
  const sEPattern = clean.match(/(?:s\d{1,2}[\s._-]*e|season\s*\d{1,2}[\s._-]*ep(?:isode)?\s*|(?:^|(?<=[\s._\[(-]))\d{1,2}x)0*([1-9]\d{0,3})(?=$|[\s._\]\)-])/i);
  if (sEPattern && sEPattern[1]) {
    const num = parseInt(sEPattern[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'strong' };
  }

  // 11. Russian season + episode: "2 сезон 5 серия"
  const ruSeasonEp = clean.match(/\d{1,2}\s*сезон[,\s._-]*0*([1-9]\d{0,3})\s*сери[яи]/i);
  if (ruSeasonEp && ruSeasonEp[1]) {
    const num = parseInt(ruSeasonEp[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'strong' };
  }

  // 12. Keywords before digits: "Episode 1", "Ep_01", "Серия 1", "Эпизод 1", "Выпуск 1"
  const prefixMatch = clean.match(/(?:ep(?:isode)?\.?|серия|эпизод|выпуск|\#)[\s._-]*0*([1-9]\d{0,3})(?=$|[\s._\]\)-])/i);
  if (prefixMatch && prefixMatch[1]) {
    const num = parseInt(prefixMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'strong' };
  }

  // 13. Keywords after digits: "1 серия", "01 серия", "1 эпизод", "01 эпизод", "1 ep"
  const suffixMatch = clean.match(/(?:^|(?<=[\s._\[(-]))0*([1-9]\d{0,3})[_\s-]*(?:серия|эпизод|серии|выпуск|ep|eps|episode)(?=$|[\s._\]\)-])/i);
  if (suffixMatch && suffixMatch[1]) {
    const num = parseInt(suffixMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'strong' };
  }

  // 14. Standard anime release format with DASH delimiter: "Title 2 - 05" or "Title — 05" (last match)
  const dashMatches = Array.from(clean.matchAll(/(?:\s+[-–—_]+\s+|[-–—_]{2,}|\s+[-–—_]+|[-–—_]+\s+)0*([1-9]\d{0,3})(?:v\d+)?(?=[\s._\-\(\[]|$)/gi));
  if (dashMatches.length > 0) {
    const lastMatch = dashMatches[dashMatches.length - 1];
    const num = parseInt(lastMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'medium' };
  }

  if (options.strictOnly) {
    return { number: null, confidence: 'none' };
  }

  // 15. Brackets around digits: "[01]", "(01)", "[1]"
  const bracketMatches = Array.from(clean.matchAll(/\[0*([1-9]\d{0,3})(?:v\d+)?\]|\(0*([1-9]\d{0,3})(?:v\d+)?\)/gi));
  if (bracketMatches.length > 0) {
    for (const bm of bracketMatches) {
      const val = bm[1] || bm[2];
      if (val) {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'weak' };
      }
    }
  }

  // 16. Trailing number at end of string
  const endMatch = clean.match(/[\s._-]+0*([1-9]\d{0,3})(?:v\d+)?$/i);
  if (endMatch && endMatch[1]) {
    const num = parseInt(endMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return { number: num, confidence: 'weak' };
  }

  // 17. Delimited standalone numbers (take the last candidate)
  const delimitedMatches = Array.from(clean.matchAll(/(?:^|[_\s.-])0*([1-9]\d{0,2})(?:[_\s.-]|$)/g));
  if (delimitedMatches.length > 0) {
    const last = delimitedMatches[delimitedMatches.length - 1];
    const num = parseInt(last[1], 10);
    if (!isNaN(num) && num > 0 && num < 1000) return { number: num, confidence: 'weak' };
  }

  return { number: null, confidence: 'none' };
}

function extractEpisodeNumber(str, projectTitle, options = {}) {
  const res = extractEpisodeNumberWithMeta(str, projectTitle, options);
  if (res.number === null) return null;
  const totalEpisodes = typeof options.totalEpisodes === 'number' && options.totalEpisodes > 0 ? options.totalEpisodes : 0;
  if (totalEpisodes > 0) {
    const reasonableCeiling = Math.max(totalEpisodes * 2, 120);
    if (res.number > reasonableCeiling && res.confidence !== 'strong') {
      return null;
    }
  }
  return res.number;
}

async function fileExists(p) {
  if (!p) return false;
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch (e) {
    return false;
  }
}

async function dirExists(p) {
  if (!p) return false;
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
}

/**
 * Finds the actual project directory on disk for a given project object.
 * Returns the folder path if found, or canonical default path.
 */
async function findProjectDirectory(baseDir, project) {
  if (!baseDir || !project) return null;
  const sanitizedTitle = sanitizeFolderName(project.title);
  const candidates = [];

  // Custom paths assigned to project
  const customDirs = [project.folderPath, project.folder, project.workingDir, project.customPath].filter(Boolean);
  for (const cd of customDirs) {
    if (path.isAbsolute(cd)) {
      candidates.push(cd);
    } else {
      candidates.push(path.join(baseDir, cd));
      candidates.push(path.join(baseDir, 'projects', cd));
    }
  }

  candidates.push(
    path.join(baseDir, sanitizedTitle),
    path.join(baseDir, project.id),
    path.join(baseDir, 'projects', project.id),
    path.join(baseDir, 'projects', sanitizedTitle)
  );

  if (project.originalTitle) {
    candidates.push(path.join(baseDir, sanitizeFolderName(project.originalTitle)));
  }

  for (const cand of candidates) {
    if (await dirExists(cand)) {
      return cand;
    }
  }

  // Normalized folder search inside baseDir and baseDir/projects
  const targetNorm = sanitizedTitle.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
  const searchDirs = [baseDir, path.join(baseDir, 'projects')];
  for (const sd of searchDirs) {
    if (await dirExists(sd)) {
      const subEntries = await fs.readdir(sd, { withFileTypes: true }).catch(() => []);
      for (const se of subEntries) {
        if (se.isDirectory()) {
          const normName = se.name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
          if (normName && normName === targetNorm) {
            return path.join(sd, se.name);
          }
        }
      }
    }
  }

  return path.join(baseDir, sanitizedTitle);
}

/**
 * Scans an individual episode folder for video, subs, and episode.json
 */
async function scanEpisodeFolder(epFolder, epNum) {
  const result = {
    folderPath: epFolder,
    episodeJson: null,
    videoPath: null,
    subPath: null,
  };

  const files = await fs.readdir(epFolder, { withFileTypes: true }).catch(() => []);

  // 1. Read episode.json or episode_${epNum}.json if present
  for (const f of files) {
    if (!f.isFile()) continue;
    const lowerName = f.name.toLowerCase();
    if (lowerName === 'episode.json' || lowerName === `episode_${epNum}.json`) {
      try {
        const jsonPath = path.join(epFolder, f.name);
        const content = await fs.readFile(jsonPath, 'utf-8');
        result.episodeJson = JSON.parse(content);
      } catch (e) {
        log.warn(`[ProjectScanner] Error reading episode JSON in ${epFolder}:`, e.message);
      }
    }
  }

  // 2. Scan for video and subtitle files
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts'];
  const subExts = ['.ass', '.srt', '.vtt'];

  const foundVideos = [];
  const foundSubs = [];

  for (const f of files) {
    if (!f.isFile()) continue;
    const lowerName = f.name.toLowerCase();
    const ext = path.extname(lowerName);
    const fullPath = path.join(epFolder, f.name);

    if (videoExts.includes(ext)) {
      foundVideos.push(fullPath);
    } else if (subExts.includes(ext)) {
      foundSubs.push(fullPath);
    }
  }

  if (foundVideos.length > 0) {
    const rawVideo = foundVideos.find(v => {
      const b = path.basename(v).toLowerCase();
      return b.startsWith('raw_video') || b.startsWith('raw_');
    });
    result.videoPath = rawVideo || foundVideos[0];
  }

  if (foundSubs.length > 0) {
    const mainSub = foundSubs.find(s => {
      const b = path.basename(s).toLowerCase();
      return b.startsWith('subtitles') || b.startsWith('subs_');
    });
    result.subPath = mainSub || foundSubs[0];
  }

  return result;
}

let isScanInProgress = false;

/**
 * Saves a single episode's individual episode.json on disk
 */
async function saveEpisodeJsonOnDisk(baseDir, project, episode) {
  if (!baseDir || !project || !episode) return;
  try {
    const projectDir = await findProjectDirectory(baseDir, project);
    if (!projectDir) return;

    const folderName = sanitizeFolderName(`Episode_${episode.number}`);
    const epFolder = path.join(projectDir, folderName);
    await fs.mkdir(epFolder, { recursive: true });

    const epJsonPath = path.join(epFolder, 'episode.json');
    const { project: _p, ...cleanEp } = episode;
    await fs.writeFile(epJsonPath, JSON.stringify(cleanEp, null, 2), 'utf-8');
    log.info(`[ProjectScanner] Saved individual episode.json for Ep ${episode.number} at ${epJsonPath}`);
  } catch (err) {
    log.error(`[ProjectScanner] Failed to save episode.json for Ep ${episode?.number}:`, err);
  }
}

/**
 * Removes an episode's metadata file (and empty episode folder) on disk after explicit deletion
 * so ProjectScanner will never resurrect a deleted episode.
 */
async function removeEpisodeOnDisk(baseDir, project, episode) {
  if (!baseDir || !project || !episode) return;
  try {
    const projectDir = await findProjectDirectory(baseDir, project);
    if (!projectDir || !(await dirExists(projectDir))) return;

    const candidateFolderNames = new Set([
      sanitizeFolderName(`Episode_${episode.number}`),
      `Episode_${episode.number}`,
      `episode_${episode.number}`,
    ]);

    const entries = await fs.readdir(projectDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (AUXILIARY_DIR_NAMES.has(lower)) continue;

      const epNum = extractEpisodeNumber(entry.name, project.title);
      if (candidateFolderNames.has(entry.name) || epNum === episode.number) {
        const epFolder = path.join(projectDir, entry.name);
        const files = await fs.readdir(epFolder, { withFileTypes: true }).catch(() => []);
        for (const f of files) {
          if (!f.isFile()) continue;
          const lf = f.name.toLowerCase();
          if (lf === 'episode.json' || lf === `episode_${episode.number}.json`) {
            await fs.unlink(path.join(epFolder, f.name)).catch(() => {});
          }
        }
        const remaining = await fs.readdir(epFolder).catch(() => []);
        if (remaining.length === 0) {
          await fs.rmdir(epFolder).catch(() => {});
        }
      }
    }
  } catch (err) {
    log.warn(`[ProjectScanner] Failed cleaning up disk metadata for deleted Ep ${episode?.number}:`, err.message);
  }
}

function buildDeletedLookup(deletedList) {
  const byId = new Map();
  const byProjAndNum = new Map();
  if (!Array.isArray(deletedList)) return { byId, byProjAndNum };
  for (const item of deletedList) {
    if (!item) continue;
    const ts = item.deletedAt ? new Date(item.deletedAt).getTime() : Date.now();
    if (item.id) {
      const prev = byId.get(item.id) || 0;
      if (ts >= prev) byId.set(item.id, ts);
    }
    if (item.projectId && typeof item.number === 'number') {
      const key = `${item.projectId}::${item.number}`;
      const prev = byProjAndNum.get(key) || 0;
      if (ts >= prev) byProjAndNum.set(key, ts);
    }
  }
  return { byId, byProjAndNum };
}

function isEpisodeTombstoned(deletedLookup, projectId, epNum, epId, itemUpdatedAtMs = 0) {
  if (!deletedLookup) return false;
  if (epId && deletedLookup.byId.has(epId)) {
    const delTs = deletedLookup.byId.get(epId);
    if (delTs >= itemUpdatedAtMs) return true;
  }
  if (projectId && typeof epNum === 'number') {
    const key = `${projectId}::${epNum}`;
    if (deletedLookup.byProjAndNum.has(key)) {
      const delTs = deletedLookup.byProjAndNum.get(key);
      if (delTs >= itemUpdatedAtMs) return true;
    }
  }
  return false;
}

/**
 * Scans project folder for episode subfolders/files, restores missing episodes,
 * updates missing/broken paths, and creates episode.json for each episode.
 */
async function scanAndRecoverProject(baseDir, project, allEpisodes, deletedEpisodes = []) {
  if (!baseDir || !project) return { hasChanges: false, updatedEpisodes: allEpisodes };

  const projectDir = await findProjectDirectory(baseDir, project);
  if (!(await dirExists(projectDir))) {
    return { hasChanges: false, updatedEpisodes: allEpisodes };
  }

  log.info(`[ProjectScanner] Scanning project folder for "${project.title}" at: ${projectDir}`);

  const deletedLookup = buildDeletedLookup(deletedEpisodes);
  const extractOpts = { totalEpisodes: project.totalEpisodes || 0 };
  const diskMap = new Map(); // epNum -> { folderPath, episodeJson, videoPath, subPath }

  // 1. Scan subdirectories in projectDir
  const entries = await fs.readdir(projectDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirName = entry.name;
      if (AUXILIARY_DIR_NAMES.has(dirName.toLowerCase())) continue;

      const epNumFromName = extractEpisodeNumber(dirName, project.title, extractOpts);
      if (epNumFromName !== null) {
        const epFolder = path.join(projectDir, dirName);
        const scannedData = await scanEpisodeFolder(epFolder, epNumFromName);

        // Ignore unrelated folders that contain no episode.json and no media/subtitles
        if (!scannedData.episodeJson && !scannedData.videoPath && !scannedData.subPath) {
          continue;
        }

        // Verify episode.json belongs to this project if specified
        if (scannedData.episodeJson && scannedData.episodeJson.projectId && scannedData.episodeJson.projectId !== project.id) {
          continue;
        }

        const resolvedEpNum = (scannedData.episodeJson && typeof scannedData.episodeJson.number === 'number' && scannedData.episodeJson.number > 0)
          ? scannedData.episodeJson.number
          : epNumFromName;

        diskMap.set(resolvedEpNum, scannedData);
      }
    }
  }

  // 2. Scan ONLY actual video & subtitle files in projectDir root
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts'];
  const subExts = ['.ass', '.srt', '.vtt'];

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!videoExts.includes(ext) && !subExts.includes(ext)) continue;

      const epNum = extractEpisodeNumber(entry.name, project.title, extractOpts);
      if (epNum !== null) {
        const fullPath = path.join(projectDir, entry.name);
        let existingDisk = diskMap.get(epNum) || { folderPath: null, episodeJson: null, videoPath: null, subPath: null };
        if (videoExts.includes(ext) && !existingDisk.videoPath) {
          existingDisk.videoPath = fullPath;
        } else if (subExts.includes(ext) && !existingDisk.subPath) {
          existingDisk.subPath = fullPath;
        }
        diskMap.set(epNum, existingDisk);
      }
    }
  }

  // Check subs subdirectory if present
  const subsDir = path.join(projectDir, 'subs');
  if (await dirExists(subsDir)) {
    const subFiles = await fs.readdir(subsDir, { withFileTypes: true }).catch(() => []);
    for (const sf of subFiles) {
      if (sf.isFile()) {
        const ext = path.extname(sf.name).toLowerCase();
        if (!subExts.includes(ext)) continue;

        const epNum = extractEpisodeNumber(sf.name, project.title, extractOpts);
        if (epNum !== null) {
          let existingDisk = diskMap.get(epNum) || { folderPath: null, episodeJson: null, videoPath: null, subPath: null };
          if (!existingDisk.subPath) {
            existingDisk.subPath = path.join(subsDir, sf.name);
            diskMap.set(epNum, existingDisk);
          }
        }
      }
    }
  }

  let hasChanges = false;
  const projectEpisodes = allEpisodes.filter(e => e.projectId === project.id);

  // 3. Reconcile scanned disk map with episodes list
  for (const [epNum, diskData] of diskMap.entries()) {
    let existingEp = projectEpisodes.find(e => e.number === epNum);

    if (!existingEp) {
      // Never auto-restore an episode that has no media/metadata or was explicitly deleted
      if (!diskData.episodeJson && !diskData.videoPath && !diskData.subPath) {
        continue;
      }

      const baseJson = diskData.episodeJson || {};
      const diskUpdatedAtMs = baseJson.updatedAt
        ? new Date(baseJson.updatedAt).getTime()
        : (baseJson.createdAt ? new Date(baseJson.createdAt).getTime() : 0);

      if (isEpisodeTombstoned(deletedLookup, project.id, epNum, baseJson.id, Number.isFinite(diskUpdatedAtMs) ? diskUpdatedAtMs : 0)) {
        log.info(`[ProjectScanner] Skipping deleted/tombstoned episode ${epNum} in project "${project.title}".`);
        continue;
      }

      log.info(`[ProjectScanner] Restoring missing episode ${epNum} for project "${project.title}" from disk files!`);
      const newEp = {
        id: baseJson.id || `ep_${project.id}_${epNum}_${Date.now()}`,
        projectId: project.id,
        number: epNum,
        status: baseJson.status || ((diskData.videoPath || diskData.subPath) ? 'ROLES' : 'UPLOAD'),
        deadline: baseJson.deadline || null,
        rawPath: diskData.videoPath || baseJson.rawPath || null,
        subPath: diskData.subPath || baseJson.subPath || null,
        isHardsub: baseJson.isHardsub !== undefined ? baseJson.isHardsub : (diskData.videoPath ? diskData.videoPath.toLowerCase().includes('hardsub') : false),
        assignments: baseJson.assignments || [],
        uploads: baseJson.uploads || [],
        statusHistory: baseJson.statusHistory || [{ status: 'UPLOAD', timestamp: new Date().toISOString() }],
        createdAt: baseJson.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      allEpisodes.push(newEp);
      projectEpisodes.push(newEp);
      hasChanges = true;
      existingEp = newEp;
    } else {
      let epChanged = false;

      // Check rawPath
      const currentRawValid = existingEp.rawPath ? (path.isAbsolute(existingEp.rawPath) ? await fileExists(existingEp.rawPath) : await fileExists(path.join(baseDir, existingEp.rawPath))) : false;
      if (!currentRawValid && diskData.videoPath) {
        log.info(`[ProjectScanner] Updating missing rawPath for Ep ${epNum} -> ${diskData.videoPath}`);
        existingEp.rawPath = diskData.videoPath;
        epChanged = true;
      }

      // Check subPath
      const currentSubValid = existingEp.subPath ? (path.isAbsolute(existingEp.subPath) ? await fileExists(existingEp.subPath) : await fileExists(path.join(baseDir, existingEp.subPath))) : false;
      if (!currentSubValid && diskData.subPath) {
        log.info(`[ProjectScanner] Updating missing subPath for Ep ${epNum} -> ${diskData.subPath}`);
        existingEp.subPath = diskData.subPath;
        epChanged = true;
      }

      // Restore assignments/uploads if present in episodeJson but empty in existingEp
      if (diskData.episodeJson) {
        if ((!existingEp.assignments || existingEp.assignments.length === 0) && (diskData.episodeJson.assignments?.length > 0)) {
          existingEp.assignments = diskData.episodeJson.assignments;
          epChanged = true;
        }
        if ((!existingEp.uploads || existingEp.uploads.length === 0) && (diskData.episodeJson.uploads?.length > 0)) {
          existingEp.uploads = diskData.episodeJson.uploads;
          epChanged = true;
        }
      }

      if (epChanged) {
        existingEp.updatedAt = new Date().toISOString();
        hasChanges = true;
      }
    }
  }

  // 4. Create/update individual episode.json in each episode folder
  for (const ep of projectEpisodes) {
    try {
      const diskData = diskMap.get(ep.number);
      const epFolder = diskData?.folderPath || path.join(projectDir, sanitizeFolderName(`Episode_${ep.number}`));
      await fs.mkdir(epFolder, { recursive: true });

      const epJsonPath = path.join(epFolder, 'episode.json');
      const { project: _p, ...cleanEp } = ep;
      await fs.writeFile(epJsonPath, JSON.stringify(cleanEp, null, 2), 'utf-8');
    } catch (e) {
      log.error(`[ProjectScanner] Failed writing episode.json for Ep ${ep.number}:`, e.message);
    }
  }

  return { hasChanges, updatedEpisodes: allEpisodes };
}

/**
 * Main function to scan all loaded system projects
 */
async function scanAndRecoverAllProjects(getData, saveData, userDataPath, baseDir) {
  if (isScanInProgress) {
    log.info('[ProjectScanner] Scan already in progress, skipping concurrent trigger.');
    return;
  }
  isScanInProgress = true;
  try {
    if (!baseDir) {
      const config = await getData('config.json');
      baseDir = config?.baseDir || userDataPath;
    }

    if (!baseDir) return;

    let projects = await getData('projects.json');
    if (!Array.isArray(projects)) projects = [];

    let episodes = await getData('episodes.json');
    if (!Array.isArray(episodes)) episodes = [];

    let deletedProjects = [];
    let deletedEpisodes = [];
    try {
      const dp = await getData('deleted_projects.json');
      if (Array.isArray(dp)) deletedProjects = dp;
    } catch (_) {}
    try {
      const de = await getData('deleted_episodes.json');
      if (Array.isArray(de)) deletedEpisodes = de;
    } catch (_) {}

    const deletedProjectTitles = new Set(
      deletedProjects
        .map(p => (p?.title || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, ''))
        .filter(Boolean)
    );

    let projectsChanged = false;

    // Discover projects on disk if project list is missing or incomplete
    const searchDirs = [baseDir, path.join(baseDir, 'projects')];
    for (const sd of searchDirs) {
      if (!(await dirExists(sd))) continue;
      const subEntries = await fs.readdir(sd, { withFileTypes: true }).catch(() => []);
      for (const se of subEntries) {
        if (!se.isDirectory()) continue;
        const dirName = se.name;
        if (AUXILIARY_DIR_NAMES.has(dirName.toLowerCase()) || dirName.toLowerCase() === 'projects') continue;

        const folderPath = path.join(sd, dirName);
        const normDirName = dirName.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

        if (deletedProjectTitles.has(normDirName)) {
          continue;
        }

        const existingProject = projects.find(p => {
          if (p.id === dirName || p.title === dirName) return true;
          const normTitle = (p.title || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
          return normTitle && normTitle === normDirName;
        });

        if (!existingProject) {
          // Check if folder contains episode subfolders with media/episode.json or project.json
          const innerFiles = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
          const mediaExts = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.ass', '.srt', '.vtt']);
          const hasEpContent = innerFiles.some(f => {
            if (f.name.toLowerCase() === 'project.json') return true;
            if (f.isFile() && !mediaExts.has(path.extname(f.name).toLowerCase())) return false;
            if (f.isDirectory() && AUXILIARY_DIR_NAMES.has(f.name.toLowerCase())) return false;
            const epNum = extractEpisodeNumber(f.name);
            return epNum !== null;
          });

          if (hasEpContent) {
            log.info(`[ProjectScanner] Discovered unindexed project folder on disk: "${dirName}" at ${folderPath}`);
            const newProj = {
              id: `proj_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              title: dirName,
              status: 'IN_PROGRESS',
              releaseType: 'VOICEOVER',
              folderPath: folderPath,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            projects.push(newProj);
            projectsChanged = true;
          }
        }
      }
    }

    if (projectsChanged) {
      log.info('[ProjectScanner] Saving newly discovered projects to projects.json...');
      await saveData('projects.json', projects);
    }

    let overallEpisodeChanges = false;

    for (const project of projects) {
      const { hasChanges, updatedEpisodes } = await scanAndRecoverProject(baseDir, project, episodes, deletedEpisodes);
      if (hasChanges) {
        overallEpisodeChanges = true;
        episodes = updatedEpisodes;
      }
    }

    if (overallEpisodeChanges) {
      log.info('[ProjectScanner] Saving recovered episode data to episodes.json...');
      await saveData('episodes.json', episodes);
    }
  } catch (err) {
    log.error('[ProjectScanner] Error during scanAndRecoverAllProjects:', err);
  } finally {
    isScanInProgress = false;
  }
}

module.exports = {
  sanitizeFolderName,
  extractEpisodeNumber,
  findProjectDirectory,
  saveEpisodeJsonOnDisk,
  removeEpisodeOnDisk,
  scanAndRecoverProject,
  scanAndRecoverAllProjects,
};
