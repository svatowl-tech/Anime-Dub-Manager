import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { createRequire } from 'module';
import type { CuratorInboxService } from './curatorInboxService.ts';
import type { ServerRuntimeConfig } from './serverConfig.ts';
import { resolveConfinedPath } from './authMiddleware.ts';

const require = createRequire(import.meta.url);

export type IpcInvoker = (channel: string, ...args: any[]) => Promise<any>;

export interface AgentToolsDependencies {
  config: ServerRuntimeConfig;
  getData: (filename: string) => Promise<any>;
  saveData: (filename: string, data: any) => Promise<void>;
  invokeIpc: IpcInvoker;
  getAvailableIpcChannels: () => string[];
  taskQueue: any;
  inboxService: CuratorInboxService;
  getTelegramService: () => any;
}

export class AgentToolsEngine {
  private deps: AgentToolsDependencies;

  constructor(deps: AgentToolsDependencies) {
    this.deps = deps;
  }

  private async unwrapIpc(channel: string, ...args: any[]): Promise<any> {
    const res = await this.deps.invokeIpc(channel, ...args);
    if (res && typeof res === 'object' && 'success' in res) {
      if (!res.success) {
        throw new Error(res.error || `IPC channel "${channel}" failed`);
      }
      return res.data !== undefined ? res.data : res;
    }
    return res;
  }

  private async resolveSafeDirOrFile(rawPath: string): Promise<string> {
    const appCfg = (await this.deps.getData('config.json').catch(() => ({}))) || {};
    const baseDir = String(appCfg.baseDir || '').trim() || this.deps.config.dataDir;
    return resolveConfinedPath(rawPath, baseDir, [this.deps.config.dataDir]);
  }

  async getOverview() {
    const [projects, participants, tasks, inboxSummary, appConfig] = await Promise.all([
      this.unwrapIpc('get-projects').catch(() => []),
      this.unwrapIpc('get-participants').catch(() => []),
      this.unwrapIpc('get-tasks').catch(() => []),
      this.deps.inboxService.getUnreadSummary(),
      this.deps.getData('config.json').catch(() => ({})),
    ]);

    const tgService = this.deps.getTelegramService?.();
    const tgStatus = tgService ? await tgService.getStatusAsync().catch(() => null) : null;

    let aiEnvReady = false;
    try {
      const EnvironmentManager = require('../electron/services/EnvironmentManager.cjs');
      aiEnvReady = await EnvironmentManager.isEnvironmentReady();
    } catch {}

    const activeProjects = Array.isArray(projects)
      ? projects.filter((p: any) => !p.isArchived)
      : [];

    return {
      serverMode: this.deps.config.isServerMode,
      dataDir: this.deps.config.dataDir,
      baseDir: appConfig?.baseDir || this.deps.config.dataDir,
      aiEnvDir: this.deps.config.aiEnvDir,
      aiEnvReady,
      projectCount: Array.isArray(projects) ? projects.length : 0,
      activeProjectCount: activeProjects.length,
      participantCount: Array.isArray(participants) ? participants.length : 0,
      runningTasks: Array.isArray(tasks)
        ? tasks.filter((t: any) => t.status === 'running' || t.status === 'pending').length
        : 0,
      inbox: inboxSummary,
      telegram: tgStatus
        ? {
            mtprotoStatus: tgStatus.status,
            botConnected: tgStatus.botConnected,
            me: tgStatus.me?.username || tgStatus.me?.firstName || null,
          }
        : null,
    };
  }

  async listProjects(params: { includeArchived?: boolean } = {}) {
    const projects = await this.unwrapIpc('get-projects');
    const list = Array.isArray(projects) ? projects : [];
    const filtered = params.includeArchived ? list : list.filter((p: any) => !p.isArchived);
    return filtered.map((p: any) => ({
      id: p.id,
      title: p.title,
      originalTitle: p.originalTitle,
      releaseType: p.releaseType,
      isOngoing: Boolean(p.isOngoing),
      isArchived: Boolean(p.isArchived),
      totalEpisodes: p.totalEpisodes,
      lastActiveEpisode: p.lastActiveEpisode,
      anime365Id: p.anime365Id,
      episodesCount: Array.isArray(p.episodes) ? p.episodes.length : 0,
      episodesSummary: Array.isArray(p.episodes)
        ? p.episodes.map((e: any) => ({
            id: e.id,
            number: e.number,
            title: e.title,
            status: e.status,
            deadline: e.deadline,
            hasRaw: Boolean(e.rawPath),
            hasSub: Boolean(e.subPath),
            assignmentsCount: Array.isArray(e.assignments) ? e.assignments.length : 0,
            uploadsCount: Array.isArray(e.uploads) ? e.uploads.length : 0,
          }))
        : [],
    }));
  }

  async getProject(projectId: string) {
    return await this.unwrapIpc('get-project', projectId);
  }

  async saveProject(project: Record<string, any>) {
    const clean = {
      ...project,
      id: project.id || `proj_${Date.now()}`,
      assignedDubberIds: Array.isArray(project.assignedDubberIds) ? project.assignedDubberIds : [],
    };
    return await this.unwrapIpc('save-project', clean);
  }

  async listEpisodes(projectId?: string) {
    const episodes = await this.deps.getData('episodes.json').catch(() => []);
    const list = Array.isArray(episodes) ? episodes : [];
    return projectId ? list.filter((e: any) => e.projectId === projectId) : list;
  }

  async getEpisode(params: { episodeId?: string; projectId?: string; episodeNumber?: number }) {
    const episodes = await this.deps.getData('episodes.json').catch(() => []);
    const list = Array.isArray(episodes) ? episodes : [];
    let found: any = null;
    if (params.episodeId) {
      found = list.find((e: any) => e.id === params.episodeId);
    } else if (params.projectId && params.episodeNumber !== undefined) {
      found = list.find(
        (e: any) => e.projectId === params.projectId && Number(e.number) === Number(params.episodeNumber)
      );
    }
    if (!found) {
      throw new Error('Эпизод не найден');
    }
    const projects = await this.deps.getData('projects.json').catch(() => []);
    const project = Array.isArray(projects) ? projects.find((p: any) => p.id === found.projectId) : null;
    return { ...found, project: project || undefined };
  }

  async saveEpisode(episode: Record<string, any>) {
    const clean = {
      ...episode,
      id: episode.id || `ep_${Date.now()}`,
      status: episode.status || 'UPLOAD',
      assignments: Array.isArray(episode.assignments) ? episode.assignments : [],
      uploads: Array.isArray(episode.uploads) ? episode.uploads : [],
    };
    return await this.unwrapIpc('save-episode', clean);
  }

  async listParticipants() {
    return await this.unwrapIpc('get-participants');
  }

  async saveParticipant(participant: Record<string, any>) {
    const clean = {
      ...participant,
      id: participant.id || `part_${Date.now()}`,
    };
    return await this.unwrapIpc('save-participant', clean);
  }

  async searchAnime(query: string, source: 'anime365' | 'all' = 'anime365') {
    if (source === 'all') {
      return await this.unwrapIpc('anime-parsers:search-all', { query });
    }
    return await this.unwrapIpc('anime365-search-series', { query });
  }

  async syncProjectAnime365(projectId: string) {
    return await this.unwrapIpc('anime365-update-project-data', { projectId });
  }

  async searchTorrents(params: { query: string; category?: string; subCategory?: string }) {
    return await this.unwrapIpc('search-nyaa-torrents', params);
  }

  async getTorrentMetadata(params: { torrentUrl?: string; magnet?: string }) {
    return await this.unwrapIpc('get-torrent-metadata', params);
  }

  async downloadEpisodeMedia(params: {
    sourceType: 'anime365' | 'torrent' | 'youtube' | 'anime365_sub';
    url?: string;
    fallbackUrls?: string[];
    magnet?: string;
    torrentUrl?: string;
    fileIndex?: number;
    formatId?: string;
    subLang?: string;
    targetDir?: string;
    fileName?: string;
    episodeId?: string;
  }) {
    const resolvedTargetDir = params.targetDir
      ? await this.resolveSafeDirOrFile(params.targetDir)
      : await this.resolveSafeDirOrFile('downloads');
    await fs.mkdir(resolvedTargetDir, { recursive: true });

    if (params.sourceType === 'anime365') {
      if (!params.url || !params.fileName) {
        throw new Error('Для Anime365 укажите url и fileName');
      }
      return await this.unwrapIpc('anime365-start-direct-download', {
        url: params.url,
        fallbackUrls: params.fallbackUrls,
        targetDir: resolvedTargetDir,
        fileName: params.fileName,
        episodeId: params.episodeId,
      });
    }

    if (params.sourceType === 'anime365_sub') {
      if (!params.url) throw new Error('Укажите url субтитров');
      return await this.unwrapIpc('anime365-download-subtitle', {
        url: params.url,
        episodeId: params.episodeId,
      });
    }

    if (params.sourceType === 'torrent') {
      return await this.unwrapIpc('start-torrent-download', {
        torrentUrl: params.torrentUrl,
        magnet: params.magnet,
        fileIndex: params.fileIndex,
      });
    }

    if (params.sourceType === 'youtube') {
      if (!params.url) throw new Error('Укажите YouTube URL');
      return await this.unwrapIpc('youtube-download', {
        url: params.url,
        formatId: params.formatId || 'best',
        subLang: params.subLang || 'none',
        targetDir: resolvedTargetDir,
        baseFilename: params.fileName || `yt_${Date.now()}`,
      });
    }

    throw new Error(`Неизвестный sourceType: ${params.sourceType}`);
  }

  async listTasks() {
    const [queueTasks, directDownloads] = await Promise.all([
      this.unwrapIpc('get-tasks').catch(() => []),
      this.unwrapIpc('get-active-downloads').catch(() => []),
    ]);
    return { queueTasks, torrentDownloads: directDownloads };
  }

  async getTaskStatus(taskId: string) {
    const queueTasks = await this.unwrapIpc('get-tasks').catch(() => []);
    const found = Array.isArray(queueTasks) ? queueTasks.find((t: any) => t.id === taskId) : null;
    if (found) return found;

    if (taskId.startsWith('direct-dl-')) {
      return await this.unwrapIpc('anime365-get-direct-download-status', { downloadId: taskId });
    }
    if (taskId.startsWith('dl-')) {
      return await this.unwrapIpc('get-torrent-download-status', { downloadId: taskId });
    }
    throw new Error(`Задача ${taskId} не найдена`);
  }

  async abortTask(taskId: string) {
    if (taskId.startsWith('direct-dl-')) {
      return await this.unwrapIpc('anime365-cancel-direct-download', { downloadId: taskId });
    }
    return await this.unwrapIpc('abort-task', taskId);
  }

  async inspectSubtitles(filePath: string) {
    const safePath = await this.resolveSafeDirOrFile(filePath);
    return await this.unwrapIpc('get-raw-subtitles', safePath);
  }

  async autoFixSubtitles(filePath: string, options: Record<string, any> = {}) {
    const safePath = await this.resolveSafeDirOrFile(filePath);
    return await this.unwrapIpc('auto-fix-subtitles', { filePath: safePath, options });
  }

  async splitSubtitlesByDubber(params: {
    episodeId: string;
    outputDirectory?: string;
    options?: Record<string, any>;
  }) {
    const ep = await this.getEpisode({ episodeId: params.episodeId });
    if (!ep.subPath) throw new Error('У серии не привязан файл субтитров (subPath)');
    const safeSub = await this.resolveSafeDirOrFile(ep.subPath);
    const outDir = params.outputDirectory
      ? await this.resolveSafeDirOrFile(params.outputDirectory)
      : path.join(path.dirname(safeSub), 'dubber_subs');
    await fs.mkdir(outDir, { recursive: true });
    return await this.unwrapIpc('split-subs-by-dubber', {
      assFilePath: safeSub,
      outputDirectory: outDir,
      assignments: ep.assignments || [],
      options: params.options || {},
    });
  }

  async assignDubbers(params: {
    episodeId: string;
    assignments: Array<{ characterName: string; dubberId: string; substituteId?: string; linesCount?: number }>;
    mergeExisting?: boolean;
    notifyTelegram?: boolean;
    telegramChatPeer?: string;
    telegramTopicId?: number;
  }) {
    const ep = await this.getEpisode({ episodeId: params.episodeId });
    const existing = Array.isArray(ep.assignments) ? [...ep.assignments] : [];
    let nextAssignments = params.assignments;

    if (params.mergeExisting !== false) {
      const byChar = new Map<string, any>();
      for (const a of existing) {
        if (a?.characterName) byChar.set(a.characterName, a);
      }
      for (const a of params.assignments) {
        if (a?.characterName) byChar.set(a.characterName, a);
      }
      nextAssignments = Array.from(byChar.values());
    }

    const updated = await this.saveEpisode({
      ...ep,
      assignments: nextAssignments,
    });

    if (params.notifyTelegram && params.telegramChatPeer) {
      const participants = (await this.listParticipants().catch(() => [])) || [];
      const partMap = new Map<string, any>(participants.map((p: any) => [String(p.id), p]));
      const dubberNames = Array.from(
        new Set(
          nextAssignments
            .map((a: any) => {
              const p = partMap.get(String(a.dubberId));
              return p?.nickname || p?.name;
            })
            .filter(Boolean)
        )
      ).join(', ');
      await this.unwrapIpc('telegram-mtproto-send-automation', {
        type: 'start',
        targetPeer: params.telegramChatPeer,
        topicId: params.telegramTopicId,
        payload: {
          project_title: ep.project?.title || 'Проект',
          episode_number: ep.number,
          dubbers_list: dubberNames || 'Не указаны',
          deadline: ep.deadline || 'Не задан',
          source_link: '',
        },
      }).catch(() => {});
    }

    return updated;
  }

  async scanTelegramTracks(params: { chatPeer: string; topicId?: number; limit?: number }) {
    return await this.unwrapIpc('telegram-mtproto-get-audio-files', params);
  }

  async downloadTelegramTrack(params: {
    chatPeer: string;
    messageId: number;
    targetDir: string;
    customFileName?: string;
  }) {
    const safeDir = await this.resolveSafeDirOrFile(params.targetDir);
    await fs.mkdir(safeDir, { recursive: true });
    return await this.unwrapIpc('telegram-mtproto-download-audio', {
      chatPeer: params.chatPeer,
      messageId: params.messageId,
      targetDir: safeDir,
      customFileName: params.customFileName,
    });
  }

  async runAudioAnalysis(params: { filePath: string; subPath?: string; isFix?: boolean; force?: boolean }) {
    const safeAudio = await this.resolveSafeDirOrFile(params.filePath);
    const safeSub = params.subPath ? await this.resolveSafeDirOrFile(params.subPath) : undefined;
    return await this.unwrapIpc('audio-get-track-analysis', {
      audioPath: safeAudio,
      force: Boolean(params.force),
      options: {
        subPath: safeSub,
        isFix: Boolean(params.isFix),
      },
    });
  }

  private parseSubtitleTimeToSec(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string') return NaN;
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    const parts = trimmed.split(':');
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2].replace(',', '.'));
      if ([h, m, s].every(Number.isFinite)) return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1].replace(',', '.'));
      if ([m, s].every(Number.isFinite)) return m * 60 + s;
    }
    return NaN;
  }

  async runQaCheck(params: { episodeId: string; audioFilePath: string; model?: string; language?: string }) {
    const ep = await this.getEpisode({ episodeId: params.episodeId });
    const safeAudio = await this.resolveSafeDirOrFile(params.audioFilePath);
    let lines: Array<{
      lineIndex: number;
      text: string;
      startSec: number;
      endSec: number;
      characterName: string;
    }> = [];
    if (ep.subPath) {
      const rawSubs = await this.unwrapIpc('get-raw-subtitles', ep.subPath);
      const subLines = Array.isArray(rawSubs?.lines) ? rawSubs.lines : [];
      lines = subLines
        .slice(0, 120)
        .map((l: any, idx: number) => {
          const startSec = this.parseSubtitleTimeToSec(l.startSec ?? l.start);
          const endSec = this.parseSubtitleTimeToSec(l.endSec ?? l.end);
          return {
            lineIndex: l.lineIndex ?? idx,
            text: l.text || '',
            startSec,
            endSec,
            characterName: String(l.name || l.characterName || ''),
          };
        })
        .filter((l) => Number.isFinite(l.startSec) && Number.isFinite(l.endSec) && l.endSec > l.startSec);
    }
    return await this.unwrapIpc('qa-whisper-check-lines', {
      audioFilePath: safeAudio,
      lines,
      model: params.model || 'small',
      language: params.language || 'ru',
    });
  }

  async runAutoTiming(params: { episodeId: string; options?: Record<string, any> }) {
    const ep = await this.getEpisode({ episodeId: params.episodeId });
    return await this.unwrapIpc('run-auto-timing-analysis', {
      episode: ep,
      options: params.options || {},
    });
  }

  async exportForSoundEngineer(params: {
    episodeId: string;
    targetDir?: string;
    includeSubtitles?: boolean;
    autoTiming?: boolean;
    smartExport?: boolean;
    skipConversion?: boolean;
    autoApplyFixes?: boolean;
  }) {
    const ep = await this.getEpisode({ episodeId: params.episodeId });
    const safeTargetDir = params.targetDir ? await this.resolveSafeDirOrFile(params.targetDir) : undefined;
    return await this.unwrapIpc('export-sound-engineer-files', {
      episode: ep,
      targetDir: safeTargetDir,
      includeSubtitles: params.includeSubtitles ?? true,
      autoTiming: params.autoTiming ?? false,
      smartExport: params.smartExport ?? false,
      skipConversion: params.skipConversion ?? false,
      autoApplyFixes: params.autoApplyFixes ?? true,
    });
  }

  async buildRelease(params: { episodeId: string; targetDir?: string; options?: Record<string, any> }) {
    const ep = await this.getEpisode({ episodeId: params.episodeId });
    const safeTargetDir = params.targetDir
      ? await this.resolveSafeDirOrFile(params.targetDir)
      : await this.resolveSafeDirOrFile(path.join('releases', `${ep.projectId || 'project'}_ep_${ep.number ?? ep.id}`));
    await fs.mkdir(safeTargetDir, { recursive: true });
    return await this.unwrapIpc('build-release', {
      episode: ep,
      targetDir: safeTargetDir,
      ...(params.options || {}),
    });
  }

  async sendTelegramMessage(params: {
    targetPeer: string;
    text: string;
    topicId?: number;
    mediaPath?: string;
    pin?: boolean;
  }) {
    const safeMedia = params.mediaPath ? await this.resolveSafeDirOrFile(params.mediaPath) : undefined;
    return await this.unwrapIpc('telegram-mtproto-send-post', {
      targetPeer: params.targetPeer,
      text: params.text,
      topicId: params.topicId,
      mediaPath: safeMedia,
      pin: Boolean(params.pin),
    });
  }

  async notifyCurator(params: {
    title: string;
    message: string;
    category?: 'approval' | 'qa_alert' | 'assignment_review' | 'download_issue' | 'release_ready' | 'note' | 'info';
    severity?: 'info' | 'warning' | 'action_required' | 'critical';
    projectId?: string;
    projectTitle?: string;
    episodeId?: string;
    episodeNumber?: number;
    targetTab?:
      | 'dashboard'
      | 'inbox'
      | 'video-editor'
      | 'subtitles'
      | 'qa'
      | 'timing'
      | 'mixing'
      | 'cover'
      | 'release'
      | 'telegram'
      | 'archive'
      | 'stats'
      | 'database'
      | 'settings';
    proposedAction?: string;
    metadata?: Record<string, any>;
    notifyTelegram?: boolean;
  }) {
    return await this.deps.inboxService.create({
      ...params,
      source: 'ai_agent',
      notifyTelegram: params.notifyTelegram !== false,
    });
  }

  async listCuratorInbox(filters?: { status?: string; projectId?: string; limit?: number }) {
    return await this.deps.inboxService.list(filters);
  }

  async getInboxItem(id: string) {
    const item = await this.deps.inboxService.getById(id);
    if (!item) throw new Error(`Запись inbox ${id} не найдена`);
    return item;
  }

  async respondCuratorInbox(params: {
    id: string;
    status?: 'approved' | 'rejected' | 'noted' | 'resolved' | 'pending';
    curatorNote?: string;
  }) {
    return await this.deps.inboxService.respond(params.id, {
      status: params.status,
      curatorNote: params.curatorNote,
      read: true,
    });
  }

  async invokeIpcRaw(channel: string, args: any[] = []) {
    return await this.unwrapIpc(channel, ...args);
  }

  getCuratorPlaybookMarkdown(): string {
    return [
      '# Anime Dub Manager — Playbook для локального AI-агента (Куратор)',
      '',
      'Вы выполняете роль помощника и заместителя куратора студии озвучки.',
      '',
      '## Базовый цикл работы над серией:',
      '1. **Изучите текущую ситуацию**: вызовите `get_overview` и `list_projects`. Проверьте `list_curator_inbox` на наличие новых пометок или решений человека.',
      '2. **Поиск и загрузка серии**:',
      '   - Найдите сериал через `search_anime` (Anime365 / All) или торрент через `search_torrents`.',
      '   - Запустите скачивание через `download_episode_media` и отслеживайте статус до завершения через `get_task_status`.',
      '   - Привяжите пути `rawPath` / `subPath` к эпизоду через `save_episode`.',
      '3. **Подготовка субтитров и назначение даберов**:',
      '   - Проинспектируйте реплики через `inspect_subtitles` и очистите ошибки через `auto_fix_subtitles`.',
      '   - Сверьте список участников (`list_participants`) и глобальный маппинг проекта (`get_project`).',
      '   - Назначьте роли через `assign_dubbers` и при необходимости нарежьте субтитры через `split_subtitles_by_dubber`.',
      '   - Если есть спорные или новые персонажи без явного актёра — **не угадывайте молча**, отправьте запрос на подтверждение в `notify_curator` (`category: "assignment_review"`, `severity: "action_required"`).',
      '4. **Приёмка дорожек, QA и автотайминг**:',
      '   - Проверьте новые дорожки в чате/топике студии через `scan_telegram_tracks` и скачайте их через `download_telegram_track`.',
      '   - Запустите `run_audio_analysis` (клиппинг, тишина, уровень шума) и при необходимости `run_qa_check`.',
      '   - Если обнаружены дефекты записи (брак, клиппинг, пропущенные фразы), отправьте отчёт в `notify_curator` (`category: "qa_alert"`, `targetTab: "qa"`) с таймкодами.',
      '   - Запустите `run_auto_timing` и `export_for_sound_engineer` когда все дорожки проверены.',
      '5. **Финальный релиз и эскалация**:',
      '   - Перед финальной публикацией поста или релизного видео (`build_release` / `send_telegram_message`) запрашивайте одобрение куратора через `notify_curator` (`category: "approval"`, `severity: "action_required"`), затем проверяйте вердикт через `get_inbox_item` или `list_curator_inbox`.',
    ].join('\n');
  }

  getZodSchemas() {
    return {
      z,
    };
  }
}
