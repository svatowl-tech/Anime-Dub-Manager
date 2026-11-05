const fs = require('fs');
const https = require('https');
const { Api } = require('telegram');

function fetchHttpsHtml(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 4) {
      return reject(new Error('Too many redirects'));
    }
    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 12000
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const nextUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `https://t.me${res.headers.location}`;
          return resolve(fetchHttpsHtml(nextUrl, redirectCount + 1));
        }

        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve(body));
      }
    );
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout fetching public Telegram channel page'));
    });
  });
}

function stripHtmlTags(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function parsePublicWebPreviewPosts(html, channelUsername, query = '', limit = 50) {
  const posts = [];
  const cleanChannel = String(channelUsername || '').replace(/^@/, '').trim();
  const blocks = String(html || '').split('tgme_widget_message_wrap');

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const postMatch = block.match(/data-post="[^/"]+\/(\d+)"/i);
    if (!postMatch) continue;

    const postId = Number(postMatch[1]);
    if (!postId) continue;

    const textMatch = block.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    const text = textMatch ? stripHtmlTags(textMatch[1]) : '';

    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/i);
    const isoDate = timeMatch ? timeMatch[1] : '';
    const unixDate = isoDate ? Math.floor(new Date(isoDate).getTime() / 1000) : Math.floor(Date.now() / 1000);

    const viewsMatch = block.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/i);
    let views = 0;
    if (viewsMatch && viewsMatch[1]) {
      const rawV = viewsMatch[1].trim().toUpperCase();
      if (rawV.endsWith('K')) {
        views = Math.round(parseFloat(rawV) * 1000);
      } else if (rawV.endsWith('M')) {
        views = Math.round(parseFloat(rawV) * 1000000);
      } else {
        views = parseInt(rawV.replace(/[^\d]/g, ''), 10) || 0;
      }
    }

    const hasMedia =
      block.includes('tgme_widget_message_photo') ||
      block.includes('tgme_widget_message_video') ||
      block.includes('tgme_widget_message_document');

    const dt = new Date(unixDate * 1000);
    const dateFormatted = dt.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    posts.push({
      id: postId,
      date: unixDate,
      dateFormatted,
      text,
      views,
      forwards: 0,
      hasMedia,
      link: `https://t.me/${cleanChannel}/${postId}`
    });
  }

  posts.sort((a, b) => b.id - a.id);

  const q = String(query || '').trim().toLowerCase();
  const filtered = q
    ? posts.filter((p) => p.text.toLowerCase().includes(q) || String(p.id) === q)
    : posts;

  return filtered.slice(0, Math.max(1, Number(limit) || 50));
}

class TelegramMessagingAndPostsService {
  constructor(configStore, entityResolver, authEngine) {
    this.configStore = configStore;
    this.entityResolver = entityResolver;
    this.authEngine = authEngine;
  }

  async getChatMessages({ chatPeer, topicId, limit = 50 } = {}) {
    const isOk = await this.authEngine.ensureConnected();
    if (!isOk || !this.authEngine.client) {
      throw new Error('Подключите аккаунт Telegram MTProto для чтения сообщений чата');
    }

    const client = this.authEngine.client;
    const inputPeer = await this.entityResolver.resolvePeer(client, chatPeer);
    const fetchLimit = Math.min(150, Math.max(10, Number(limit) || 50));
    const numericTopicId = topicId ? Number(topicId) : null;

    const params = { limit: fetchLimit };
    if (numericTopicId && !Number.isNaN(numericTopicId)) {
      params.replyTo = numericTopicId;
    }

    const rawMessages = await client.getMessages(inputPeer, params);
    const formatted = [];

    for (const msg of rawMessages) {
      if (!msg) continue;
      const text = String(msg.message || '').trim();
      const hasMedia = Boolean(msg.media);
      if (!text && !hasMedia) continue;

      const isMe = Boolean(msg.out);
      let senderName = isMe ? 'Вы' : 'Участник';
      const sender = msg.sender || msg._sender;
      if (!isMe && sender) {
        senderName =
          [sender.firstName, sender.lastName].filter(Boolean).join(' ') ||
          sender.title ||
          (sender.username ? `@${sender.username}` : 'Участник');
      }

      let mediaLabel = undefined;
      if (hasMedia) {
        const doc = msg.media?.document;
        const attrs = Array.isArray(doc?.attributes) ? doc.attributes : [];
        const fnAttr = attrs.find((a) => a.className === 'DocumentAttributeFilename');
        mediaLabel = fnAttr?.fileName || (msg.media?.photo ? 'photo.jpg' : 'media_attachment');
      }

      const dt = msg.date ? new Date(msg.date * 1000) : new Date();
      const timeStr = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

      formatted.push({
        id: String(msg.id),
        senderName,
        text: text || (mediaLabel ? `📎 Медиафайл: ${mediaLabel}` : ''),
        time: timeStr,
        isMe,
        mediaPath: mediaLabel,
        isPinned: Boolean(msg.pinned),
        topicId: msg.replyTo?.replyToTopId || msg.replyTo?.replyToMsgId || undefined
      });
    }

    formatted.reverse();
    return {
      success: true,
      messages: formatted
    };
  }

  async sendPost({
    targetPeer,
    topicId,
    text,
    parseMode = 'html',
    silent = false,
    pin = false,
    scheduleDate,
    mediaPath
  } = {}) {
    const peerStr = String(targetPeer || this.configStore.settings.defaultChannelId || '').trim();
    if (!peerStr) {
      throw new Error('Укажите целевой канал или чат (@username или ID)');
    }

    const numericTopicId = topicId ? Number(topicId) : undefined;
    const isConnected = await this.authEngine.ensureConnected();

    // 1. Send via MTProto if connected
    if (isConnected && this.authEngine.client) {
      const client = this.authEngine.client;
      const inputPeer = await this.entityResolver.resolvePeer(client, peerStr);

      let scheduleTs = undefined;
      if (scheduleDate) {
        const parsedTime = new Date(scheduleDate).getTime();
        if (!Number.isNaN(parsedTime) && parsedTime > Date.now() + 15000) {
          scheduleTs = Math.floor(parsedTime / 1000);
        }
      }

      const sendOptions = {
        message: String(text || ''),
        parseMode: parseMode === 'md' ? 'markdown' : 'html',
        silent: Boolean(silent),
        schedule: scheduleTs
      };

      if (numericTopicId && !Number.isNaN(numericTopicId)) {
        sendOptions.replyTo = numericTopicId;
      }

      if (mediaPath && String(mediaPath).trim() && fs.existsSync(String(mediaPath).trim())) {
        sendOptions.file = String(mediaPath).trim();
      }

      const sentMsg = await client.sendMessage(inputPeer, sendOptions);

      if (pin && sentMsg && sentMsg.id && !scheduleTs) {
        try {
          await client.pinMessage(inputPeer, sentMsg.id, { notify: !silent });
        } catch (pinErr) {
          this.configStore.addLog(
            'warn',
            'Post',
            `Сообщение отправлено, но закрепить не удалось: ${pinErr.message}`
          );
        }
      }

      this.configStore.addLog(
        'info',
        'Post',
        `Сообщение отправлено через MTProto в ${peerStr} (ID: ${sentMsg?.id || 'ok'})`
      );

      return {
        success: true,
        via: 'mtproto',
        messageId: sentMsg?.id || Date.now()
      };
    }

    // 2. Fallback to Bot API if botToken is configured
    const botToken = String(this.configStore.settings.botToken || '').trim();
    if (botToken) {
      const payload = {
        chat_id: peerStr,
        text: String(text || ''),
        parse_mode: parseMode === 'md' ? 'Markdown' : 'HTML',
        disable_notification: Boolean(silent)
      };
      if (numericTopicId && !Number.isNaN(numericTopicId)) {
        payload.message_thread_id = numericTopicId;
      }

      const sent = await this.authEngine.callBotApiJson(botToken, 'sendMessage', payload);
      if (pin && sent && sent.message_id) {
        try {
          await this.authEngine.callBotApiJson(botToken, 'pinChatMessage', {
            chat_id: peerStr,
            message_id: sent.message_id,
            disable_notification: Boolean(silent)
          });
        } catch {}
      }

      this.configStore.addLog(
        'info',
        'BotAPI',
        `Сообщение отправлено через Bot API в ${peerStr} (ID: ${sent?.message_id})`
      );

      return {
        success: true,
        via: 'bot',
        messageId: sent?.message_id || Date.now()
      };
    }

    throw new Error(
      'Telegram не подключен. Войдите в аккаунт (QR / Телефон / StringSession) или подключите Bot Token.'
    );
  }

  async sendAutomationNotification({
    type,
    targetPeer,
    topicId,
    payload = {},
    customTemplate,
    pin = false,
    silent = false
  } = {}) {
    const settings = this.configStore.settings;
    let template = customTemplate;

    if (!template) {
      if (type === 'start') template = settings.startNoticeTemplate;
      else if (type === 'reminder') template = settings.reminderTemplate;
      else if (type === 'fix') template = settings.fixNoticeTemplate;
      else if (type === 'track') template = settings.trackReceivedTemplate;
    }

    let messageText = String(template || '');
    for (const [key, val] of Object.entries(payload || {})) {
      const token = `{${key}}`;
      messageText = messageText.split(token).join(String(val ?? ''));
    }

    return await this.sendPost({
      targetPeer,
      topicId,
      text: messageText,
      parseMode: 'html',
      pin,
      silent
    });
  }

  async searchChannelPosts({ channelPeer, query = '', limit = 50 } = {}) {
    const rawPeer = String(channelPeer || this.configStore.settings.defaultChannelId || '').trim();
    if (!rawPeer) {
      throw new Error('Укажите канал для поиска постов');
    }

    // Check if direct post URL like t.me/channel/123
    const directMatch = rawPeer.match(/(?:t\.me\/(?:s\/)?|^@?)([a-zA-Z0-9_]+)\/(\d+)$/i);
    const cleanUsername = directMatch
      ? directMatch[1]
      : rawPeer
          .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?/i, '')
          .replace(/^@/, '')
          .split('/')[0]
          .trim();

    const isConnected = await this.authEngine.ensureConnected();

    // 1. Try MTProto first if connected
    if (isConnected && this.authEngine.client) {
      try {
        const client = this.authEngine.client;
        const peerToResolve = directMatch ? `@${cleanUsername}` : rawPeer;
        const inputPeer = await this.entityResolver.resolvePeer(client, peerToResolve);

        const searchParams = {
          limit: Math.min(100, Math.max(10, Number(limit) || 50))
        };
        if (directMatch && directMatch[2]) {
          searchParams.ids = [Number(directMatch[2])];
        } else if (query && String(query).trim()) {
          searchParams.search = String(query).trim();
        }

        const messages = await client.getMessages(inputPeer, searchParams);
        const posts = [];

        for (const msg of messages) {
          if (!msg || !msg.id) continue;
          const text = String(msg.message || '').trim();
          const hasMedia = Boolean(msg.media);
          if (!text && !hasMedia) continue;

          const dt = msg.date ? new Date(msg.date * 1000) : new Date();
          const dateFormatted = dt.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          const linkSlug = /^[a-zA-Z0-9_]+$/.test(cleanUsername)
            ? cleanUsername
            : `c/${String(rawPeer).replace(/^-100/, '')}`;

          posts.push({
            id: Number(msg.id),
            date: Number(msg.date || 0),
            dateFormatted,
            text,
            views: msg.views !== undefined ? Number(msg.views) : undefined,
            forwards: msg.forwards !== undefined ? Number(msg.forwards) : undefined,
            hasMedia,
            link: `https://t.me/${linkSlug}/${msg.id}`
          });
        }

        this.configStore.addLog(
          'info',
          'Search',
          `MTProto поиск в ${rawPeer}: найдено ${posts.length} постов`
        );

        return {
          success: true,
          source: 'mtproto',
          posts
        };
      } catch (err) {
        this.configStore.addLog(
          'warn',
          'Search',
          `MTProto поиск в ${rawPeer} не удался (${err.message}), пробуем публичный веб-парсер t.me/s/...`
        );
      }
    }

    // 2. Public Web Preview fallback (https://t.me/s/<username>) — works without authentication!
    if (/^[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(cleanUsername)) {
      const searchParam = query ? `?q=${encodeURIComponent(String(query).trim())}` : '';
      const url = `https://t.me/s/${cleanUsername}${searchParam}`;
      this.configStore.addLog('info', 'Public Preview', `Загрузка публичной ленты ${url}...`);

      const html = await fetchHttpsHtml(url);
      const posts = parsePublicWebPreviewPosts(html, cleanUsername, query, limit);

      this.configStore.addLog(
        'info',
        'Public Preview',
        `Публичный парсер нашел ${posts.length} постов в @${cleanUsername}`
      );

      return {
        success: true,
        source: 'public_web',
        posts
      };
    }

    throw new Error(
      'Для поиска по закрытому каналу (по числовому ID) необходим вход в аккаунт Telegram MTProto.'
    );
  }
}

module.exports = {
  TelegramMessagingAndPostsService
};
