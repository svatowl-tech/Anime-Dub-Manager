const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');

const SUPPORTED_AUDIO_OR_ARCHIVE_EXTENSIONS = [
  '.wav',
  '.flac',
  '.mp3',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.aiff',
  '.wma',
  '.zip',
  '.rar',
  '.7z'
];

function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds) {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

function formatMsgDate(unixTimestamp) {
  if (!unixTimestamp) return '';
  const dt = new Date(Number(unixTimestamp) * 1000);
  const now = new Date();
  const timePart = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (dt.toDateString() === now.toDateString()) {
    return `Сегодня, ${timePart}`;
  }
  const datePart = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${datePart}, ${timePart}`;
}

function sanitizeFileName(rawName) {
  const clean = String(rawName || 'audio_track.wav')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();
  return clean || 'audio_track.wav';
}

class TelegramMediaTracksService {
  constructor(configStore, entityResolver, authEngine) {
    this.configStore = configStore;
    this.entityResolver = entityResolver;
    this.authEngine = authEngine;
  }

  _extractMediaMetadata(msg) {
    if (!msg || !msg.media) return null;
    const doc = msg.media.document || (msg.document ? msg.document : null);
    if (!doc) return null;

    const mimeType = String(doc.mimeType || '').toLowerCase();
    const attributes = Array.isArray(doc.attributes) ? doc.attributes : [];

    let fileName = '';
    let duration = 0;
    let isVoice = false;

    for (const attr of attributes) {
      const cls = attr.className || '';
      if (cls === 'DocumentAttributeFilename' && attr.fileName) {
        fileName = String(attr.fileName);
      } else if (cls === 'DocumentAttributeAudio') {
        duration = Number(attr.duration || 0);
        if (attr.voice) isVoice = true;
        if (!fileName && attr.title) {
          const performer = attr.performer ? `${attr.performer} - ` : '';
          fileName = `${performer}${attr.title}`;
        }
      }
    }

    const lowerFileName = fileName.toLowerCase();
    const hasAudioOrArchiveExt = SUPPORTED_AUDIO_OR_ARCHIVE_EXTENSIONS.some((ext) =>
      lowerFileName.endsWith(ext)
    );
    const isAudioMime =
      mimeType.startsWith('audio/') ||
      mimeType === 'application/ogg' ||
      mimeType.includes('zip') ||
      mimeType.includes('rar') ||
      mimeType.includes('7z') ||
      mimeType.includes('flac') ||
      mimeType.includes('wav');

    if (!isVoice && !hasAudioOrArchiveExt && !isAudioMime) {
      return null;
    }

    if (!fileName) {
      const ext = isVoice
        ? '.ogg'
        : mimeType.includes('wav')
        ? '.wav'
        : mimeType.includes('flac')
        ? '.flac'
        : mimeType.includes('mp3') || mimeType.includes('mpeg')
        ? '.mp3'
        : mimeType.includes('zip')
        ? '.zip'
        : '.wav';
      fileName = `${isVoice ? 'voice' : 'track'}_${msg.id}${ext}`;
    }

    const sizeBytes = Number(doc.size || 0);
    const replyToTopId =
      msg.replyTo?.replyToTopId || msg.replyTo?.replyToMsgId || undefined;

    return {
      fileName: sanitizeFileName(fileName),
      mimeType: mimeType || 'audio/wav',
      size: sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      duration,
      durationFormatted: duration > 0 ? formatDuration(duration) : undefined,
      isVoice,
      topicId: replyToTopId ? Number(replyToTopId) : undefined
    };
  }

  async getChatAudioFiles({ chatPeer, topicId, limit = 100 } = {}) {
    const isOk = await this.authEngine.ensureConnected();
    if (!isOk || !this.authEngine.client) {
      throw new Error('Подключите аккаунт Telegram MTProto для сканирования аудиодорожек в чатах');
    }

    const client = this.authEngine.client;
    const inputPeer = await this.entityResolver.resolvePeer(client, chatPeer);

    const fetchLimit = Math.min(250, Math.max(30, Number(limit) || 100));
    const numericTopicId = topicId ? Number(topicId) : null;

    this.configStore.addLog(
      'info',
      'Tracks',
      `Сканирование аудиофайлов в чате ${chatPeer}${numericTopicId ? ` (Тема #${numericTopicId})` : ''}...`
    );

    const getMessagesParams = {
      limit: fetchLimit
    };
    if (numericTopicId && !Number.isNaN(numericTopicId)) {
      getMessagesParams.replyTo = numericTopicId;
    }

    const messages = await client.getMessages(inputPeer, getMessagesParams);
    const files = [];

    for (const msg of messages) {
      if (!msg || !msg.media) continue;
      const meta = this._extractMediaMetadata(msg);
      if (!meta) continue;

      let senderName = 'Участник';
      let senderUsername = '';
      let senderId = '';

      const sender = msg.sender || msg._sender;
      if (sender) {
        senderId = String(sender.id || '');
        senderName =
          [sender.firstName, sender.lastName].filter(Boolean).join(' ') ||
          sender.title ||
          sender.username ||
          `ID ${senderId}`;
        senderUsername = sender.username || '';
      } else if (msg.fromId) {
        senderId = String(msg.fromId.userId || msg.fromId.channelId || '');
        senderName = `ID ${senderId}`;
      }

      files.push({
        id: Number(msg.id),
        date: Number(msg.date || 0),
        dateFormatted: formatMsgDate(msg.date),
        sender: {
          id: senderId,
          name: senderName,
          username: senderUsername
        },
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        size: meta.size,
        sizeFormatted: meta.sizeFormatted,
        duration: meta.duration,
        durationFormatted: meta.durationFormatted,
        isVoice: meta.isVoice,
        topicId: meta.topicId,
        caption: String(msg.message || '').trim()
      });
    }

    this.configStore.addLog(
      'info',
      'Tracks',
      `Найдено аудиофайлов и архивов в ${chatPeer}: ${files.length}`
    );

    return {
      success: true,
      files
    };
  }

  async downloadChatAudioFile({ chatPeer, messageId, targetDir, customFileName } = {}) {
    const isOk = await this.authEngine.ensureConnected();
    if (!isOk || !this.authEngine.client) {
      throw new Error('Telegram MTProto не подключен');
    }

    const client = this.authEngine.client;
    const inputPeer = await this.entityResolver.resolvePeer(client, chatPeer);
    const msgIdNum = Number(messageId);
    if (!msgIdNum || Number.isNaN(msgIdNum)) {
      throw new Error('Некорректный ID сообщения для скачивания');
    }

    const messages = await client.getMessages(inputPeer, { ids: [msgIdNum] });
    const msg = messages && messages[0];
    if (!msg || !msg.media) {
      throw new Error(`Сообщение #${msgIdNum} с медиафайлом не найдено в чате`);
    }

    const meta = this._extractMediaMetadata(msg) || {
      fileName: `telegram_audio_${msgIdNum}.wav`
    };

    const destFolder =
      targetDir && String(targetDir).trim()
        ? path.resolve(String(targetDir).trim())
        : path.join(this.configStore.userDataPath, 'downloads', 'telegram_tracks');

    await fs.promises.mkdir(destFolder, { recursive: true });

    const finalFileName = sanitizeFileName(customFileName || meta.fileName);
    const outputFilePath = path.join(destFolder, finalFileName);

    this.configStore.addLog(
      'info',
      'Download',
      `Скачивание файла «${finalFileName}» (сообщение #${msgIdNum})...`
    );

    await client.downloadMedia(msg, {
      outputFile: outputFilePath
    });

    const stat = await fs.promises.stat(outputFilePath);
    this.configStore.addLog(
      'info',
      'Download',
      `Файл сохранен: ${outputFilePath} (${formatBytes(stat.size)})`
    );

    return {
      success: true,
      filePath: outputFilePath,
      fileName: finalFileName,
      fileSize: stat.size
    };
  }
}

module.exports = {
  TelegramMediaTracksService
};
