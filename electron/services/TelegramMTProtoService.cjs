const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const { computeCheck } = require('telegram/Password');
const QRCode = require('qrcode');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Official Telegram Public API ID/Hash for Telegram Desktop (production default)
const DEFAULT_TELEGRAM_API_ID = 2040;
const DEFAULT_TELEGRAM_API_HASH = 'b18441a1ff607e10a989891a5462e627';

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '').trim();
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('8') && cleaned.length === 11) {
      cleaned = '+7' + cleaned.slice(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 11) {
      cleaned = '+' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

function formatFileSize(bytes) {
  const num = Number(bytes || 0);
  if (!num || num <= 0) return '0 KB';
  if (num < 1024 * 1024) {
    return `${(num / 1024).toFixed(1)} KB`;
  }
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds) {
  const sec = Math.max(0, Math.round(Number(seconds || 0)));
  if (!sec) return '';
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

function formatRuDateTime(unixSeconds) {
  const dateObj = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  return dateObj.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRuTimeShort(unixSeconds) {
  const dateObj = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  const now = new Date();
  const isToday =
    dateObj.getDate() === now.getDate() &&
    dateObj.getMonth() === now.getMonth() &&
    dateObj.getFullYear() === now.getFullYear();

  if (isToday) {
    return dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return dateObj.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

class TelegramMTProtoService {
  constructor(dataManager, userDataPath) {
    this.dataManager = dataManager;
    this.userDataPath = userDataPath;
    this.client = null;
    this.session = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'code_sent' | 'password_required'
    this.me = null;
    this.botMe = null;
    this.phoneNumber = null;
    this.phoneCodeHash = null;
    this.isCodeViaApp = false;
    this.passwordHint = '';

    // QR Code Authentication state
    this.qrAuthActive = false;
    this.qrStatus = 'idle'; // 'idle' | 'waiting_scan' | 'password_required' | 'authenticated' | 'error'
    this.qrUrl = '';
    this.qrDataUrl = '';
    this.qrExpires = 0;
    this.qrError = null;
    this._qrFlowId = 0;
    this._qrWakeResolve = null;

    // Entity & dialog cache for reliable peer resolution
    this._dialogEntities = new Map();
    this._dialogsCache = [];

    // Live logs buffer for UI inspection
    this.logs = [];

    // Internal lock for reconnecting
    this._connectingPromise = null;
    this._initPromise = null;

    this.settings = {
      enabled: false,
      apiId: DEFAULT_TELEGRAM_API_ID,
      apiHash: DEFAULT_TELEGRAM_API_HASH,
      phoneNumber: '',
      sessionString: '',
      botToken: '',
      defaultChannelId: '',
      autoPin: false,
      autoNotify: true,
      parseMode: 'html',
      headerTemplate: '✨ <b>{title_ru}</b> [{episode_number} СЕРИЯ]',
      footerTemplate: '📌 Смотреть: {site_link}\n💬 Обсуждение: {tg_group}',
      startNoticeTemplate:
        '🎬 <b>СТАРТ РАБОТЫ НАД СЕРИЕЙ!</b>\n📌 <b>{project_title}</b> — Серия {episode_number}\n\n👥 <b>Состав команды:</b>\n{dubbers_list}\n\n📅 <b>Дедлайн сдачи:</b> {deadline}\n🔗 <b>Материалы:</b> {source_link}',
      reminderTemplate:
        '⏰ <b>НАПОМИНАНИЕ О ДЕДЛАЙНЕ!</b>\nРелиз: <b>{project_title}</b> (Серия {episode_number})\n\nКоллеги, ожидаем ваши дорожки:\n{pending_dubbers}\n\nПросьба дописать как можно скорее! 🙏',
      fixNoticeTemplate:
        '⚠️ <b>СПИСОК ФИКСОВ / ПРАВОК</b>\nКому: {dubber_mention}\nПроект: <b>{project_title}</b> (Серия {episode_number})\n\n{fixes_list}',
      trackReceivedTemplate:
        '🎙️ <b>ДОРОЖКА ПРИНЯТА!</b>\nДабер: {dubber_name}\nСерия: {episode_number}\nСтатус: ✅ Готово к сведению',
    };
  }

  _addLog(level, tag, message, details = null) {
    const timestamp = new Date().toISOString();
    const timeShort = new Date().toLocaleTimeString('ru-RU');
    const logItem = { timestamp, time: timeShort, level, tag, message, details };

    this.logs.push(logItem);
    if (this.logs.length > 500) {
      this.logs.shift();
    }

    const logStr = `[MTProto ${tag}] ${message}${
      details ? ' ' + (typeof details === 'object' ? JSON.stringify(details) : details) : ''
    }`;
    if (level === 'error') {
      log.error(logStr);
      console.error(logStr);
    } else if (level === 'warn') {
      log.warn(logStr);
      console.warn(logStr);
    } else {
      log.info(logStr);
      console.log(logStr);
    }
  }

  getLogs(limit = 150) {
    return (this.logs || []).slice(-Math.min(limit, 500));
  }

  clearLogs() {
    this.logs = [];
    this._addLog('info', 'System', 'Журнал логов MTProto очищен пользователем');
    return { success: true };
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        this._addLog('info', 'Init', 'Инициализация сервиса Telegram MTProto...');
        const saved = await this.dataManager.getData('telegram_mtproto_settings.json');
        if (saved && typeof saved === 'object') {
          this.settings = { ...this.settings, ...saved };
        }

        if (this.settings.botToken && String(this.settings.botToken).trim()) {
          this.testBotConnection(this.settings.botToken).catch((err) => {
            this._addLog('warn', 'Init', `Проверка Bot API при запуске: ${err.message}`);
          });
        }

        if (this.settings.sessionString) {
          this._addLog('info', 'Init', 'Обнаружена сохраненная сессия, запуск фонового подключения...');
          this.connectWithSavedSession().catch((err) => {
            this._addLog('warn', 'Init', `Фоновое подключение: ${err.message}`);
          });
        } else {
          this._addLog('info', 'Init', 'Сохраненная сессия отсутствует. Готов к входу по QR или телефону.');
        }
      } catch (e) {
        this._addLog('error', 'Init', `Ошибка инициализации: ${e.message}`);
      }
    })();
    return this._initPromise;
  }

  async saveSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') return this.settings;
    const prevBotToken = this.settings.botToken;
    this.settings = { ...this.settings, ...newSettings };
    await this.dataManager.saveData('telegram_mtproto_settings.json', this.settings);

    if (newSettings.botToken !== undefined && newSettings.botToken !== prevBotToken) {
      if (this.settings.botToken) {
        try {
          await this.testBotConnection(this.settings.botToken);
        } catch (e) {
          // Ignore error during settings save, user can test explicitly
        }
      } else {
        this.botMe = null;
      }
    }

    return this.settings;
  }

  _createTelegramClient(session, apiId, apiHash, customParams = {}) {
    const is64 = process.arch === 'x64' || process.arch === 'arm64';
    const platform =
      process.platform === 'win32'
        ? 'Windows 10'
        : process.platform === 'darwin'
        ? 'macOS'
        : 'Linux';

    const validApiId = Number(apiId || DEFAULT_TELEGRAM_API_ID) || DEFAULT_TELEGRAM_API_ID;
    const validApiHash = String(apiHash || DEFAULT_TELEGRAM_API_HASH).trim() || DEFAULT_TELEGRAM_API_HASH;

    return new TelegramClient(session, validApiId, validApiHash, {
      connectionRetries: 5,
      requestRetries: 3,
      useWSS: false,
      autoReconnect: true,
      floodSleepThreshold: 60,
      deviceModel: is64 ? 'Desktop 64bit' : 'Desktop 32bit',
      systemVersion: platform,
      appVersion: '5.9.0 x64',
      langCode: 'ru',
      systemLangCode: 'ru',
      ...customParams,
    });
  }

  _isSessionInvalidError(errMsg) {
    const msg = String(errMsg || '');
    return (
      msg.includes('AUTH_KEY_UNREGISTERED') ||
      msg.includes('AUTH_KEY_INVALID') ||
      msg.includes('AUTH_KEY_DUPLICATED') ||
      msg.includes('SESSION_REVOKED') ||
      msg.includes('SESSION_EXPIRED') ||
      msg.includes('USER_DEACTIVATED')
    );
  }

  async connectWithSavedSession() {
    if (this._connectingPromise) {
      this._addLog('info', 'Auth', 'Ожидание текущего процесса переподключения...');
      return await this._connectingPromise;
    }

    if (
      this.client &&
      this.status === 'connected' &&
      this.me &&
      this.me.id &&
      this.client.connected
    ) {
      return true;
    }

    if (!this.settings.sessionString) {
      this.status = 'disconnected';
      this.me = null;
      return false;
    }

    this._connectingPromise = (async () => {
      try {
        const apiId = Number(this.settings.apiId || DEFAULT_TELEGRAM_API_ID) || DEFAULT_TELEGRAM_API_ID;
        const apiHash = String(this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim() || DEFAULT_TELEGRAM_API_HASH;

        this._addLog(
          'info',
          'Auth',
          `Подключение по сохраненной сессии (apiId: ${apiId}, длина: ${this.settings.sessionString.length})...`
        );

        if (this.client) {
          try {
            await this.client.disconnect();
          } catch (e) {}
          this.client = null;
        }

        this.session = new StringSession(this.settings.sessionString);
        this.client = this._createTelegramClient(this.session, apiId, apiHash);

        await this.client.connect();
        this._addLog('info', 'Auth', 'Транспорт MTProto подключен. Проверка авторизации аккаунта...');

        let me = null;
        try {
          me = await this.client.getMe();
        } catch (authCheckErr) {
          const checkMsg = authCheckErr.message || String(authCheckErr);
          this._addLog('warn', 'Auth', `Проверка getMe вернула ошибку: ${checkMsg}`);
          if (this._isSessionInvalidError(checkMsg)) {
            this._addLog('error', 'Auth', 'Сохраненная сессия недействительна или отозвана. Очистка сессии...');
            this.status = 'disconnected';
            this.me = null;
            this.settings.sessionString = '';
            await this.saveSettings({ sessionString: '' });
            return false;
          }
          throw authCheckErr;
        }

        if (me && me.id) {
          this.me = {
            id: me.id.toString(),
            firstName: me.firstName || '',
            lastName: me.lastName || '',
            username: me.username || '',
            phone: me.phone || this.settings.phoneNumber || '',
          };
          this.status = 'connected';
          this.qrStatus = 'authenticated';
          this.qrAuthActive = false;

          if (this.client.session) {
            const savedStr = this.client.session.save();
            if (savedStr && savedStr !== this.settings.sessionString) {
              this.settings.sessionString = savedStr;
              await this.saveSettings({
                sessionString: savedStr,
                phoneNumber: this.me.phone,
              });
            }
          }

          this._addLog(
            'info',
            'Auth',
            `Успешное подключение: @${this.me.username || this.me.id} (${this.me.firstName})`
          );

          // Pre-warm dialogs cache in background
          this.getDialogs(80).catch(() => {});
          return true;
        } else {
          this.status = 'disconnected';
          this.me = null;
          return false;
        }
      } catch (e) {
        const errMsg = e.message || String(e);
        this._addLog('error', 'Auth', `Не удалось подключиться по сохраненной сессии: ${errMsg}`);
        this.status = 'disconnected';
        this.me = null;
        if (this._isSessionInvalidError(errMsg)) {
          this.settings.sessionString = '';
          await this.saveSettings({ sessionString: '' });
        }
        return false;
      } finally {
        this._connectingPromise = null;
      }
    })();

    return await this._connectingPromise;
  }

  /**
   * Executes MTProto calls with automatic retry on flood wait / socket drop.
   * Only performs _switchDC when NOT yet authenticated (during login flows),
   * because _switchDC clears the session authKey.
   */
  async _invokeWithMigration(callFn, maxRetries = 4, allowSwitchDc = false) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await callFn();
      } catch (err) {
        const errMsg = err.message || err.errorMessage || String(err);
        this._addLog('warn', 'MTProto RPC', `Попытка RPC ${attempt + 1}: ${errMsg}`);

        // 1. Data Center Migration (only during unauthenticated login flows!)
        const migrateMatch =
          errMsg.match(/(?:PHONE|USER|NETWORK)_MIGRATE_(\d+)/i) ||
          (err.newDc ? [null, err.newDc] : null);
        if (migrateMatch && migrateMatch[1] && (allowSwitchDc || this.status !== 'connected')) {
          const targetDc = Number(migrateMatch[1]);
          this._addLog(
            'info',
            'MTProto DC',
            `Переключение на DC ${targetDc} (попытка ${attempt + 1}/${maxRetries})...`
          );
          if (this.client) {
            await this.client._switchDC(targetDc);
          }
          continue;
        }

        // 2. Auth Restart
        if (errMsg.includes('AUTH_RESTART') && attempt < maxRetries - 1) {
          this._addLog('info', 'MTProto RPC', 'Получен AUTH_RESTART, повтор через 1с...');
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // 3. Short Flood Wait
        if (errMsg.includes('FLOOD_WAIT_') && attempt < maxRetries - 1) {
          const sec = Number(errMsg.match(/FLOOD_WAIT_(\d+)/)?.[1] || err.seconds || 0);
          if (sec > 0 && sec <= 10) {
            this._addLog('info', 'MTProto RPC', `Ожидание FLOOD_WAIT (${sec}с)...`);
            await new Promise((r) => setTimeout(r, sec * 1000));
            continue;
          }
        }

        // 4. Disconnected / Socket Closed
        if (
          (errMsg.includes('disconnected') ||
            errMsg.includes('CONNECTION_LOST') ||
            errMsg.includes('CONNECTION_NOT_INITED') ||
            errMsg.includes('Cannot send requests while disconnected')) &&
          attempt < maxRetries - 1
        ) {
          this._addLog('warn', 'MTProto RPC', 'Соединение потеряно, переподключение...');
          if (this.client) {
            try {
              await this.client.connect();
              continue;
            } catch (reconnErr) {
              this._addLog('error', 'MTProto RPC', `Ошибка переподключения: ${reconnErr.message}`);
            }
          }
        }

        throw err;
      }
    }
  }

  async testConnection() {
    const startTime = Date.now();
    try {
      this._addLog('info', 'Test', 'Запуск проверки соединения с Telegram MTProto...');
      await this.ensureConnected();
      // Perform a lightweight live RPC call to confirm session validity
      const me = await this.client.getMe();
      if (me && me.id) {
        this.me = {
          id: me.id.toString(),
          firstName: me.firstName || '',
          lastName: me.lastName || '',
          username: me.username || '',
          phone: me.phone || this.settings.phoneNumber || '',
        };
      }
      const latencyMs = Date.now() - startTime;
      const dcId = this.client && this.client.session ? this.client.session.dcId : null;
      this._addLog(
        'info',
        'Test',
        `Проверка связи успешна! Задержка: ${latencyMs}мс, DC: ${dcId || 'N/A'}, Аккаунт: @${
          this.me?.username || this.me?.id || 'N/A'
        }`
      );
      return {
        success: true,
        connected: true,
        latencyMs,
        dcId,
        me: this.me,
        status: this.status,
        hasSession: !!this.settings.sessionString,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this._addLog('warn', 'Test', `Тест подключения не прошел: ${err.message}`);
      return {
        success: false,
        connected: false,
        latencyMs,
        error: err.message,
        hasSession: !!this.settings.sessionString,
      };
    }
  }

  async sendCode(phoneNumber, customApiId, customApiHash, forceSMS = false) {
    this._addLog('info', 'Phone Auth', `Запрос кода: phone=${phoneNumber}, forceSMS=${forceSMS}`);
    try {
      const cleanPhone = normalizePhoneNumber(phoneNumber);
      if (!cleanPhone || cleanPhone.length < 7) {
        throw new Error('Укажите корректный номер телефона в международном формате (напр. +79991234567)');
      }

      const apiId = Number(customApiId || this.settings.apiId || DEFAULT_TELEGRAM_API_ID) || DEFAULT_TELEGRAM_API_ID;
      const apiHash =
        String(customApiHash || this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim() ||
        DEFAULT_TELEGRAM_API_HASH;

      this.settings.apiId = apiId;
      this.settings.apiHash = apiHash;
      this.phoneNumber = cleanPhone;

      this.cancelQrCodeAuth();

      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (e) {}
      }

      this.session = new StringSession('');
      this.client = this._createTelegramClient(this.session, apiId, apiHash);
      await this.client.connect();

      this._addLog('info', 'Phone Auth', 'Подключено к MTProto. Отправка auth.SendCode...');

      const res = await this._invokeWithMigration(
        async () => {
          return await this.client.sendCode({ apiId, apiHash }, cleanPhone, forceSMS);
        },
        4,
        true
      );

      this.phoneCodeHash = res.phoneCodeHash;
      this.isCodeViaApp = !!res.isCodeViaApp;
      this.status = 'code_sent';

      await this.saveSettings({ phoneNumber: cleanPhone, apiId, apiHash });
      this._addLog('info', 'Phone Auth', `Код успешно отправлен (isCodeViaApp=${res.isCodeViaApp})`);

      return {
        success: true,
        phoneCodeHash: res.phoneCodeHash,
        isCodeViaApp: !!res.isCodeViaApp,
        deliveryMethod: res.isCodeViaApp ? 'app' : 'sms',
        formattedPhone: cleanPhone,
        message: res.isCodeViaApp
          ? 'Код отправлен в приложение Telegram (служебный чат «Telegram» / ID 777000)'
          : `Код отправлен по SMS на номер ${cleanPhone}`,
      };
    } catch (e) {
      this._addLog('error', 'Phone Auth', `Ошибка sendCode: ${e.message}`);
      let msg = e.message || String(e);
      if (msg.includes('PHONE_NUMBER_INVALID')) {
        msg = 'Неверный формат номера телефона. Проверьте правильность и код страны (напр. +79991234567).';
      } else if (msg.includes('PHONE_NUMBER_UNOCCUPIED')) {
        msg = 'Этот номер телефона не зарегистрирован в Telegram.';
      } else if (msg.includes('API_ID_INVALID') || msg.includes('API_HASH_INVALID')) {
        msg = 'Неверный API ID или API Hash. Проверьте ключи на my.telegram.org или оставьте поля пустыми для встроенных ключей.';
      } else if (msg.includes('API_ID_PUBLISHED_FLOOD')) {
        msg = 'Публичный API ID временно ограничен для SMS. Пожалуйста, используйте вход по QR-коду или укажите собственный API ID с my.telegram.org.';
      } else if (msg.includes('PHONE_NUMBER_BANNED')) {
        msg = 'Этот номер телефона заблокирован в Telegram.';
      } else if (msg.includes('PHONE_CODE_EXPIRED')) {
        msg = 'Срок действия кода истек. Запросите код повторно.';
      } else if (msg.includes('FLOOD_WAIT')) {
        const seconds = msg.match(/\d+/)?.[0] || 'несколько';
        msg = `Слишком много запросов. Telegram временно ограничил отправку кодов (ожидание ~${seconds} сек). Используйте вход по QR-коду.`;
      }
      throw new Error(msg);
    }
  }

  async resendCode(forceSMS = true) {
    if (!this.client || !this.phoneNumber || !this.phoneCodeHash) {
      throw new Error('Сначала запросите отправку кода на номер телефона');
    }
    try {
      this._addLog('info', 'Phone Auth', `Повторный запрос кода (${forceSMS ? 'SMS' : 'App'})...`);
      const res = await this._invokeWithMigration(
        async () => {
          return await this.client.invoke(
            new Api.auth.ResendCode({
              phoneNumber: this.phoneNumber,
              phoneCodeHash: this.phoneCodeHash,
            })
          );
        },
        3,
        true
      );

      if (res && res.phoneCodeHash) {
        this.phoneCodeHash = res.phoneCodeHash;
      }
      const isViaApp = res?.type instanceof Api.auth.SentCodeTypeApp;
      this.isCodeViaApp = isViaApp;
      this._addLog('info', 'Phone Auth', 'Код успешно отправлен повторно');
      return {
        success: true,
        isCodeViaApp: isViaApp,
        deliveryMethod: isViaApp ? 'app' : 'sms',
        message: isViaApp
          ? 'Код повторно отправлен в чат «Telegram»'
          : 'Код повторно отправлен по SMS / звонком',
      };
    } catch (e) {
      this._addLog('error', 'Phone Auth', `Ошибка resendCode: ${e.message}`);
      let msg = e.message || String(e);
      if (msg.includes('SEND_CODE_UNAVAILABLE')) {
        msg = 'Доставка по SMS недоступна для этого аккаунта. Проверьте сервисный чат «Telegram» на авторизованном устройстве или войдите по QR-коду.';
      } else if (msg.includes('FLOOD_WAIT')) {
        const seconds = msg.match(/\d+/)?.[0] || 'несколько';
        msg = `Слишком много попыток. Подождите ~${seconds} сек.`;
      }
      throw new Error(msg);
    }
  }

  async signIn(phoneCode, password) {
    this._addLog('info', 'Phone Auth', `Запрос signIn (hasPassword: ${!!password})`);
    if (!this.client || !this.phoneNumber || !this.phoneCodeHash) {
      throw new Error('Сессия входа не инициализирована. Запросите код подтверждения заново.');
    }
    try {
      let user;
      const cleanCode = String(phoneCode || '').replace(/[\s-]/g, '').trim();
      if (!cleanCode) {
        throw new Error('Введите код подтверждения');
      }

      try {
        const signInResult = await this._invokeWithMigration(
          async () => {
            return await this.client.invoke(
              new Api.auth.SignIn({
                phoneNumber: this.phoneNumber,
                phoneCodeHash: this.phoneCodeHash,
                phoneCode: cleanCode,
              })
            );
          },
          3,
          true
        );
        user = signInResult.user || signInResult;
      } catch (err) {
        const errMsg = err.message || err.errorMessage || String(err);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
          this.status = 'password_required';
          const passwordSrpResult = await this.client.invoke(new Api.account.GetPassword());
          this.passwordHint = passwordSrpResult?.hint || '';

          if (!password) {
            this._addLog(
              'info',
              'Phone Auth',
              `Требуется облачный пароль 2FA (подсказка: ${this.passwordHint || 'нет'})`
            );
            return {
              success: false,
              requiresPassword: true,
              hint: this.passwordHint,
            };
          }

          const passwordSrpCheck = await computeCheck(passwordSrpResult, password);
          const checkRes = await this.client.invoke(
            new Api.auth.CheckPassword({
              password: passwordSrpCheck,
            })
          );
          user = checkRes.user || checkRes;
        } else if (errMsg.includes('PHONE_CODE_INVALID')) {
          throw new Error('Неверный код подтверждения из Telegram.');
        } else if (errMsg.includes('PHONE_CODE_EXPIRED')) {
          throw new Error('Срок действия кода истек. Запросите новый код.');
        } else if (errMsg.includes('PASSWORD_HASH_INVALID')) {
          throw new Error('Неверный облачный пароль 2FA двухфакторной защиты Telegram.');
        } else {
          throw err;
        }
      }

      return await this._completeAuthSuccess(user);
    } catch (e) {
      this._addLog('error', 'Phone Auth', `Ошибка signIn: ${e.message}`);
      throw new Error(e.message || String(e));
    }
  }

  /**
   * Custom, deterministic MTProto QR Code Authentication loop.
   * Avoids GramJS's internal signInUserWithQrCode bug where ExportLoginToken
   * returning LoginTokenSuccess/LoginTokenMigrateTo throws "Unexpected".
   */
  async startQrCodeAuth(customApiId, customApiHash) {
    const apiId = Number(customApiId || this.settings.apiId || DEFAULT_TELEGRAM_API_ID) || DEFAULT_TELEGRAM_API_ID;
    const apiHash =
      String(customApiHash || this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim() ||
      DEFAULT_TELEGRAM_API_HASH;

    this._addLog('info', 'QR', `Запуск авторизации по QR-коду (apiId: ${apiId})...`);

    this.settings.apiId = apiId;
    this.settings.apiHash = apiHash;
    await this.saveSettings({ apiId, apiHash });

    // Increment flowId to invalidate any previous background QR loop immediately
    const flowId = ++this._qrFlowId;
    if (this._qrWakeResolve) {
      try {
        this._qrWakeResolve();
      } catch (e) {}
      this._qrWakeResolve = null;
    }

    this.qrAuthActive = true;
    this.qrStatus = 'waiting_scan';
    this.qrError = null;
    this.passwordHint = '';

    // Reuse existing unauthenticated client if already connected during QR refresh,
    // or create a fresh client
    if (!this.client || !this.client.connected || this.status === 'connected') {
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (e) {}
      }
      this.session = new StringSession('');
      this.client = this._createTelegramClient(this.session, apiId, apiHash);
      this._addLog('info', 'QR', 'Подключение клиента к дата-центру Telegram...');
      await this.client.connect();
    }

    // Attach listener for UpdateLoginToken push notifications to wake up polling immediately
    if (this.client && !this.client._hasQrUpdateHandler) {
      this.client._hasQrUpdateHandler = true;
      this.client.addEventHandler((update) => {
        if (
          update instanceof Api.UpdateLoginToken ||
          update?.className === 'UpdateLoginToken'
        ) {
          this._addLog('info', 'QR', 'Получено событие UpdateLoginToken от Telegram!');
          if (this._qrWakeResolve) {
            const wake = this._qrWakeResolve;
            this._qrWakeResolve = null;
            wake();
          }
        }
      });
    }

    // Generate the initial QR token immediately and start the background polling loop
    const firstStep = await this._pollQrLoginTokenOnce(flowId, apiId, apiHash);
    if (firstStep && firstStep.completed) {
      return {
        success: true,
        status: this.qrStatus,
        me: this.me,
      };
    }

    if (firstStep && firstStep.error) {
      return {
        success: false,
        error: firstStep.error,
      };
    }

    // Start background polling every 2.5s until scanned, 2FA required, or cancelled
    this._runQrPollingLoop(flowId, apiId, apiHash).catch((err) => {
      if (this._qrFlowId === flowId && this.qrAuthActive) {
        this._addLog('error', 'QR', `Ошибка фонового цикла QR: ${err.message}`);
      }
    });

    return {
      success: true,
      qrUrl: this.qrUrl,
      qrDataUrl: this.qrDataUrl,
      expires: this.qrExpires,
    };
  }

  async _pollQrLoginTokenOnce(flowId, apiId, apiHash) {
    if (!this.qrAuthActive || this._qrFlowId !== flowId || !this.client) {
      return { cancelled: true };
    }

    try {
      const result = await this._invokeWithMigration(
        async () => {
          return await this.client.invoke(
            new Api.auth.ExportLoginToken({
              apiId: Number(apiId),
              apiHash: String(apiHash),
              exceptIds: [],
            })
          );
        },
        3,
        true
      );

      if (!this.qrAuthActive || this._qrFlowId !== flowId) {
        return { cancelled: true };
      }

      // 1. Standard LoginToken -> update QR image if token changed
      if (result instanceof Api.auth.LoginToken || result?.className === 'auth.LoginToken') {
        const base64UrlToken = Buffer.from(result.token).toString('base64url');
        const nextUrl = `tg://login?token=${base64UrlToken}`;
        this.qrExpires = result.expires;
        this.qrStatus = 'waiting_scan';

        if (nextUrl !== this.qrUrl || !this.qrDataUrl) {
          this.qrUrl = nextUrl;
          this.qrDataUrl = await QRCode.toDataURL(this.qrUrl, {
            width: 280,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          const timeLeft = Math.max(0, result.expires - Math.floor(Date.now() / 1000));
          this._addLog('info', 'QR', `Сгенерирован токен QR-кода (действителен ${timeLeft}с)`);
        }
        return { success: true, waiting: true };
      }

      // 2. LoginTokenMigrateTo -> user scanned QR and account is on another DC
      if (
        result instanceof Api.auth.LoginTokenMigrateTo ||
        result?.className === 'auth.LoginTokenMigrateTo'
      ) {
        this._addLog(
          'info',
          'QR',
          `QR-код отсканирован! Переключение на домашний дата-центр аккаунта DC ${result.dcId}...`
        );
        await this.client._switchDC(result.dcId);

        try {
          const imported = await this.client.invoke(
            new Api.auth.ImportLoginToken({
              token: result.token,
            })
          );

          if (
            imported instanceof Api.auth.LoginTokenSuccess ||
            imported?.className === 'auth.LoginTokenSuccess'
          ) {
            const user = imported.authorization?.user || imported.user || imported;
            await this._completeAuthSuccess(user);
            return { completed: true };
          }
        } catch (importErr) {
          const impMsg = importErr.message || importErr.errorMessage || String(importErr);
          if (impMsg.includes('SESSION_PASSWORD_NEEDED')) {
            return await this._enterQr2FAState();
          }
          throw importErr;
        }
      }

      // 3. LoginTokenSuccess -> user scanned QR on current DC
      if (
        result instanceof Api.auth.LoginTokenSuccess ||
        result?.className === 'auth.LoginTokenSuccess'
      ) {
        const user = result.authorization?.user || result.user || result;
        this._addLog('info', 'QR', 'QR-код успешно подтвержден в приложении Telegram!');
        await this._completeAuthSuccess(user);
        return { completed: true };
      }

      return { waiting: true };
    } catch (err) {
      if (!this.qrAuthActive || this._qrFlowId !== flowId) {
        return { cancelled: true };
      }

      const errMsg = err.message || err.errorMessage || String(err);
      if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
        return await this._enterQr2FAState();
      }

      this._addLog('error', 'QR', `Ошибка проверки токена QR: ${errMsg}`);
      this.qrStatus = 'error';
      this.qrError = errMsg;
      return { error: errMsg };
    }
  }

  async _enterQr2FAState() {
    this._addLog('info', 'QR', 'QR-код подтвержден! Требуется ввод облачного пароля 2FA...');
    this.qrStatus = 'password_required';
    this.status = 'password_required';
    try {
      const pwdInfo = await this.client.invoke(new Api.account.GetPassword());
      this.passwordHint = pwdInfo?.hint || '';
      if (this.passwordHint) {
        this._addLog('info', 'QR', `Подсказка к паролю 2FA: ${this.passwordHint}`);
      }
    } catch (e) {
      this.passwordHint = '';
    }
    return { completed: true, requiresPassword: true };
  }

  async _runQrPollingLoop(flowId, apiId, apiHash) {
    while (this.qrAuthActive && this._qrFlowId === flowId && this.qrStatus === 'waiting_scan') {
      // Wait 2.5 seconds OR wake up immediately if UpdateLoginToken arrives
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (this._qrWakeResolve === wakeFn) {
            this._qrWakeResolve = null;
          }
          resolve();
        }, 2500);
        const wakeFn = () => {
          clearTimeout(timer);
          resolve();
        };
        this._qrWakeResolve = wakeFn;
      });

      if (!this.qrAuthActive || this._qrFlowId !== flowId || this.qrStatus !== 'waiting_scan') {
        break;
      }

      const step = await this._pollQrLoginTokenOnce(flowId, apiId, apiHash);
      if (step?.completed || step?.cancelled || step?.error) {
        break;
      }
    }
  }

  async _completeAuthSuccess(userObj) {
    try {
      this._addLog('info', 'Auth', 'Завершение процедуры авторизации в Telegram MTProto...');

      let user = userObj?.user || userObj?.authorization?.user || userObj?.authorization || userObj;

      // Fetch full user profile if needed
      if ((!user || !user.id || !user.firstName) && this.client) {
        try {
          user = await this.client.getMe();
        } catch (e) {}
      }

      this.me = {
        id: user && user.id ? user.id.toString() : this.me?.id || 'telegram_user',
        firstName: (user && user.firstName) || this.me?.firstName || 'Пользователь',
        lastName: (user && user.lastName) || this.me?.lastName || '',
        username: (user && user.username) || this.me?.username || '',
        phone: (user && user.phone) || this.phoneNumber || this.settings.phoneNumber || '',
      };

      if (this.client && this.client.session) {
        const sessionStr = this.client.session.save();
        if (sessionStr) {
          this.settings.sessionString = sessionStr;
        }
      }

      this.status = 'connected';
      this.qrStatus = 'authenticated';
      this.qrAuthActive = false;
      this.passwordHint = '';

      await this.saveSettings({
        sessionString: this.settings.sessionString,
        phoneNumber: this.me.phone || this.phoneNumber,
        apiId: this.settings.apiId,
        apiHash: this.settings.apiHash,
      });

      this._addLog(
        'info',
        'Auth',
        `Авторизация успешна! Аккаунт: @${this.me.username || this.me.id} (${this.me.firstName}), сессия сохранена.`
      );

      // Warm up dialogs cache in background
      this.getDialogs(80).catch(() => {});

      return { success: true, status: 'connected', me: this.me };
    } catch (e) {
      this._addLog('error', 'Auth', `Ошибка в _completeAuthSuccess: ${e.message}`);
      this.status = 'connected';
      this.qrStatus = 'authenticated';
      this.qrAuthActive = false;
      return { success: true, status: 'connected', me: this.me };
    }
  }

  async submit2FAPassword(password) {
    const cleanPassword = String(password || '').trim();
    if (!cleanPassword) {
      throw new Error('Введите облачный пароль 2FA');
    }

    if (!this.client) {
      throw new Error('Сессия Telegram не активна. Пожалуйста, начните вход заново.');
    }

    this._addLog('info', 'Auth', 'Проверка облачного пароля 2FA...');

    try {
      const passwordSrpResult = await this.client.invoke(new Api.account.GetPassword());
      const passwordSrpCheck = await computeCheck(passwordSrpResult, cleanPassword);
      const checkRes = await this.client.invoke(
        new Api.auth.CheckPassword({
          password: passwordSrpCheck,
        })
      );

      this._addLog('info', 'Auth', 'Пароль 2FA успешно подтвержден!');
      return await this._completeAuthSuccess(checkRes.user || checkRes);
    } catch (e) {
      const errMsg = e.message || e.errorMessage || String(e);
      this._addLog('error', 'Auth', `Ошибка проверки 2FA: ${errMsg}`);
      if (errMsg.includes('PASSWORD_HASH_INVALID')) {
        throw new Error('Неверный пароль 2FA двухфакторной защиты Telegram.');
      }
      throw new Error(errMsg);
    }
  }

  async getQrAuthStatus() {
    if (this.status === 'connected' && this.me && this.me.id) {
      return {
        active: false,
        status: 'authenticated',
        qrUrl: this.qrUrl,
        qrDataUrl: this.qrDataUrl,
        expires: this.qrExpires,
        passwordHint: this.passwordHint,
        error: null,
        me: this.me,
      };
    }

    return {
      active: this.qrAuthActive,
      status: this.qrStatus,
      qrUrl: this.qrUrl,
      qrDataUrl: this.qrDataUrl,
      expires: this.qrExpires,
      passwordHint: this.passwordHint,
      error: this.qrError,
      me: this.me,
    };
  }

  cancelQrCodeAuth() {
    this._qrFlowId++;
    this.qrAuthActive = false;
    this.qrStatus = 'idle';
    this.qrUrl = '';
    this.qrDataUrl = '';
    if (this._qrWakeResolve) {
      try {
        this._qrWakeResolve();
      } catch (e) {}
      this._qrWakeResolve = null;
    }
    return { success: true };
  }

  async logout() {
    try {
      this.cancelQrCodeAuth();
      if (this.client) {
        if (this.status === 'connected') {
          try {
            await this.client.invoke(new Api.auth.LogOut());
          } catch (e) {}
        }
        await this.client.disconnect().catch(() => {});
      }
    } catch (e) {}
    this.client = null;
    this.session = null;
    this.status = 'disconnected';
    this.me = null;
    this.phoneNumber = null;
    this.phoneCodeHash = null;
    this._dialogEntities.clear();
    this._dialogsCache = [];
    await this.saveSettings({ sessionString: '' });
    this._addLog('info', 'Auth', 'Выход из аккаунта выполнен, сессия очищена.');
    return { success: true };
  }

  /**
   * Parses any user input for a peer/channel/post link:
   * - https://t.me/c/1234567890/45 -> { peer: '-1001234567890', postId: 45, isPublic: false }
   * - https://t.me/s/channel/45 -> { peer: '@channel', postId: 45, isPublic: true }
   * - https://t.me/channel/45 -> { peer: '@channel', postId: 45, isPublic: true }
   * - @channel/45 -> { peer: '@channel', postId: 45, isPublic: true }
   * - -1001234567890 -> { peer: '-1001234567890', postId: null, isPublic: false }
   */
  _parsePeerInput(rawInput) {
    if (!rawInput) return { peer: '', postId: null, isPublic: false, cleanUsername: '' };
    let str = String(rawInput).trim();
    // Strip query string and hash
    str = str.split('?')[0].split('#')[0].replace(/\/+$/, '');

    // Check private channel link: t.me/c/1234567890/45 or t.me/c/1234567890
    const privateMatch = str.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)(?:\/(\d+))?/i);
    if (privateMatch) {
      const chanId = `-100${privateMatch[1]}`;
      const postId = privateMatch[2] ? parseInt(privateMatch[2], 10) : null;
      return { peer: chanId, postId, isPublic: false, cleanUsername: '' };
    }

    // Check public t.me link: t.me/s/username/45 or t.me/username/45
    const publicUrlMatch = str.match(/(?:https?:\/\/)?t\.me\/(?:s\/)?([a-zA-Z0-9_]{3,})(?:\/(\d+))?/i);
    if (publicUrlMatch && !['joinchat', 'addstickers', 'addlist', 'proxy', 'socks'].includes(publicUrlMatch[1].toLowerCase())) {
      const username = publicUrlMatch[1];
      const postId = publicUrlMatch[2] ? parseInt(publicUrlMatch[2], 10) : null;
      return {
        peer: `@${username}`,
        postId,
        isPublic: true,
        cleanUsername: username,
      };
    }

    // Check @username/45 or username/45
    const slashMatch = str.match(/^@?([a-zA-Z0-9_]{3,})\/(\d+)$/);
    if (slashMatch) {
      const username = slashMatch[1];
      const postId = parseInt(slashMatch[2], 10);
      return {
        peer: `@${username}`,
        postId,
        isPublic: true,
        cleanUsername: username,
      };
    }

    // Numeric ID (e.g. -1001234567890, -123456789, 123456789)
    if (/^-?\d+$/.test(str)) {
      return { peer: str, postId: null, isPublic: false, cleanUsername: '' };
    }

    // Username with or without @
    const cleanUsername = str.replace(/^@/, '');
    return {
      peer: `@${cleanUsername}`,
      postId: null,
      isPublic: /^[a-zA-Z0-9_]{3,}$/.test(cleanUsername),
      cleanUsername,
    };
  }

  _cacheDialogEntity(dialog) {
    if (!dialog) return;
    const entity = dialog.inputEntity || dialog.entity;
    if (!entity) return;

    if (dialog.id !== undefined && dialog.id !== null) {
      const idStr = dialog.id.toString();
      this._dialogEntities.set(idStr, entity);
      if (idStr.startsWith('-100')) {
        this._dialogEntities.set(idStr.slice(4), entity);
      }
    }
    if (dialog.entity && dialog.entity.id !== undefined) {
      const rawId = dialog.entity.id.toString();
      this._dialogEntities.set(rawId, entity);
      this._dialogEntities.set(`-100${rawId}`, entity);
      this._dialogEntities.set(`-${rawId}`, entity);
    }
    if (dialog.entity && dialog.entity.username) {
      const uname = String(dialog.entity.username).toLowerCase();
      this._dialogEntities.set(uname, entity);
      this._dialogEntities.set(`@${uname}`, entity);
    }
  }

  async _resolvePeer(targetPeer) {
    if (!targetPeer) throw new Error('Укажите чат или канал (@channel или ID)');
    const { peer, cleanUsername } = this._parsePeerInput(targetPeer);
    if (!peer) throw new Error('Укажите корректный чат или канал');

    // 1. Check cached dialog entities first
    const cached =
      this._dialogEntities.get(peer) ||
      this._dialogEntities.get(peer.toLowerCase()) ||
      (cleanUsername ? this._dialogEntities.get(cleanUsername.toLowerCase()) : null);
    if (cached) {
      return cached;
    }

    // 2. If numeric ID and dialog cache is empty, warm up dialogs cache once
    if (/^-?\d+$/.test(peer) && this._dialogEntities.size === 0) {
      try {
        await this.getDialogs(100);
        const afterWarmup =
          this._dialogEntities.get(peer) ||
          this._dialogEntities.get(peer.replace(/^-100/, ''));
        if (afterWarmup) return afterWarmup;
      } catch (e) {}
    }

    // 3. Try GramJS getInputEntity
    try {
      return await this._invokeWithMigration(async () => {
        return await this.client.getInputEntity(peer);
      });
    } catch (e) {
      // 4. If it's a public @username, try contacts.ResolveUsername explicitly
      if (cleanUsername) {
        try {
          const resolved = await this._invokeWithMigration(async () => {
            return await this.client.invoke(
              new Api.contacts.ResolveUsername({
                username: cleanUsername,
              })
            );
          });
          if (resolved) {
            const entity =
              (resolved.chats && resolved.chats[0]) ||
              (resolved.users && resolved.users[0]);
            if (entity) {
              this._dialogEntities.set(`@${cleanUsername.toLowerCase()}`, entity);
              return entity;
            }
          }
        } catch (resErr) {
          this._addLog('warn', 'Peer', `Не удалось разрешить @${cleanUsername}: ${resErr.message}`);
        }
      }
      this._addLog('warn', 'Peer', `Fallback разрешения пира "${peer}": ${e.message}`);
      return peer;
    }
  }

  _extractSenderInfo(msg) {
    let id = '';
    let name = '';
    let username = '';

    const sender = msg.sender || msg._sender;
    if (sender) {
      if (sender.id) id = sender.id.toString();
      if (sender.title) {
        name = sender.title;
      } else {
        name = [sender.firstName, sender.lastName].filter(Boolean).join(' ');
      }
      if (sender.username) {
        username = sender.username;
      }
    }

    if (!id && msg.fromId) {
      id = (msg.fromId.userId || msg.fromId.channelId || msg.fromId.chatId || msg.fromId).toString();
    }

    if (!name) {
      if (msg.out) {
        name = this.me?.firstName || 'Вы';
        username = this.me?.username || '';
      } else if (msg.postAuthor) {
        name = msg.postAuthor;
      } else if (username) {
        name = `@${username}`;
      } else if (id) {
        name = `Участник #${id.slice(-4)}`;
      } else {
        name = 'Участник чата';
      }
    }

    return { id, name, username };
  }

  async getDialogs(limit = 80) {
    if (this._initPromise) {
      await this._initPromise.catch(() => {});
    }

    if (this.status !== 'connected' || !this.client) {
      if (this.settings.sessionString) {
        const reconnected = await this.connectWithSavedSession();
        if (!reconnected) {
          return [];
        }
      } else {
        return [];
      }
    }

    try {
      const dialogs = await this._invokeWithMigration(async () => {
        return await this.client.getDialogs({ limit });
      });

      const mapped = (dialogs || []).map((d) => {
        this._cacheDialogEntity(d);
        const lastMsgText = d.message?.message || (d.message?.media ? '📎 Медиафайл' : '');
        const lastMsgDate = d.message?.date ? formatRuTimeShort(d.message.date) : '';

        return {
          id: d.id ? d.id.toString() : '',
          title: d.title || d.name || 'Без названия',
          username: d.entity && d.entity.username ? d.entity.username : '',
          isChannel: Boolean(d.isChannel && !d.isGroup),
          isGroup: Boolean(d.isGroup),
          isUser: Boolean(d.isUser),
          unreadCount: d.unreadCount || 0,
          type: d.isChannel && !d.isGroup ? 'channel' : d.isGroup ? 'group' : d.isUser ? 'user' : 'chat',
          lastMessage: lastMsgText,
          date: lastMsgDate,
        };
      });

      this._dialogsCache = mapped;
      return mapped;
    } catch (e) {
      this._addLog('warn', 'Dialogs', `Ошибка получения списка диалогов: ${e.message}`);
      if (this._isSessionInvalidError(e.message)) {
        await this._handleApiError(e, 'getDialogs');
      }
      return this._dialogsCache || [];
    }
  }

  async testBotConnection(customToken) {
    const token = customToken
      ? String(customToken).trim()
      : String(this.settings.botToken || '').trim();
    if (!token) {
      throw new Error('Укажите токен бота Telegram (полученный у @BotFather)');
    }

    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await resp.json();
      if (!data.ok) {
        throw new Error(
          data.description || 'Не удалось авторизовать бота. Проверьте правильность токена.'
        );
      }
      this.botMe = {
        id: data.result.id,
        username: data.result.username,
        firstName: data.result.first_name,
      };
      if (customToken && customToken !== this.settings.botToken) {
        await this.saveSettings({ botToken: token });
      }
      this._addLog('info', 'Bot API', `Бот успешно подключен: @${data.result.username}`);
      return {
        success: true,
        bot: this.botMe,
      };
    } catch (err) {
      this._addLog('error', 'Bot API', `Ошибка testBotConnection: ${err.message}`);
      throw new Error(err.message || 'Ошибка подключения к Telegram Bot API');
    }
  }

  async sendViaBotApi({ targetPeer, text, parseMode = 'html', silent = false, pin = false, mediaPath }) {
    const token = String(this.settings.botToken || '').trim();
    if (!token) {
      throw new Error('Токен бота не настроен в параметрах Telegram.');
    }

    const rawChat = targetPeer || this.settings.defaultChannelId;
    if (!rawChat) throw new Error('Укажите ID или @username канала/чата');

    const { peer: chatId } = this._parsePeerInput(rawChat);
    const cleanText = text || '';

    if (mediaPath && fs.existsSync(mediaPath)) {
      const ext = path.extname(mediaPath).toLowerCase();
      const isPhoto = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      const isVideo = ['.mp4', '.mkv', '.avi', '.mov'].includes(ext);
      const isAudio = ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus'].includes(ext);

      let method = 'sendDocument';
      let field = 'document';
      if (isPhoto) {
        method = 'sendPhoto';
        field = 'photo';
      } else if (isVideo) {
        method = 'sendVideo';
        field = 'video';
      } else if (isAudio) {
        method = 'sendAudio';
        field = 'audio';
      }

      const fileBuffer = await fs.promises.readFile(mediaPath);
      const fileBlob = new Blob([fileBuffer]);
      const form = new FormData();
      form.append('chat_id', chatId);
      if (cleanText) form.append('caption', cleanText);
      if (parseMode === 'html') form.append('parse_mode', 'HTML');
      else if (parseMode === 'md') form.append('parse_mode', 'Markdown');
      if (silent) form.append('disable_notification', 'true');
      form.append(field, fileBlob, path.basename(mediaPath));

      const url = `https://api.telegram.org/bot${token}/${method}`;
      const resp = await fetch(url, { method: 'POST', body: form });
      const data = await resp.json();
      if (!data.ok) {
        throw new Error(data.description || 'Ошибка отправки медиафайла через Bot API');
      }

      if (pin && data.result && data.result.message_id) {
        await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: data.result.message_id,
            disable_notification: !!silent,
          }),
        }).catch(() => {});
      }

      this._addLog('info', 'Bot API', `Медиа-пост отправлен в ${chatId} (msgId: ${data.result.message_id})`);
      return { success: true, messageId: data.result.message_id, method: 'bot_api' };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: cleanText,
      parse_mode: parseMode === 'html' ? 'HTML' : 'Markdown',
      disable_notification: !!silent,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.description || 'Ошибка отправки сообщения через Bot API');
    }

    if (pin && data.result && data.result.message_id) {
      await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: data.result.message_id,
          disable_notification: !!silent,
        }),
      }).catch(() => {});
    }

    this._addLog('info', 'Bot API', `Сообщение отправлено в ${chatId} (msgId: ${data.result.message_id})`);
    return { success: true, messageId: data.result.message_id, method: 'bot_api' };
  }

  async sendPost({ targetPeer, text, parseMode = 'html', silent = false, pin = false, scheduleDate, mediaPath }) {
    let mtprotoReady = Boolean(this.client && this.status === 'connected');
    if (!mtprotoReady && this.settings.sessionString) {
      try {
        mtprotoReady = await this.connectWithSavedSession();
      } catch (e) {
        this._addLog('warn', 'MTProto', `Автопереподключение перед отправкой: ${e.message}`);
      }
    }

    if (!mtprotoReady) {
      if (this.settings.botToken) {
        this._addLog('info', 'Post', 'MTProto не подключен, отправка публикации через Bot API...');
        return await this.sendViaBotApi({ targetPeer, text, parseMode, silent, pin, mediaPath });
      }
      await this.ensureConnected();
    }

    try {
      const rawPeer = targetPeer || this.settings.defaultChannelId;
      if (!rawPeer) throw new Error('Укажите ID или @username канала/чата');
      const peer = await this._resolvePeer(rawPeer);

      const sendOptions = {
        silent: !!silent,
        schedule: scheduleDate ? Math.floor(new Date(scheduleDate).getTime() / 1000) : undefined,
      };

      if (parseMode === 'html') {
        sendOptions.parseMode = 'html';
      } else if (parseMode === 'md') {
        sendOptions.parseMode = 'markdown';
      }

      const sentMsg = await this._invokeWithMigration(async () => {
        try {
          if (mediaPath && fs.existsSync(mediaPath)) {
            sendOptions.file = mediaPath;
            sendOptions.caption = text || '';
            return await this.client.sendFile(peer, sendOptions);
          } else {
            sendOptions.message = text || '';
            return await this.client.sendMessage(peer, sendOptions);
          }
        } catch (firstErr) {
          const errStr = String(firstErr.message || firstErr);
          if (
            sendOptions.parseMode &&
            (errStr.includes('TAG_') || errStr.includes('PARSE') || errStr.includes('ENTITY_BOUNDS'))
          ) {
            this._addLog('warn', 'MTProto', 'Ошибка разбора HTML/MD тегов, отправка обычным текстом');
            delete sendOptions.parseMode;
            const plain = String(text || '').replace(/<[^>]*>/g, '');
            if (mediaPath && fs.existsSync(mediaPath)) {
              sendOptions.caption = plain;
              return await this.client.sendFile(peer, sendOptions);
            } else {
              sendOptions.message = plain;
              return await this.client.sendMessage(peer, sendOptions);
            }
          }
          throw firstErr;
        }
      });

      if (pin && sentMsg && sentMsg.id) {
        try {
          await this._invokeWithMigration(async () => {
            return await this.client.pinMessage(peer, sentMsg.id, { notify: !silent });
          });
        } catch (pinErr) {
          this._addLog('warn', 'MTProto', `Не удалось закрепить сообщение: ${pinErr.message}`);
        }
      }

      this._addLog('info', 'Post', `Публикация успешно отправлена (ID: ${sentMsg?.id || 'scheduled'})`);
      return {
        success: true,
        messageId: sentMsg ? sentMsg.id : null,
        method: 'mtproto',
      };
    } catch (e) {
      // Fallback to Bot API if configured and MTProto failed due to peer/session issue
      if (this.settings.botToken && !scheduleDate) {
        try {
          this._addLog('warn', 'Post', `Ошибка MTProto (${e.message}), пробуем отправить через Bot API...`);
          return await this.sendViaBotApi({ targetPeer, text, parseMode, silent, pin, mediaPath });
        } catch (botErr) {
          // Throw original error if bot also fails
        }
      }
      await this._handleApiError(e, 'sendPost');
    }
  }

  async sendAutomationNotification({
    type,
    targetPeer,
    payload,
    pin = false,
    silent = false,
    customText = null,
    scheduleDate = null,
  }) {
    let formattedText = customText;

    if (!formattedText) {
      let template = payload?.customTemplate || '';
      if (!template) {
        switch (type) {
          case 'start':
            template = this.settings.startNoticeTemplate;
            break;
          case 'reminder':
            template = this.settings.reminderTemplate;
            break;
          case 'fix':
            template = this.settings.fixNoticeTemplate;
            break;
          case 'track':
          case 'track_received':
            template = this.settings.trackReceivedTemplate;
            break;
          default:
            template = this.settings.headerTemplate + '\n\n' + this.settings.footerTemplate;
            break;
        }
      }

      formattedText = template;
      if (payload && typeof payload === 'object') {
        Object.entries(payload).forEach(([key, val]) => {
          formattedText = formattedText.replaceAll(`{${key}}`, String(val ?? ''));
        });
      }
    }

    return await this.sendPost({
      targetPeer: targetPeer || this.settings.defaultChannelId,
      text: formattedText,
      parseMode: 'html',
      silent,
      pin,
      scheduleDate,
    });
  }

  async fetchPublicChannelPosts(channelUsername, query = '', limit = 30, directPostId = null) {
    const { cleanUsername } = this._parsePeerInput(channelUsername);
    if (!cleanUsername) {
      return { success: false, posts: [], error: 'Укажите логин публичного канала (@channel)' };
    }

    this._addLog(
      'info',
      'Public Preview',
      `Запрос веб-предпросмотра t.me/s/${cleanUsername} (запрос: "${query || ''}")...`
    );

    return new Promise((resolve) => {
      const url = directPostId
        ? `https://t.me/${encodeURIComponent(cleanUsername)}/${directPostId}?embed=1&mode=tme`
        : `https://t.me/s/${encodeURIComponent(cleanUsername)}`;

      const req = https.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          },
          timeout: 8000,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const loc = res.headers.location;
            if (loc.includes('t.me/') && !loc.endsWith(`/${cleanUsername}`)) {
              const redirectTarget = loc.split('/').filter(Boolean).pop();
              if (redirectTarget && redirectTarget !== cleanUsername) {
                this._addLog('info', 'Public Preview', `Редирект на @${redirectTarget}`);
                return resolve(
                  this.fetchPublicChannelPosts(redirectTarget, query, limit, directPostId)
                );
              }
            }
          }

          if (res.statusCode === 404) {
            this._addLog(
              'warn',
              'Public Preview',
              `Канал @${cleanUsername} не найден или приватный (404)`
            );
            return resolve({
              success: false,
              posts: [],
              error: `Канал @${cleanUsername} не найден или является закрытым.`,
            });
          }

          if (res.statusCode !== 200) {
            this._addLog(
              'warn',
              'Public Preview',
              `Ответ HTTP ${res.statusCode} при запросе @${cleanUsername}`
            );
            return resolve({
              success: false,
              posts: [],
              error: `Не удалось загрузить страницу канала @${cleanUsername} (HTTP ${res.statusCode})`,
            });
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const messageBlocks = data.split('class="tgme_widget_message_wrap');
              const allPosts = [];
              const cleanQuery = String(query || '').toLowerCase().trim();

              for (const block of messageBlocks.slice(1)) {
                const postMatch = block.match(/data-post="([^"]+)"/);
                if (!postMatch) continue;
                const fullPostId = postMatch[1];
                const parts = fullPostId.split('/');
                const numId = Number(parts[1]) || fullPostId;

                if (directPostId && Number(numId) !== Number(directPostId)) {
                  continue;
                }

                const textMatch = block.match(
                  /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/
                );
                const rawText = textMatch ? textMatch[1] : '';
                const cleanText = rawText
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<[^>]+>/g, '')
                  .replace(/&quot;/g, '"')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&#39;/g, "'")
                  .replace(/&#039;/g, "'")
                  .replace(/&nbsp;/g, ' ')
                  .trim();

                const dateMatch = block.match(/<time[^>]+datetime="([^"]+)"/);
                const isoDate = dateMatch ? dateMatch[1] : null;
                const dateObj = isoDate ? new Date(isoDate) : new Date();
                const unixSec = Math.floor(dateObj.getTime() / 1000);

                const viewsMatch = block.match(/class="tgme_widget_message_views">([^<]+)<\/span>/);
                const viewsStr = viewsMatch ? viewsMatch[1].trim() : '0';

                const hasMedia =
                  block.includes('tgme_widget_message_photo') ||
                  block.includes('tgme_widget_message_video') ||
                  block.includes('tgme_widget_message_document') ||
                  block.includes('tgme_widget_message_voice');

                const isPinned = block.includes('tgme_widget_message_pinned');

                allPosts.push({
                  id: numId,
                  date: unixSec,
                  dateFormatted: formatRuDateTime(unixSec),
                  text: cleanText,
                  message: cleanText,
                  views: viewsStr,
                  forwards: 0,
                  link: `https://t.me/${fullPostId}`,
                  postLink: `https://t.me/${fullPostId}`,
                  hasMedia,
                  isPinned,
                });
              }

              allPosts.reverse();

              let matchedPosts = allPosts;
              if (cleanQuery) {
                const words = cleanQuery.split(/\s+/).filter(Boolean);
                matchedPosts = allPosts.filter((p) => {
                  const lower = p.text.toLowerCase();
                  if (lower.includes(cleanQuery)) return true;
                  return words.length > 0 && words.every((w) => lower.includes(w));
                });
              }

              this._addLog(
                'info',
                'Public Preview',
                `Получено ${matchedPosts.length} (всего на странице: ${allPosts.length}) постов из @${cleanUsername}`
              );
              resolve({
                success: true,
                isPublicPreview: true,
                posts: matchedPosts.slice(0, limit),
              });
            } catch (parseErr) {
              this._addLog('error', 'Public Preview', `Ошибка парсинга HTML: ${parseErr.message}`);
              resolve({
                success: false,
                posts: [],
                error: `Ошибка разбора страницы канала: ${parseErr.message}`,
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        this._addLog('warn', 'Public Preview', `Сетевая ошибка при запросе t.me: ${err.message}`);
        resolve({
          success: false,
          posts: [],
          error: `Сетевая ошибка предпросмотра Telegram: ${err.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        this._addLog('warn', 'Public Preview', `Тайм-аут веб-предпросмотра t.me/s/${cleanUsername}`);
        resolve({
          success: false,
          posts: [],
          error: `Превышено время ожидания ответа от t.me/s/${cleanUsername}. Авторизуйтесь в MTProto для прямого доступа.`,
        });
      });
    });
  }

  async searchChannelPosts({ channelPeer, channelId, query = '', limit = 30 }) {
    const rawTarget = channelPeer || channelId || this.settings.defaultChannelId;
    if (!rawTarget) throw new Error('Укажите ID или @username канала');

    // Also check if query itself contains a direct t.me post URL
    const parsedTarget = this._parsePeerInput(rawTarget);
    const parsedQuery = query && String(query).includes('t.me/') ? this._parsePeerInput(query) : null;

    const peer = parsedQuery?.peer || parsedTarget.peer;
    const directPostId = parsedQuery?.postId || parsedTarget.postId;
    const cleanUsername = parsedQuery?.cleanUsername || parsedTarget.cleanUsername;
    const isPublicPeer = Boolean(parsedQuery ? parsedQuery.isPublic : parsedTarget.isPublic);
    const effectiveQuery = parsedQuery?.postId ? '' : String(query || '').trim();

    this._addLog(
      'info',
      'Search',
      `searchChannelPosts: peer="${peer}", query="${effectiveQuery}", directPostId=${directPostId || 'none'}`
    );

    let mtprotoReady = Boolean(this.client && this.status === 'connected' && this.me && this.me.id);
    if (!mtprotoReady && this.settings.sessionString) {
      try {
        const reconnected = await this.connectWithSavedSession();
        mtprotoReady = Boolean(reconnected && this.status === 'connected');
      } catch (connErr) {
        this._addLog('warn', 'Search', `Автоподключение перед поиском: ${connErr.message}`);
      }
    }

    if (mtprotoReady) {
      try {
        const resolvedPeer = await this._resolvePeer(peer);
        let messages = await this._invokeWithMigration(async () => {
          if (directPostId) {
            const singleMsg = await this.client.getMessages(resolvedPeer, { ids: [directPostId] });
            return singleMsg ? (Array.isArray(singleMsg) ? singleMsg : [singleMsg]) : [];
          } else {
            return await this.client.getMessages(resolvedPeer, {
              limit: Math.min(limit, 50),
              search: effectiveQuery || undefined,
            });
          }
        });

        // If server-side search with multi-word query returned 0, fallback to fetching recent posts and filtering locally
        if (
          (!messages || messages.length === 0) &&
          effectiveQuery &&
          !directPostId
        ) {
          const recentMessages = await this._invokeWithMigration(async () => {
            return await this.client.getMessages(resolvedPeer, { limit: 50 });
          });
          const qLower = effectiveQuery.toLowerCase();
          const words = qLower.split(/\s+/).filter(Boolean);
          messages = (recentMessages || []).filter((m) => {
            const txt = String(m?.message || '').toLowerCase();
            if (!txt) return false;
            if (txt.includes(qLower)) return true;
            return words.length > 0 && words.every((w) => txt.includes(w));
          });
        }

        const resolvedUsername =
          cleanUsername ||
          resolvedPeer?.username ||
          this._dialogsCache.find((d) => d.id === peer)?.username ||
          '';

        const posts = (messages || [])
          .filter(Boolean)
          .map((m) => {
            const postLink = resolvedUsername
              ? `https://t.me/${resolvedUsername}/${m.id}`
              : `https://t.me/c/${String(peer).replace(/^-100/, '')}/${m.id}`;

            return {
              id: m.id,
              date: m.date || Math.floor(Date.now() / 1000),
              dateFormatted: formatRuDateTime(m.date),
              text: m.message || '',
              message: m.message || '',
              views: m.views || 0,
              forwards: m.forwards || 0,
              link: postLink,
              postLink,
              hasMedia: !!m.media,
              isPinned: !!m.pinned,
            };
          });

        this._addLog('info', 'Search', `Найдено ${posts.length} публикаций через Telegram MTProto`);
        return {
          success: true,
          posts,
        };
      } catch (mtErr) {
        this._addLog(
          'warn',
          'Search',
          `MTProto запрос для "${peer}" завершился с предупреждением: ${mtErr.message}`
        );
      }
    }

    // Fallback to public web preview for @username channels
    if (isPublicPeer && cleanUsername) {
      const publicResult = await this.fetchPublicChannelPosts(
        cleanUsername,
        effectiveQuery,
        limit,
        directPostId
      );
      if (publicResult && publicResult.success) {
        return publicResult;
      }

      return {
        success: false,
        posts: publicResult?.posts || [],
        error:
          publicResult?.error ||
          `Не удалось загрузить посты @${cleanUsername}. Авторизуйтесь в Telegram MTProto.`,
      };
    }

    return {
      success: false,
      posts: [],
      error:
        'Для поиска в закрытых каналах (по ID) необходима авторизация в Telegram MTProto (по QR-коду или номеру телефона).',
    };
  }

  /**
   * Scans chat messages for audio tracks, voice messages, and archive files (.zip, .rar, .7z).
   * Returns { success: true, files: TelegramAudioFileItem[] } matching the frontend contract.
   */
  async getChatAudioFiles({ chatPeer, chatId, limit = 80 }) {
    await this.ensureConnected();
    try {
      const rawPeer = chatPeer || chatId;
      if (!rawPeer) throw new Error('Укажите чат или рабочую группу для сканирования');
      const peer = await this._resolvePeer(rawPeer);

      const messages = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { limit: Math.min(limit || 80, 150) });
      });

      const audioExts = new Set(['.wav', '.mp3', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.wma', '.aiff']);
      const archiveExts = new Set(['.zip', '.rar', '.7z', '.tar', '.gz']);
      const files = [];

      for (const m of messages || []) {
        if (!m || !m.media) continue;

        let isSupportedFile = false;
        let isVoice = false;
        let fileName = '';
        let fileSize = 0;
        let duration = 0;
        let mimeType = '';

        const doc = m.media.document;
        if (doc) {
          fileSize = Number(doc.size || 0);
          mimeType = String(doc.mimeType || '').toLowerCase();

          if (doc.attributes && Array.isArray(doc.attributes)) {
            for (const attr of doc.attributes) {
              if (attr.fileName) fileName = attr.fileName;
              if (attr.duration !== undefined) duration = Number(attr.duration || 0);
              if (attr.voice) {
                isVoice = true;
                isSupportedFile = true;
              }
            }
          }

          const ext = fileName ? path.extname(fileName).toLowerCase() : '';

          if (
            mimeType.startsWith('audio/') ||
            mimeType.includes('ogg') ||
            mimeType.includes('wav') ||
            mimeType.includes('flac') ||
            audioExts.has(ext) ||
            archiveExts.has(ext)
          ) {
            isSupportedFile = true;
          }
        }

        if (isSupportedFile) {
          if (!fileName) {
            const defaultExt = isVoice
              ? '.ogg'
              : mimeType.includes('wav')
              ? '.wav'
              : mimeType.includes('flac')
              ? '.flac'
              : '.mp3';
            fileName = `${isVoice ? 'voice' : 'track'}_${m.id}${defaultExt}`;
          }

          const sender = this._extractSenderInfo(m);
          const sizeFormatted = formatFileSize(fileSize);
          const durationFormatted = formatDuration(duration);
          const dateFormatted = formatRuDateTime(m.date);

          files.push({
            id: m.id,
            date: m.date || Math.floor(Date.now() / 1000),
            dateFormatted,
            sender,
            fileName,
            mimeType: mimeType || 'audio/mpeg',
            size: fileSize,
            sizeFormatted,
            duration,
            durationFormatted,
            isVoice,
            caption: m.message || '',
            // Legacy fields for compatibility
            fileSize,
            fileSizeFormatted: sizeFormatted,
            senderId: sender.id,
            messageText: m.message || '',
          });
        }
      }

      this._addLog('info', 'Audio', `Найдено ${files.length} дорожек/архивов в чате "${rawPeer}"`);
      return {
        success: true,
        files,
      };
    } catch (e) {
      await this._handleApiError(e, 'getChatAudioFiles');
    }
  }

  /**
   * Loads recent messages from a chat/channel and formats them for TelegramMessengerTab.
   * Returns { success: true, messages: TelegramChatMessage[] } in chronological order.
   */
  async getChatMessages({ chatPeer, chatId, limit = 50 }) {
    await this.ensureConnected();
    try {
      const rawPeer = chatPeer || chatId;
      if (!rawPeer) throw new Error('Укажите чат или канал');
      const peer = await this._resolvePeer(rawPeer);

      const rawMessages = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { limit: Math.min(limit || 50, 100) });
      });

      const messages = (rawMessages || [])
        .filter(Boolean)
        .map((m) => {
          const sender = this._extractSenderInfo(m);
          let mediaName = '';
          if (m.media && m.media.document && Array.isArray(m.media.document.attributes)) {
            for (const attr of m.media.document.attributes) {
              if (attr.fileName) mediaName = attr.fileName;
            }
          }
          const hasMedia = Boolean(m.media);
          const textContent =
            m.message ||
            (mediaName ? `📎 Файл: ${mediaName}` : hasMedia ? '📎 [Медиа-вложение]' : '');

          return {
            id: String(m.id),
            senderName: sender.name,
            senderUsername: sender.username,
            senderId: sender.id,
            text: textContent,
            time: formatRuTimeShort(m.date),
            date: m.date,
            dateFormatted: formatRuDateTime(m.date),
            isMe: Boolean(m.out),
            out: Boolean(m.out),
            isPinned: Boolean(m.pinned),
            hasMedia,
            mediaPath: mediaName || undefined,
            views: m.views || 0,
          };
        })
        .reverse(); // Chronological order (oldest -> newest) for chat view

      return {
        success: true,
        messages,
      };
    } catch (e) {
      await this._handleApiError(e, 'getChatMessages');
    }
  }

  async downloadChatAudioFile({ chatPeer, messageId, targetDir, customFileName }) {
    await this.ensureConnected();
    try {
      const peer = await this._resolvePeer(chatPeer);
      const msgs = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { ids: [Number(messageId)] });
      });
      const msg = Array.isArray(msgs) ? msgs[0] : msgs;
      if (!msg || !msg.media) {
        throw new Error('Сообщение или медиафайл не найдены в чате');
      }

      let originalName = '';
      if (msg.media.document && Array.isArray(msg.media.document.attributes)) {
        for (const attr of msg.media.document.attributes) {
          if (attr.fileName) originalName = attr.fileName;
        }
      }
      const rawName = customFileName || originalName || `audio_${messageId}.wav`;
      // Sanitize filename for Windows/macOS/Linux
      const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      const saveFolder = targetDir || path.join(this.userDataPath, 'downloads', 'telegram_tracks');

      if (!fs.existsSync(saveFolder)) {
        fs.mkdirSync(saveFolder, { recursive: true });
      }

      const savePath = path.join(saveFolder, safeName);
      this._addLog('info', 'Download', `Скачивание файла "${safeName}" в ${saveFolder}...`);

      const buffer = await this.client.downloadMedia(msg.media, {
        workers: 1,
      });

      if (!buffer) {
        throw new Error('Не удалось получить содержимое файла из Telegram');
      }

      await fs.promises.writeFile(savePath, buffer);
      this._addLog('info', 'Download', `Файл успешно сохранен: ${savePath} (${formatFileSize(buffer.length)})`);

      return {
        success: true,
        filePath: savePath,
        fileName: safeName,
        size: buffer.length,
        fileSize: buffer.length,
      };
    } catch (e) {
      await this._handleApiError(e, 'downloadChatAudioFile');
    }
  }

  async _handleApiError(e, context = '') {
    const errMsg = e.message || e.errorMessage || String(e);
    this._addLog('error', 'API Error', `[${context}] ${errMsg}`);
    if (this._isSessionInvalidError(errMsg)) {
      this.status = 'disconnected';
      this.me = null;
      this.session = null;
      this._dialogEntities.clear();
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (err) {}
        this.client = null;
      }
      this.settings.sessionString = '';
      await this.saveSettings({ sessionString: '' });
      throw new Error(
        'Сессия Telegram устарела или была завершена. Пожалуйста, выполните повторный вход.'
      );
    }
    throw new Error(errMsg);
  }

  async ensureConnected() {
    if (this._initPromise) {
      await this._initPromise.catch(() => {});
    }

    if (this.client && this.status === 'connected' && this.me && this.me.id) {
      if (this.client.connected === false) {
        try {
          await this.client.connect();
        } catch (reconnErr) {
          this._addLog('warn', 'MTProto', `Ошибка переподключения сокета: ${reconnErr.message}`);
        }
      }
      return true;
    }

    if (this.settings.sessionString) {
      this._addLog('info', 'MTProto', 'Автоматическое подключение по сохраненной сессии...');
      const reconnected = await this.connectWithSavedSession();
      if (reconnected && this.status === 'connected') {
        return true;
      }
    }

    this.status = 'disconnected';
    throw new Error(
      'Подключение к Telegram MTProto отсутствует. Пожалуйста, авторизуйтесь в Telegram (по QR-коду или номеру телефона).'
    );
  }

  async getStatusAsync() {
    if (this._initPromise) {
      await this._initPromise.catch(() => {});
    }

    // If a background session connection is currently in progress, wait up to 3.5s for it
    if (this._connectingPromise) {
      await Promise.race([
        this._connectingPromise.catch(() => {}),
        new Promise((r) => setTimeout(r, 3500)),
      ]);
    } else if (
      this.status === 'disconnected' &&
      this.settings.sessionString &&
      !this.qrAuthActive
    ) {
      // Trigger reconnect if we have a saved session
      await Promise.race([
        this.connectWithSavedSession().catch(() => {}),
        new Promise((r) => setTimeout(r, 3500)),
      ]);
    }

    return this.getStatus();
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      me: this.me,
      botConnected: Boolean(this.botMe || (this.settings.botToken && String(this.settings.botToken).trim())),
      botMe: this.botMe,
      phoneNumber: this.phoneNumber || this.settings.phoneNumber,
      isCodeViaApp: this.isCodeViaApp,
      passwordHint: this.passwordHint,
      qrStatus: this.qrStatus,
      qrUrl: this.qrUrl,
      qrDataUrl: this.qrDataUrl,
      qrExpires: this.qrExpires,
      qrError: this.qrError,
      settings: {
        enabled: this.settings.enabled,
        apiId: this.settings.apiId,
        apiHash: this.settings.apiHash,
        phoneNumber: this.settings.phoneNumber,
        botToken: this.settings.botToken,
        defaultChannelId: this.settings.defaultChannelId,
        autoPin: Boolean(this.settings.autoPin),
        autoNotify: this.settings.autoNotify,
        parseMode: this.settings.parseMode,
        headerTemplate: this.settings.headerTemplate,
        footerTemplate: this.settings.footerTemplate,
        startNoticeTemplate: this.settings.startNoticeTemplate,
        reminderTemplate: this.settings.reminderTemplate,
        fixNoticeTemplate: this.settings.fixNoticeTemplate,
        trackReceivedTemplate: this.settings.trackReceivedTemplate,
        hasSession: !!this.settings.sessionString,
      },
    };
  }

  async disconnect() {
    return await this.logout();
  }
}

module.exports = TelegramMTProtoService;
