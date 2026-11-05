const https = require('https');
const QRCode = require('qrcode');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');

class TelegramAuthEngine {
  constructor(configStore, entityResolver) {
    this.configStore = configStore;
    this.entityResolver = entityResolver;

    this.client = null;
    this.status = 'disconnected'; // 'disconnected' | 'code_sent' | 'password_required' | 'connected'
    this.me = null;
    this.phoneCodeHash = null;
    this.pendingPhoneNumber = null;
    this.passwordHint = '';

    this.qrState = {
      active: false,
      status: 'idle', // 'idle' | 'waiting_scan' | 'password_required' | 'authorized' | 'error'
      tokenBase64: '',
      qrUrl: '',
      qrDataUrl: '',
      expires: 0,
      passwordHint: '',
      error: null,
      apiId: null,
      apiHash: null,
      pollingInFlight: false,
      updateHandler: null
    };
  }

  async createClientInstance(sessionStr = '', apiId = null, apiHash = null) {
    const creds = this.configStore.getCredentials(apiId, apiHash);
    const stringSession = new StringSession(String(sessionStr || '').trim());

    const client = new TelegramClient(stringSession, creds.apiId, creds.apiHash, {
      connectionRetries: 5,
      retryDelay: 1000,
      autoReconnect: true,
      useWSS: false,
      deviceModel: 'DubStudio Desktop Workstation',
      systemVersion: `${process.platform} ${process.arch}`,
      appVersion: '3.0.0',
      langCode: 'ru',
      systemLangCode: 'ru'
    });

    client.setLogLevel('warn');
    return client;
  }

  async disconnectClient() {
    this._cleanupQrHandler();
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {}
      try {
        await this.client.destroy();
      } catch {}
      this.client = null;
    }
  }

  _cleanupQrHandler() {
    if (this.client && this.qrState.updateHandler) {
      try {
        this.client.removeEventHandler(this.qrState.updateHandler);
      } catch {}
    }
    this.qrState.updateHandler = null;
  }

  _formatMe(userObj) {
    if (!userObj) return null;
    return {
      id: String(userObj.id || ''),
      firstName: userObj.firstName || '',
      lastName: userObj.lastName || '',
      username: userObj.username || '',
      phone: userObj.phone || this.configStore.settings.phoneNumber || ''
    };
  }

  async _finalizeAuthorization(userObj = null) {
    if (!this.client) {
      throw new Error('Клиент Telegram не инициализирован');
    }

    const meUser = userObj || (await this.client.getMe());
    if (!meUser) {
      throw new Error('Не удалось получить профиль пользователя после авторизации');
    }

    this.me = this._formatMe(meUser);
    this.status = 'connected';
    this.phoneCodeHash = null;
    this.passwordHint = '';

    const savedSessionString = this.client.session.save();
    await this.configStore.save({
      sessionString: savedSessionString,
      phoneNumber: this.me.phone || this.configStore.settings.phoneNumber
    });

    this.qrState = {
      ...this.qrState,
      active: false,
      status: 'authorized',
      error: null
    };
    this._cleanupQrHandler();

    this.configStore.addLog(
      'info',
      'Auth',
      `Авторизация успешна: ${this.me.firstName} (@${this.me.username || this.me.id})`
    );

    // Pre-warm dialogs in background
    this.entityResolver.getDialogs(this.client, 80).catch((err) => {
      this.configStore.addLog('warn', 'Dialogs', `Фоновая загрузка чатов: ${err.message}`);
    });

    return this.me;
  }

  async connectWithSavedSession() {
    const sessionStr = String(this.configStore.settings.sessionString || '').trim();
    if (!sessionStr || sessionStr.length < 10) {
      this.status = 'disconnected';
      this.me = null;
      return false;
    }

    try {
      await this.disconnectClient();
      this.configStore.addLog('info', 'Auth', 'Подключение по сохраненной MTProto сессии...');
      this.client = await this.createClientInstance(sessionStr);
      await this.client.connect();

      const meUser = await this.client.getMe();
      if (meUser) {
        await this._finalizeAuthorization(meUser);
        return true;
      }
    } catch (err) {
      const msg = String(err?.errorMessage || err?.message || err);
      this.configStore.addLog('warn', 'Auth', `Сохраненная сессия неактивна: ${msg}`);
      if (
        msg.includes('AUTH_KEY_UNREGISTERED') ||
        msg.includes('SESSION_REVOKED') ||
        msg.includes('USER_DEACTIVATED') ||
        msg.includes('AUTH_KEY_DUPLICATED')
      ) {
        await this.configStore.save({ sessionString: '' });
      }
      await this.disconnectClient();
    }

    this.status = 'disconnected';
    this.me = null;
    return false;
  }

  async ensureConnected() {
    if (this.client && this.status === 'connected') {
      if (!this.client.connected) {
        await this.client.connect();
      }
      return true;
    }
    if (this.configStore.settings.sessionString) {
      return await this.connectWithSavedSession();
    }
    return false;
  }

  // ===========================================================================
  // 1. NATIVE QR CODE AUTHENTICATION (GramJS UpdateLoginToken + Export/Import)
  // ===========================================================================
  async startQrCodeAuth(apiId, apiHash) {
    const creds = this.configStore.getCredentials(apiId, apiHash);
    await this.configStore.save({ apiId: creds.apiId, apiHash: creds.apiHash });

    this.configStore.addLog('info', 'QR', `Запуск авторизации по QR-коду (API ID: ${creds.apiId})...`);
    await this.disconnectClient();

    this.client = await this.createClientInstance('', creds.apiId, creds.apiHash);
    await this.client.connect();

    this.qrState = {
      active: true,
      status: 'waiting_scan',
      tokenBase64: '',
      qrUrl: '',
      qrDataUrl: '',
      expires: 0,
      passwordHint: '',
      error: null,
      apiId: creds.apiId,
      apiHash: creds.apiHash,
      pollingInFlight: false,
      updateHandler: null
    };

    // Listen for Telegram's push notification when the user scans the QR code on their phone
    const onUpdate = async (update) => {
      if (
        update instanceof Api.UpdateLoginToken ||
        update?.className === 'UpdateLoginToken'
      ) {
        this.configStore.addLog('info', 'QR', 'Получен сигнал UpdateLoginToken от смартфона!');
        await this._exportAndCheckQrToken(true);
      }
    };
    this.qrState.updateHandler = onUpdate;
    this.client.addEventHandler(onUpdate);

    await this._exportAndCheckQrToken(true);

    return {
      success: true,
      active: this.qrState.active,
      status: this.qrState.status,
      qrUrl: this.qrState.qrUrl,
      qrDataUrl: this.qrState.qrDataUrl,
      expires: this.qrState.expires,
      passwordHint: this.qrState.passwordHint,
      me: this.me
    };
  }

  async _exportAndCheckQrToken(forceCheck = false) {
    if (!this.client || !this.qrState.active) return;
    if (this.qrState.status === 'password_required' || this.qrState.status === 'authorized') {
      return;
    }
    if (this.qrState.pollingInFlight) return;

    this.qrState.pollingInFlight = true;
    try {
      if (!this.client.connected) {
        await this.client.connect();
      }

      const { apiId, apiHash } = this.configStore.getCredentials(
        this.qrState.apiId,
        this.qrState.apiHash
      );

      let result = await this.client.invoke(
        new Api.auth.ExportLoginToken({
          apiId: Number(apiId),
          apiHash: String(apiHash),
          exceptIds: []
        })
      );

      // Case 1: User belongs to another DataCenter -> switch DC and ImportLoginToken
      if (
        result instanceof Api.auth.LoginTokenMigrateTo ||
        result?.className === 'auth.LoginTokenMigrateTo'
      ) {
        this.configStore.addLog(
          'info',
          'QR',
          `Аккаунт находится на DC ${result.dcId}. Переключаемся и импортируем токен...`
        );
        await this.client._switchDC(result.dcId);
        result = await this.client.invoke(
          new Api.auth.ImportLoginToken({
            token: result.token
          })
        );
      }

      // Case 2: Login succeeded!
      if (
        result instanceof Api.auth.LoginTokenSuccess ||
        result?.className === 'auth.LoginTokenSuccess'
      ) {
        const user = result.authorization?.user || null;
        await this._finalizeAuthorization(user);
        return;
      }

      // Case 3: Still waiting for scan — update QR image ONLY if token changed
      if (result instanceof Api.auth.LoginToken || result?.className === 'auth.LoginToken') {
        const tokenBuffer = Buffer.from(result.token);
        const tokenBase64 = tokenBuffer
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const qrUrl = `tg://login?token=${tokenBase64}`;

        if (tokenBase64 !== this.qrState.tokenBase64 || !this.qrState.qrDataUrl) {
          const qrDataUrl = await QRCode.toDataURL(qrUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 300,
            color: {
              dark: '#0f172a',
              light: '#ffffff'
            }
          });
          this.qrState.tokenBase64 = tokenBase64;
          this.qrState.qrUrl = qrUrl;
          this.qrState.qrDataUrl = qrDataUrl;
          this.configStore.addLog('info', 'QR', 'Сгенерирован свежий QR-код для сканирования');
        }

        this.qrState.expires = Number(result.expires) || Math.floor(Date.now() / 1000) + 30;
        this.qrState.status = 'waiting_scan';
      }
    } catch (err) {
      const errMsg = String(err?.errorMessage || err?.message || err);
      if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
        let hint = '';
        try {
          const pwdInfo = await this.client.invoke(new Api.account.GetPassword());
          hint = pwdInfo?.hint || '';
        } catch {}

        this.status = 'password_required';
        this.passwordHint = hint;
        this.qrState.status = 'password_required';
        this.qrState.passwordHint = hint;
        this._cleanupQrHandler();
        this.configStore.addLog(
          'info',
          'QR',
          `QR-код отсканирован! Требуется облачный пароль 2FA (подсказка: ${hint || 'нет'})`
        );
        return;
      }

      this.configStore.addLog('warn', 'QR', `Проверка QR-токена: ${errMsg}`);
      if (forceCheck && !this.qrState.qrDataUrl) {
        this.qrState.error = errMsg;
      }
    } finally {
      this.qrState.pollingInFlight = false;
    }
  }

  async getQrAuthStatus(forceRefresh = false) {
    if (this.status === 'connected' && this.me) {
      return {
        active: false,
        status: 'authorized',
        authorized: true,
        me: this.me
      };
    }

    if (this.qrState.status === 'password_required' || this.status === 'password_required') {
      return {
        active: true,
        status: 'password_required',
        passwordHint: this.qrState.passwordHint || this.passwordHint || ''
      };
    }

    if (!this.qrState.active || !this.client) {
      return {
        active: false,
        status: 'idle'
      };
    }

    // Check token status with Telegram server (ExportLoginToken returns the same token until expiry or LoginTokenSuccess once scanned)
    await this._exportAndCheckQrToken(Boolean(forceRefresh));

    if (this.status === 'connected' && this.me) {
      return {
        active: false,
        status: 'authorized',
        authorized: true,
        me: this.me
      };
    }

    if (this.qrState.status === 'password_required') {
      return {
        active: true,
        status: 'password_required',
        passwordHint: this.qrState.passwordHint || ''
      };
    }

    return {
      active: this.qrState.active,
      status: this.qrState.status,
      qrUrl: this.qrState.qrUrl,
      qrDataUrl: this.qrState.qrDataUrl,
      expires: this.qrState.expires,
      error: this.qrState.error
    };
  }

  cancelQrCodeAuth() {
    this._cleanupQrHandler();
    this.qrState = {
      ...this.qrState,
      active: false,
      status: 'idle',
      tokenBase64: '',
      qrUrl: '',
      qrDataUrl: '',
      error: null
    };
    this.configStore.addLog('info', 'QR', 'Авторизация по QR-коду отменена');
    return { success: true };
  }

  // ===========================================================================
  // 2. PHONE NUMBER + SMS/APP CODE + 2FA PASSWORD
  // ===========================================================================
  async sendCode(phoneNumber, apiId, apiHash, forceSMS = false) {
    const cleanPhone = String(phoneNumber || '').replace(/[^\d+]/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error('Укажите корректный номер телефона в международном формате (например, +79991234567)');
    }

    const creds = this.configStore.getCredentials(apiId, apiHash);
    await this.configStore.save({
      apiId: creds.apiId,
      apiHash: creds.apiHash,
      phoneNumber: cleanPhone
    });

    this.cancelQrCodeAuth();
    await this.disconnectClient();

    this.client = await this.createClientInstance('', creds.apiId, creds.apiHash);
    await this.client.connect();

    this.configStore.addLog('info', 'Auth', `Отправка кода подтверждения на ${cleanPhone}...`);

    // Use GramJS built-in client.sendCode which handles DC migration cleanly
    const sendResult = await this.client.sendCode(
      { apiId: creds.apiId, apiHash: creds.apiHash },
      cleanPhone,
      Boolean(forceSMS)
    );

    this.phoneCodeHash = sendResult.phoneCodeHash;
    this.pendingPhoneNumber = cleanPhone;
    this.status = 'code_sent';

    const isCodeViaApp = Boolean(sendResult.isCodeViaApp);
    const deliveryMethod = isCodeViaApp ? 'app' : 'sms';

    this.configStore.addLog(
      'info',
      'Auth',
      `Код отправлен (${isCodeViaApp ? 'в приложение Telegram' : 'по SMS'})`
    );

    return {
      success: true,
      phoneCodeHash: this.phoneCodeHash,
      isCodeViaApp,
      deliveryMethod,
      formattedPhone: cleanPhone,
      message: isCodeViaApp
        ? 'Код отправлен в приложение Telegram (служебный чат «Telegram»)'
        : 'Код отправлен по SMS на указанный номер'
    };
  }

  async resendCode() {
    if (!this.client || !this.pendingPhoneNumber || !this.phoneCodeHash) {
      throw new Error('Сначала запросите первичный код подтверждения');
    }

    const res = await this.client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: this.pendingPhoneNumber,
        phoneCodeHash: this.phoneCodeHash
      })
    );

    if (res && res.phoneCodeHash) {
      this.phoneCodeHash = res.phoneCodeHash;
    }

    const typeName = res?.type?.className || '';
    const isCodeViaApp = typeName.includes('SentCodeTypeApp');

    this.configStore.addLog('info', 'Auth', `Код запрошен повторно (${typeName || 'SMS'})`);
    return {
      success: true,
      phoneCodeHash: this.phoneCodeHash,
      isCodeViaApp,
      deliveryMethod: isCodeViaApp ? 'app' : 'sms',
      message: isCodeViaApp ? 'Код повторно отправлен в Telegram' : 'Код отправлен по SMS'
    };
  }

  async signIn(phoneCode, password = '') {
    if (!this.client) {
      throw new Error('Сессия авторизации не активна. Запросите код заново.');
    }

    const cleanCode = String(phoneCode || '').replace(/\s+/g, '').trim();
    const phone = this.pendingPhoneNumber || this.configStore.settings.phoneNumber;

    if (!cleanCode) {
      throw new Error('Введите код подтверждения из Telegram или SMS');
    }

    try {
      const signInResult = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: cleanCode
        })
      );

      if (
        signInResult instanceof Api.auth.AuthorizationSignUpRequired ||
        signInResult?.className === 'auth.AuthorizationSignUpRequired'
      ) {
        throw new Error('Этот номер телефона еще не зарегистрирован в Telegram');
      }

      const me = await this._finalizeAuthorization(signInResult?.user || null);
      return {
        status: 'connected',
        me
      };
    } catch (err) {
      const errMsg = String(err?.errorMessage || err?.message || err);

      if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
        if (password && String(password).trim()) {
          return await this.submit2FAPassword(password);
        }

        let hint = '';
        try {
          const pwdData = await this.client.invoke(new Api.account.GetPassword());
          hint = pwdData?.hint || '';
        } catch {}

        this.status = 'password_required';
        this.passwordHint = hint;
        this.configStore.addLog('info', 'Auth', `Требуется пароль 2FA (подсказка: ${hint || 'нет'})`);
        return {
          status: 'password_required',
          passwordHint: hint,
          me: null
        };
      }

      if (errMsg.includes('PHONE_CODE_INVALID')) {
        throw new Error('Неверный код подтверждения. Проверьте цифры и попробуйте снова.');
      }
      if (errMsg.includes('PHONE_CODE_EXPIRED')) {
        throw new Error('Срок действия кода истек. Запросите новый код.');
      }

      this.configStore.addLog('error', 'Auth', `Ошибка входа по коду: ${errMsg}`);
      throw new Error(`Ошибка входа: ${errMsg}`);
    }
  }

  async submit2FAPassword(password) {
    if (!this.client) {
      throw new Error('Сессия Telegram не инициализирована. Начните вход заново.');
    }
    if (!password) {
      throw new Error('Введите облачный пароль двухфакторной аутентификации (2FA)');
    }

    try {
      if (!this.client.connected) {
        await this.client.connect();
      }

      this.configStore.addLog('info', 'Auth', 'Проверка облачного пароля 2FA (SRP)...');
      const passwordInformation = await this.client.invoke(new Api.account.GetPassword());
      const srpCheck = await computeCheck(passwordInformation, String(password));
      const authResult = await this.client.invoke(
        new Api.auth.CheckPassword({
          password: srpCheck
        })
      );

      const me = await this._finalizeAuthorization(authResult?.user || null);
      return {
        success: true,
        status: 'connected',
        me
      };
    } catch (err) {
      const errMsg = String(err?.errorMessage || err?.message || err);
      this.configStore.addLog('error', 'Auth', `Ошибка проверки пароля 2FA: ${errMsg}`);
      if (errMsg.includes('PASSWORD_HASH_INVALID')) {
        throw new Error('Неверный пароль двухфакторной аутентификации (2FA)');
      }
      throw new Error(`Ошибка 2FA: ${errMsg}`);
    }
  }

  // ===========================================================================
  // 3. DIRECT STRING SESSION IMPORT & EXPORT
  // ===========================================================================
  async importSessionString(rawSessionString, apiId, apiHash) {
    const cleanSession = String(rawSessionString || '').trim();
    if (!cleanSession || cleanSession.length < 15) {
      throw new Error('Укажите корректную строку StringSession GramJS');
    }

    const creds = this.configStore.getCredentials(apiId, apiHash);
    await this.configStore.save({ apiId: creds.apiId, apiHash: creds.apiHash });

    this.cancelQrCodeAuth();
    await this.disconnectClient();

    this.configStore.addLog('info', 'Auth', 'Импорт и проверка StringSession...');
    this.client = await this.createClientInstance(cleanSession, creds.apiId, creds.apiHash);
    await this.client.connect();

    const meUser = await this.client.getMe();
    if (!meUser) {
      await this.disconnectClient();
      throw new Error('Переданная StringSession недействительна или устарела');
    }

    const me = await this._finalizeAuthorization(meUser);
    return {
      success: true,
      status: 'connected',
      me
    };
  }

  exportSessionString() {
    const sessionString =
      (this.client && this.status === 'connected' ? this.client.session.save() : '') ||
      String(this.configStore.settings.sessionString || '').trim();

    if (!sessionString) {
      throw new Error('Активная сессия отсутствует');
    }

    return {
      success: true,
      sessionString
    };
  }

  async logout() {
    this.cancelQrCodeAuth();
    if (this.client && this.client.connected) {
      try {
        await this.client.invoke(new Api.auth.LogOut());
      } catch {}
    }
    await this.disconnectClient();
    this.status = 'disconnected';
    this.me = null;
    this.entityResolver.clearCache();
    await this.configStore.save({ sessionString: '' });
    this.configStore.addLog('info', 'Auth', 'Выход из аккаунта Telegram выполнен');
    return { success: true };
  }

  // ===========================================================================
  // 4. TELEGRAM BOT API CONNECTION & HTTP CLIENT
  // ===========================================================================
  callBotApiJson(botToken, method, payload = {}) {
    return new Promise((resolve, reject) => {
      const cleanToken = String(botToken || this.configStore.settings.botToken || '').trim();
      if (!cleanToken) {
        return reject(new Error('Токен Telegram-бота не указан'));
      }

      const bodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          port: 443,
          path: `/bot${cleanToken}/${method}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': bodyBuffer.length
          },
          timeout: 15000
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw);
              if (!parsed.ok) {
                return reject(
                  new Error(parsed.description || `Bot API error ${parsed.error_code}`)
                );
              }
              resolve(parsed.result);
            } catch (e) {
              reject(new Error(`Некорректный ответ Bot API: ${e.message}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Таймаут соединения с api.telegram.org'));
      });
      req.write(bodyBuffer);
      req.end();
    });
  }

  async testBotConnection(customBotToken) {
    const token = String(customBotToken || this.configStore.settings.botToken || '').trim();
    if (!token) {
      throw new Error('Введите токен бота от @BotFather');
    }

    const botInfo = await this.callBotApiJson(token, 'getMe', {});
    const botMe = {
      id: botInfo.id,
      username: botInfo.username || '',
      firstName: botInfo.first_name || 'Bot'
    };

    await this.configStore.save({
      botToken: token,
      botMe
    });

    this.configStore.addLog(
      'info',
      'BotAPI',
      `Бот успешно подключен: @${botMe.username} (${botMe.firstName})`
    );

    return {
      success: true,
      bot: botMe
    };
  }

  async testConnection() {
    const startTime = Date.now();
    try {
      const ok = await this.ensureConnected();
      const latencyMs = Date.now() - startTime;
      if (!ok || !this.client) {
        return {
          success: false,
          connected: false,
          latencyMs,
          status: this.status,
          hasSession: Boolean(this.configStore.settings.sessionString),
          error: 'Активная MTProto сессия не найдена. Выполните вход по QR-коду, номеру или StringSession.'
        };
      }

      const me = await this.client.getMe();
      const dcId = this.client.session?.dcId || 2;
      return {
        success: true,
        connected: true,
        latencyMs: Date.now() - startTime,
        dcId,
        status: 'connected',
        hasSession: true,
        me: this._formatMe(me)
      };
    } catch (err) {
      return {
        success: false,
        connected: false,
        latencyMs: Date.now() - startTime,
        status: this.status,
        hasSession: Boolean(this.configStore.settings.sessionString),
        error: err.message || String(err)
      };
    }
  }
}

module.exports = {
  TelegramAuthEngine
};
