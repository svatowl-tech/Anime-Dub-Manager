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

    // QR Code Authentication state
    this.qrAuthActive = false;
    this.qrStatus = 'idle'; // 'idle' | 'waiting_scan' | 'password_required' | 'authenticated' | 'error'
    this.qrUrl = '';
    this.qrDataUrl = '';
    this.qrExpires = 0;
    this.qrError = null;
    this._qrAuthPromise = null;
    this._2faPasswordResolve = null;
    this._2faPasswordReject = null;

    // Live logs buffer for UI inspection
    this.logs = [];

    // Internal lock for reconnecting
    this._connectingPromise = null;

    this.settings = {
      enabled: false,
      apiId: DEFAULT_TELEGRAM_API_ID,
      apiHash: DEFAULT_TELEGRAM_API_HASH,
      phoneNumber: '',
      sessionString: '',
      botToken: '',
      defaultChannelId: '',
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
            checkMsg.includes('SESSION_REVOKED') ||
            checkMsg.includes('SESSION_EXPIRED')
          ) {
            this._addLog('error', 'Auth', 'Saved session is revoked on Telegram servers. Clearing session...');
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
              if (newSession) {
                this.settings.sessionString = newSession;
                await this.saveSettings({ sessionString: newSession });
                this._addLog('info', 'MTProto DC', `Migrated to DC ${targetDc} and updated sessionString.`);
              }
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
    this._addLog('info', 'Phone Auth', `sendCode requested: phone=${phoneNumber}, forceSMS=${forceSMS}`);
    try {
      const cleanPhone = normalizePhoneNumber(phoneNumber);
      if (!cleanPhone || cleanPhone.length < 7) {
        throw new Error('Укажите корректный номер телефона (напр. +79991234567)');
      }

      const apiId = Number(customApiId || this.settings.apiId || DEFAULT_TELEGRAM_API_ID);
      const apiHash = String(customApiHash || this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim();

      this.settings.apiId = apiId;
      this.settings.apiHash = apiHash;
      this.phoneNumber = cleanPhone;

      if (!this.client || !this.client.connected) {
        if (this.client) {
          try { await this.client.disconnect(); } catch (e) {}
        }

        this.session = new StringSession('');
        this.client = this._createTelegramClient(this.session, apiId, apiHash);
        await this.client.connect();
      }

      this._addLog('info', 'Phone Auth', 'Connected to MTProto. Sending code request...');
      
      const res = await this._invokeWithMigration(async () => {
        return await this.client.sendCode({ apiId, apiHash }, cleanPhone, forceSMS);
      });

      this.phoneCodeHash = res.phoneCodeHash;
      this.isCodeViaApp = !!res.isCodeViaApp;
      this.status = 'code_sent';

      await this.saveSettings({ phoneNumber: cleanPhone, apiId, apiHash });
      this._addLog('info', 'Phone Auth', `sendCode success: isCodeViaApp=${res.isCodeViaApp}`);

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
      this._addLog('error', 'Phone Auth', `sendCode failed: ${e.message}`);
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
    if (!this.client || !this.phoneNumber || !this.phoneCodeHash) {
      throw new Error('Сначала запросите отправку кода через sendCode');
    }
    try {
      this._addLog('info', 'Phone Auth', `Resending code via ${forceSMS ? 'SMS' : 'App'}...`);
      const apiId = Number(this.settings.apiId || DEFAULT_TELEGRAM_API_ID);
      const apiHash = String(this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim();

      const res = await this._invokeWithMigration(async () => {
        return await this.client.sendCode({ apiId, apiHash }, this.phoneNumber, forceSMS);
      });

      if (res && res.phoneCodeHash) {
        this.phoneCodeHash = res.phoneCodeHash;
      }
      this._addLog('info', 'Phone Auth', 'Код успешно повторно отправлен');
      return { 
        success: true, 
        isCodeViaApp: !!res?.isCodeViaApp,
        message: forceSMS ? 'Код отправлен повторно по SMS' : 'Код отправлен повторно в приложение Telegram'
      };
    } catch (e) {
      this._addLog('error', 'Phone Auth', `resendCode failed: ${e.message}`);
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
    this._addLog('info', 'Phone Auth', `signIn requested (hasPassword: ${!!password})`);
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
        const signInResult = await this._invokeWithMigration(async () => {
          return await this.client.invoke(new Api.auth.SignIn({
            phoneNumber: this.phoneNumber,
            phoneCodeHash: this.phoneCodeHash,
            phoneCode: cleanCode,
          }));
        });
        user = signInResult.user || signInResult;
      } catch (err) {
        const errMsg = err.message || String(err);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
          this.status = 'password_required';
          if (!password) {
            return { requiresPassword: true };
          }
          const passwordSrpResult = await this._invokeWithMigration(async () => {
            return await this.client.invoke(new Api.account.GetPassword());
          });
          const passwordSrpCheck = await computeCheck(passwordSrpResult, password);
          const checkRes = await this._invokeWithMigration(async () => {
            return await this.client.invoke(new Api.auth.CheckPassword({
              password: passwordSrpCheck,
            }));
          });
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
      this._addLog('error', 'Phone Auth', `signIn error: ${e.message}`);
      throw new Error(e.message || String(e));
    }
  }

  /**
   * Start QR Code Authentication using GramJS's built-in signInUserWithQrCode
   * which natively handles DC migration, 2FA passwords, and event loops.
   */
  async startQrCodeAuth(customApiId, customApiHash) {
    const apiId = Number(customApiId || this.settings.apiId || DEFAULT_TELEGRAM_API_ID);
    const apiHash = String(customApiHash || this.settings.apiHash || DEFAULT_TELEGRAM_API_HASH).trim();

    this._addLog('info', 'QR', `startQrCodeAuth requested (apiId: ${apiId})...`);

    this.settings.apiId = apiId;
    this.settings.apiHash = apiHash;
    await this.saveSettings({ apiId, apiHash });

    // Cancel any previous in-flight QR flow
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

    this._addLog('info', 'QR', 'Connecting client transport to Telegram DC...');
    await this.client.connect();

    // Create a promise to wait for the first QR code token generation
    let firstQrResolve;
    const firstQrPromise = new Promise((resolve) => {
      firstQrResolve = resolve;
    });

    // Start GramJS's official signInUserWithQrCode in the background
    this._qrAuthPromise = (async () => {
      try {
        const user = await this.client.signInUserWithQrCode(
          { apiId, apiHash },
          {
            qrCode: async ({ token, expires }) => {
              if (!this.qrAuthActive) return;
              const base64UrlToken = Buffer.from(token).toString('base64url');
              this.qrUrl = `tg://login?token=${base64UrlToken}`;
              this.qrExpires = expires;
              this.qrDataUrl = await QRCode.toDataURL(this.qrUrl, {
                width: 280,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
              });
              this.qrStatus = 'waiting_scan';
              const timeLeft = Math.max(0, expires - Math.floor(Date.now() / 1000));
              this._addLog('info', 'QR', `QR-код активен (срок действия: ${timeLeft}с)`);

              if (firstQrResolve) {
                firstQrResolve({
                  success: true,
                  qrUrl: this.qrUrl,
                  qrDataUrl: this.qrDataUrl,
                  expires: this.qrExpires
                });
                firstQrResolve = null;
              }
            },
            password: async (hint) => {
              this._addLog('info', 'QR', `Требуется ввод 2FA пароля (подсказка: ${hint || 'нет'})`);
              this.qrStatus = 'password_required';
              return new Promise((resolve, reject) => {
                this._2faPasswordResolve = resolve;
                this._2faPasswordReject = reject;
              });
            },
            onError: async (err) => {
              if (!this.qrAuthActive) return;
              const errMsg = err?.message || String(err);
              this._addLog('error', 'QR', `Ошибка в процессе QR авторизации: ${errMsg}`);
              this.qrStatus = 'error';
              this.qrError = errMsg;
              if (firstQrResolve) {
                firstQrResolve({ success: false, error: errMsg });
                firstQrResolve = null;
              }
            }
          }
        );

        if (user) {
          this._addLog('info', 'QR', `Авторизация через QR завершена успешно! Получен пользователь: @${user.username || user.id}`);
          await this._completeAuthSuccess(user);
        }
      } catch (flowErr) {
        if (!this.qrAuthActive) return;
        const errMsg = flowErr?.message || String(flowErr);
        this._addLog('error', 'QR', `Сбой потока QR: ${errMsg}`);
        this.qrStatus = 'error';
        this.qrError = errMsg;
      }
    })();

    // Await first generated QR code or error (timeout after 10s)
    const result = await Promise.race([
      firstQrPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Превышено время ожидания генерации QR-кода')), 10000))
    ]);

    return result;
  }

  async _completeAuthSuccess(userObj) {
    try {
      this._addLog('info', 'Auth', 'Завершение процедуры авторизации в Telegram MTProto...');
      
      const user = userObj?.user || userObj?.authorization?.user || userObj?.authorization || userObj;

      // Extract user profile fields
      this.me = {
        id: (user && user.id) ? user.id.toString() : (this.me?.id || 'telegram_user'),
        firstName: (user && user.firstName) || this.me?.firstName || 'Пользователь',
        lastName: (user && user.lastName) || this.me?.lastName || '',
        username: (user && user.username) || this.me?.username || '',
        phone: (user && user.phone) || this.phoneNumber || this.settings.phoneNumber || '',
      };

      // Save persistent session string from connected client
      if (this.client && this.client.session) {
        const sessionStr = this.client.session.save();
        if (sessionStr) {
          this.settings.sessionString = sessionStr;
        }
      }

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
      this._addLog('error', 'Auth', `Ошибка в _completeAuthSuccess: ${e.message}`);
      this.status = 'connected';
      this.qrStatus = 'authenticated';
      this.qrAuthActive = false;
      return { success: true, me: this.me };
    }
  }

  async submit2FAPassword(password) {
    const cleanPassword = String(password || '').trim();
    if (!cleanPassword) {
      throw new Error('Введите пароль 2FA');
    }

    this._addLog('info', 'Auth', 'Submitting 2FA Cloud Password...');

    // If QR login flow is waiting for 2FA password
    if (typeof this._2faPasswordResolve === 'function') {
      const resolveFn = this._2faPasswordResolve;
      this._2faPasswordResolve = null;
      this._2faPasswordReject = null;
      resolveFn(cleanPassword);
      
      // Wait for the QR flow to finish
      if (this._qrAuthPromise) {
        await this._qrAuthPromise;
      }
      return { success: true, me: this.me };
    }

    // Otherwise standard phone login 2FA flow
    if (!this.client) {
      throw new Error('Сессия Telegram не активна');
    }

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
    if (typeof this._2faPasswordReject === 'function') {
      try { this._2faPasswordReject(new Error('QR auth cancelled')); } catch (e) {}
      this._2faPasswordResolve = null;
      this._2faPasswordReject = null;
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
      this._addLog('warn', 'Dialogs', `getDialogs notice: ${e.message}`);
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
      this._addLog('info', 'Bot API', `Bot verified successfully: @${data.result.username}`);
      return {
        success: true,
        bot: {
          id: data.result.id,
          username: data.result.username,
          firstName: data.result.first_name,
        }
      };
    } catch (err) {
      this._addLog('error', 'Bot API', `testBotConnection error: ${err.message}`);
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

    let url = `https://api.telegram.org/bot${token}/sendMessage`;

    if (mediaPath && fs.existsSync(mediaPath)) {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', cleanText);
      if (parseMode === 'html') form.append('parse_mode', 'HTML');
      if (silent) form.append('disable_notification', 'true');
      
      const ext = path.extname(mediaPath).toLowerCase();
      const isPhoto = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      const isVideo = ['.mp4', '.mkv', '.avi', '.mov'].includes(ext);
      const isAudio = ['.mp3', '.m4a', '.flac', '.wav', '.ogg'].includes(ext);

      let method = 'sendDocument';
      let field = 'document';
      if (isPhoto) { method = 'sendPhoto'; field = 'photo'; }
      else if (isVideo) { method = 'sendVideo'; field = 'video'; }
      else if (isAudio) { method = 'sendAudio'; field = 'audio'; }

      form.append(field, fs.createReadStream(mediaPath));
      url = `https://api.telegram.org/bot${token}/${method}`;

      const resp = await fetch(url, { method: 'POST', body: form });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.description || 'Ошибка отправки медиа через Bot API');
      
      if (pin && data.result && data.result.message_id) {
        await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: data.result.message_id, disable_notification: !!silent })
        }).catch(() => {});
      }

      return { success: true, messageId: data.result.message_id, method: 'bot_api' };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.description || 'Ошибка отправки текстового сообщения через Bot API');
    }

    if (pin && data.result && data.result.message_id) {
      await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: data.result.message_id, disable_notification: !!silent })
      }).catch(() => {});
    }

    return { success: true, messageId: data.result.message_id, method: 'bot_api' };
  }

  async sendPost({ targetPeer, text, parseMode = 'html', silent = false, pin = false, scheduleDate, mediaPath }) {
    let mtprotoReady = (this.client && this.status === 'connected');
    if (!mtprotoReady && this.settings.sessionString) {
      try {
        mtprotoReady = await this.connectWithSavedSession();
      } catch (e) {
        this._addLog('warn', 'MTProto', `On-demand session reconnect notice: ${e.message}`);
      }
    }

    if (!mtprotoReady) {
      if (this.settings.botToken) {
        this._addLog('info', 'Post', 'MTProto не подключен, отправка через Bot API...');
        return await this.sendViaBotApi({ targetPeer, text, parseMode, silent, pin, mediaPath });
      }
      await this.ensureConnected();
    }

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
          if (sendOptions.parseMode && (errStr.includes('TAG_') || errStr.includes('PARSE') || errStr.includes('ENTITY_BOUNDS'))) {
            this._addLog('warn', 'MTProto', 'HTML/MD formatting error, falling back to plain text send');
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
          this._addLog('warn', 'MTProto', `Could not pin message: ${pinErr.message}`);
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
        timeout: 3500
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

            posts.reverse();
            this._addLog('info', 'Public Preview', `Успешно получено ${posts.length} постов из веб-предпросмотра @${cleanUsername}`);
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
        this._addLog('warn', 'Public Preview', `Тайм-аут веб-предпросмотра t.me/s/${cleanUsername}`);
        resolve({
          success: false,
          posts: [],
          error: `Превышено время ожидания ответа Telegram при проверке @${cleanUsername}. Рекомендуется авторизоваться в MTProto.`
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
      }
    }

    // Fallback: If public peer, try public channel web preview
    if (isPublicPeer) {
      this._addLog('info', 'Search', `Запуск веб-предпросмотра для @${cleanUsername}...`);
      const publicResult = await this.fetchPublicChannelPosts(cleanUsername, query, limit, directPostId);
      if (publicResult && publicResult.success && Array.isArray(publicResult.posts) && publicResult.posts.length > 0) {
        return publicResult;
      }

      return {
        success: false,
        posts: publicResult?.posts || [],
        error: publicResult?.error || `Не удалось загрузить публикации @${cleanUsername}. Авторизуйтесь в Telegram MTProto для прямого доступа.`
      };
    }

    return {
      success: false,
      posts: [],
      error: 'Для доступа к закрытым каналам требуется активная авторизация в Telegram MTProto.'
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
              if (attr.voice) isAudio = true;
            }
          }
        }

        if (isAudio) {
          const dateObj = m.date ? new Date(m.date * 1000) : new Date();
          audioFiles.push({
            id: m.id,
            fileName: fileName || `audio_${m.id}.mp3`,
            fileSize,
            fileSizeFormatted: fileSize ? `${(fileSize / (1024 * 1024)).toFixed(2)} MB` : '0 MB',
            duration,
            durationFormatted: duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : '0:00',
            date: m.date,
            dateFormatted: dateObj.toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
            senderId: m.fromId ? (m.fromId.userId || m.fromId).toString() : '',
            messageText: m.message || '',
          });
        }
      }

      this._addLog('info', 'Audio', `Найдено ${audioFiles.length} аудиодорожек в чате`);
      return audioFiles;
    } catch (e) {
      await this._handleApiError(e, 'getChatAudioFiles');
    }
  }

  async getChatMessages({ chatPeer, chatId, limit = 40 }) {
    await this.ensureConnected();
    try {
      const rawPeer = chatPeer || chatId;
      if (!rawPeer) throw new Error('Укажите чат или канал');
      const peer = await this._resolvePeer(rawPeer);

      const messages = await this._invokeWithMigration(async () => {
        return await this.client.getMessages(peer, { limit: Math.min(limit, 100) });
      });

      return (messages || []).filter(Boolean).map(m => {
        const dateObj = m.date ? new Date(m.date * 1000) : new Date();
        return {
          id: m.id,
          date: m.date,
          dateFormatted: dateObj.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          text: m.message || '',
          senderId: m.fromId ? (m.fromId.userId || m.fromId).toString() : '',
          out: !!m.out,
          hasMedia: !!m.media,
          views: m.views || 0,
        };
      });
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
        throw new Error('Сообщение или медиафайл не найдены');
      }

      let originalName = '';
      if (msg.media.document && msg.media.document.attributes) {
        for (const attr of msg.media.document.attributes) {
          if (attr.fileName) originalName = attr.fileName;
        }
      }
      const safeName = customFileName || originalName || `audio_${messageId}.mp3`;
      const saveFolder = targetDir || path.join(this.userDataPath, 'downloads');

      if (!fs.existsSync(saveFolder)) {
        fs.mkdirSync(saveFolder, { recursive: true });
      }

      const savePath = path.join(saveFolder, safeName);
      this._addLog('info', 'Download', `Скачивание аудио: ${safeName}...`);

      const buffer = await this.client.downloadMedia(msg.media, {
        workers: 1,
      });

      if (!buffer) {
        throw new Error('Не удалось скачать файл из Telegram');
      }

      fs.writeFileSync(savePath, buffer);
      this._addLog('info', 'Download', `Файл сохранен: ${savePath}`);

      return {
        success: true,
        filePath: savePath,
        fileName: safeName,
        size: buffer.length,
      };
    } catch (e) {
      await this._handleApiError(e, 'downloadChatAudioFile');
    }
  }

  async _handleApiError(e, context = '') {
    const errMsg = e.message || String(e);
    this._addLog('error', 'API Error', `[${context}] ${errMsg}`);
    if (
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
      throw new Error('Сессия Telegram отозвана на сервере. Пожалуйста, выполните повторный вход.');
    }
    throw new Error(errMsg);
  }

  async ensureConnected() {
    if (this.client && this.status === 'connected' && this.me && this.me.id) {
      if (this.client.connected === false) {
        try {
          await this.client.connect();
        } catch (reconnErr) {
          this._addLog('warn', 'MTProto', `Reconnect failed: ${reconnErr.message}`);
        }
      }
      return true;
    }

    if (this.settings.sessionString) {
      this._addLog('info', 'MTProto', 'Attempting auto-reconnect with saved session...');
      const reconnected = await this.connectWithSavedSession();
      if (reconnected && this.status === 'connected') {
        return true;
      }
    }

    this.status = 'disconnected';
    throw new Error('Подключение к Telegram MTProto отсутствует. Пожалуйста, авторизуйтесь в Telegram (по QR-коду или номеру телефона).');
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      me: this.me,
      botMe: this.botMe,
      phoneNumber: this.phoneNumber || this.settings.phoneNumber,
      isCodeViaApp: this.isCodeViaApp,
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
