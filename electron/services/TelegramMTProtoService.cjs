const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const net = require('net');
const log = require('electron-log');

// Official public Telegram credentials used for seamless out-of-the-box authorization
const DEFAULT_TELEGRAM_API_ID = 2040;
const DEFAULT_TELEGRAM_API_HASH = 'b18441a1ff607e10a989891a5462e627';

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  let cleaned = String(phoneNumber).trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.slice(1).replace(/\+/g, '');
  } else {
    if (cleaned.startsWith('8') && cleaned.length === 11) {
      cleaned = '+7' + cleaned.slice(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 11) {
      cleaned = '+7' + cleaned.slice(1);
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

class TelegramMTProtoService {
  constructor(dataManager, userDataPath) {
    this.dataManager = dataManager;
    this.userDataPath = userDataPath;
    this.client = null;
    this.session = null;
    this.status = 'disconnected'; // 'disconnected', 'code_sent', 'password_required', 'connected'
    this.phoneCodeHash = null;
    this.phoneNumber = null;
    this.isCodeViaApp = true;
    this.me = null;

    // Mutex promise to prevent concurrent connection attempts / collisions
    this._connectingPromise = null;

    // Internal In-Memory Ring Buffer for diagnostic logs
    this.logs = [];

    // QR Code Authentication State
    this.qrAuthActive = false;
    this.qrToken = null;
    this.qrExpires = 0;
    this.qrDataUrl = '';
    this.qrUrl = '';
    this.qrStatus = 'idle'; // 'idle', 'waiting_scan', 'password_required', 'authenticated', 'error'
    this.qrError = null;

    this.botMe = null;

    this.settings = {
      apiId: '',
      apiHash: '',
      phoneNumber: '',
      sessionString: '',
      botToken: '',
      defaultChannelId: '',
      autoPin: false,
      autoNotify: true,
      parseMode: 'html',
      headerTemplate: '✨ <b>{title_ru}</b> [{episode_number} СЕРИЯ]',
      footerTemplate: '📌 Смотреть: {site_link}\n💬 Обсуждение: {tg_group}',
      startNoticeTemplate: '🎬 <b>СТАРТ РАБОТЫ НАД СЕРИЕЙ!</b>\n📌 <b>{project_title}</b> — Серия {episode_number}\n\n👥 <b>Состав команды:</b>\n{dubbers_list}\n\n📅 <b>Дедлайн сдачи:</b> {deadline}\n🔗 <b>Материалы:</b> {source_link}',
      reminderTemplate: '⏰ <b>НАПОМИНАНИЕ О ДЕДЛАЙНЕ!</b>\nРелиз: <b>{project_title}</b> (Серия {episode_number})\n\nКоллеги, ожидаем ваши дорожки:\n{pending_dubbers}\n\nПросьба дописать как можно скорее! 🙏',
      fixNoticeTemplate: '⚠️ <b>СПИСОК ФИКСОВ / ПРАВОК</b>\nКому: {dubber_mention}\nПроект: <b>{project_title}</b> (Серия {episode_number})\n\n{fixes_list}',
      trackReceivedTemplate: '🎙️ <b>ДОРОЖКА ПРИНЯТА!</b>\nДабер: {dubber_name}\nСерия: {episode_number}\nСтатус: ✅ Готово к сведению',
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

    const logStr = `[MTProto ${tag}] ${message}${details ? ' ' + (typeof details === 'object' ? JSON.stringify(details) : details) : ''}`;
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

  async testConnection() {
    const startTime = Date.now();
    try {
      this._addLog('info', 'Test', 'Запуск проверки соединения с Telegram MTProto...');
      await this.ensureConnected();
      const latencyMs = Date.now() - startTime;
      const dcId = (this.client && this.client.session) ? this.client.session.dcId : null;
      this._addLog('info', 'Test', `Проверка связи успешна! Задержка: ${latencyMs}мс, DC: ${dcId || 'N/A'}, Аккаунт: @${this.me?.username || this.me?.id || 'N/A'}`);
      return {
        success: true,
        connected: true,
        latencyMs,
        dcId,
        me: this.me,
        status: this.status,
        hasSession: !!this.settings.sessionString
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this._addLog('warn', 'Test', `Тест подключения не прошел: ${err.message}`);
      return {
        success: false,
        connected: false,
        latencyMs,
        error: err.message,
        hasSession: !!this.settings.sessionString
      };
    }
  }

  async init() {
    try {
      this._addLog('info', 'Init', 'Initializing Telegram MTProto service...');
      const saved = await this.dataManager.getData('telegram_mtproto_settings.json');
      if (saved && typeof saved === 'object') {
        this.settings = { ...this.settings, ...saved };
      }
      if (this.settings.sessionString) {
        this._addLog('info', 'Init', 'Saved session detected, initiating background connection...');
        this.connectWithSavedSession().catch(err => {
          this._addLog('warn', 'Init', `Background connect notice: ${err.message}`);
        });
      } else {
        this._addLog('info', 'Init', 'No saved sessionString found. Ready for QR/phone login.');
      }
    } catch (e) {
      this._addLog('error', 'Init', `Error during init: ${e.message}`);
    }
  }

  async saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await this.dataManager.saveData('telegram_mtproto_settings.json', this.settings);
    return this.settings;
  }

  _createTelegramClient(session, apiId, apiHash, customParams = {}) {
    const is64 = process.arch === 'x64' || process.arch === 'arm64';
    const platform = process.platform === 'win32' ? 'Windows 10' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    return new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: false,
      autoReconnect: true,
      floodSleepThreshold: 60,
      deviceModel: is64 ? 'PC 64bit' : 'PC 32bit',
      systemVersion: platform,
      appVersion: '5.6.3 x64',
      langCode: 'ru',
      systemLangCode: 'ru',
      ...customParams,
    });
  }

  async connectWithSavedSession() {
    if (this._connectingPromise) {
      this._addLog('info', 'Auth', 'Auto-reconnect already in progress, awaiting existing promise...');
      return await this._connectingPromise;
    }

    if (this.client && this.status === 'connected' && this.me && this.me.id && this.client.connected) {
      return true;
    }

    if (!this.settings.sessionString) {
      this.status = 'disconnected';
      this.me = null;
      return false;
    }

    this._connectingPromise = (async () => {
      try {
        const apiId = Number(this.settings.apiId || DEFAULT_TELEGRAM_API_ID);
        const apiHash = String(this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim();
        
        if (!apiId || !apiHash) {
          throw new Error('API_ID or API_HASH is missing. Re-authentication required.');
        }

        this._addLog('info', 'Auth', `Connecting with saved session (apiId: ${apiId}, sessionLen: ${this.settings.sessionString.length})...`);

        if (this.client) {
          try { await this.client.disconnect(); } catch (e) {}
          this.client = null;
        }

        this.session = new StringSession(this.settings.sessionString);
        this.client = this._createTelegramClient(this.session, apiId, apiHash);

        await this.client.connect();
        this._addLog('info', 'Auth', 'MTProto transport connected. Verifying authorization with Telegram DC...');

        // Verify authorization by fetching current user with DC migration resilience
        let me = null;
        try {
          me = await this._invokeWithMigration(async () => {
            return await this.client.getMe();
          });
        } catch (authCheckErr) {
          const checkMsg = authCheckErr.message || String(authCheckErr);
          this._addLog('warn', 'Auth', `getMe verification notice: ${checkMsg}`);
          if (
            checkMsg.includes('AUTH_KEY_UNREGISTERED') ||
            checkMsg.includes('AUTH_KEY_INVALID') ||
            checkMsg.includes('SESSION_REVOKED') ||
            checkMsg.includes('SESSION_EXPIRED')
          ) {
            this._addLog('error', 'Auth', 'Saved session is revoked or expired on Telegram servers. Clearing session...');
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
          
          // Save updated session (which may have migrated to home DC)
          if (this.client.session) {
            const savedStr = this.client.session.save();
            if (savedStr && savedStr !== this.settings.sessionString) {
              this.settings.sessionString = savedStr;
              await this.saveSettings({ sessionString: savedStr, phoneNumber: this.me.phone });
            }
          }

          this._addLog('info', 'Auth', `Connected and authorized as: @${this.me.username || this.me.id} (${this.me.firstName})`);
          return true;
        } else {
          this.status = 'disconnected';
          this.me = null;
          return false;
        }
      } catch (e) {
        const errMsg = e.message || String(e);
        this._addLog('error', 'Auth', `Failed connecting with saved session: ${errMsg}`);
        this.status = 'disconnected';
        this.me = null;
        if (
          errMsg.includes('AUTH_KEY_UNREGISTERED') ||
          errMsg.includes('AUTH_KEY_INVALID') ||
          errMsg.includes('SESSION_REVOKED') ||
          errMsg.includes('SESSION_EXPIRED')
        ) {
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
   * Helper to execute Telegram MTProto calls with automatic DC migration
   * (following WTelegramClient's proven 303 *_MIGRATE_X handling).
   */
  async _invokeWithMigration(callFn, maxRetries = 4) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await callFn();
      } catch (err) {
        const errMsg = err.message || String(err);
        this._addLog('warn', 'MTProto RPC', `RPC attempt ${attempt + 1} notice: ${errMsg}`);
        
        // 1. Data Center Migration
        const migrateMatch = errMsg.match(/(?:PHONE|USER|NETWORK|CHANNEL|FILE|STATS)_MIGRATE_(\d+)/i) || 
                             (err.newDc ? [null, err.newDc] : null);
        if (migrateMatch && migrateMatch[1]) {
          const targetDc = Number(migrateMatch[1]);
          this._addLog('info', 'MTProto DC', `Migrating to DC ${targetDc} (attempt ${attempt + 1}/${maxRetries})...`);
          if (this.client) {
            await this.client._switchDC(targetDc);
            if (this.client.session && this.status === 'connected') {
              const newSession = this.client.session.save();
              this.settings.sessionString = newSession;
              await this.saveSettings({ sessionString: newSession });
              this._addLog('info', 'MTProto DC', `Migrated to DC ${targetDc} and updated sessionString.`);
            }
          }
          continue;
        }

        // 2. Auth Restart
        if (errMsg.includes('AUTH_RESTART') && attempt < maxRetries - 1) {
          this._addLog('info', 'MTProto RPC', 'AUTH_RESTART received, waiting 1s before retry...');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        // 3. Flood Wait
        if (errMsg.includes('FLOOD_WAIT_') && attempt < maxRetries - 1) {
          const sec = Number(errMsg.match(/FLOOD_WAIT_(\d+)/)?.[1] || 0);
          if (sec > 0 && sec <= 6) {
            this._addLog('info', 'MTProto RPC', `Short flood wait (${sec}s), sleeping before retry...`);
            await new Promise(r => setTimeout(r, sec * 1000));
            continue;
          }
        }

        // 4. Disconnected / Socket Closed
        if ((errMsg.includes('disconnected') || errMsg.includes('CONNECTION_LOST') || errMsg.includes('Cannot send requests while disconnected')) && attempt < maxRetries - 1) {
          this._addLog('warn', 'MTProto RPC', 'Socket disconnected, attempting reconnect...');
          if (this.client) {
            try {
              await this.client.connect();
              continue;
            } catch (reconnErr) {
              this._addLog('error', 'MTProto RPC', `Reconnect failed: ${reconnErr.message}`);
            }
          }
        }

        throw err;
      }
    }
  }

  async sendCode(phoneNumber, customApiId, customApiHash, forceSMS = false) {
    console.log(`[MTProto Auth] >>> sendCode requested: phone=${phoneNumber}, customApiId=${customApiId}, forceSMS=${forceSMS}`);
    try {
      const cleanPhone = normalizePhoneNumber(phoneNumber);
      console.log(`[MTProto Auth] Normalized phone: "${cleanPhone}"`);
      if (!cleanPhone || cleanPhone.length < 7) {
        throw new Error('Укажите корректный номер телефона (напр. +79991234567)');
      }

      const apiId = Number(customApiId || this.settings.apiId || DEFAULT_TELEGRAM_API_ID);
      const apiHash = String(customApiHash || this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim();

      console.log(`[MTProto Auth] Using apiId=${apiId}, apiHash length=${apiHash ? apiHash.length : 0}`);

      this.settings.apiId = apiId;
      this.settings.apiHash = apiHash;
      this.phoneNumber = cleanPhone;

      if (!this.client || !this.client.connected) {
        if (this.client) {
          try { 
            console.log('[MTProto Auth] Disconnecting existing client instance...');
            await this.client.disconnect(); 
          } catch (e) {
            console.warn('[MTProto Auth] Disconnect previous client ignored:', e.message);
          }
        }

        console.log('[MTProto Auth] Initializing TelegramClient instance with StringSession...');
        this.session = new StringSession('');
        this.client = this._createTelegramClient(this.session, apiId, apiHash);

        console.log('[MTProto Auth] Connecting to Telegram MTProto DC servers...');
        await this.client.connect();
      }

      console.log('[MTProto Auth] Connected successfully to MTProto network. Sending auth code request with migration support...');
      
      const res = await this._invokeWithMigration(async () => {
        return await this.client.sendCode({ apiId, apiHash }, cleanPhone, forceSMS);
      });

      console.log('[MTProto Auth] sendCode response received:', {
        phoneCodeHash: res?.phoneCodeHash,
        isCodeViaApp: res?.isCodeViaApp,
        type: res?.type?.constructor?.name || typeof res?.type
      });

      this.phoneCodeHash = res.phoneCodeHash;
      this.isCodeViaApp = !!res.isCodeViaApp;
      this.status = 'code_sent';

      await this.saveSettings({ phoneNumber: cleanPhone, apiId, apiHash });

      log.info(`[MTProto Auth] sendCode success: phoneCodeHash=${res.phoneCodeHash}, isCodeViaApp=${res.isCodeViaApp}`);

      return { 
        success: true, 
        phoneCodeHash: res.phoneCodeHash, 
        isCodeViaApp: !!res.isCodeViaApp,
        deliveryMethod: res.isCodeViaApp ? 'app' : 'sms',
        formattedPhone: cleanPhone,
        message: res.isCodeViaApp 
          ? 'Код отправлен в приложение Telegram (чат «Telegram» / ID 777000)'
          : `Код отправлен по SMS на номер ${cleanPhone}`
      };
    } catch (e) {
      console.error('[MTProto Auth] sendCode FAILED:', e);
      log.error('[MTProto Auth] sendCode error:', e);
      let msg = e.message || String(e);
      if (msg.includes('PHONE_NUMBER_INVALID')) {
        msg = 'Неверный формат номера телефона. Проверьте правильность и код страны (напр. +79991234567).';
      } else if (msg.includes('PHONE_NUMBER_UNOCCUPIED')) {
        msg = 'Этот номер телефона не зарегистрирован в Telegram. Зарегистрируйтесь в официальном клиенте.';
      } else if (msg.includes('API_ID_INVALID') || msg.includes('API_HASH_INVALID')) {
        msg = 'Неверный API ID или API Hash. Получите персональные ключи на my.telegram.org в разделе API development tools.';
      } else if (msg.includes('API_ID_PUBLISHED_FLOOD')) {
        msg = 'Публичный API ID временно перегружен Telegram. Пожалуйста, используйте вход по QR-коду (рекомендуется) или введите личный API ID с my.telegram.org.';
      } else if (msg.includes('PHONE_NUMBER_BANNED')) {
        msg = 'Этот номер телефона заблокирован в Telegram.';
      } else if (msg.includes('PHONE_CODE_EXPIRED')) {
        msg = 'Срок действия кода истек. Запросите код повторно.';
      } else if (msg.includes('FLOOD_WAIT')) {
        const seconds = msg.match(/\d+/)?.[0] || 'несколько';
        msg = `Слишком много запросов. Telegram временно ограничил отправку кодов (ожидание ~${seconds} сек). Попробуйте позже или используйте вход по QR-коду.`;
      }
      throw new Error(msg);
    }
  }

  async resendCode(forceSMS = true) {
    console.log(`[MTProto Auth] >>> resendCode requested: forceSMS=${forceSMS}, phone=${this.phoneNumber}`);
    if (!this.client || !this.phoneNumber || !this.phoneCodeHash) {
      throw new Error('Сначала отправьте запрос на получение кода.');
    }
    try {
      console.log('[MTProto Auth] Invoking auth.ResendCode with migration resilience...');
      const res = await this._invokeWithMigration(async () => {
        return await this.client.invoke(new Api.auth.ResendCode({
          phoneNumber: this.phoneNumber,
          phoneCodeHash: this.phoneCodeHash,
        }));
      });
      console.log('[MTProto Auth] resendCode response received:', res);
      this.phoneCodeHash = res.phoneCodeHash;
      this.isCodeViaApp = res.type instanceof Api.auth.SentCodeTypeApp;
      return {
        success: true,
        phoneCodeHash: res.phoneCodeHash,
        isCodeViaApp: this.isCodeViaApp,
        deliveryMethod: this.isCodeViaApp ? 'app' : 'sms',
        message: this.isCodeViaApp
          ? 'Код отправлен в приложение Telegram'
          : `Код отправлен по SMS на ${this.phoneNumber}`
      };
    } catch (e) {
      console.error('[MTProto Auth] resendCode FAILED:', e);
      log.error('[MTProto Auth] resendCode error:', e);
      let msg = e.message || String(e);
      if (msg.includes('SEND_CODE_UNAVAILABLE')) {
        msg = 'Повторная отправка через SMS недоступна. Проверьте чат «Telegram» в вашем приложении.';
      } else if (msg.includes('FLOOD_WAIT')) {
        const seconds = msg.match(/\d+/)?.[0] || 'несколько';
        msg = `Слишком много попыток. Пожалуйста, подождите ~${seconds} сек.`;
      }
      throw new Error(msg);
    }
  }

  async signIn(phoneCode, password) {
    console.log(`[MTProto Auth] >>> signIn requested: codeLength=${phoneCode ? String(phoneCode).length : 0}, hasPassword=${!!password}`);
    if (!this.client || !this.phoneNumber || !this.phoneCodeHash) {
      throw new Error('Сессия не инициализирована. Запросите код подтверждения заново.');
    }
    try {
      let user;
      const cleanCode = String(phoneCode || '').trim();
      if (!cleanCode) {
        throw new Error('Введите код подтверждения');
      }

      try {
        console.log('[MTProto Auth] Invoking auth.SignIn with phoneCode and phoneCodeHash...');
        const signInResult = await this._invokeWithMigration(async () => {
          return await this.client.invoke(new Api.auth.SignIn({
            phoneNumber: this.phoneNumber,
            phoneCodeHash: this.phoneCodeHash,
            phoneCode: cleanCode,
          }));
        });
        console.log('[MTProto Auth] SignIn invoke completed successfully:', signInResult?.user?.id || 'User logged in');
        user = signInResult.user || signInResult;
      } catch (err) {
        const errMsg = err.message || String(err);
        console.warn('[MTProto Auth] auth.SignIn returned error:', errMsg);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
          console.log('[MTProto Auth] 2FA Password is required for this account.');
          this.status = 'password_required';
          if (!password) {
            return { requiresPassword: true };
          }
          console.log('[MTProto Auth] Fetching 2FA password SRP parameters (account.GetPassword)...');
          const passwordSrpResult = await this._invokeWithMigration(async () => {
            return await this.client.invoke(new Api.account.GetPassword());
          });
          console.log('[MTProto Auth] Computing password check SRP hash...');
          const passwordSrpCheck = await computeCheck(passwordSrpResult, password);
          console.log('[MTProto Auth] Invoking auth.CheckPassword...');
          const checkRes = await this._invokeWithMigration(async () => {
            return await this.client.invoke(new Api.auth.CheckPassword({
              password: passwordSrpCheck,
            }));
          });
          console.log('[MTProto Auth] 2FA CheckPassword successful!');
          user = checkRes.user || checkRes;
        } else if (errMsg.includes('PHONE_CODE_INVALID')) {
          throw new Error('Неверный код подтверждения из Telegram.');
        } else if (errMsg.includes('PHONE_CODE_EXPIRED')) {
          throw new Error('Срок действия кода истек. Запросите новый код.');
        } else if (errMsg.includes('PASSWORD_HASH_INVALID')) {
          throw new Error('Неверный пароль 2FA двухфакторной защиты Telegram.');
        } else {
          throw err;
        }
      }

      return await this._completeAuthSuccess(user);
    } catch (e) {
      console.error('[MTProto Auth] signIn FAILED:', e);
      log.error('[MTProto Auth] signIn error:', e);
      throw new Error(e.message || String(e));
    }
  }

  /**
   * Recursive token handler implementing WTelegramClient's proven state-machine:
   * - LoginToken: generates and displays QR code URL tg://login?token=...
   * - LoginTokenMigrateTo: switches to the target DC, calls ImportLoginToken, and loops
   * - LoginTokenSuccess: completes authorization
   */
  async _handleLoginTokenResult(res, apiId, apiHash) {
    if (!res) throw new Error('Пустой ответ от сервера Telegram');

    const className = res.className || res._ || res.constructor?.name || '';
    this._addLog('info', 'QR', `Обработка ответа токена: ${className || 'Unknown'}`);

    if (res instanceof Api.auth.LoginTokenSuccess || className.includes('LoginTokenSuccess') || (res.authorization && (res.authorization.user || res.authorization))) {
      this._addLog('info', 'QR', 'Успешная авторизация (LoginTokenSuccess) подтверждена Telegram сервером!');
      return await this._completeAuthSuccess(res.authorization || res);
    }

    if (res instanceof Api.auth.LoginTokenMigrateTo || className.includes('LoginTokenMigrateTo')) {
      const targetDcId = res.dcId || res.dc_id;
      this._addLog('info', 'QR', `Telegram запросил миграцию на DC ${targetDcId}. Переключение соединения...`);
      await this.client._switchDC(targetDcId);
      this._addLog('info', 'QR', `DC переключен на ${targetDcId}. Импорт токена входа (ImportLoginToken)...`);
      let migratedRes;
      try {
        migratedRes = await this._invokeWithMigration(async () => {
          return await this.client.invoke(new Api.auth.ImportLoginToken({
            token: res.token,
          }));
        });
      } catch (importErr) {
        const importMsg = importErr.message || String(importErr);
        if (importMsg.includes('SESSION_PASSWORD_NEEDED') || importMsg.includes('2FA')) {
          this._addLog('info', 'QR', 'Требуется ввод облачного пароля 2FA Cloud Password после миграции DC');
          this.qrStatus = 'password_required';
          return { requiresPassword: true };
        }
        throw importErr;
      }
      return await this._handleLoginTokenResult(migratedRes, apiId, apiHash);
    }

    if (res instanceof Api.auth.LoginToken || className.includes('LoginToken')) {
      const base64UrlToken = Buffer.from(res.token).toString('base64url');
      const newQrUrl = `tg://login?token=${base64UrlToken}`;
      this.qrUrl = newQrUrl;
      this.qrExpires = res.expires;
      this.qrDataUrl = await QRCode.toDataURL(this.qrUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      this.qrStatus = 'waiting_scan';
      const timeLeft = Math.max(0, res.expires - Math.floor(Date.now() / 1000));
      this._addLog('info', 'QR', `QR-код активен (срок действия: ${timeLeft}с)`);
      return {
        success: true,
        qrUrl: this.qrUrl,
        qrDataUrl: this.qrDataUrl,
        expires: this.qrExpires
      };
    }

    throw new Error(`Неизвестный тип ответа токена: ${className}`);
  }

  async startQrCodeAuth(customApiId, customApiHash) {
    const apiId = Number(customApiId || this.settings.apiId || DEFAULT_TELEGRAM_API_ID);
    const apiHash = String(customApiHash || this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim();

    this._addLog('info', 'QR', `startQrCodeAuth requested (apiId: ${apiId})...`);

    this.settings.apiId = apiId;
    this.settings.apiHash = apiHash;
    await this.saveSettings({ apiId, apiHash });

    // WTelegramClient pattern: If connection is already alive and QR loop is actively running,
    // do NOT drop connection or destroy session! Simply export the latest token on the same socket.
    if (this.client && this.client.connected && this.qrAuthActive && this.qrStatus === 'waiting_scan' && this.qrDataUrl) {
      this._addLog('info', 'QR', 'Existing QR session is active, serving current QR code');
      return {
        success: true,
        qrUrl: this.qrUrl,
        qrDataUrl: this.qrDataUrl,
        expires: this.qrExpires
      };
    }

    this.cancelQrCodeAuth();
    this.qrAuthActive = true;
    this.qrStatus = 'waiting_scan';
    this.qrError = null;

    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {}
    }

    this.session = new StringSession('');
    this.client = this._createTelegramClient(this.session, apiId, apiHash);

    this._addLog('info', 'QR', 'Connecting new client for QR login...');
    await this.client.connect();

    // Raw update handler for UpdateLoginToken event (fires when mobile device scans the code)
    this._qrTcsResolve = null;
    this._qrUpdateHandler = async (update) => {
      try {
        if (!this.qrAuthActive || this.qrStatus !== 'waiting_scan') return;
        const isUpdateLoginToken = update && (
          update.className === 'UpdateLoginToken' || 
          update._ === 'updateLoginToken' || 
          (update.constructor && update.constructor.name === 'UpdateLoginToken') ||
          (update.className && String(update.className).toLowerCase().includes('logintoken'))
        );

        if (isUpdateLoginToken) {
          this._addLog('info', 'QR', 'Received UpdateLoginToken event from Telegram! Waking up QR loop...');
          if (typeof this._qrTcsResolve === 'function') {
            const resolveFn = this._qrTcsResolve;
            this._qrTcsResolve = null;
            resolveFn('update');
          }
        }
      } catch (evErr) {
        this._addLog('warn', 'QR', `Update event notice: ${evErr.message}`);
      }
    };

    if (typeof this.client.addEventHandler === 'function') {
      this.client.addEventHandler(this._qrUpdateHandler);
    }

    // Initial ExportLoginToken call
    this._addLog('info', 'QR', 'Invoking ExportLoginToken...');
    const initialRes = await this.client.invoke(new Api.auth.ExportLoginToken({
      apiId,
      apiHash,
      exceptIds: [],
    }));

    const result = await this._handleLoginTokenResult(initialRes, apiId, apiHash);

    // If initial token was already authenticated, return immediately
    if (result && result.me) {
      return result;
    }

    // Start background QR active wait-and-refresh loop following WTelegramClient's Task.WhenAny pattern
    this._runQrCodeAuthLoop(apiId, apiHash).catch((err) => {
      this._addLog('error', 'QR', `Loop error: ${err.message}`);
    });

    return {
      success: true,
      qrUrl: this.qrUrl,
      qrDataUrl: this.qrDataUrl,
      expires: this.qrExpires
    };
  }

  async _runQrCodeAuthLoop(apiId, apiHash) {
    this._addLog('info', 'QR', 'Starting active QR wait loop (polling every 2.5s or push trigger)...');
    while (this.qrAuthActive && this.qrStatus === 'waiting_scan') {
      // Sleep until EITHER the mobile device scanned (UpdateLoginToken) OR 2.5s active polling tick
      await new Promise((resolve) => {
        this._qrTcsResolve = resolve;
        const timer = setTimeout(() => {
          if (this._qrTcsResolve === resolve) {
            this._qrTcsResolve = null;
            resolve('poll_tick');
          }
        }, 2500);

        this._qrCancelTimer = () => {
          clearTimeout(timer);
          if (this._qrTcsResolve === resolve) {
            this._qrTcsResolve = null;
            resolve('cancelled');
          }
        };
      });

      if (!this.qrAuthActive || this.qrStatus !== 'waiting_scan' || !this.client) break;

      try {
        const nextRes = await this.client.invoke(new Api.auth.ExportLoginToken({
          apiId,
          apiHash,
          exceptIds: [],
        }));

        const handleRes = await this._handleLoginTokenResult(nextRes, apiId, apiHash);
        if (handleRes && handleRes.me) {
          this._addLog('info', 'QR', `Successfully completed authentication from loop for @${handleRes.me.username || handleRes.me.id}!`);
          break;
        }
      } catch (err) {
        const errMsg = err.message || String(err);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
          this.qrStatus = 'password_required';
          this._addLog('info', 'QR', '2FA cloud password required.');
          break;
        } else if (errMsg.includes('FLOOD_WAIT')) {
          const sec = Number(errMsg.match(/FLOOD_WAIT_(\d+)/)?.[1] || 0);
          if (sec > 0 && sec <= 5) {
            await new Promise(r => setTimeout(r, sec * 1000));
            continue;
          }
          this.qrStatus = 'error';
          this.qrError = errMsg;
          this._addLog('error', 'QR', `Flood wait error: ${errMsg}`);
          break;
        } else {
          this._addLog('warn', 'QR', `Polling check notice: ${errMsg}`);
        }
      }
    }
  }

  async _completeAuthSuccess(auth) {
    try {
      this._addLog('info', 'Auth', 'Завершение процедуры авторизации в Telegram MTProto...');
      const user = auth?.user || auth?.authorization?.user || auth?.authorization || (auth instanceof Api.User ? auth : null);

      // Perform DC check on current user with resilience
      let me = user;
      try {
        me = await this._invokeWithMigration(async () => {
          return await this.client.getMe();
        });
      } catch (e) {
        this._addLog('warn', 'Auth', `Уведомление getMe: ${e.message}. Используем данные из авторизации.`);
        me = user || null;
      }

      const sessionStr = this.client && this.client.session ? this.client.session.save() : '';
      if (sessionStr) {
        this.settings.sessionString = sessionStr;
      }

      const activeUser = me || user;
      this.me = {
        id: (activeUser && activeUser.id) ? activeUser.id.toString() : (this.me?.id || 'telegram_user'),
        firstName: (activeUser && activeUser.firstName) || this.me?.firstName || 'Пользователь',
        lastName: (activeUser && activeUser.lastName) || this.me?.lastName || '',
        username: (activeUser && activeUser.username) || this.me?.username || '',
        phone: (activeUser && activeUser.phone) || this.phoneNumber || this.settings.phoneNumber || '',
      };

      this.status = 'connected';
      this.qrStatus = 'authenticated';
      this.qrAuthActive = false;

      await this.saveSettings({
        sessionString: this.settings.sessionString,
        phoneNumber: this.me.phone || this.phoneNumber,
        apiId: this.settings.apiId,
        apiHash: this.settings.apiHash,
      });

      this._addLog('info', 'Auth', `Авторизация успешна! Вход выполнен: @${this.me.username || this.me.id} (${this.me.firstName}), сессия сохранена.`);
      return { success: true, me: this.me };
    } catch (e) {
      this._addLog('error', 'Auth', `Ошибка _completeAuthSuccess: ${e.message}`);
      
      const fallbackUser = auth?.user || auth?.authorization?.user || auth?.authorization || (auth instanceof Api.User ? auth : null);
      if (!this.me && fallbackUser) {
        this.me = {
          id: fallbackUser.id ? fallbackUser.id.toString() : 'telegram_user',
          firstName: fallbackUser.firstName || 'Пользователь',
          lastName: fallbackUser.lastName || '',
          username: fallbackUser.username || '',
          phone: fallbackUser.phone || this.phoneNumber || this.settings.phoneNumber || '',
        };
      }
      
      if (this.client && this.client.session) {
        try {
          const s = this.client.session.save();
          if (s) {
            this.settings.sessionString = s;
            await this.saveSettings({ sessionString: s });
          }
        } catch (saveErr) {}
      }

      this.status = 'connected';
      this.qrStatus = 'authenticated';
      this.qrAuthActive = false;
      return { success: true, me: this.me };
    }
  }

  async submit2FAPassword(password) {
    if (!this.client) {
      throw new Error('Сессия Telegram не активна');
    }
    const cleanPassword = String(password || '').trim();
    if (!cleanPassword) {
      throw new Error('Введите пароль 2FA');
    }

    this._addLog('info', 'Auth', 'Submitting 2FA Cloud Password...');
    try {
      const passwordSrpResult = await this._invokeWithMigration(async () => {
        return await this.client.invoke(new Api.account.GetPassword());
      });
      const passwordSrpCheck = await computeCheck(passwordSrpResult, cleanPassword);
      const checkRes = await this._invokeWithMigration(async () => {
        return await this.client.invoke(new Api.auth.CheckPassword({
          password: passwordSrpCheck,
        }));
      });

      this._addLog('info', 'Auth', '2FA Password check succeeded!');
      return await this._completeAuthSuccess(checkRes.user || checkRes);
    } catch (e) {
      const errMsg = e.message || String(e);
      this._addLog('error', 'Auth', `2FA verification failed: ${errMsg}`);
      if (errMsg.includes('PASSWORD_HASH_INVALID')) {
        throw new Error('Неверный пароль 2FA двухфакторной защиты Telegram.');
      }
      throw new Error(errMsg);
    }
  }

  async getQrAuthStatus() {
    // If already authenticated and connected, return success immediately
    if (this.status === 'connected' && this.me && this.me.id) {
      return {
        active: false,
        status: 'authenticated',
        qrUrl: this.qrUrl,
        qrDataUrl: this.qrDataUrl,
        expires: this.qrExpires,
        error: null,
        me: this.me
      };
    }

    return {
      active: this.qrAuthActive,
      status: this.qrStatus,
      qrUrl: this.qrUrl,
      qrDataUrl: this.qrDataUrl,
      expires: this.qrExpires,
      error: this.qrError,
      me: this.me
    };
  }

  cancelQrCodeAuth() {
    this.qrAuthActive = false;
    this.qrStatus = 'idle';
    this.qrUrl = '';
    this.qrDataUrl = '';
    if (typeof this._qrCancelTimer === 'function') {
      try { this._qrCancelTimer(); } catch (e) {}
      this._qrCancelTimer = null;
    }
    if (typeof this._qrTcsResolve === 'function') {
      try { this._qrTcsResolve('cancelled'); } catch (e) {}
      this._qrTcsResolve = null;
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
    await this.saveSettings({ sessionString: '' });
    return { success: true };
  }

  async _resolvePeer(targetPeer) {
    if (!targetPeer) throw new Error('Укажите чат или канал (@channel или ID)');
    let peer = String(targetPeer).trim();
    if (peer.startsWith('https://t.me/')) peer = peer.replace('https://t.me/', '@');
    if (peer.startsWith('t.me/')) peer = peer.replace('t.me/', '@');

    // If it's a numeric ID (e.g. -1001234567890 or 123456789)
    if (/^-?\d+$/.test(peer)) {
      try {
        const bigId = BigInt(peer);
        try {
          return await this._invokeWithMigration(async () => {
            return await this.client.getInputEntity(bigId);
          });
        } catch {
          return bigId;
        }
      } catch (e) {
        return peer;
      }
    }

    try {
      return await this._invokeWithMigration(async () => {
        return await this.client.getInputEntity(peer);
      });
    } catch (e) {
      this._addLog('warn', 'Peer', `_resolvePeer fallback notice for "${peer}": ${e.message}`);
      return peer;
    }
  }

  async getDialogs(limit = 50) {
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
      return (dialogs || []).map(d => ({
        id: d.id ? d.id.toString() : '',
        title: d.title || d.name || 'Без названия',
        username: d.entity && d.entity.username ? d.entity.username : '',
        isChannel: d.isChannel || false,
        isGroup: d.isGroup || false,
        isUser: d.isUser || false,
        unreadCount: d.unreadCount || 0,
        type: d.isChannel ? 'channel' : d.isGroup ? 'group' : d.isUser ? 'user' : 'chat',
      }));
    } catch (e) {
      await this._handleApiError(e, 'getDialogs');
      return [];
    }
  }

  async testBotConnection(customToken) {
    const token = customToken ? String(customToken).trim() : String(this.settings.botToken || '').trim();
    if (!token) {
      throw new Error('Укажите токен бота Telegram (полученный у @BotFather)');
    }

    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await resp.json();
      if (!data.ok) {
        throw new Error(data.description || 'Не удалось авторизовать бота. Проверьте правильность токена.');
      }
      this.botMe = data.result;
      log.info('[Telegram Bot] Bot verified successfully:', data.result.username);
      return {
        success: true,
        bot: {
          id: data.result.id,
          username: data.result.username,
          firstName: data.result.first_name,
        }
      };
    } catch (err) {
      log.error('[Telegram Bot] testBotConnection error:', err);
      throw new Error(err.message || 'Ошибка подключения к Telegram Bot API');
    }
  }

  async sendViaBotApi({ targetPeer, text, parseMode = 'html', silent = false, pin = false, mediaPath }) {
    const token = String(this.settings.botToken || '').trim();
    if (!token) {
      throw new Error('Бот-токен не настроен в настройках Telegram.');
    }

    let chatId = targetPeer || this.settings.defaultChannelId;
    if (!chatId) throw new Error('Укажите ID или логин канала/чата (@channel)');

    chatId = String(chatId).trim();
    if (chatId.startsWith('https://t.me/')) chatId = chatId.replace('https://t.me/', '@');
    if (chatId.startsWith('t.me/')) chatId = chatId.replace('t.me/', '@');

    const cleanText = text || '';
    const body = {
      chat_id: chatId,
      text: cleanText,
      parse_mode: parseMode === 'html' ? 'HTML' : 'Markdown',
      disable_notification: !!silent,
    };

    let endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!data.ok) {
      // If formatting failed, retry with plain text
      if (data.description && (data.description.includes('can\'t parse entities') || data.description.includes('formatting'))) {
        log.warn('[Telegram Bot] HTML parse failed, retrying plain text...');
        delete body.parse_mode;
        body.text = cleanText.replace(/<[^>]*>/g, '');
        const retryResp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const retryData = await retryResp.json();
        if (!retryData.ok) {
          throw new Error(retryData.description || 'Ошибка отправки через Telegram Bot API');
        }
        if (pin && retryData.result?.message_id) {
          await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: retryData.result.message_id, disable_notification: !!silent }),
          }).catch(() => {});
        }
        return { success: true, messageId: retryData.result?.message_id, viaBot: true };
      }
      throw new Error(data.description || 'Ошибка отправки через Telegram Bot API');
    }

    if (pin && data.result?.message_id) {
      await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: data.result.message_id, disable_notification: !!silent }),
      }).catch(() => {});
    }

    return {
      success: true,
      messageId: data.result?.message_id,
      viaBot: true,
    };
  }

  async sendPost({ targetPeer, text, parseMode = 'html', silent = false, pin = false, scheduleDate, mediaPath }) {
    // Check if MTProto is connected or can auto-reconnect
    let mtprotoReady = (this.client && this.status === 'connected');
    if (!mtprotoReady && this.settings.sessionString) {
      try {
        mtprotoReady = await this.connectWithSavedSession();
      } catch (e) {
        log.warn('[MTProto] On-demand session reconnect notice:', e.message);
      }
    }

    // If MTProto is not connected, but Bot Token is provided, fallback to Bot API
    if (!mtprotoReady && this.settings.botToken) {
      log.info('[Telegram] MTProto not active, using Bot API for sendPost...');
      return await this.sendViaBotApi({ targetPeer, text, parseMode, silent, pin, mediaPath });
    }

    await this.ensureConnected();

    try {
      const rawPeer = targetPeer || this.settings.defaultChannelId;
      if (!rawPeer) throw new Error('Укажите ID или логин канала (@channel)');
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

      let sentMsg = await this._invokeWithMigration(async () => {
        try {
          if (mediaPath && fs.existsSync(mediaPath)) {
            sendOptions.file = mediaPath;
            sendOptions.caption = text;
            return await this.client.sendFile(peer, sendOptions);
          } else {
            sendOptions.message = text;
            return await this.client.sendMessage(peer, sendOptions);
          }
        } catch (firstErr) {
          const errStr = String(firstErr.message || firstErr);
          // If failed due to unclosed HTML tag or parse error, fallback to plain text gracefully
          if (sendOptions.parseMode && (errStr.includes('TAG_') || errStr.includes('PARSE') || errStr.includes('ENTITY_BOUNDS'))) {
            log.warn('[MTProto] HTML/MD formatting error, falling back to plain text send:', errStr);
            delete sendOptions.parseMode;
            if (mediaPath && fs.existsSync(mediaPath)) {
              sendOptions.caption = text.replace(/<[^>]*>/g, '');
              return await this.client.sendFile(peer, sendOptions);
            } else {
              sendOptions.message = text.replace(/<[^>]*>/g, '');
              return await this.client.sendMessage(peer, sendOptions);
            }
          } else {
            throw firstErr;
          }
        }
      });

      if (pin && sentMsg && sentMsg.id) {
        try {
          await this._invokeWithMigration(async () => {
            return await this.client.pinMessage(peer, sentMsg.id, { notify: !silent });
          });
        } catch (pinErr) {
          log.warn('[MTProto] Could not pin message:', pinErr.message);
        }
      }

      return {
        success: true,
        messageId: sentMsg ? sentMsg.id : null,
      };
    } catch (e) {
      await this._handleApiError(e, 'sendPost');
    }
  }

  async sendAutomationNotification({ type, targetPeer, payload, pin = false, silent = false, customText = null, scheduleDate = null }) {
    let formattedText = customText;

    if (!formattedText) {
      let template = payload?.customTemplate || '';
      if (!template) {
        if (type === 'start') {
          template = this.settings.startNoticeTemplate;
        } else if (type === 'reminder') {
          template = this.settings.reminderTemplate;
        } else if (type === 'fix') {
          template = this.settings.fixNoticeTemplate;
        } else if (type === 'track') {
          template = this.settings.trackReceivedTemplate;
        }
      }

      if (!template) {
        throw new Error(`Неизвестный тип автоматизации или шаблон: ${type}`);
      }

      formattedText = template;
      if (payload && typeof payload === 'object') {
        Object.keys(payload).forEach(key => {
          const val = payload[key] || '';
          formattedText = formattedText.replaceAll(`{${key}}`, val);
        });
      }
    }

    return await this.sendPost({
      targetPeer: targetPeer || this.settings.defaultChannelId,
      text: formattedText,
      parseMode: 'html',
      silent,
      pin,
      scheduleDate
    });
  }

  async fetchPublicChannelPosts(channelUsername, query = '', limit = 30, directPostId = null) {
    const cleanUsername = String(channelUsername).replace(/^@/, '').trim();
    if (!cleanUsername) {
      return { success: false, posts: [], error: 'Укажите логин канала (@channel)' };
    }

    this._addLog('info', 'Public Preview', `Запрос веб-предпросмотра t.me/s/${cleanUsername} (query: "${query || ''}")...`);

    return new Promise((resolve) => {
      const url = `https://t.me/s/${encodeURIComponent(cleanUsername)}`;
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 3500 // Быстрый тайм-аут 3.5 сек чтобы приложение не зависало
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectTarget = res.headers.location.split('/').filter(Boolean).pop();
          this._addLog('info', 'Public Preview', `Редирект на @${redirectTarget}`);
          return resolve(this.fetchPublicChannelPosts(redirectTarget, query, limit, directPostId));
        }

        if (res.statusCode === 404) {
          this._addLog('warn', 'Public Preview', `Канал @${cleanUsername} не найден или является приватным (404)`);
          return resolve({
            success: false,
            posts: [],
            error: `Канал @${cleanUsername} не найден или является приватным.`
          });
        }

        if (res.statusCode !== 200) {
          this._addLog('warn', 'Public Preview', `Ответ HTTP ${res.statusCode} при запросе @${cleanUsername}`);
          return resolve({
            success: false,
            posts: [],
            error: `Не удалось загрузить веб-предпросмотр канала @${cleanUsername} (HTTP ${res.statusCode})`
          });
        }

        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const messageBlocks = data.split('class="tgme_widget_message_wrap');
            const posts = [];
            const cleanQuery = String(query || '').toLowerCase().trim();

            for (const block of messageBlocks.slice(1)) {
              const postMatch = block.match(/data-post="([^"]+)"/);
              if (!postMatch) continue;
              const fullPostId = postMatch[1];
              const parts = fullPostId.split('/');
              const numId = Number(parts[1]) || fullPostId;

              if (directPostId && numId !== directPostId) {
                continue;
              }

              const textMatch = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
              let rawText = textMatch ? textMatch[1] : '';
              let cleanText = rawText
                .replace(/<br\s*[\/]?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ')
                .trim();

              const dateMatch = block.match(/<time\s+datetime="([^"]+)"/);
              const isoDate = dateMatch ? dateMatch[1] : null;
              const dateObj = isoDate ? new Date(isoDate) : new Date();

              const viewsMatch = block.match(/class="tgme_widget_message_views">([^<]+)<\/span>/);
              const viewsStr = viewsMatch ? viewsMatch[1].trim() : '0';

              const hasMedia = block.includes('tgme_widget_message_photo') || 
                               block.includes('tgme_widget_message_video') ||
                               block.includes('tgme_widget_message_document');

              const isPinned = block.includes('tgme_widget_message_pinned');

              if (cleanQuery && !cleanText.toLowerCase().includes(cleanQuery)) {
                continue;
              }

              posts.push({
                id: numId,
                date: Math.floor(dateObj.getTime() / 1000),
                dateFormatted: dateObj.toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                }),
                text: cleanText,
                message: cleanText,
                views: viewsStr,
                forwards: 0,
                link: `https://t.me/${fullPostId}`,
                postLink: `https://t.me/${fullPostId}`,
                hasMedia,
                isPinned
              });
            }

            // Return latest posts first
            posts.reverse();
            this._addLog('info', 'Public Preview', `Успешно спарсено ${posts.length} постов из веб-предпросмотра @${cleanUsername}`);
            resolve({
              success: true,
              isPublicPreview: true,
              posts: posts.slice(0, limit)
            });
          } catch (parseErr) {
            this._addLog('error', 'Public Preview', `Ошибка парсинга HTML: ${parseErr.message}`);
            resolve({
              success: false,
              posts: [],
              error: `Ошибка парсинга страницы канала: ${parseErr.message}`
            });
          }
        });
      });

      req.on('error', err => {
        this._addLog('warn', 'Public Preview', `Сетевая ошибка при запросе t.me: ${err.message}`);
        resolve({
          success: false,
          posts: [],
          error: `Сетевая ошибка предпросмотра Telegram: ${err.message}`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        this._addLog('warn', 'Public Preview', `Тайм-аут веб-предпросмотра t.me/s/${cleanUsername} (3.5с)`);
        resolve({
          success: false,
          posts: [],
          error: `Превышено время ожидания ответа Telegram (t.me) при проверке @${cleanUsername}. Сеть или провайдер блокируют веб-предпросмотр. Авторизуйтесь в MTProto для стабильной работы.`
        });
      });
    });
  }

  async searchChannelPosts({ channelPeer, channelId, query = '', limit = 20 }) {
    let peer = channelPeer || channelId || this.settings.defaultChannelId;
    if (!peer) throw new Error('Укажите ID или логин канала (@channel)');
    peer = String(peer).trim();
    if (peer.startsWith('https://t.me/')) peer = peer.replace('https://t.me/', '@');
    if (peer.startsWith('t.me/')) peer = peer.replace('t.me/', '@');

    // Detect if a direct post link/ID was passed, e.g. @channel/123 or channel/123
    let directPostId = null;
    if (peer.includes('/')) {
      const parts = peer.split('/');
      peer = parts[0];
      if (parts[1] && /^\d+$/.test(parts[1])) {
        directPostId = parseInt(parts[1], 10);
      }
    }

    const cleanUsername = peer.startsWith('@') ? peer.slice(1) : peer;
    const isPublicPeer = typeof peer === 'string' && (peer.startsWith('@') || /^[a-zA-Z0-9_]{3,}$/.test(peer));

    this._addLog('info', 'Search', `searchChannelPosts: peer="${peer}", query="${query}", directPostId=${directPostId || 'none'}`);

    // Check MTProto connection & auto-reconnect if needed
    let mtprotoReady = (this.client && this.status === 'connected' && this.me && this.me.id);
    if (!mtprotoReady && this.settings.sessionString) {
      try {
        this._addLog('info', 'Search', 'MTProto клиент не подключен, пробуем авто-подключение по сохраненной сессии...');
        const reconnected = await this.connectWithSavedSession();
        mtprotoReady = (reconnected && this.status === 'connected');
      } catch (connErr) {
        this._addLog('warn', 'Search', `Попытка авто-подключения завершилась: ${connErr.message}`);
      }
    }

    if (mtprotoReady) {
      try {
        this._addLog('info', 'Search', `Разрешение пира "${peer}" через MTProto...`);
        const resolvedPeer = await this._resolvePeer(peer);

        this._addLog('info', 'Search', `Запрос сообщений через Telegram MTProto (limit: ${limit})...`);
        const messages = await this._invokeWithMigration(async () => {
          if (directPostId) {
            const singleMsg = await this.client.getMessages(resolvedPeer, { ids: [directPostId] });
            return singleMsg ? (Array.isArray(singleMsg) ? singleMsg : [singleMsg]) : [];
          } else {
            return await this.client.getMessages(resolvedPeer, {
              limit: Math.min(limit, 50),
              search: query ? String(query).trim() : undefined,
            });
          }
        });

        const posts = (messages || []).filter(Boolean).map(m => {
          let channelUsername = '';
          if (typeof peer === 'string' && peer.startsWith('@')) {
            channelUsername = peer.slice(1);
          }
          const postLink = channelUsername 
            ? `https://t.me/${channelUsername}/${m.id}`
            : `https://t.me/c/${String(peer).replace(/^-100/, '')}/${m.id}`;

          const dateObj = m.date ? new Date(m.date * 1000) : new Date();

          return {
            id: m.id,
            date: m.date ? m.date : Math.floor(dateObj.getTime() / 1000),
            dateFormatted: dateObj.toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
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

        this._addLog('info', 'Search', `Успешно получено ${posts.length} постов через Telegram MTProto!`);
        return {
          success: true,
          posts,
        };
      } catch (mtErr) {
        this._addLog('warn', 'Search', `MTProto запрос постов для "${peer}" вызвал ошибку: ${mtErr.message}`);
        // Fall through to public preview fallback if public peer
      }
    }

    // Fallback: If public peer, try public channel web preview
    if (isPublicPeer) {
      this._addLog('info', 'Search', `MTProto не готов или вернул ошибку. Запуск веб-предпросмотра для @${cleanUsername}...`);
      const publicResult = await this.fetchPublicChannelPosts(cleanUsername, query, limit, directPostId);
      if (publicResult && publicResult.success && Array.isArray(publicResult.posts) && publicResult.posts.length > 0) {
        return publicResult;
      }

      // Check if Bot API can verify channel
      if (this.settings.botToken) {
        try {
          this._addLog('info', 'Search', `Попытка проверки канала @${cleanUsername} через Bot API...`);
          const botResp = await fetch(`https://api.telegram.org/bot${this.settings.botToken}/getChat?chat_id=@${encodeURIComponent(cleanUsername)}`);
          const botData = await botResp.json();
          if (botData && botData.ok) {
            this._addLog('info', 'Search', `Канал @${cleanUsername} найден через Bot API: "${botData.result?.title}"`);
          }
        } catch (botErr) {
          this._addLog('warn', 'Search', `Bot API check error: ${botErr.message}`);
        }
      }

      // Return informative result without throwing unhandled exceptions
      return {
        success: false,
        posts: publicResult?.posts || [],
        error: publicResult?.error || `Не удалось загрузить публикации @${cleanUsername}. Для доступа к закрытым и публичным каналам выполните авторизацию в Telegram MTProto.`
      };
    }

    return {
      success: false,
      posts: [],
      error: 'Для данного канала требуется активная авторизация в Telegram MTProto.'
    };
  }

  async getChatAudioFiles({ chatPeer, chatId, limit = 40 }) {
    await this.ensureConnected();
    try {
      const rawPeer = chatPeer || chatId;
      if (!rawPeer) throw new Error('Укажите чат или пользователя');
      const peer = await this._resolvePeer(rawPeer);

      const messages = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { limit: Math.min(limit, 100) });
      });
      const audioFiles = [];

      for (const m of (messages || [])) {
        if (!m || !m.media) continue;

        let isAudio = false;
        let fileName = '';
        let fileSize = 0;
        let duration = 0;
        let mimeType = '';

        if (m.media.document) {
          const doc = m.media.document;
          fileSize = Number(doc.size || 0);
          mimeType = doc.mimeType || '';

          if (mimeType.startsWith('audio/') || mimeType.includes('ogg') || mimeType.includes('wav')) {
            isAudio = true;
          }

          if (doc.attributes) {
            for (const attr of doc.attributes) {
              if (attr.fileName) fileName = attr.fileName;
              if (attr.duration) duration = attr.duration;
              if (attr.className === 'DocumentAttributeAudio') isAudio = true;
            }
          }

          if (!isAudio && fileName) {
            const ext = path.extname(fileName).toLowerCase();
            if (['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.zip', '.rar'].includes(ext)) {
              isAudio = true;
            }
          }
        }

        if (isAudio) {
          let senderName = 'Участник';
          let senderId = '';
          let senderUsername = '';
          if (m.sender) {
            senderId = m.sender.id ? m.sender.id.toString() : '';
            senderUsername = m.sender.username || '';
            senderName = [m.sender.firstName, m.sender.lastName].filter(Boolean).join(' ') || m.sender.username || senderId;
          }

          const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
          const durMin = duration ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : '';
          const dateObj = m.date ? new Date(m.date * 1000) : new Date();

          audioFiles.push({
            id: m.id,
            messageId: m.id,
            date: m.date || Math.floor(dateObj.getTime() / 1000),
            dateFormatted: dateObj.toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }),
            sender: {
              id: senderId,
              name: senderName,
              username: senderUsername
            },
            senderId,
            senderName,
            fileName: fileName || `audio_${m.id}.mp3`,
            fileSize,
            size: fileSize,
            sizeFormatted: fileSize > 0 ? `${sizeMB} MB` : '0 MB',
            duration,
            durationFormatted: durMin,
            mimeType,
            isVoice: mimeType.includes('ogg') || mimeType.includes('voice'),
            caption: m.message || '',
            text: m.message || ''
          });
        }
      }

      return {
        success: true,
        files: audioFiles,
      };
    } catch (e) {
      await this._handleApiError(e, 'getChatAudioFiles');
    }
  }

  async getChatMessages({ chatPeer, chatId, limit = 40 }) {
    await this.ensureConnected();
    try {
      const rawPeer = chatPeer || chatId;
      if (!rawPeer) throw new Error('Укажите чат');
      const peer = await this._resolvePeer(rawPeer);

      const messages = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { limit: Math.min(limit, 100) });
      });
      const myId = this.me?.id;

      const formatted = (messages || []).map(m => {
        let senderName = 'Участник';
        let isMe = false;
        if (m.sender) {
          const sId = m.sender.id ? m.sender.id.toString() : '';
          isMe = !!(myId && sId === String(myId));
          senderName = isMe ? 'Вы' : ([m.sender.firstName, m.sender.lastName].filter(Boolean).join(' ') || m.sender.username || sId);
        } else if (m.out) {
          isMe = true;
          senderName = 'Вы';
        }

        const dateObj = m.date ? new Date(m.date * 1000) : new Date();
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return {
          id: String(m.id),
          senderName,
          text: m.message || (m.media ? '[Медиафайл]' : ''),
          time: timeStr,
          isMe,
          isPinned: !!m.pinned,
          mediaPath: undefined
        };
      }).reverse();

      return {
        success: true,
        messages: formatted,
      };
    } catch (e) {
      await this._handleApiError(e, 'getChatMessages');
    }
  }

  async downloadChatAudioFile({ chatPeer, chatId, messageId, id, targetDir, customFileName, fileName }) {
    await this.ensureConnected();
    try {
      const rawPeer = chatPeer || chatId;
      if (!rawPeer) throw new Error('Укажите чат');
      const peer = await this._resolvePeer(rawPeer);

      const targetMsgId = Number(messageId || id);
      if (!targetMsgId) throw new Error('Укажите ID сообщения');

      const [msg] = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { ids: [targetMsgId] });
      });
      if (!msg || !msg.media) {
        throw new Error('Файл или сообщение не найдены');
      }

      let saveDir = targetDir;
      if (!saveDir || !fs.existsSync(saveDir)) {
        saveDir = path.join(this.userDataPath, 'downloads', 'telegram_tracks');
        fs.mkdirSync(saveDir, { recursive: true });
      }

      let originalName = customFileName || fileName;
      if (!originalName) {
        if (msg.media.document && msg.media.document.attributes) {
          for (const attr of msg.media.document.attributes) {
            if (attr.fileName) originalName = attr.fileName;
          }
        }
      }
      if (!originalName) {
        originalName = `telegram_track_${targetMsgId}.mp3`;
      }

      const finalPath = path.join(saveDir, originalName);
      log.info(`[MTProto] Downloading audio message #${targetMsgId} to ${finalPath}`);

      const buffer = await this._invokeWithMigration(async () => {
        return await this.client.downloadMedia(msg, {
          workers: 1,
        });
      });

      if (!buffer) {
        throw new Error('Не удалось скачать файл из Telegram');
      }

      fs.writeFileSync(finalPath, buffer);
      log.info(`[MTProto] Successfully saved file: ${finalPath} (${buffer.length} bytes)`);

      return {
        success: true,
        filePath: finalPath,
        fileName: originalName,
        fileSize: buffer.length,
      };
    } catch (e) {
      await this._handleApiError(e, 'downloadChatAudioFile');
    }
  }

  async _handleApiError(e, contextStr) {
    const log = require('electron-log');
    log.error(`[MTProto] ${contextStr} error:`, e);
    const errMsg = e.message || String(e);
    if (
      errMsg.includes('AUTH_KEY_UNREGISTERED') ||
      errMsg.includes('AUTH_KEY_INVALID') ||
      errMsg.includes('SESSION_REVOKED') ||
      errMsg.includes('SESSION_EXPIRED')
    ) {
      this.status = 'disconnected';
      this.me = null;
      this.session = null;
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (err) {}
        this.client = null;
      }
      this.settings.sessionString = '';
      await this.saveSettings({ sessionString: '' });
      throw new Error('AUTH_KEY_UNREGISTERED: Сессия Telegram устарела или завершена. Пожалуйста, выполните повторный вход.');
    }
    throw new Error(errMsg);
  }

  async ensureConnected() {
    if (this.client && this.status === 'connected' && this.me && this.me.id) {
      if (this.client.connected === false) {
        try {
          await this.client.connect();
        } catch (reconnErr) {
          log.warn('[MTProto] Reconnect failed:', reconnErr);
        }
      }
      return true;
    }

    if (this.settings.sessionString) {
      log.info('[MTProto] Attempting auto-reconnect with saved session...');
      const reconnected = await this.connectWithSavedSession();
      if (reconnected && this.status === 'connected') {
        return true;
      }
    }

    throw new Error('Подключение к Telegram MTProto отсутствует. Пожалуйста, авторизуйтесь в Telegram (по QR-коду или номеру телефона).');
  }

  getStatus() {
    const isConnected = this.status === 'connected' && !!(this.me && this.me.id);
    return {
      status: isConnected ? 'connected' : 'disconnected',
      me: isConnected ? this.me : null,
      botConnected: !!this.botMe,
      botMe: this.botMe,
      settings: {
        apiId: this.settings.apiId,
        apiHash: this.settings.apiHash,
        phoneNumber: this.settings.phoneNumber,
        botToken: this.settings.botToken,
        defaultChannelId: this.settings.defaultChannelId,
        autoPin: this.settings.autoPin,
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
    try {
      if (this.client) {
        log.info('[MTProto] Disconnecting client on application shutdown...');
        await this.client.disconnect();
        this.client = null;
        this.status = 'disconnected';
      }
    } catch (err) {
      log.warn('[MTProto] Error disconnecting client:', err.message);
    }
  }
}

module.exports = TelegramMTProtoService;
