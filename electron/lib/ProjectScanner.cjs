const fs = require('fs/promises');
const path = require('path');
const log = require('electron-log');

function sanitizeFolderName(name) {
  if (!name) return 'Project';
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

function extractEpisodeNumber(str) {
  if (!str) return null;
  let clean = str.trim();

  // Strip resolution tags and common video parameters to prevent false positive numbers (e.g., 1080p, 720, 2024)
  clean = clean.replace(/(?:1080p|720p|2160p|480p|360p|4k|2k)/gi, ' ');
  clean = clean.replace(/(?:\b202[0-9]\b)/g, ' ');

  // 1. Pure digits like "1", "01", "12"
  if (/^\d+$/.test(clean.trim())) {
    const num = parseInt(clean.trim(), 10);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }

  // 2. Standard S01E02 / E02 / E2 / e02 / e2 patterns
  const sEPattern = clean.match(/(?:s\d{1,2})?e(\d{1,4})/i);
  if (sEPattern && sEPattern[1]) {
    const num = parseInt(sEPattern[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }

  // 3. Keywords before digits: "Episode 1", "Ep_01", "Серия 1", "Эпизод 1", "Серия_01"
  const prefixMatch = clean.match(/(?:episode|ep|серия|эпизод|series)[_\s-]*(\d{1,4})/i);
  if (prefixMatch && prefixMatch[1]) {
    const num = parseInt(prefixMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }

  // 4. Keywords after digits: "1 серия", "01 серия", "1 эпизод", "01 эпизод", "1 ep"
  const suffixMatch = clean.match(/(\d{1,4})[_\s-]*(?:серия|эпизод|серии|ep|eps|episode)/i);
  if (suffixMatch && suffixMatch[1]) {
    const num = parseInt(suffixMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }

  // 5. Brackets around digits: "[01]", "(01)", "[1]"
  const bracketMatch = clean.match(/[\[\(](\d{1,4})[\]\)]/);
  if (bracketMatch && bracketMatch[1]) {
    const num = parseInt(bracketMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }

  // 6. Delimited standalone numbers: "- 01 -", "_01_", ".01.", " 01 "
  const delimitedMatch = clean.match(/(?:^|[_\s.-])(\d{1,4})(?:[_\s.-]|$)/);
  if (delimitedMatch && delimitedMatch[1]) {
    const num = parseInt(delimitedMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }

  return null;
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
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.m4a'];
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
 * Scans project folder for episode subfolders/files, restores missing episodes,
 * updates missing/broken paths, and creates episode.json for each episode.
 */
async function scanAndRecoverProject(baseDir, project, allEpisodes) {
  if (!baseDir || !project) return { hasChanges: false, updatedEpisodes: allEpisodes };

  const projectDir = await findProjectDirectory(baseDir, project);
  if (!(await dirExists(projectDir))) {
    return { hasChanges: false, updatedEpisodes: allEpisodes };
  }

  log.info(`[ProjectScanner] Scanning project folder for "${project.title}" at: ${projectDir}`);

  const diskMap = new Map(); // epNum -> { folderPath, episodeJson, videoPath, subPath }

  // 1. Scan subdirectories in projectDir
  const entries = await fs.readdir(projectDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirName = entry.name;
      if (['torrents_temp', 'torrents_meta', 'backups', 'models'].includes(dirName.toLowerCase())) continue;

      const epNum = extractEpisodeNumber(dirName);
      if (epNum !== null) {
        const epFolder = path.join(projectDir, dirName);
        const scannedData = await scanEpisodeFolder(epFolder, epNum);
        diskMap.set(epNum, scannedData);
      }
    }
  }

  // 2. Scan files in projectDir root
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.m4a'];
  const subExts = ['.ass', '.srt', '.vtt'];

  for (const entry of entries) {
    if (entry.isFile()) {
      const epNum = extractEpisodeNumber(entry.name);
      if (epNum !== null) {
        const ext = path.extname(entry.name).toLowerCase();
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
        const epNum = extractEpisodeNumber(sf.name);
        if (epNum !== null && subExts.includes(path.extname(sf.name).toLowerCase())) {
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
      log.info(`[ProjectScanner] Restoring missing episode ${epNum} for project "${project.title}" from disk files!`);
      const baseJson = diskData.episodeJson || {};
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

    let projectsChanged = false;

    // Discover projects on disk if project list is missing or incomplete
    const searchDirs = [baseDir, path.join(baseDir, 'projects')];
    for (const sd of searchDirs) {
      if (!(await dirExists(sd))) continue;
      const subEntries = await fs.readdir(sd, { withFileTypes: true }).catch(() => []);
      for (const se of subEntries) {
        if (!se.isDirectory()) continue;
        const dirName = se.name;
        if (['torrents_temp', 'torrents_meta', 'backups', 'models', 'projects'].includes(dirName.toLowerCase())) continue;

        const folderPath = path.join(sd, dirName);
        const normDirName = dirName.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

        const existingProject = projects.find(p => {
          if (p.id === dirName || p.title === dirName) return true;
          const normTitle = (p.title || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
          return normTitle && normTitle === normDirName;
        });

        if (!existingProject) {
          // Check if folder contains episode files or subfolders
          const innerFiles = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
          const hasEpContent = innerFiles.some(f => {
            const epNum = extractEpisodeNumber(f.name);
            return epNum !== null || f.name.toLowerCase() === 'project.json';
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
      const { hasChanges, updatedEpisodes } = await scanAndRecoverProject(baseDir, project, episodes);
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
  scanAndRecoverProject,
  scanAndRecoverAllProjects,
};
