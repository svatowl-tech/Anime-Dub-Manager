const fs = require('fs/promises');
const path = require('path');
const { z } = require('zod');
const log = require('electron-log');
const ProjectScanner = require('./ProjectScanner.cjs');

// Zod Schemas for validation
const ParticipantSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  telegram: z.string().optional().nullable(),
  tgChannel: z.string().optional().nullable(),
  vkLink: z.string().optional().nullable(),
  roles: z.array(z.string()).optional(),
}).passthrough();

const RoleAssignmentSchema = z.object({
  id: z.string().optional().default(() => Math.random().toString(36).substring(2, 9)),
  episodeId: z.string().optional().nullable(),
  characterName: z.string().optional().default(''),
  dubberId: z.string().optional().nullable().default(''),
  dubber: z.any().optional().nullable(),
  substituteId: z.string().optional().nullable(),
  substitute: z.any().optional().nullable(),
  status: z.string().optional().default('PENDING'),
  comments: z.string().optional().nullable(),
  lineCount: z.number().optional().nullable(),
  isMain: z.boolean().optional().nullable(),
}).passthrough();

const UploadedFileSchema = z.object({
  id: z.string().optional().default(() => Math.random().toString(36).substring(2, 9)),
  episodeId: z.string().optional().nullable(),
  assignmentId: z.string().optional().nullable(),
  type: z.enum(["DUBBER_FILE", "FIXES", "SOUND_ENGINEER_FILE"]).or(z.string()),
  path: z.string().optional().default(''),
  uploadedById: z.string().optional().nullable().default(''),
  uploadedBy: z.any().optional().nullable(),
  role: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
}).passthrough();

const EpisodeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  number: z.number(),
  status: z.string().optional().default("UPLOAD"),
  airingDate: z.string().optional().nullable(),
  deadline: z.string().optional().nullable(),
  rawPath: z.string().optional().nullable(),
  subPath: z.string().optional().nullable(),
  isHardsub: z.boolean().optional().nullable(),
  yandexUrl: z.string().optional().nullable(),
  tgPostTemplate: z.string().optional().nullable(),
  vkPostTemplate: z.string().optional().nullable(),
  finalTgPostTemplate: z.string().optional().nullable(),
  linksTemplate: z.string().optional().nullable(),
  startMessageTemplate: z.string().optional().nullable(),
  soundEngineerMessageTemplate: z.string().optional().nullable(),
  fixesMessageTemplate: z.string().optional().nullable(),
  statusMessageTemplate: z.string().optional().nullable(),
  tgPostLink: z.string().optional().nullable(),
  vkPostLink: z.string().optional().nullable(),
  assignments: z.array(RoleAssignmentSchema).optional().default([]),
  uploads: z.array(UploadedFileSchema).optional().default([]),
  statusHistory: z.array(z.any()).optional().nullable(),
  coverSettings: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
}).passthrough();

const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  originalTitle: z.string().optional().nullable(),
  status: z.string().optional().default("ACTIVE"),
  lastActiveEpisode: z.number().optional().default(1),
  totalEpisodes: z.number().optional().default(12),
  assignedDubberIds: z.array(z.string()).optional().default([]),
  soundEngineerId: z.string().optional().nullable(),
  releaseType: z.string().optional().nullable(),
  emoji: z.string().optional().nullable(),
  isOngoing: z.boolean().optional().nullable(),
  synopsis: z.string().optional().nullable(),
  posterUrl: z.string().optional().nullable(),
  links: z.string().optional().nullable(),
  globalMapping: z.string().optional().nullable(),
  characterAliases: z.string().optional().nullable(),
  nameStresses: z.string().optional().nullable(),
  characters: z.string().optional().nullable(),
  typeAndSeason: z.string().optional().nullable(),
  coverSettings: z.string().optional().nullable(),
  tgPostTemplate: z.string().optional().nullable(),
  vkPostTemplate: z.string().optional().nullable(),
  finalTgPostTemplate: z.string().optional().nullable(),
  linksTemplate: z.string().optional().nullable(),
  startMessageTemplate: z.string().optional().nullable(),
  soundEngineerMessageTemplate: z.string().optional().nullable(),
  fixesMessageTemplate: z.string().optional().nullable(),
  statusMessageTemplate: z.string().optional().nullable(),
  nextEpisodeDate: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
}).passthrough();

const ConfigSchema = z.object({
  baseDir: z.string().optional().nullable(),
  ffmpegPath: z.string().optional().nullable(),
  useNvenc: z.boolean().optional().nullable(),
  gpuIndex: z.string().optional().nullable(),
  openRouterKey: z.string().optional().nullable(),
  yandexToken: z.string().optional().nullable(),
  syncEnabled: z.boolean().optional().nullable(),
}).passthrough();

const Schemas = {
  'participants.json': z.array(ParticipantSchema),
  'projects.json': z.array(ProjectSchema),
  'episodes.json': z.array(EpisodeSchema),
  'config.json': ConfigSchema,
};

class DataManager {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.backupPath = path.join(userDataPath, 'backups');
    this.saveQueues = new Map();
    this.cache = new Map();
    this.baseDir = null;
  }

  /**
   * Helper to extract valid timestamp from entity
   */
  getItemTimestamp(item) {
    if (!item) return 0;
    if (item.updatedAt) {
      const t = new Date(item.updatedAt).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (item.createdAt) {
      const t = new Date(item.createdAt).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  }

  /**
   * Initialize DataManager (create necessary directories)
   */
  async init() {
    try {
      await fs.mkdir(this.backupPath, { recursive: true });
      log.info('DataManager initialized. Backup path:', this.backupPath);
      
      // Load config to fetch baseDir
      const config = await this.getData('config.json');
      if (config && config.baseDir) {
        this.baseDir = config.baseDir;
        log.info('DataManager: Loaded baseDir config on startup:', this.baseDir);
        await this.syncAndLoadFromBaseDir();
      }
    } catch (e) {
      log.error('Failed to initialize DataManager:', e);
    }
  }

  async syncAndLoadFromBaseDir() {
    if (!this.baseDir) return;
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      const files = ['projects.json', 'episodes.json', 'participants.json', 'config.json'];
      
      for (const file of files) {
        const localPath = path.join(this.userDataPath, file);
        const folderPath = path.join(this.baseDir, file);
        
        let folderData = null;
        try {
          const folderContent = await fs.readFile(folderPath, 'utf-8');
          folderData = JSON.parse(folderContent);
        } catch (e) {
          // Folder copy doesn't exist yet, or is invalid
        }
        
        let localData = null;
        try {
          const localContent = await fs.readFile(localPath, 'utf-8');
          localData = JSON.parse(localContent);
        } catch (e) {
          // Local copy doesn't exist yet
        }
        
        if (folderData) {
          if (file === 'config.json') {
            // Merge configs
            const merged = { ...(localData || {}), ...folderData };
            await this.saveData(file, merged);
          } else {
            // Entities: smart merge prioritizing newer updatedAt and preserving rich nested arrays
            const mergedList = Array.isArray(localData) ? [...localData] : [];
            const folderList = Array.isArray(folderData) ? folderData : [];
            
            for (const folderItem of folderList) {
              if (!folderItem || !folderItem.id) continue;
              const existingIndex = mergedList.findIndex(item => item && item.id === folderItem.id);
              if (existingIndex === -1) {
                mergedList.push(folderItem);
              } else {
                const localItem = mergedList[existingIndex];
                const localUpdate = this.getItemTimestamp(localItem);
                const folderUpdate = this.getItemTimestamp(folderItem);
                
                let mergedItem;
                if (folderUpdate > localUpdate) {
                  mergedItem = { ...localItem, ...folderItem };
                } else if (localUpdate > folderUpdate) {
                  mergedItem = { ...folderItem, ...localItem };
                } else {
                  // Equal timestamps: preserve non-empty array fields from local if folder lacks them
                  mergedItem = { ...localItem, ...folderItem };
                  for (const key of Object.keys(localItem)) {
                    if (Array.isArray(localItem[key]) && localItem[key].length > 0 && (!Array.isArray(folderItem[key]) || folderItem[key].length === 0)) {
                      mergedItem[key] = localItem[key];
                    } else if (localItem[key] && !folderItem[key]) {
                      mergedItem[key] = localItem[key];
                    }
                  }
                }
                mergedList[existingIndex] = mergedItem;
              }
            }
            
            await this.saveData(file, mergedList);
          }
        } else if (localData) {
          // If no folder data but local data exists, sync it to the folder
          await this.saveData(file, localData);
        }
      }
      log.info('DataManager: Successfully synced local databases with working directory:', this.baseDir);

      // Perform initial project scan and recovery
      await ProjectScanner.scanAndRecoverAllProjects(
        (file) => this.getData(file),
        (file, data) => this.saveData(file, data),
        this.userDataPath,
        this.baseDir
      );
    } catch (err) {
      log.error('DataManager: Failed during syncAndLoadFromBaseDir:', err);
    }
  }

  /**
   * Read data from JSON file with fast in-memory cache and backup recovery fallback
   */
  async getData(filename) {
    if (this.cache.has(filename)) {
      return JSON.parse(JSON.stringify(this.cache.get(filename)));
    }

    const filePath = path.join(this.userDataPath, filename);
    try {
      const dataStr = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(dataStr);
      this.cache.set(filename, parsed);
      return JSON.parse(JSON.stringify(parsed));
    } catch (e) {
      // Fallback 1: Try reading from working directory (baseDir) if configured
      if (this.baseDir) {
        try {
          const folderFilePath = path.join(this.baseDir, filename);
          const folderDataStr = await fs.readFile(folderFilePath, 'utf-8');
          const parsed = JSON.parse(folderDataStr);
          this.cache.set(filename, parsed);
          // Restore local copy
          await fs.writeFile(filePath, folderDataStr, 'utf-8').catch(() => {});
          log.info(`[DataManager] Recovered ${filename} from working directory (${this.baseDir})`);
          return JSON.parse(JSON.stringify(parsed));
        } catch (baseDirErr) {}
      }

      // Fallback 2: Try recovering from most recent backup
      try {
        const backupFiles = await fs.readdir(this.backupPath).catch(() => []);
        const matched = backupFiles
          .filter(f => f.startsWith(filename) && f.endsWith('.bak'))
          .sort()
          .reverse();
        if (matched.length > 0) {
          const newestBackupPath = path.join(this.backupPath, matched[0]);
          const backupDataStr = await fs.readFile(newestBackupPath, 'utf-8');
          const parsed = JSON.parse(backupDataStr);
          this.cache.set(filename, parsed);
          await fs.writeFile(filePath, backupDataStr, 'utf-8').catch(() => {});
          log.warn(`[DataManager] Recovered ${filename} from backup: ${matched[0]}`);
          return JSON.parse(JSON.stringify(parsed));
        }
      } catch (backupErr) {}

      log.warn(`[DataManager] File ${filename} not found. Returning default.`);
      const defaultVal = filename.endsWith('s.json') ? [] : (filename === 'config.json' ? {} : null);
      this.cache.set(filename, defaultVal);
      return defaultVal;
    }
  }

  /**
   * Save data to JSON file using immediate cache update and serialized Atomic Write pattern
   */
  async saveData(filename, data) {
    // Immediately update in-memory cache so subsequent reads are instantaneous and fresh
    const clonedData = JSON.parse(JSON.stringify(data));
    this.cache.set(filename, clonedData);

    if (!this.saveQueues.has(filename)) {
      this.saveQueues.set(filename, Promise.resolve());
    }

    const queue = this.saveQueues.get(filename);
    const newQueue = queue
      .then(() => this._performSave(filename, clonedData))
      .catch((err) => {
        log.error(`[DataManager] Error in save queue for ${filename}:`, err);
        return this._performSave(filename, clonedData);
      });
    this.saveQueues.set(filename, newQueue);
    return newQueue;
  }

  async _performSave(filename, data) {
    const filePath = path.join(this.userDataPath, filename);
    const tempPath = `${filePath}.tmp`;

    try {
      // 1. Validate data against Zod schema
      if (Schemas[filename]) {
        Schemas[filename].parse(data);
      }

      // 2. Create a backup before overwriting
      await this.createBackup(filename);

      // 3. Atomic Write: Write to a temporary file first
      // Circular references are assumed to be handled by the caller (as per project state)
      const json = JSON.stringify(data, null, 2);
      await fs.writeFile(tempPath, json, 'utf-8');

      // 4. Atomic Write: Rename temp file to original file (OS-level atomic operation)
      // Retry logic for EPERM on Windows (often caused by Antivirus locks or short-lived open handles)
      let renameSuccess = false;
      let retries = 5;
      while (!renameSuccess && retries > 0) {
        try {
          await fs.rename(tempPath, filePath);
          renameSuccess = true;
        } catch (renameErr) {
          if (renameErr.code === 'EPERM' && retries > 1) {
            retries--;
            await new Promise(resolve => setTimeout(resolve, 50));
          } else {
            throw renameErr;
          }
        }
      }
      
      log.info(`DataManager: Successfully saved ${filename} atomically.`);

      // If config.json is saved, update internal baseDir reference dynamically
      if (filename === 'config.json') {
        this.baseDir = data ? data.baseDir : null;
        log.info('DataManager: Dynamically updated baseDir to:', this.baseDir);
      }
      
      // If baseDir is configured, duplicate/sync the file as requested!
      if (this.baseDir) {
        try {
          await fs.mkdir(this.baseDir, { recursive: true });
          const targetFolderPath = path.join(this.baseDir, filename);
          const json = JSON.stringify(data, null, 2);
          await fs.writeFile(targetFolderPath, json, 'utf-8');
          log.info(`DataManager: Duplicated/Synced ${filename} to working directory: ${targetFolderPath}`);
        } catch (syncErr) {
          log.error(`DataManager: Failed to sync ${filename} to working directory:`, syncErr);
        }
      }
    } catch (e) {
      log.error(`DataManager: Failed to save ${filename}:`, e);
      
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        // Ignore unlink errors
      }
      
      throw e;
    }
  }

  /**
   * Create a timestamped backup of the file
   */
  async createBackup(filename) {
    const filePath = path.join(this.userDataPath, filename);
    try {
      // Check if original file exists before backing up
      await fs.access(filePath);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupPath, `${filename}.${timestamp}.bak`);
      
      await fs.copyFile(filePath, backupFile);
      
      // Keep only the last 5 versions
      await this.rotateBackups(filename);
    } catch (e) {
      // File doesn't exist yet, skip backup
    }
  }

  /**
   * Keep only the last 5 backups for a specific file
   */
  async rotateBackups(filename) {
    try {
      const files = await fs.readdir(this.backupPath);
      const backups = files
        .filter(f => f.startsWith(filename) && f.endsWith('.bak'))
        .sort()
        .reverse();

      if (backups.length > 5) {
        const toDelete = backups.slice(5);
        for (const file of toDelete) {
          await fs.unlink(path.join(this.backupPath, file));
        }
      }
    } catch (e) {
      log.error(`DataManager: Failed to rotate backups for ${filename}:`, e);
    }
  }
}

module.exports = DataManager;
