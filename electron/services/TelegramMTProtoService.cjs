const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

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

    // QR Code Authentication State
    this.qrAuthActive = false;
    this.qrToken = null;
    this.qrExpires = 0;
    this.qrDataUrl = '';
    this.qrUrl = '';
    this.qrStatus = 'idle'; // 'idle', 'waiting_scan', 'password_required', 'authenticated', 'error'
    this.qrError = null;

    this.settings = {
      apiId: '',
      apiHash: '',
      phoneNumber: '',
      sessionString: '',
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

  async init() {
    try {
      const saved = await this.dataManager.getData('telegram_mtproto_settings.json');
      if (saved && typeof saved === 'object') {
        this.settings = { ...this.settings, ...saved };
      }
      if (this.settings.sessionString) {
        await this.connectWithSavedSession();
      }
    } catch (e) {
      log.error('[MTProto] Error during init:', e);
    }
  }

  async saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await this.dataManager.saveData('telegram_mtproto_settings.json', this.settings);
    return this.settings;
  }

  async connectWithSavedSession() {
    if (!this.settings.sessionString) return false;
    try {
      const apiId = Number(this.settings.apiId);
      const apiHash = String(this.settings.apiHash || '').trim();
      
      if (!apiId || !apiHash) {
        throw new Error('API_ID or API_HASH is missing. Re-authentication required.');
      }
      this.session = new StringSession(this.settings.sessionString);

      this.client = new TelegramClient(this.session, apiId, apiHash, {
        connectionRetries: 3,
        useWSS: false,
      });

      await this.client.connect();
      const me = await this.client.getMe();
      if (me) {
        this.me = {
          id: me.id ? me.id.toString() : '',
          firstName: me.firstName || '',
          lastName: me.lastName || '',
          username: me.username || '',
          phone: me.phone || '',
        };
        this.status = 'connected';
        log.info('[MTProto] Connected as:', me.username || me.id);
        return true;
      } else {
        this.status = 'disconnected';
      }
    } catch (e) {
      log.error('[MTProto] Failed connecting with saved session:', e);
      this.status = 'disconnected';
    }
    return false;
  }

  async sendCode(phoneNumber, customApiId, customApiHash, forceSMS = false) {
    console.log(`[MTProto Auth] >>> sendCode requested: phone=${phoneNumber}, customApiId=${customApiId}, forceSMS=${forceSMS}`);
    try {
      const cleanPhone = normalizePhoneNumber(phoneNumber);
      console.log(`[MTProto Auth] Normalized phone: "${cleanPhone}"`);
      if (!cleanPhone || cleanPhone.length < 7) {
        throw new Error('Укажите корректный номер телефона (напр. +79991234567)');
      }

      const apiId = Number(customApiId || this.settings.apiId);
      const apiHash = String(customApiHash || this.settings.apiHash || '').trim();

      console.log(`[MTProto Auth] Using apiId=${apiId}, apiHash length=${apiHash ? apiHash.length : 0}`);
      if (!apiId || isNaN(apiId) || !apiHash) {
        throw new Error('Укажите свои персональные API ID и API Hash (получить можно бесплатно на my.telegram.org в разделе API development tools)');
      }

      this.settings.apiId = apiId;
      this.settings.apiHash = apiHash;
      this.phoneNumber = cleanPhone;

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
      this.client = new TelegramClient(this.session, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false,
      });

      console.log('[MTProto Auth] Connecting to Telegram MTProto DC servers...');
      await this.client.connect();
      console.log('[MTProto Auth] Connected successfully to MTProto network. Sending auth code request...');
      
      const res = await this.client.sendCode({ apiId, apiHash }, cleanPhone, forceSMS);
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
        msg = 'Этот номер телефона не зарегистрирован в Telegram.';
      } else if (msg.includes('API_ID_INVALID') || msg.includes('API_HASH_INVALID')) {
        msg = 'Неверный API ID или API Hash. Получите персональные ключи на my.telegram.org в разделе API development tools.';
      } else if (msg.includes('API_ID_PUBLISHED_FLOOD')) {
        msg = 'Данный публичный API ID заблокирован Telegram из-за превышения лимитов. Введите ваш собственный API ID с my.telegram.org.';
      } else if (msg.includes('PHONE_NUMBER_BANNED')) {
        msg = 'Этот номер телефона заблокирован в Telegram.';
      } else if (msg.includes('PHONE_CODE_EXPIRED')) {
        msg = 'Срок действия кода истек. Запросите код повторно.';
      } else if (msg.includes('FLOOD_WAIT')) {
        const seconds = msg.match(/\d+/)?.[0] || 'несколько';
        msg = `Слишком много запросов. Telegram временно ограничил отправку кодов (ожидание ~${seconds} сек). Попробуйте позже.`;
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
      console.log('[MTProto Auth] Invoking auth.ResendCode...');
      const res = await this.client.invoke(new Api.auth.ResendCode({
        phoneNumber: this.phoneNumber,
        phoneCodeHash: this.phoneCodeHash,
      }));
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
        const signInResult = await this.client.invoke(new Api.auth.SignIn({
          phoneNumber: this.phoneNumber,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: cleanCode,
        }));
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
          const passwordSrpResult = await this.client.invoke(new Api.account.GetPassword());
          console.log('[MTProto Auth] Computing password check SRP hash...');
          const passwordSrpCheck = await computeCheck(passwordSrpResult, password);
          console.log('[MTProto Auth] Invoking auth.CheckPassword...');
          const checkRes = await this.client.invoke(new Api.auth.CheckPassword({
            password: passwordSrpCheck,
          }));
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

      console.log('[MTProto Auth] Saving session string to storage...');
      const sessionStr = this.client.session.save();
      this.settings.sessionString = sessionStr;

      console.log('[MTProto Auth] Fetching account info (getMe)...');
      const me = await this.client.getMe();
      this.me = {
        id: me.id ? me.id.toString() : '',
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || '',
        phone: me.phone || '',
      };
      this.status = 'connected';

      await this.saveSettings({ sessionString: sessionStr, phoneNumber: this.phoneNumber });
      console.log('[MTProto Auth] Login completed successfully for user:', this.me);

      return { success: true, me: this.me };
    } catch (e) {
      console.error('[MTProto Auth] signIn FAILED:', e);
      log.error('[MTProto Auth] signIn error:', e);
      throw new Error(e.message || String(e));
    }
  }

  async startQrCodeAuth(customApiId, customApiHash) {
    const apiId = Number(customApiId || this.settings.apiId);
    const apiHash = String(customApiHash || this.settings.apiHash || '').trim();

    if (!apiId || isNaN(apiId) || !apiHash) {
      throw new Error('Укажите свои персональные API ID и API Hash (получить можно на my.telegram.org в разделе API development tools)');
    }

    this.settings.apiId = apiId;
    this.settings.apiHash = apiHash;
    await this.saveSettings({ apiId, apiHash });

    this.qrAuthActive = true;
    this.qrStatus = 'waiting_scan';
    this.qrError = null;

    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {}
    }

    this.session = new StringSession('');
    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: false,
    });

    await this.client.connect();

    // Export initial login token from Telegram MTProto
    const res = await this.client.invoke(new Api.auth.ExportLoginToken({
      apiId,
      apiHash,
      exceptIds: [],
    }));

    if (res instanceof Api.auth.LoginToken) {
      const base64UrlToken = Buffer.from(res.token).toString('base64url');
      this.qrUrl = `tg://login?token=${base64UrlToken}`;
      this.qrExpires = res.expires;
      this.qrDataUrl = await QRCode.toDataURL(this.qrUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });

      // Set up real-time raw update handler for UpdateLoginToken
      const updateHandler = async (update) => {
        try {
          if (!this.qrAuthActive || this.qrStatus !== 'waiting_scan') return;
          const isUpdateLoginToken = update && (
            update.className === 'UpdateLoginToken' || 
            update._ === 'updateLoginToken' || 
            (update.constructor && update.constructor.name === 'UpdateLoginToken') ||
            (update.className && String(update.className).toLowerCase().includes('logintoken'))
          );

          if (isUpdateLoginToken) {
            log.info('[MTProto QR] Received UpdateLoginToken raw event from Telegram! Completing auth...');
            try {
              const finishRes = await this.client.invoke(new Api.auth.ExportLoginToken({
                apiId,
                apiHash,
                exceptIds: [],
              }));
              if (finishRes instanceof Api.auth.LoginTokenSuccess && finishRes.authorization) {
                await this._completeAuthSuccess(finishRes.authorization);
                return;
              } else if (finishRes instanceof Api.auth.LoginTokenMigrateTo) {
                log.info('[MTProto QR] Event triggered DC migration to:', finishRes.dcId);
                await this.client._switchDC(finishRes.dcId);
                const migratedRes = await this.client.invoke(new Api.auth.ImportLoginToken({
                  token: finishRes.token,
                }));
                if (migratedRes && (migratedRes.authorization || migratedRes instanceof Api.auth.LoginTokenSuccess)) {
                  await this._completeAuthSuccess(migratedRes.authorization || finishRes.authorization);
                  return;
                }
              }
            } catch (finishErr) {
              const fMsg = finishErr.message || String(finishErr);
              if (fMsg.includes('SESSION_PASSWORD_NEEDED') || fMsg.includes('2FA')) {
                this.qrStatus = 'password_required';
                return;
              }
            }

            // Also check getMe directly if authorization succeeded on Telegram side
            const me = await this.client.getMe().catch(() => null);
            if (me && me.id) {
              await this._completeAuthSuccess({ user: me });
            }
          }
        } catch (evErr) {
          const errMsg = evErr.message || String(evErr);
          log.warn('[MTProto QR] Update handler warning:', errMsg);
          if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
            this.qrStatus = 'password_required';
          }
        }
      };

      if (typeof this.client.addEventHandler === 'function') {
        this.client.addEventHandler(updateHandler);
      }

      // Start background polling loop for QR scan confirmation (runs concurrently as fallback)
      this._pollQrCodeAuth(apiId, apiHash).catch((err) => {
        console.error('[MTProto QR] Polling loop error:', err);
      });

      return {
        success: true,
        qrUrl: this.qrUrl,
        qrDataUrl: this.qrDataUrl,
        expires: this.qrExpires
      };
    } else if (res instanceof Api.auth.LoginTokenSuccess && res.authorization) {
      return await this._completeAuthSuccess(res.authorization);
    } else {
      throw new Error('Не удалось сгенерировать токен авторизации Telegram');
    }
  }

  async _pollQrCodeAuth(apiId, apiHash) {
    let checkCount = 0;
    while (this.qrAuthActive && this.qrStatus === 'waiting_scan') {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        if (!this.qrAuthActive || this.qrStatus !== 'waiting_scan') break;
        checkCount++;

        // 1. Direct active authorization check (GramJS will return user info if session was activated)
        try {
          const me = await this.client.getMe();
          if (me && me.id) {
            log.info('[MTProto QR] Active session verified via getMe()!', me.username || me.id);
            await this._completeAuthSuccess({ user: me });
            break;
          }
        } catch (meErr) {
          const meMsg = meErr.message || String(meErr);
          if (meMsg.includes('SESSION_PASSWORD_NEEDED') || meMsg.includes('2FA')) {
            this.qrStatus = 'password_required';
            log.info('[MTProto QR] 2FA password required after QR scan');
            break;
          }
        }

        // 2. Periodic MTProto exportLoginToken check / renewal
        const nowSec = Math.floor(Date.now() / 1000);
        const shouldCallExport = (checkCount % 2 === 0) || (this.qrExpires && nowSec >= this.qrExpires - 3);

        if (shouldCallExport) {
          const res = await this.client.invoke(new Api.auth.ExportLoginToken({
            apiId,
            apiHash,
            exceptIds: [],
          }));

          if (res instanceof Api.auth.LoginTokenSuccess && res.authorization) {
            log.info('[MTProto QR] LoginTokenSuccess confirmed by Telegram!');
            await this._completeAuthSuccess(res.authorization);
            break;
          } else if (res instanceof Api.auth.LoginTokenMigrateTo) {
            log.info('[MTProto QR] Migrating DC to:', res.dcId);
            await this.client._switchDC(res.dcId);
            const migratedRes = await this.client.invoke(new Api.auth.ImportLoginToken({
              token: res.token,
            }));
            if (migratedRes && (migratedRes.authorization || migratedRes instanceof Api.auth.LoginTokenSuccess)) {
              await this._completeAuthSuccess(migratedRes.authorization);
              break;
            }
          } else if (res instanceof Api.auth.LoginToken) {
            const newBase64 = Buffer.from(res.token).toString('base64url');
            const newUrl = `tg://login?token=${newBase64}`;
            if (newUrl !== this.qrUrl) {
              this.qrUrl = newUrl;
              this.qrExpires = res.expires;
              this.qrDataUrl = await QRCode.toDataURL(this.qrUrl, {
                width: 280,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
              });
            }
          }
        }
      } catch (err) {
        const errMsg = err.message || String(err);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
          this.qrStatus = 'password_required';
          log.info('[MTProto QR] 2FA password required');
          break;
        } else if (errMsg.includes('AUTH_KEY_UNREGISTERED') || errMsg.includes('FLOOD_WAIT')) {
          this.qrStatus = 'error';
          this.qrError = errMsg;
          break;
        }
      }
    }
  }

  async _completeAuthSuccess(auth) {
    try {
      const sessionStr = this.client.session.save();
      this.settings.sessionString = sessionStr;
      const me = await this.client.getMe().catch(() => auth?.user || null);
      this.me = {
        id: (me && me.id) ? me.id.toString() : '',
        firstName: (me && me.firstName) || '',
        lastName: (me && me.lastName) || '',
        username: (me && me.username) || '',
        phone: (me && me.phone) || '',
      };
      this.status = 'connected';
      this.qrStatus = 'authenticated';
      this.qrAuthActive = false;
      await this.saveSettings({ sessionString: sessionStr });
      log.info('[MTProto QR] Successfully authenticated as:', this.me.username || this.me.id);
      return { success: true, me: this.me };
    } catch (e) {
      log.error('[MTProto QR] _completeAuthSuccess error:', e);
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

    const passwordSrpResult = await this.client.invoke(new Api.account.GetPassword());
    const passwordSrpCheck = await computeCheck(passwordSrpResult, cleanPassword);
    const checkRes = await this.client.invoke(new Api.auth.CheckPassword({
      password: passwordSrpCheck,
    }));

    const sessionStr = this.client.session.save();
    this.settings.sessionString = sessionStr;
    const me = await this.client.getMe();
    this.me = {
      id: me.id ? me.id.toString() : '',
      firstName: me.firstName || '',
      lastName: me.lastName || '',
      username: me.username || '',
      phone: me.phone || '',
    };
    this.status = 'connected';
    this.qrStatus = 'authenticated';
    this.qrAuthActive = false;
    await this.saveSettings({ sessionString: sessionStr });
    return { success: true, me: this.me };
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

    // If waiting for scan, active check via client.getMe()
    if (this.qrAuthActive && this.qrStatus === 'waiting_scan' && this.client) {
      try {
        const me = await this.client.getMe();
        if (me && me.id) {
          log.info('[MTProto QR check] User confirmed authorized via getQrAuthStatus!', me.username || me.id);
          await this._completeAuthSuccess({ user: me });
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
      } catch (checkErr) {
        const errMsg = checkErr.message || String(checkErr);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED') || errMsg.includes('2FA')) {
          this.qrStatus = 'password_required';
        }
      }
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
    return { success: true };
  }

  async logout() {
    try {
      if (this.client) {
        try {
          await this.client.invoke(new Api.auth.LogOut());
        } catch (e) {}
        await this.client.disconnect();
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

  async getDialogs(limit = 50) {
    this.ensureConnected();
    try {
      const dialogs = await this.client.getDialogs({ limit });
      return dialogs.map(d => ({
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
      log.error('[MTProto] getDialogs error:', e);
      throw new Error(e.message || String(e));
    }
  }

  async sendPost({ targetPeer, text, parseMode = 'html', silent = false, pin = false, scheduleDate, mediaPath }) {
    this.ensureConnected();
    try {
      let peer = targetPeer || this.settings.defaultChannelId;
      if (!peer) throw new Error('Укажите ID или логин канала (@channel)');

      peer = String(peer).trim();
      if (peer.startsWith('https://t.me/')) {
        peer = peer.replace('https://t.me/', '@');
      } else if (peer.startsWith('t.me/')) {
        peer = peer.replace('t.me/', '@');
      }

      // Try resolving numeric chat IDs safely
      if (/^-?\d+$/.test(peer)) {
        try {
          peer = BigInt(peer);
        } catch (e) {}
      }

      const sendOptions = {
        silent: !!silent,
        schedule: scheduleDate ? Math.floor(new Date(scheduleDate).getTime() / 1000) : undefined,
      };

      if (parseMode === 'html') {
        sendOptions.parseMode = 'html';
      } else if (parseMode === 'md') {
        sendOptions.parseMode = 'markdown';
      }

      let sentMsg;
      try {
        if (mediaPath && fs.existsSync(mediaPath)) {
          sendOptions.file = mediaPath;
          sendOptions.caption = text;
          sentMsg = await this.client.sendFile(peer, sendOptions);
        } else {
          sendOptions.message = text;
          sentMsg = await this.client.sendMessage(peer, sendOptions);
        }
      } catch (firstErr) {
        const errStr = String(firstErr.message || firstErr);
        // If failed due to unclosed HTML tag or parse error, fallback to plain text gracefully
        if (sendOptions.parseMode && (errStr.includes('TAG_') || errStr.includes('PARSE') || errStr.includes('ENTITY_BOUNDS'))) {
          log.warn('[MTProto] HTML/MD formatting error, falling back to plain text send:', errStr);
          delete sendOptions.parseMode;
          if (mediaPath && fs.existsSync(mediaPath)) {
            sendOptions.caption = text.replace(/<[^>]*>/g, '');
            sentMsg = await this.client.sendFile(peer, sendOptions);
          } else {
            sendOptions.message = text.replace(/<[^>]*>/g, '');
            sentMsg = await this.client.sendMessage(peer, sendOptions);
          }
        } else {
          throw firstErr;
        }
      }

      if (pin && sentMsg && sentMsg.id) {
        try {
          await this.client.invoke(new Api.messages.TogglePinnedMessage({
            peer: peer,
            id: sentMsg.id,
            silent: silent,
          }));
        } catch (pinErr) {
          log.warn('[MTProto] Could not pin message:', pinErr);
        }
      }

      return {
        success: true,
        messageId: sentMsg ? sentMsg.id : null,
      };
    } catch (e) {
      log.error('[MTProto] sendPost error:', e);
      throw new Error(e.message || String(e));
    }
  }

  async sendAutomationNotification({ type, targetPeer, payload, pin = false, silent = false, customText = null, scheduleDate = null }) {
    this.ensureConnected();
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

  ensureConnected() {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Подключение к Telegram MTProto отсутствует. Пожалуйста, авторизуйтесь в настройках Telegram MTProto.');
    }
  }

  getStatus() {
    let effectiveStatus = this.status;
    if (effectiveStatus !== 'connected' && this.me && this.me.id) {
      effectiveStatus = 'connected';
    }
    return {
      status: effectiveStatus,
      me: this.me,
      settings: {
        apiId: this.settings.apiId,
        apiHash: this.settings.apiHash,
        phoneNumber: this.settings.phoneNumber,
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
