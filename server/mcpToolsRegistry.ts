import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentToolsEngine } from './agentToolsEngine.ts';

function okJson(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errText(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
  };
}

export interface ToolSummaryItem {
  name: string;
  description: string;
}

export const ADM_TOOL_CATALOG: ToolSummaryItem[] = [
  { name: 'get_overview', description: 'Получить сводку состояния сервера, AI_env, активных задач и непрочитанных запросов куратора.' },
  { name: 'list_projects', description: 'Список проектов студии (тайтлы, статус онгоинга, сводка по сериям).' },
  { name: 'get_project', description: 'Полная информация о проекте, ролях, участниках и сериях.' },
  { name: 'save_project', description: 'Создать или обновить проект.' },
  { name: 'list_episodes', description: 'Список серий (всех или конкретного проекта).' },
  { name: 'get_episode', description: 'Получить данные серии, назначения даберов и загруженные дорожки.' },
  { name: 'save_episode', description: 'Создать или обновить серию (status, rawPath, subPath, deadline, assignments, uploads).' },
  { name: 'list_participants', description: 'Список всех участников студии (даберы, звукорежиссеры, таймеры) и их контактов.' },
  { name: 'save_participant', description: 'Добавить или обновить участника студии.' },
  { name: 'search_anime', description: 'Поиск аниме в базе Anime365 или по всем парсерам.' },
  { name: 'sync_project_anime365', description: 'Автоматически синхронизировать метаданные проекта и расписание серий с Anime365/Shikimori.' },
  { name: 'search_torrents', description: 'Поиск торрентов (Nyaa / TokyoTosho / SubsPlease RSS) по названию тайтла или серии.' },
  { name: 'get_torrent_metadata', description: 'Получить список файлов внутри торрента перед скачиванием.' },
  { name: 'download_episode_media', description: 'Запустить скачивание видео или субтитров на сервер (Anime365, Torrent, YouTube).' },
  { name: 'list_tasks', description: 'Показать активные и недавние фоновые задачи сервера (скачивания, FFmpeg, AI).' },
  { name: 'get_task_status', description: 'Проверить прогресс и статус конкретной фоновой задачи или загрузки.' },
  { name: 'abort_task', description: 'Остановить выполняющуюся задачу или загрузку.' },
  { name: 'inspect_subtitles', description: 'Прочитать и распарсить файл субтитров (.ass/.srt) серии.' },
  { name: 'auto_fix_subtitles', description: 'Автоматически очистить и нормализовать файл субтитров.' },
  { name: 'split_subtitles_by_dubber', description: 'Нарезать индивидуальные файлы субтитров для каждого назначенного дабера.' },
  { name: 'assign_dubbers', description: 'Назначить даберов на роли в серии и (опционально) отправить уведомление о старте в Telegram.' },
  { name: 'scan_telegram_tracks', description: 'Просканировать аудиодорожки и архивы от даберов в Telegram-чате или теме форума.' },
  { name: 'download_telegram_track', description: 'Скачать конкретную аудиодорожку из Telegram-сообщения в папку серии на сервере.' },
  { name: 'run_audio_analysis', description: 'Провести технический анализ аудиодорожки (громкость, клиппинг, шум, паузы).' },
  { name: 'run_qa_check', description: 'Запустить Whisper QA проверку соответствия озвученной дорожки тексту субтитров.' },
  { name: 'run_auto_timing', description: 'Выполнить автоматический тайминг дорожек серии и разрешение коллизий.' },
  { name: 'export_for_sound_engineer', description: 'Собрать и экспортировать комплект дорожек, видео и субтитров для звукорежиссера.' },
  { name: 'build_release', description: 'Собрать финальный релиз серии.' },
  { name: 'send_telegram_message', description: 'Отправить сообщение, уведомление или пост с медиафайлом в Telegram.' },
  { name: 'notify_curator', description: 'Отправить уведомление, отчет или запрос подтверждения куратору в Web Inbox и Telegram.' },
  { name: 'list_curator_inbox', description: 'Просмотреть уведомления, запросы на подтверждение и заметки куратора.' },
  { name: 'get_inbox_item', description: 'Получить конкретную запись Curator Inbox вместе с вердиктом и заметкой куратора.' },
  { name: 'respond_curator_inbox', description: 'Обновить статус или добавить заметку к записи Curator Inbox.' },
  { name: 'check_system_updates', description: 'Проверить наличие новых релизов сервера и обновлений AI_env на GitHub Releases.' },
  { name: 'apply_system_update', description: 'Установить доступное обновление сервера (adm-server-bundle и при необходимости AI_env) с перезапуском.' },
  { name: 'invoke_ipc_raw', description: 'Расширенный вызов любого зарегистрированного IPC-канала бэкенда.' },
];

export interface ToolExecutor {
  execute(toolName: string, args: Record<string, any>): Promise<any>;
  getPlaybook(): string;
  listTools(): ToolSummaryItem[];
}

export function createDirectToolExecutor(engine: AgentToolsEngine): ToolExecutor {
  const map: Record<string, (args: any) => Promise<any>> = {
    get_overview: () => engine.getOverview(),
    list_projects: (a) => engine.listProjects(a),
    get_project: (a) => engine.getProject(a.projectId),
    save_project: (a) => engine.saveProject(a.project),
    list_episodes: (a) => engine.listEpisodes(a.projectId),
    get_episode: (a) => engine.getEpisode(a),
    save_episode: (a) => engine.saveEpisode(a.episode),
    list_participants: () => engine.listParticipants(),
    save_participant: (a) => engine.saveParticipant(a.participant),
    search_anime: (a) => engine.searchAnime(a.query, a.source),
    sync_project_anime365: (a) => engine.syncProjectAnime365(a.projectId),
    search_torrents: (a) => engine.searchTorrents(a),
    get_torrent_metadata: (a) => engine.getTorrentMetadata(a),
    download_episode_media: (a) => engine.downloadEpisodeMedia(a),
    list_tasks: () => engine.listTasks(),
    get_task_status: (a) => engine.getTaskStatus(a.taskId),
    abort_task: (a) => engine.abortTask(a.taskId),
    inspect_subtitles: (a) => engine.inspectSubtitles(a.filePath),
    auto_fix_subtitles: (a) => engine.autoFixSubtitles(a.filePath, a.options),
    split_subtitles_by_dubber: (a) => engine.splitSubtitlesByDubber(a),
    assign_dubbers: (a) => engine.assignDubbers(a),
    scan_telegram_tracks: (a) => engine.scanTelegramTracks(a),
    download_telegram_track: (a) => engine.downloadTelegramTrack(a),
    run_audio_analysis: (a) => engine.runAudioAnalysis(a),
    run_qa_check: (a) => engine.runQaCheck(a),
    run_auto_timing: (a) => engine.runAutoTiming(a),
    export_for_sound_engineer: (a) => engine.exportForSoundEngineer(a),
    build_release: (a) => engine.buildRelease(a),
    send_telegram_message: (a) => engine.sendTelegramMessage(a),
    notify_curator: (a) => engine.notifyCurator(a),
    list_curator_inbox: (a) => engine.listCuratorInbox(a),
    get_inbox_item: (a) => engine.getInboxItem(a.id),
    respond_curator_inbox: (a) => engine.respondCuratorInbox(a),
    check_system_updates: () => engine.checkSystemUpdates(),
    apply_system_update: (a) => engine.applySystemUpdate(Boolean(a?.force)),
    invoke_ipc_raw: (a) => engine.invokeIpcRaw(a.channel, a.args),
  };

  return {
    async execute(toolName: string, args: Record<string, any>) {
      const fn = map[toolName];
      if (!fn) {
        throw new Error(`Unknown ADM tool: ${toolName}`);
      }
      return await fn(args || {});
    },
    getPlaybook() {
      return engine.getCuratorPlaybookMarkdown();
    },
    listTools() {
      return ADM_TOOL_CATALOG;
    },
  };
}

export function createAdmMcpServer(executor: ToolExecutor): McpServer {
  const server = new McpServer({
    name: 'anime-dub-manager',
    version: '1.2.0',
  });

  const reg = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: T,
    handler?: (args: z.infer<z.ZodObject<T>>) => Promise<any>
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: shape,
      },
      (async (args: any) => {
        try {
          const result = handler ? await handler(args) : await executor.execute(name, args);
          return okJson(result);
        } catch (err) {
          return errText(err);
        }
      }) as any
    );
  };

  reg('get_overview', 'Получить сводку состояния сервера, AI_env, активных задач и непрочитанных запросов куратора.', {});

  reg('list_projects', 'Список проектов студии (тайтлы, статус онгоинга, сводка по сериям).', {
    includeArchived: z.boolean().optional().describe('Включить архивные проекты'),
  });

  reg('get_project', 'Полная информация о проекте, ролях, участниках и сериях.', {
    projectId: z.string().describe('ID проекта'),
  });

  reg('save_project', 'Создать или обновить проект.', {
    project: z.record(z.any()).describe('Объект проекта (title, originalTitle, releaseType, isOngoing, globalMapping и т.д.)'),
  });

  reg('list_episodes', 'Список серий (всех или конкретного проекта).', {
    projectId: z.string().optional().describe('Фильтр по ID проекта'),
  });

  reg('get_episode', 'Получить данные серии, назначения даберов и загруженные дорожки.', {
    episodeId: z.string().optional(),
    projectId: z.string().optional(),
    episodeNumber: z.number().optional(),
  });

  reg('save_episode', 'Создать или обновить серию (status, rawPath, subPath, deadline, assignments, uploads).', {
    episode: z.record(z.any()).describe('Объект серии'),
  });

  reg('list_participants', 'Список всех участников студии (даберы, звукорежиссеры, таймеры) и их контактов.', {});

  reg('save_participant', 'Добавить или обновить участника студии.', {
    participant: z.record(z.any()).describe('Данные участника (name, role, telegram, notes и т.д.)'),
  });

  reg('search_anime', 'Поиск аниме в базе Anime365 или по всем парсерам.', {
    query: z.string().describe('Название аниме для поиска'),
    source: z.enum(['anime365', 'all']).optional().default('anime365'),
  });

  reg('sync_project_anime365', 'Автоматически синхронизировать метаданные проекта и расписание серий с Anime365/Shikimori.', {
    projectId: z.string().describe('ID проекта'),
  });

  reg('search_torrents', 'Поиск торрентов (Nyaa / TokyoTosho / SubsPlease RSS) по названию тайтла или серии.', {
    query: z.string().describe('Поисковый запрос'),
    category: z.string().optional(),
    subCategory: z.string().optional(),
  });

  reg('get_torrent_metadata', 'Получить список файлов внутри торрента перед скачиванием.', {
    torrentUrl: z.string().optional(),
    magnet: z.string().optional(),
  });

  reg('download_episode_media', 'Запустить скачивание видео или субтитров на сервер (Anime365, Torrent, YouTube).', {
    sourceType: z.enum(['anime365', 'torrent', 'youtube', 'anime365_sub']),
    url: z.string().optional(),
    fallbackUrls: z.array(z.string()).optional(),
    magnet: z.string().optional(),
    torrentUrl: z.string().optional(),
    fileIndex: z.number().optional(),
    formatId: z.string().optional(),
    subLang: z.string().optional(),
    targetDir: z.string().optional().describe('Папка внутри хранилища сервера'),
    fileName: z.string().optional(),
    episodeId: z.string().optional(),
  });

  reg('list_tasks', 'Показать активные и недавние фоновые задачи сервера (скачивания, FFmpeg, AI).', {});

  reg('get_task_status', 'Проверить прогресс и статус конкретной фоновой задачи или загрузки.', {
    taskId: z.string().describe('ID задачи или загрузки'),
  });

  reg('abort_task', 'Остановить выполняющуюся задачу или загрузку.', {
    taskId: z.string().describe('ID задачи'),
  });

  reg('inspect_subtitles', 'Прочитать и распарсить файл субтитров (.ass/.srt) серии.', {
    filePath: z.string().describe('Путь к файлу субтитров на сервере'),
  });

  reg('auto_fix_subtitles', 'Автоматически очистить и нормализовать файл субтитров.', {
    filePath: z.string().describe('Путь к файлу субтитров'),
    options: z.record(z.any()).optional(),
  });

  reg('split_subtitles_by_dubber', 'Нарезать индивидуальные файлы субтитров для каждого назначенного дабера.', {
    episodeId: z.string().describe('ID серии'),
    outputDirectory: z.string().optional(),
    options: z.record(z.any()).optional(),
  });

  reg('assign_dubbers', 'Назначить даберов на роли в серии и (опционально) отправить уведомление о старте в Telegram.', {
    episodeId: z.string(),
    assignments: z.array(
      z.object({
        characterName: z.string(),
        dubberId: z.string(),
        substituteId: z.string().optional(),
        linesCount: z.number().optional(),
      })
    ),
    mergeExisting: z.boolean().optional().default(true),
    notifyTelegram: z.boolean().optional().default(false),
    telegramChatPeer: z.string().optional(),
    telegramTopicId: z.number().optional(),
  });

  reg('scan_telegram_tracks', 'Просканировать аудиодорожки и архивы от даберов в Telegram-чате или теме форума.', {
    chatPeer: z.string().describe('ID, @username или peer чата/супергруппы'),
    topicId: z.number().optional().describe('ID темы форума (если супергруппа с топиками)'),
    limit: z.number().optional().default(100),
  });

  reg('download_telegram_track', 'Скачать конкретную аудиодорожку из Telegram-сообщения в папку серии на сервере.', {
    chatPeer: z.string(),
    messageId: z.number(),
    targetDir: z.string(),
    customFileName: z.string().optional(),
  });

  reg('run_audio_analysis', 'Провести технический анализ аудиодорожки (громкость, клиппинг, шум, паузы).', {
    filePath: z.string(),
    subPath: z.string().optional(),
    isFix: z.boolean().optional(),
    force: z.boolean().optional(),
  });

  reg('run_qa_check', 'Запустить Whisper QA проверку соответствия озвученной дорожки тексту субтитров.', {
    episodeId: z.string(),
    audioFilePath: z.string(),
    model: z.string().optional().default('small'),
    language: z.string().optional().default('ru'),
  });

  reg('run_auto_timing', 'Выполнить автоматический тайминг дорожек серии и разрешение коллизий.', {
    episodeId: z.string(),
    options: z.record(z.any()).optional(),
  });

  reg('export_for_sound_engineer', 'Собрать и экспортировать комплект дорожек, видео и субтитров для звукорежиссера.', {
    episodeId: z.string(),
    targetDir: z.string().optional(),
    includeSubtitles: z.boolean().optional(),
    autoTiming: z.boolean().optional(),
    smartExport: z.boolean().optional(),
    skipConversion: z.boolean().optional(),
    autoApplyFixes: z.boolean().optional(),
  });

  reg('build_release', 'Собрать финальный релиз серии.', {
    episodeId: z.string(),
    targetDir: z.string().optional(),
    options: z.record(z.any()).optional(),
  });

  reg('send_telegram_message', 'Отправить сообщение, уведомление или пост с медиафайлом в Telegram.', {
    targetPeer: z.string(),
    text: z.string(),
    topicId: z.number().optional(),
    mediaPath: z.string().optional(),
    pin: z.boolean().optional(),
  });

  reg('notify_curator', 'Отправить уведомление, отчет или запрос подтверждения куратору в Web Inbox и Telegram.', {
    title: z.string(),
    message: z.string(),
    category: z.enum(['approval', 'qa_alert', 'assignment_review', 'download_issue', 'release_ready', 'note', 'info']).optional(),
    severity: z.enum(['info', 'warning', 'action_required', 'critical']).optional(),
    projectId: z.string().optional(),
    projectTitle: z.string().optional(),
    episodeId: z.string().optional(),
    episodeNumber: z.number().optional(),
    targetTab: z
      .enum([
        'dashboard',
        'inbox',
        'video-editor',
        'subtitles',
        'qa',
        'timing',
        'mixing',
        'cover',
        'release',
        'telegram',
        'archive',
        'stats',
        'database',
        'settings',
      ])
      .optional(),
    proposedAction: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    notifyTelegram: z.boolean().optional().default(true),
  });

  reg('list_curator_inbox', 'Просмотреть уведомления, запросы на подтверждение и заметки куратора.', {
    status: z.enum(['all', 'pending', 'approved', 'rejected', 'noted', 'resolved']).optional(),
    projectId: z.string().optional(),
    limit: z.number().optional(),
  });

  reg('get_inbox_item', 'Получить конкретную запись Curator Inbox вместе с вердиктом и заметкой куратора.', {
    id: z.string(),
  });

  reg('respond_curator_inbox', 'Обновить статус или добавить заметку к записи Curator Inbox.', {
    id: z.string(),
    status: z.enum(['approved', 'rejected', 'noted', 'resolved', 'pending']).optional(),
    curatorNote: z.string().optional(),
  });

  reg('check_system_updates', 'Проверить наличие новых релизов сервера и обновлений AI_env на GitHub Releases.', {});

  reg('apply_system_update', 'Установить доступное обновление сервера (adm-server-bundle и при необходимости AI_env) с перезапуском.', {
    force: z.boolean().optional().default(false),
  });

  reg('invoke_ipc_raw', 'Расширенный вызов любого зарегистрированного IPC-канала бэкенда.', {
    channel: z.string(),
    args: z.array(z.any()).optional().default([]),
  });

  server.registerResource(
    'curator-playbook',
    'adm://playbook/curator',
    {
      title: 'Playbook куратора Anime Dub Manager',
      description: 'Пошаговая инструкция для автономного AI-агента куратора студии озвучки.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: 'adm://playbook/curator',
          mimeType: 'text/markdown',
          text: executor.getPlaybook(),
        },
      ],
    })
  );

  server.registerPrompt(
    'curator-autopilot',
    {
      title: 'Режим автопилота куратора',
      description: 'Инструкция для агента по обработке текущих серий и эскалации спорных моментов куратору.',
      argsSchema: {
        goal: z.string().optional().describe('Конкретная цель на этот запуск (например, подготовить 7 серию)'),
      },
    },
    async ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${executor.getPlaybook()}\n\n${goal ? `Текущая задача от куратора: ${goal}` : 'Проверь активные проекты, новые дорожки и запросы, выполни рутинные шаги и при необходимости запроси подтверждение через notify_curator.'}`,
          },
        },
      ],
    })
  );

  return server;
}
