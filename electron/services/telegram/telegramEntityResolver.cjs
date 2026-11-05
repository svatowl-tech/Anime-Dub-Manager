const { Api } = require('telegram');
const bigInt = require('big-integer');

function toBigInt(value) {
  if (value === undefined || value === null || value === '') return bigInt(0);
  if (bigInt.isInstance(value)) return value;
  if (typeof value === 'bigint') return bigInt(value.toString());
  const str = String(value).trim();
  try {
    return bigInt(str);
  } catch {
    return bigInt(0);
  }
}

function normalizePeerInput(rawPeer) {
  if (!rawPeer) return '';
  let str = String(rawPeer).trim();
  const tmeMatch = str.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([a-zA-Z0-9_+]+)/i);
  if (tmeMatch && tmeMatch[1]) {
    const slug = tmeMatch[1];
    if (!slug.startsWith('+')) {
      return `@${slug}`;
    }
  }
  return str;
}

class TelegramEntityResolver {
  constructor(configStore) {
    this.configStore = configStore;
    this.dialogEntities = new Map();
    this.lastDialogsList = [];
  }

  clearCache() {
    this.dialogEntities.clear();
    this.lastDialogsList = [];
  }

  rememberEntity(dialogId, entity, forcedType = null) {
    if (!entity) return;
    const rawEntityId = entity.id !== undefined ? String(entity.id) : String(dialogId || '');
    const className = entity.className || '';
    const isChannel =
      forcedType === 'channel' ||
      className === 'Channel' ||
      Boolean(entity.broadcast) ||
      Boolean(entity.megagroup);
    const isChat = forcedType === 'chat' || className === 'Chat';
    const isUser = forcedType === 'user' || className === 'User';

    let canonicalDialogId = String(dialogId || rawEntityId);
    if (isChannel && !canonicalDialogId.startsWith('-100') && /^\d+$/.test(rawEntityId)) {
      canonicalDialogId = `-100${rawEntityId}`;
    } else if (isChat && !canonicalDialogId.startsWith('-') && /^\d+$/.test(rawEntityId)) {
      canonicalDialogId = `-${rawEntityId}`;
    }

    this.dialogEntities.set(canonicalDialogId, entity);
    this.dialogEntities.set(rawEntityId, entity);

    const username = entity.username ? String(entity.username).replace(/^@/, '') : '';
    if (username) {
      this.dialogEntities.set(`@${username.toLowerCase()}`, entity);
      this.dialogEntities.set(username.toLowerCase(), entity);
    }

    const accessHash =
      entity.accessHash !== undefined && entity.accessHash !== null
        ? String(entity.accessHash)
        : null;

    const record = {
      id: canonicalDialogId,
      rawId: rawEntityId,
      accessHash,
      type: isChannel ? 'channel' : isChat ? 'chat' : isUser ? 'user' : 'channel',
      title:
        entity.title ||
        [entity.firstName, entity.lastName].filter(Boolean).join(' ') ||
        username ||
        canonicalDialogId,
      username,
      isForum: Boolean(entity.forum)
    };

    this.configStore.cachePeerRecord(canonicalDialogId, record);
    if (username) {
      this.configStore.cachePeerRecord(`@${username.toLowerCase()}`, record);
    }
  }

  buildInputPeerFromRecord(record) {
    if (!record || !record.id) return null;
    const idStr = String(record.id);

    if (record.type === 'channel' || idStr.startsWith('-100')) {
      const cleanChannelId = idStr.replace(/^-100/, '').replace(/^-/, '');
      if (!record.accessHash) return null;
      return new Api.InputPeerChannel({
        channelId: toBigInt(cleanChannelId),
        accessHash: toBigInt(record.accessHash)
      });
    }

    if (record.type === 'chat' || (idStr.startsWith('-') && !idStr.startsWith('-100'))) {
      const cleanChatId = idStr.replace(/^-/, '');
      return new Api.InputPeerChat({
        chatId: toBigInt(cleanChatId)
      });
    }

    if (record.type === 'user' && record.accessHash) {
      return new Api.InputPeerUser({
        userId: toBigInt(idStr.replace(/^-/, '')),
        accessHash: toBigInt(record.accessHash)
      });
    }

    return null;
  }

  async resolvePeer(client, rawPeer) {
    if (!client) {
      throw new Error('Telegram клиент не инициализирован');
    }

    const peerStr = normalizePeerInput(rawPeer);
    if (!peerStr) {
      throw new Error('Не указан идентификатор чата или канала');
    }

    if (peerStr === 'me' || peerStr === 'self') {
      return new Api.InputPeerSelf();
    }

    // 1. Check in-memory entity cache
    const directEntity =
      this.dialogEntities.get(peerStr) ||
      this.dialogEntities.get(peerStr.toLowerCase()) ||
      this.dialogEntities.get(peerStr.replace(/^@/, '').toLowerCase());

    if (directEntity) {
      try {
        return await client.getInputEntity(directEntity);
      } catch {
        // Fall through to manual InputPeer construction
      }
    }

    // 2. Check persistent peerCache (survives restarts without needing getDialogs first)
    const cachedRecord = this.configStore.getCachedPeerRecord(peerStr);
    if (cachedRecord) {
      const built = this.buildInputPeerFromRecord(cachedRecord);
      if (built) {
        return built;
      }
    }

    // 3. If @username, resolve via contacts.ResolveUsername
    if (peerStr.startsWith('@') || /^[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(peerStr)) {
      const cleanUsername = peerStr.replace(/^@/, '');
      try {
        const resolved = await client.invoke(
          new Api.contacts.ResolveUsername({ username: cleanUsername })
        );
        const entity =
          (resolved.chats && resolved.chats[0]) || (resolved.users && resolved.users[0]);
        if (entity) {
          this.rememberEntity(null, entity);
          await this.configStore.save();
          return await client.getInputEntity(entity);
        }
      } catch (err) {
        this.configStore.addLog(
          'warn',
          'Resolver',
          `Не удалось разрешить @${cleanUsername} через ResolveUsername: ${err.message}`
        );
      }
    }

    // 4. Try GramJS getInputEntity directly
    try {
      if (/^-?\d+$/.test(peerStr)) {
        return await client.getInputEntity(toBigInt(peerStr));
      }
      return await client.getInputEntity(peerStr);
    } catch {
      // 5. Warm up dialogs cache and retry
      this.configStore.addLog(
        'info',
        'Resolver',
        `Кэш для ${peerStr} пуст, подгружаем список диалогов...`
      );
      await this.getDialogs(client, 120);

      const warmedEntity =
        this.dialogEntities.get(peerStr) ||
        this.dialogEntities.get(peerStr.toLowerCase()) ||
        this.dialogEntities.get(peerStr.replace(/^-100/, ''));

      if (warmedEntity) {
        return await client.getInputEntity(warmedEntity);
      }

      const warmedRecord = this.configStore.getCachedPeerRecord(peerStr);
      if (warmedRecord) {
        const built = this.buildInputPeerFromRecord(warmedRecord);
        if (built) return built;
      }
    }

    throw new Error(
      `Не удалось найти чат или канал «${peerStr}». Убедитесь, что аккаунт состоит в этом чате или укажите публичный @username.`
    );
  }

  async getDialogs(client, limit = 100) {
    if (!client) {
      throw new Error('Telegram MTProto не подключен');
    }

    const dialogs = await client.getDialogs({ limit: Math.min(200, Math.max(20, Number(limit) || 100)) });
    const result = [];

    for (const d of dialogs) {
      const entity = d.entity;
      const dialogId = String(d.id || (entity && entity.id) || '');
      if (!dialogId) continue;

      if (entity) {
        this.rememberEntity(dialogId, entity);
      }

      const isChannel = Boolean(d.isChannel && (!entity || !entity.megagroup));
      const isGroup = Boolean(d.isGroup || (entity && entity.megagroup));
      const isUser = Boolean(d.isUser);
      const isForum = Boolean(entity && entity.forum);

      let dateStr = '';
      if (d.message && d.message.date) {
        const msgDate = new Date(d.message.date * 1000);
        const now = new Date();
        if (msgDate.toDateString() === now.toDateString()) {
          dateStr = msgDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else {
          dateStr = msgDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        }
      }

      result.push({
        id: dialogId,
        title: d.title || d.name || 'Без названия',
        username: entity && entity.username ? String(entity.username) : '',
        isChannel,
        isGroup,
        isUser,
        isForum,
        unreadCount: Number(d.unreadCount || 0),
        type: isChannel ? 'channel' : isGroup ? 'group' : isUser ? 'user' : 'chat',
        lastMessage: d.message && d.message.message ? String(d.message.message).slice(0, 140) : '',
        date: dateStr
      });
    }

    this.lastDialogsList = result;
    await this.configStore.save();
    this.configStore.addLog('info', 'Dialogs', `Загружено диалогов: ${result.length}`);
    return result;
  }

  async getForumTopics(client, chatPeer, limit = 100) {
    if (!client) {
      throw new Error('Telegram MTProto не подключен');
    }

    const inputPeer = await this.resolvePeer(client, chatPeer);
    try {
      const res = await client.invoke(
        new Api.channels.GetForumTopics({
          channel: inputPeer,
          offsetDate: 0,
          offsetId: 0,
          offsetTopic: 0,
          limit: Math.min(100, Number(limit) || 100)
        })
      );

      const topics = Array.isArray(res?.topics) ? res.topics : [];
      const mapped = topics
        .filter((t) => t && t.id !== undefined && t.title)
        .map((t) => ({
          id: Number(t.id),
          title: String(t.title || `Тема #${t.id}`),
          iconColor: t.iconColor || 0,
          iconEmojiId: t.iconEmojiId ? String(t.iconEmojiId) : undefined,
          unreadCount: Number(t.unreadCount || 0),
          isClosed: Boolean(t.closed),
          isPinned: Boolean(t.pinned)
        }));

      this.configStore.addLog(
        'info',
        'Topics',
        `Загружено тем форума для ${chatPeer}: ${mapped.length}`
      );
      return {
        success: true,
        isForum: mapped.length > 0,
        topics: mapped
      };
    } catch (err) {
      const msg = String(err?.errorMessage || err?.message || err);
      if (
        msg.includes('CHANNEL_FORUM_MISSING') ||
        msg.includes('CHAT_INVALID') ||
        msg.includes('CHANNEL_INVALID')
      ) {
        return { success: true, isForum: false, topics: [] };
      }
      this.configStore.addLog('warn', 'Topics', `Чат ${chatPeer} не использует темы: ${msg}`);
      return { success: true, isForum: false, topics: [] };
    }
  }
}

module.exports = {
  TelegramEntityResolver,
  toBigInt,
  normalizePeerInput
};
