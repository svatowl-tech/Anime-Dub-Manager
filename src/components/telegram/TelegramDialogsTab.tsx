import React, { useState } from 'react';
import { 
  Users, 
  MessageSquare, 
  Hash, 
  Search, 
  RefreshCw, 
  Copy, 
  ExternalLink, 
  Check, 
  ShieldCheck, 
  Radio 
} from 'lucide-react';
import { toast } from 'sonner';
import { TelegramMTProtoDialog } from '../../types';

interface TelegramDialogsTabProps {
  dialogs: TelegramMTProtoDialog[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectChat?: (chatId: string) => void;
}

export const TelegramDialogsTab: React.FC<TelegramDialogsTabProps> = ({
  dialogs,
  isLoading,
  onRefresh,
  onSelectChat
}) => {
  const [filter, setFilter] = useState<'all' | 'channel' | 'group' | 'user'>('all');
  const [search, setSearch] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredDialogs = dialogs.filter((d) => {
    if (filter !== 'all' && d.type !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = d.title.toLowerCase().includes(q);
      const matchUser = d.username ? d.username.toLowerCase().includes(q) : false;
      const matchId = d.id.includes(q);
      if (!matchTitle && !matchUser && !matchId) return false;
    }
    return true;
  });

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success(`ID ${id} скопирован в буфер обмена`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden">
      {/* Top Filter Strip */}
      <div className="bg-neutral-900 border-b border-neutral-800 p-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск каналов, супергрупп или контактов..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-sky-500 outline-none"
            />
          </div>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl border border-neutral-700 transition cursor-pointer"
            title="Обновить список каналов"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800">
          {(['all', 'channel', 'group', 'user'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                filter === f ? 'bg-sky-600 text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {f === 'all' && `Все (${dialogs.length})`}
              {f === 'channel' && 'Каналы'}
              {f === 'group' && 'Группы'}
              {f === 'user' && 'Личные'}
            </button>
          ))}
        </div>
      </div>

      {/* Dialogs List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading && dialogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-500 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-sky-500" />
            <p className="text-xs">Загрузка ваших каналов и чатов из Telegram...</p>
          </div>
        ) : filteredDialogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-500 space-y-2">
            <MessageSquare className="w-8 h-8 opacity-30" />
            <p className="text-xs">Чаты не найдены</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredDialogs.map((d) => (
              <div
                key={d.id}
                onClick={() => onSelectChat && onSelectChat(d.id)}
                className="bg-neutral-900 hover:bg-neutral-850 border border-neutral-800/90 hover:border-sky-500/50 rounded-2xl p-3.5 transition group cursor-pointer shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        d.type === 'channel'
                          ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                          : d.type === 'group'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {d.type === 'channel' ? 'Канал' : d.type === 'group' ? 'Группа' : 'ЛС'}
                    </span>

                    {d.unreadCount > 0 && (
                      <span className="px-2 py-0.5 bg-sky-600 text-white rounded-full text-[10px] font-bold">
                        +{d.unreadCount}
                      </span>
                    )}
                  </div>

                  <h4 className="text-xs font-bold text-white group-hover:text-sky-300 transition line-clamp-1">
                    {d.title}
                  </h4>

                  {d.username && (
                    <div className="text-[11px] text-sky-400 font-mono mt-0.5">
                      @{d.username}
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-neutral-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-neutral-500 font-mono text-[10px]">ID: {d.id}</span>
                  <button
                    onClick={(e) => handleCopyId(d.id, e)}
                    className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition"
                    title="Скопировать ID"
                  >
                    {copiedId === d.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
