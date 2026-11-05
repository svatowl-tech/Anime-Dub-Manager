const fs = require('fs');
const path = require('path');

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ed607e10a39be2731a544f07';

const DEFAULT_TEMPLATES = {
  headerTemplate: '✨ <b>{title_ru}</b> [{episode_number} СЕРИЯ]',
  footerTemplate: '📌 Смотреть: {site_link}\n💬 Обсуждение: {tg_group}',
  startNoticeTemplate:
    '🎬 <b>СТАРТ РАБОТЫ НАД СЕРИЕЙ!</b>\n📌 <b>{project_title}</b> — Серия {episode_number}\n\n👥 <b>Состав команды:</b>\n{dubbers_list}\n\n📅 <b>ДЕДЛАЙН:</b> {deadline}\n🔗 <b>Материалы:</b> {source_link}',
  reminderTemplate:
    '⏰ <b>НАПОМИНАНИЕ О ДЕДЛАЙНЕ!</b>\nРелиз: <b>{project_title}</b> (Серия {episode_number})\n\nКоллеги, ожидаем ваши дорожки:\n{pending_dubbers}\n\nПросьба дописать как можно скорее! 🙏',
  fixNoticeTemplate:
    '⚠️ <b>СПИСОК ФИКСОВ / ПРАВОК</b>\nКому: {dubber_mention}\nПроект: <b>{project_title}</b> (Серия {episode_number})\n\n{fixes_list}',
  trackReceivedTemplate:
    '🎙️ <b>ДОРОЖКА ПРИНЯТА!</b>\nДабер: {dubber_name}\nСерия: {episode_number}\nСтатус: ✅ Готово к сведению'
};

class TelegramConfigStore {
  constructor(dataManager, userDataPath) {
    this.dataManager = dataManager;
    this.userDataPath = userDataPath || process.cwd();
    this.configFileName = 'telegram_mtproto_config.json';
    this.logs = [];
    this.maxLogs = 300;

    this.settings = {
      apiId: DEFAULT_API_ID,
      apiHash: DEFAULT_API_HASH,
      phoneNumber: '',
      sessionString: '',
      botToken: '',
      botMe: null,
      defaultChannelId: '',
      autoPin: false,
      autoNotify: true,
      parseMode: 'html',
      ...DEFAULT_TEMPLATES,
      peerCache: {}
    };
  }

  addLog(level, tag, message, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString('ru-RU'),
      level: level || 'info',
      tag: tag || 'General',
      message: String(message || ''),
      details: details
        ? typeof details === 'object'
          ? JSON.parse(JSON.stringify(details, Object.getOwnPropertyNames(details)))
          : String(details)
        : null
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const prefix = `[Telegram:${entry.tag}]`;
    if (level === 'error') {
      console.error(prefix, entry.message, details || '');
    } else if (level === 'warn') {
      console.warn(prefix, entry.message, details || '');
    } else {
      console.log(prefix, entry.message);
    }
    return entry;
  }

  getLogs(limit = 150) {
    return this.logs.slice(-Math.max(1, Number(limit) || 150));
  }

  clearLogs() {
    this.logs = [];
    this.addLog('info', 'System', 'Журнал логов Telegram очищен');
    return { success: true };
  }

  getDirectConfigFilePath() {
    return path.join(this.userDataPath, this.configFileName);
  }

  async load() {
    let loaded = null;

    if (this.dataManager && typeof this.dataManager.getData === 'function') {
      try {
        const dmData = await this.dataManager.getData(this.configFileName);
        if (dmData && typeof dmData === 'object' && Object.keys(dmData).length > 0) {
          loaded = dmData;
        }
      } catch (err) {
        this.addLog('warn', 'Config', `Чтение через DataManager не удалось: ${err.message}`);
      }
    }

    if (!loaded) {
      const filePath = this.getDirectConfigFilePath();
      try {
        if (fs.existsSync(filePath)) {
          const raw = await fs.promises.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            loaded = parsed;
          }
        }
      } catch (err) {
        this.addLog('warn', 'Config', `Чтение файла конфигурации не удалось: ${err.message}`);
      }
    }

    if (loaded && typeof loaded === 'object') {
      this.settings = {
        ...this.settings,
        ...loaded,
        apiId: Number(loaded.apiId) || DEFAULT_API_ID,
        apiHash: String(loaded.apiHash || DEFAULT_API_HASH).trim() || DEFAULT_API_HASH,
        peerCache: loaded.peerCache && typeof loaded.peerCache === 'object' ? loaded.peerCache : {}
      };
    }

    return this.settings;
  }

  async save(patch = {}) {
    if (patch && typeof patch === 'object') {
      const nextApiId =
        patch.apiId !== undefined ? Number(patch.apiId) || DEFAULT_API_ID : this.settings.apiId;
      const nextApiHash =
        patch.apiHash !== undefined
          ? String(patch.apiHash || '').trim() || DEFAULT_API_HASH
          : this.settings.apiHash;

      this.settings = {
        ...this.settings,
        ...patch,
        apiId: nextApiId,
        apiHash: nextApiHash,
        peerCache:
          patch.peerCache && typeof patch.peerCache === 'object'
            ? { ...this.settings.peerCache, ...patch.peerCache }
            : this.settings.peerCache
      };
    }

    if (this.dataManager && typeof this.dataManager.saveData === 'function') {
      try {
        await this.dataManager.saveData(this.configFileName, this.settings);
      } catch (err) {
        this.addLog('warn', 'Config', `Сохранение в DataManager не удалось: ${err.message}`);
      }
    }

    try {
      const filePath = this.getDirectConfigFilePath();
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (err) {
      this.addLog('warn', 'Config', `Прямая запись конфигурации не удалась: ${err.message}`);
    }

    return this.getPublicSettings();
  }

  cachePeerRecord(key, record) {
    if (!key || !record) return;
    if (!this.settings.peerCache) {
      this.settings.peerCache = {};
    }
    this.settings.peerCache[String(key)] = {
      id: String(record.id || key),
      accessHash: record.accessHash !== undefined && record.accessHash !== null ? String(record.accessHash) : null,
      type: record.type || 'channel',
      title: record.title || '',
      username: record.username || '',
      isForum: Boolean(record.isForum),
      updatedAt: Date.now()
    };
  }

  getCachedPeerRecord(key) {
    if (!key || !this.settings.peerCache) return null;
    const clean = String(key).trim().replace(/^@/, '').toLowerCase();
    if (this.settings.peerCache[String(key)]) {
      return this.settings.peerCache[String(key)];
    }
    for (const entry of Object.values(this.settings.peerCache)) {
      if (
        String(entry.id) === String(key) ||
        (entry.username && String(entry.username).toLowerCase() === clean)
      ) {
        return entry;
      }
    }
    return null;
  }

  getCredentials(overrideApiId, overrideApiHash) {
    const apiId = Number(overrideApiId || this.settings.apiId || DEFAULT_API_ID) || DEFAULT_API_ID;
    const apiHash =
      String(overrideApiHash || this.settings.apiHash || DEFAULT_API_HASH).trim() ||
      DEFAULT_API_HASH;
    return { apiId, apiHash };
  }

  getPublicSettings() {
    const { sessionString, peerCache, ...rest } = this.settings;
    return {
      ...rest,
      apiId: this.settings.apiId || DEFAULT_API_ID,
      apiHash: this.settings.apiHash || DEFAULT_API_HASH,
      hasSession: Boolean(sessionString && String(sessionString).trim().length > 10)
    };
  }
}

module.exports = {
  TelegramConfigStore,
  DEFAULT_API_ID,
  DEFAULT_API_HASH,
  DEFAULT_TEMPLATES
};
