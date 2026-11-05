const { TelegramConfigStore } = require('./telegram/telegramConfigStore.cjs');
const { TelegramEntityResolver } = require('./telegram/telegramEntityResolver.cjs');
const { TelegramAuthEngine } = require('./telegram/telegramAuthEngine.cjs');
const { TelegramMediaTracksService } = require('./telegram/telegramMediaTracks.cjs');
const { TelegramMessagingAndPostsService } = require('./telegram/telegramMessagingAndPosts.cjs');

class TelegramMTProtoService {
  constructor(dataManager, userDataPath) {
    this.configStore = new TelegramConfigStore(dataManager, userDataPath);
    this.entityResolver = new TelegramEntityResolver(this.configStore);
    this.authEngine = new TelegramAuthEngine(this.configStore, this.entityResolver);
    this.mediaTracks = new TelegramMediaTracksService(
      this.configStore,
      this.entityResolver,
      this.authEngine
    );
    this.messaging = new TelegramMessagingAndPostsService(
      this.configStore,
      this.entityResolver,
      this.authEngine
    );
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      await this.configStore.load();
      this.configStore.addLog('info', 'Init', 'Модульный клиент Telegram инициализирован');

      if (this.configStore.settings.sessionString) {
        await this.authEngine.connectWithSavedSession();
      }
      if (this.configStore.settings.botToken && !this.configStore.settings.botMe) {
        this.authEngine.testBotConnection(this.configStore.settings.botToken).catch(() => {});
      }
    })();
    return this._initPromise;
  }

  getStatus() {
    const publicSettings = this.configStore.getPublicSettings();
    const botConnected = Boolean(
      this.configStore.settings.botToken &&
        String(this.configStore.settings.botToken).trim().length > 10
    );

    return {
      status: this.authEngine.status,
      me: this.authEngine.me,
      botConnected,
      botMe: this.configStore.settings.botMe || null,
      passwordHint: this.authEngine.passwordHint || this.authEngine.qrState.passwordHint || '',
      settings: publicSettings
    };
  }

  async getStatusAsync() {
    await this.init();
    if (
      this.authEngine.status === 'disconnected' &&
      this.configStore.settings.sessionString &&
      String(this.configStore.settings.sessionString).trim().length > 10
    ) {
      await this.authEngine.connectWithSavedSession();
    }
    return this.getStatus();
  }

  async connectWithSavedSession() {
    await this.init();
    return await this.authEngine.connectWithSavedSession();
  }

  async saveSettings(newSettings) {
    await this.init();
    return await this.configStore.save(newSettings);
  }

  // Auth methods
  async startQrCodeAuth(apiId, apiHash) {
    await this.init();
    return await this.authEngine.startQrCodeAuth(apiId, apiHash);
  }

  async getQrAuthStatus(forceRefresh = false) {
    await this.init();
    return await this.authEngine.getQrAuthStatus(forceRefresh);
  }

  cancelQrCodeAuth() {
    return this.authEngine.cancelQrCodeAuth();
  }

  async sendCode(phoneNumber, apiId, apiHash, forceSMS = false) {
    await this.init();
    return await this.authEngine.sendCode(phoneNumber, apiId, apiHash, forceSMS);
  }

  async resendCode(forceSMS = true) {
    await this.init();
    return await this.authEngine.resendCode(forceSMS);
  }

  async signIn(phoneCode, password = '') {
    await this.init();
    return await this.authEngine.signIn(phoneCode, password);
  }

  async submit2FAPassword(password) {
    await this.init();
    return await this.authEngine.submit2FAPassword(password);
  }

  async importSessionString(sessionString, apiId, apiHash) {
    await this.init();
    return await this.authEngine.importSessionString(sessionString, apiId, apiHash);
  }

  exportSessionString() {
    return this.authEngine.exportSessionString();
  }

  async logout() {
    await this.init();
    return await this.authEngine.logout();
  }

  async testBotConnection(botToken) {
    await this.init();
    return await this.authEngine.testBotConnection(botToken);
  }

  async testConnection() {
    await this.init();
    return await this.authEngine.testConnection();
  }

  // Dialogs & Forum Topics
  async getDialogs(limit = 100) {
    await this.init();
    const ok = await this.authEngine.ensureConnected();
    if (!ok || !this.authEngine.client) {
      return [];
    }
    return await this.entityResolver.getDialogs(this.authEngine.client, limit);
  }

  async getForumTopics(chatPeer, limit = 100) {
    await this.init();
    const ok = await this.authEngine.ensureConnected();
    if (!ok || !this.authEngine.client) {
      return { success: true, isForum: false, topics: [] };
    }
    return await this.entityResolver.getForumTopics(this.authEngine.client, chatPeer, limit);
  }

  // Audio tracks & media downloads
  async getChatAudioFiles(params) {
    await this.init();
    return await this.mediaTracks.getChatAudioFiles(params);
  }

  async downloadChatAudioFile(params) {
    await this.init();
    return await this.mediaTracks.downloadChatAudioFile(params);
  }

  // Messaging, posts, automations, search
  async getChatMessages(params) {
    await this.init();
    return await this.messaging.getChatMessages(params);
  }

  async sendPost(params) {
    await this.init();
    return await this.messaging.sendPost(params);
  }

  async sendAutomationNotification(params) {
    await this.init();
    return await this.messaging.sendAutomationNotification(params);
  }

  async searchChannelPosts(params) {
    await this.init();
    return await this.messaging.searchChannelPosts(params);
  }

  // Logs & cleanup
  getLogs(limit = 150) {
    return this.configStore.getLogs(limit);
  }

  clearLogs() {
    return this.configStore.clearLogs();
  }

  async disconnect() {
    await this.authEngine.disconnectClient();
  }
}

module.exports = TelegramMTProtoService;
