import React from 'react';
import { CheckSquare, X, Trash2, Plus, RefreshCw, Link2 } from 'lucide-react';
import { ChecklistItemDef } from '../types';
import { QuickUploadLink } from '../../../types';

interface ChecklistManagerModalProps {
  checklistDefs: ChecklistItemDef[];
  quickLinks: QuickUploadLink[];
  newChecklistLabel: string;
  setNewChecklistLabel: (val: string) => void;
  newChecklistUrl: string;
  setNewChecklistUrl: (val: string) => void;
  onAddChecklistItem: () => void;
  onDeleteChecklistItem: (id: string) => void;
  onSyncWithQuickLinks: () => void;
  onResetChecklistDefs: () => void;
  onClose: () => void;
}

export const ChecklistManagerModal: React.FC<ChecklistManagerModalProps> = ({
  checklistDefs,
  quickLinks,
  newChecklistLabel,
  setNewChecklistLabel,
  newChecklistUrl,
  setNewChecklistUrl,
  onAddChecklistItem,
  onDeleteChecklistItem,
  onSyncWithQuickLinks,
  onResetChecklistDefs,
  onClose
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-sm">Настройка элементов чек-листа</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Quick Links Sync Banner */}
          <div className="bg-purple-950/30 border border-purple-800/50 rounded-xl p-3 flex items-center justify-between text-xs">
            <div className="space-y-0.5 pr-2">
              <div className="font-semibold text-purple-200 flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-purple-400" />
                <span>Синхронизация с быстрыми кнопками</span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Кнопок загрузки в проекте: <strong className="text-white">{quickLinks.length}</strong>. Все площадки объединяются с чек-листом.
              </p>
            </div>
            <button
              type="button"
              onClick={onSyncWithQuickLinks}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition flex items-center gap-1.5 flex-shrink-0 shadow cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Обновить</span>
            </button>
          </div>

          {/* Existing Items */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {checklistDefs.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs">
                <div className="truncate pr-2 min-w-0">
                  <div className="font-semibold text-white truncate">{item.label}</div>
                  {item.url && <div className="text-neutral-500 truncate text-[11px] font-mono">{item.url}</div>}
                </div>
                <button
                  onClick={() => onDeleteChecklistItem(item.id)}
                  className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-950/50 rounded-lg transition flex-shrink-0 cursor-pointer"
                  title="Удалить пункт"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <hr className="border-neutral-800" />

          {/* Add Form */}
          <div className="space-y-2 bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-xs">
            <span className="font-semibold text-neutral-200 block">Новый пункт:</span>
            <input
              type="text"
              placeholder="Название площадки (например, Boosty)"
              value={newChecklistLabel}
              onChange={(e) => setNewChecklistLabel(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <input
              type="text"
              placeholder="Ссылка площадки (необязательно)"
              value={newChecklistUrl}
              onChange={(e) => setNewChecklistUrl(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              onClick={onAddChecklistItem}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить пункт</span>
            </button>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between">
          <button
            onClick={onResetChecklistDefs}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 rounded-lg text-xs transition cursor-pointer"
          >
            Сбросить по умолчанию
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition cursor-pointer"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
