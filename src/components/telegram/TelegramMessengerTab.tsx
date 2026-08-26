import React, { useState } from 'react';
import { 
  Send, 
  Paperclip, 
  Pin, 
  BellOff, 
  Search, 
  Check, 
  Users, 
  MessageSquare, 
  Hash, 
  CheckCheck,
  X,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { TelegramMTProtoDialog } from '../../types';
import { TelegramChatMessage } from './types';

interface TelegramMessengerTabProps {
  dialogs: TelegramMTProtoDialog[];
  selectedChatId: string;
  onSelectChat: (chatId: string) => void;
}

export const TelegramMessengerTab: React.FC<TelegramMessengerTabProps> = ({
  dialogs,
  selectedChatId,
  onSelectChat
}) => {
  const [messages, setMessages] = useState<Record<string, TelegramChatMessage[]>>({
    default: [
      {
        id: '1',
        senderName: 'Akane Studio Bot',
        text: '👋 Добро пожаловать в Telegram Studio Hub! Здесь отображаются сообщения из рабочих чатов и каналов.',
        time: '12:00',
        isMe: false,
        isPinned: true
      }
    ]
  });

  const [inputMessage, setInputMessage] = useState<string>('');
  const [isSilent, setIsSilent] = useState<boolean>(false);
  const [isPin, setIsPin] = useState<boolean>(false);
  const [mediaPath, setMediaPath] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [chatSearch, setChatSearch] = useState<string>('');

  const currentDialog = dialogs.find(d => d.id === selectedChatId) || dialogs[0] || null;
  const currentChatKey = currentDialog?.id || 'default';
  const chatMessages = messages[currentChatKey] || messages['default'] || [];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() && !mediaPath) return;

    const textToSend = inputMessage.trim();
    const targetPeer = currentDialog?.username ? `@${currentDialog.username}` : currentDialog?.id;

    if (!targetPeer) {
      toast.error('Выберите чат для отправки');
      return;
    }

    setIsSending(true);
    try {
      await ipcSafe.invoke('telegram-mtproto-send-post', {
        targetPeer,
        text: textToSend,
        mediaPath: mediaPath || undefined,
        silent: isSilent,
        pin: isPin,
        parseMode: 'html'
      });

      const newMsg: TelegramChatMessage = {
        id: String(Date.now()),
        senderName: 'Вы',
        text: textToSend,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
        mediaPath: mediaPath || undefined,
        isPinned: isPin
      };

      setMessages(prev => ({
        ...prev,
        [currentChatKey]: [...(prev[currentChatKey] || []), newMsg]
      }));

      setInputMessage('');
      setMediaPath('');
      toast.success('Сообщение отправлено');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка отправки сообщения');
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachFile = async () => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        title: 'Прикрепить файл к сообщению',
        filters: [{ name: 'Файлы', extensions: ['jpg', 'png', 'mp4', 'mp3', 'wav', 'txt', 'zip'] }]
      });
      if (res && typeof res === 'string') {
        setMediaPath(res);
      } else if (res && res.filePath) {
        setMediaPath(res.filePath);
      }
    } catch (e) {
      console.warn('File attach canceled:', e);
    }
  };

  const filteredDialogs = dialogs.filter(d => {
    if (!chatSearch.trim()) return true;
    const q = chatSearch.toLowerCase();
    return d.title.toLowerCase().includes(q) || (d.username && d.username.toLowerCase().includes(q));
  });

  return (
    <div className="flex-1 flex h-full bg-neutral-950 overflow-hidden">
      {/* Sidebar: Dialogs */}
      <div className="w-72 bg-neutral-900 border-r border-neutral-800 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-neutral-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Поиск диалогов..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-sky-500 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/40">
          {filteredDialogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-500">
              Чаты не найдены
            </div>
          ) : (
            filteredDialogs.map(d => {
              const isSelected = (currentDialog && currentDialog.id === d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => onSelectChat(d.id)}
                  className={`w-full p-3 text-left flex items-center gap-2.5 transition cursor-pointer ${
                    isSelected ? 'bg-sky-600/15 border-l-2 border-sky-500' : 'hover:bg-neutral-850'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                    d.type === 'channel' ? 'bg-sky-500/20 text-sky-400' : d.type === 'group' ? 'bg-amber-500/20 text-amber-400' : 'bg-neutral-800 text-neutral-300'
                  }`}>
                    {d.title.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white truncate">{d.title}</span>
                      {d.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-sky-600 text-[10px] text-white rounded-full font-bold">
                          {d.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate">
                      {d.username ? `@${d.username}` : `ID: ${d.id}`}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
        {/* Chat Header */}
        <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold text-xs">
              {currentDialog ? currentDialog.title.charAt(0) : 'TG'}
            </div>
            <div>
              <h3 className="text-xs font-bold text-white truncate">
                {currentDialog ? currentDialog.title : 'Выберите чат'}
              </h3>
              <p className="text-[11px] text-neutral-400">
                {currentDialog?.username ? `@${currentDialog.username}` : (currentDialog?.type || 'Telegram MTProto')}
              </p>
            </div>
          </div>
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chatMessages.map(m => (
            <div
              key={m.id}
              className={`flex flex-col ${m.isMe ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-md rounded-2xl p-3.5 shadow-md relative text-xs space-y-1.5 ${
                  m.isMe
                    ? 'bg-sky-600 text-white rounded-br-none'
                    : 'bg-neutral-900 text-neutral-200 border border-neutral-800 rounded-bl-none'
                }`}
              >
                {!m.isMe && (
                  <div className="text-[11px] font-bold text-sky-400">{m.senderName}</div>
                )}
                {m.isPinned && (
                  <div className="flex items-center gap-1 text-[10px] text-amber-300 font-semibold mb-1">
                    <Pin className="w-3 h-3" /> Закрепленное сообщение
                  </div>
                )}
                <div
                  className="leading-relaxed break-words"
                  dangerouslySetInnerHTML={{ __html: m.text }}
                />
                {m.mediaPath && (
                  <div className="mt-2 text-[11px] bg-black/20 p-2 rounded-lg flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    <span className="truncate">{m.mediaPath.split(/[\\/]/).pop()}</span>
                  </div>
                )}
                <div className={`text-[10px] text-right mt-1 ${m.isMe ? 'text-sky-200' : 'text-neutral-500'}`}>
                  {m.time}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="bg-neutral-900 border-t border-neutral-800 p-3 space-y-2 flex-shrink-0">
          {mediaPath && (
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs text-sky-300">
              <span className="truncate">Прикреплен: {mediaPath.split(/[\\/]/).pop()}</span>
              <button
                type="button"
                onClick={() => setMediaPath('')}
                className="text-neutral-400 hover:text-red-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAttachFile}
              className="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 transition cursor-pointer"
              title="Прикрепить файл"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsPin(!isPin)}
              className={`p-2 rounded-xl transition cursor-pointer ${
                isPin ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
              title="Закрепить сообщение в чате"
            >
              <Pin className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsSilent(!isSilent)}
              className={`p-2 rounded-xl transition cursor-pointer ${
                isSilent ? 'bg-purple-500/20 text-purple-300' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
              title="Отправить без звука"
            >
              <BellOff className="w-4 h-4" />
            </button>

            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Напишите сообщение в Telegram..."
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:border-sky-500 outline-none"
            />

            <button
              type="submit"
              disabled={isSending || (!inputMessage.trim() && !mediaPath)}
              className="p-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl transition cursor-pointer shadow-md"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
