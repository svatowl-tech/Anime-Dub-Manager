import crypto from 'crypto';
import axios from 'axios';
import { z } from 'zod';

export const InboxCategorySchema = z.enum([
  'approval',
  'qa_alert',
  'assignment_review',
  'download_issue',
  'release_ready',
  'note',
  'info',
]);

export const InboxSeveritySchema = z.enum(['info', 'warning', 'action_required', 'critical']);

export const InboxStatusSchema = z.enum(['pending', 'approved', 'rejected', 'noted', 'resolved']);

export const CreateInboxItemSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
  category: InboxCategorySchema.default('info'),
  severity: InboxSeveritySchema.default('info'),
  projectId: z.string().optional(),
  projectTitle: z.string().optional(),
  episodeId: z.string().optional(),
  episodeNumber: z.number().optional(),
  targetTab: z
    .enum([
      'dashboard',
      'inbox',
      'video-editor',
      'subtitles',
      'qa',
      'timing',
      'mixing',
      'cover',
      'release',
      'telegram',
      'archive',
      'stats',
      'database',
      'settings',
    ])
    .optional(),
  proposedAction: z.string().max(1000).optional(),
  metadata: z.record(z.any()).optional(),
  source: z.enum(['ai_agent', 'system', 'telegram']).default('ai_agent'),
  notifyTelegram: z.boolean().default(true),
});

export interface CuratorInboxItem {
  id: string;
  title: string;
  message: string;
  category: z.infer<typeof InboxCategorySchema>;
  severity: z.infer<typeof InboxSeveritySchema>;
  status: z.infer<typeof InboxStatusSchema>;
  read: boolean;
  projectId?: string;
  projectTitle?: string;
  episodeId?: string;
  episodeNumber?: number;
  targetTab?: string;
  proposedAction?: string;
  metadata?: Record<string, any>;
  curatorNote?: string;
  source: 'ai_agent' | 'system' | 'telegram';
  telegramMessageId?: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface RespondInboxPayload {
  status?: 'approved' | 'rejected' | 'noted' | 'resolved' | 'pending';
  curatorNote?: string;
  read?: boolean;
}

const INBOX_FILENAME = 'curator_inbox.json';

export class CuratorInboxService {
  private getData: (filename: string) => Promise<any>;
  private saveData: (filename: string, data: any) => Promise<void>;
  private broadcast: (channel: string, data: any) => void;
  private getTelegramService: () => any;
  private defaultCuratorChatId: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdateOffset = 0;
  private isPolling = false;

  constructor(options: {
    getData: (filename: string) => Promise<any>;
    saveData: (filename: string, data: any) => Promise<void>;
    broadcast: (channel: string, data: any) => void;
    getTelegramService: () => any;
    defaultCuratorChatId?: string;
  }) {
    this.getData = options.getData;
    this.saveData = options.saveData;
    this.broadcast = options.broadcast;
    this.getTelegramService = options.getTelegramService;
    this.defaultCuratorChatId = options.defaultCuratorChatId || '';
  }

  private async readAll(): Promise<CuratorInboxItem[]> {
    try {
      const data = await this.getData(INBOX_FILENAME);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private async writeAll(items: CuratorInboxItem[]): Promise<void> {
    const trimmed = items.slice(0, 500);
    await this.saveData(INBOX_FILENAME, trimmed);
    this.broadcast('curator-inbox-updated', {
      unreadCount: trimmed.filter((i) => !i.read || i.status === 'pending').length,
      pendingCount: trimmed.filter((i) => i.status === 'pending').length,
      items: trimmed.slice(0, 50),
    });
  }

  async list(filters?: { status?: string; projectId?: string; limit?: number }): Promise<CuratorInboxItem[]> {
    const items = await this.readAll();
    let result = items;
    if (filters?.status && filters.status !== 'all') {
      result = result.filter((i) => i.status === filters.status);
    }
    if (filters?.projectId) {
      result = result.filter((i) => i.projectId === filters.projectId);
    }
    const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 100));
    return result.slice(0, limit);
  }

  async getById(id: string): Promise<CuratorInboxItem | null> {
    const items = await this.readAll();
    return items.find((i) => i.id === id) || null;
  }

  async getUnreadSummary(): Promise<{ unreadCount: number; pendingCount: number; total: number }> {
    const items = await this.readAll();
    return {
      unreadCount: items.filter((i) => !i.read).length,
      pendingCount: items.filter((i) => i.status === 'pending').length,
      total: items.length,
    };
  }

  async create(rawInput: z.input<typeof CreateInboxItemSchema>): Promise<CuratorInboxItem> {
    const input = CreateInboxItemSchema.parse(rawInput);
    const items = await this.readAll();
    const now = new Date().toISOString();
    const shortId = crypto.randomBytes(4).toString('hex');
    const isActionable =
      input.severity === 'action_required' ||
      input.category === 'approval' ||
      input.category === 'assignment_review' ||
      input.category === 'qa_alert';

    const item: CuratorInboxItem = {
      id: `inbox_${Date.now()}_${shortId}`,
      title: input.title,
      message: input.message,
      category: input.category,
      severity: input.severity,
      status: isActionable ? 'pending' : 'resolved',
      read: false,
      projectId: input.projectId,
      projectTitle: input.projectTitle,
      episodeId: input.episodeId,
      episodeNumber: input.episodeNumber,
      targetTab: input.targetTab,
      proposedAction: input.proposedAction,
      metadata: input.metadata,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      ...(isActionable ? {} : { resolvedAt: now }),
    };

    const next = [item, ...items];
    await this.writeAll(next);

    if (input.notifyTelegram) {
      const msgId = await this.dispatchToTelegram(item).catch((err) => {
        console.warn('[CuratorInbox] Telegram dispatch failed:', err?.message || err);
        return undefined;
      });
      if (msgId) {
        item.telegramMessageId = msgId;
        await this.writeAll(next);
      }
    }

    return item;
  }

  async respond(id: string, payload: RespondInboxPayload): Promise<CuratorInboxItem> {
    const items = await this.readAll();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) {
      throw new Error(`Inbox item not found: ${id}`);
    }

    const current = items[idx];
    const now = new Date().toISOString();
    const nextStatus = payload.status || (payload.curatorNote ? 'noted' : current.status);
    const updated: CuratorInboxItem = {
      ...current,
      status: nextStatus,
      read: payload.read !== undefined ? payload.read : true,
      curatorNote: payload.curatorNote !== undefined ? payload.curatorNote : current.curatorNote,
      updatedAt: now,
      resolvedAt: nextStatus !== 'pending' ? now : undefined,
    };

    items[idx] = updated;
    await this.writeAll(items);
    return updated;
  }

  async markAllRead(): Promise<void> {
    const items = await this.readAll();
    const updated = items.map((i) => ({ ...i, read: true }));
    await this.writeAll(updated);
  }

  async deleteItem(id: string): Promise<boolean> {
    const items = await this.readAll();
    const filtered = items.filter((i) => i.id !== id);
    if (filtered.length === items.length) return false;
    await this.writeAll(filtered);
    return true;
  }

  async clearResolved(): Promise<number> {
    const items = await this.readAll();
    const remaining = items.filter((i) => i.status === 'pending');
    const removed = items.length - remaining.length;
    await this.writeAll(remaining);
    return removed;
  }

  private async resolveTelegramSettings(): Promise<{ botToken: string; curatorChatId: string }> {
    const appConfig = (await this.getData('config.json').catch(() => ({}))) || {};
    const tgService = this.getTelegramService?.();
    const botToken = String(
      appConfig.telegramBotToken ||
        tgService?.configStore?.settings?.botToken ||
        process.env.ADM_TELEGRAM_BOT_TOKEN ||
        ''
    ).trim();
    const curatorChatId = String(
      appConfig.curatorTelegramChatId ||
        this.defaultCuratorChatId ||
        tgService?.configStore?.settings?.curatorChatId ||
        ''
    ).trim();
    return { botToken, curatorChatId };
  }

  private async dispatchToTelegram(item: CuratorInboxItem): Promise<number | undefined> {
    const { botToken, curatorChatId } = await this.resolveTelegramSettings();
    if (!curatorChatId) return undefined;

    const escapeHtml = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const lines = [
      `<b>[ADM Agent] ${escapeHtml(item.title)}</b>`,
      item.projectTitle
        ? `Проект: <b>${escapeHtml(item.projectTitle)}</b>${item.episodeNumber !== undefined ? ` • Серия ${item.episodeNumber}` : ''}`
        : '',
      '',
      escapeHtml(item.message),
      item.proposedAction ? `\n<i>Предложение: ${escapeHtml(item.proposedAction)}</i>` : '',
      `\nID: <code>${escapeHtml(item.id)}</code>`,
    ].filter(Boolean);
    const text = lines.join('\n');

    if (botToken) {
      const payload: Record<string, any> = {
        chat_id: curatorChatId,
        text,
        parse_mode: 'HTML',
      };
      if (item.status === 'pending') {
        payload.reply_markup = {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `inbox:approve:${item.id}` },
              { text: '❌ Отклонить', callback_data: `inbox:reject:${item.id}` },
            ],
          ],
        };
      }
      const res = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload, {
        timeout: 10000,
      });
      return res.data?.result?.message_id;
    }

    const tgService = this.getTelegramService?.();
    if (tgService && typeof tgService.sendPost === 'function') {
      const sent = await tgService.sendPost({
        targetPeer: curatorChatId,
        text,
        parseMode: 'html',
      });
      return sent?.messageId;
    }
    return undefined;
  }

  startTelegramBotPoller(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollTelegramUpdates();
    }, 5000);
  }

  stopTelegramBotPoller(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollTelegramUpdates(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      const appConfig = (await this.getData('config.json').catch(() => ({}))) || {};
      if (appConfig.curatorTelegramBotPolling === false) return;

      const { botToken, curatorChatId } = await this.resolveTelegramSettings();
      if (!botToken || !curatorChatId) return;

      const res = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        params: {
          offset: this.lastUpdateOffset,
          timeout: 0,
          allowed_updates: JSON.stringify(['message', 'callback_query']),
        },
        timeout: 8000,
      });

      const updates = Array.isArray(res.data?.result) ? res.data.result : [];
      for (const upd of updates) {
        this.lastUpdateOffset = Math.max(this.lastUpdateOffset, Number(upd.update_id) + 1);

        if (upd.callback_query) {
          const cq = upd.callback_query;
          const fromChat = String(cq.message?.chat?.id || cq.from?.id || '');
          if (fromChat !== curatorChatId && String(cq.from?.id || '') !== curatorChatId) continue;

          const data = String(cq.data || '');
          const match = data.match(/^inbox:(approve|reject):(.+)$/);
          if (match) {
            const action = match[1] === 'approve' ? 'approved' : 'rejected';
            const itemId = match[2];
            try {
              const updated = await this.respond(itemId, { status: action, read: true });
              await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                callback_query_id: cq.id,
                text: action === 'approved' ? 'Одобрено куратором' : 'Отклонено куратором',
              });
              if (cq.message?.message_id) {
                await axios.post(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
                  chat_id: cq.message.chat.id,
                  message_id: cq.message.message_id,
                  reply_markup: { inline_keyboard: [] },
                }).catch(() => {});
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: curatorChatId,
                  reply_to_message_id: cq.message.message_id,
                  text: `${action === 'approved' ? '✅ Одобрено' : '❌ Отклонено'}: ${updated.title}`,
                }).catch(() => {});
              }
            } catch (err: any) {
              await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                callback_query_id: cq.id,
                text: `Ошибка: ${err?.message || 'запись не найдена'}`,
              }).catch(() => {});
            }
          }
        } else if (upd.message?.text) {
          const msgChat = String(upd.message.chat?.id || '');
          if (msgChat !== curatorChatId) continue;
          const text = String(upd.message.text).trim();

          const cmdMatch = text.match(/^\/(approve|reject|note)\s+(\S+)(?:\s+([\s\S]+))?$/i);
          if (cmdMatch) {
            const verb = cmdMatch[1].toLowerCase();
            const itemId = cmdMatch[2];
            const note = cmdMatch[3]?.trim();
            const status = verb === 'approve' ? 'approved' : verb === 'reject' ? 'rejected' : 'noted';
            try {
              const updated = await this.respond(itemId, {
                status,
                ...(note ? { curatorNote: note } : {}),
                read: true,
              });
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: curatorChatId,
                text: `Сохранено (${status}): ${updated.title}`,
              }).catch(() => {});
            } catch (err: any) {
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: curatorChatId,
                text: `Не удалось обновить ${itemId}: ${err?.message || err}`,
              }).catch(() => {});
            }
          } else if (text.startsWith('/inbox')) {
            const summary = await this.getUnreadSummary();
            const pending = await this.list({ status: 'pending', limit: 5 });
            const lines = [
              `Ожидают проверки: ${summary.pendingCount}`,
              ...pending.map((p) => `• ${p.title} (${p.id})`),
            ];
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: curatorChatId,
              text: lines.join('\n'),
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Quietly ignore transient network/409 polling issues
    } finally {
      this.isPolling = false;
    }
  }
}
