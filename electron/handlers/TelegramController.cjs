const { ipcMain } = require('electron');
const { wrapIpcHandler } = require('../lib/IpcWrapper.cjs');
const TelegramMTProtoService = require('../services/TelegramMTProtoService.cjs');

let tgServiceInstance = null;

function getTelegramService(getData, saveData, userDataPath) {
  if (!tgServiceInstance) {
    const dataManager = { getData, saveData };
    tgServiceInstance = new TelegramMTProtoService(dataManager, userDataPath);
    tgServiceInstance.init().catch(err => {
      console.error('[TelegramController] Service init error:', err);
    });
  }
  return tgServiceInstance;
}

function registerTelegramHandlers(getData, saveData, userDataPath) {
  const service = getTelegramService(getData, saveData, userDataPath);

  ipcMain.handle('telegram-mtproto-get-status', wrapIpcHandler(async () => {
    return service.getStatus();
  }));

  ipcMain.handle('telegram-mtproto-save-settings', wrapIpcHandler(async (event, newSettings) => {
    return await service.saveSettings(newSettings);
  }));

  ipcMain.handle('telegram-mtproto-send-code', wrapIpcHandler(async (event, { phoneNumber, apiId, apiHash, forceSMS }) => {
    if (!phoneNumber) throw new Error('Номер телефона обязателен (напр. +79991234567)');
    return await service.sendCode(phoneNumber, apiId, apiHash, forceSMS);
  }));

  ipcMain.handle('telegram-mtproto-resend-code', wrapIpcHandler(async (event, { forceSMS } = {}) => {
    return await service.resendCode(forceSMS !== false);
  }));

  ipcMain.handle('telegram-mtproto-sign-in', wrapIpcHandler(async (event, { phoneCode, password }) => {
    if (!phoneCode) throw new Error('Код подтверждения обязателен');
    return await service.signIn(phoneCode, password);
  }));

  ipcMain.handle('telegram-mtproto-start-qr', wrapIpcHandler(async (event, { apiId, apiHash } = {}) => {
    return await service.startQrCodeAuth(apiId, apiHash);
  }));

  ipcMain.handle('telegram-mtproto-check-qr', wrapIpcHandler(async () => {
    return await service.getQrAuthStatus();
  }));

  ipcMain.handle('telegram-mtproto-cancel-qr', wrapIpcHandler(async () => {
    return service.cancelQrCodeAuth();
  }));

  ipcMain.handle('telegram-mtproto-submit-password', wrapIpcHandler(async (event, { password }) => {
    if (!password) throw new Error('Пароль обязателен');
    return await service.submit2FAPassword(password);
  }));

  ipcMain.handle('telegram-mtproto-logout', wrapIpcHandler(async () => {
    return await service.logout();
  }));

  ipcMain.handle('telegram-mtproto-get-dialogs', wrapIpcHandler(async (event, { limit } = {}) => {
    try {
      return await service.getDialogs(limit || 50);
    } catch (err) {
      if (String(err).includes('AUTH_KEY_UNREGISTERED') || String(err).includes('Сессия Telegram устарела')) {
        return [];
      }
      throw err;
    }
  }));

  ipcMain.handle('telegram-mtproto-send-post', wrapIpcHandler(async (event, postParams) => {
    if (!postParams || !postParams.text) throw new Error('Текст поста обязателен');
    const targetPeer = postParams.targetPeer || postParams.chatPeer || postParams.chatId || postParams.channelId;
    return await service.sendPost({ ...postParams, targetPeer });
  }));

  ipcMain.handle('telegram-mtproto-send-automation', wrapIpcHandler(async (event, params) => {
    if (!params || !params.type) throw new Error('Тип автоматизации обязателен');
    const targetPeer = params.targetPeer || params.chatPeer || params.chatId;
    return await service.sendAutomationNotification({ ...params, targetPeer });
  }));

  ipcMain.handle('telegram-mtproto-search-posts', wrapIpcHandler(async (event, params) => {
    const peer = params?.channelPeer || params?.channelId || params?.targetPeer || params?.chatId;
    return await service.searchChannelPosts({
      channelPeer: peer,
      query: params?.query || '',
      limit: params?.limit || 50
    });
  }));

  ipcMain.handle('telegram-mtproto-get-audio-files', wrapIpcHandler(async (event, params) => {
    const peer = params?.chatPeer || params?.chatId || params?.peer;
    if (!peer) throw new Error('Чат обязателен');
    return await service.getChatAudioFiles({
      chatPeer: peer,
      limit: params?.limit || 50
    });
  }));

  ipcMain.handle('telegram-mtproto-get-messages', wrapIpcHandler(async (event, params) => {
    const peer = params?.chatPeer || params?.chatId || params?.peer;
    if (!peer) throw new Error('Чат обязателен');
    return await service.getChatMessages({
      chatPeer: peer,
      limit: params?.limit || 40
    });
  }));

  ipcMain.handle('telegram-mtproto-download-audio', wrapIpcHandler(async (event, params) => {
    const peer = params?.chatPeer || params?.chatId || params?.peer;
    const msgId = params?.messageId || params?.id;
    if (!peer || !msgId) {
      throw new Error('Идентификатор сообщения и чат обязательны');
    }
    return await service.downloadChatAudioFile({
      chatPeer: peer,
      messageId: msgId,
      targetDir: params?.targetDir,
      customFileName: params?.customFileName || params?.fileName
    });
  }));

  ipcMain.handle('telegram-bot-test-connection', wrapIpcHandler(async (event, { botToken } = {}) => {
    return await service.testBotConnection(botToken);
  }));
}

async function cleanupTelegramHandlers() {
  if (tgServiceInstance) {
    await tgServiceInstance.disconnect();
    tgServiceInstance = null;
  }
}

module.exports = {
  registerTelegramHandlers,
  getTelegramService,
  cleanupTelegramHandlers
};
