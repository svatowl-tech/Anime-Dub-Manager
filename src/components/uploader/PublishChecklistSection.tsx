import React from 'react';
import { CheckSquare, RefreshCw, Settings2, Square, ExternalLink, CheckCircle2 } from 'lucide-react';
import { ChecklistItemDef } from './types';

interface PublishChecklistSectionProps {
  checklistDefs: ChecklistItemDef[];
  checklist: Record<string, boolean>;
  toggleChecklistItem: (id: string) => void;
  handleSyncChecklistWithQuickLinks: () => void;
  onOpenChecklistModal: () => void;
  onSelectUrl: (url: string, label: string) => void;
  handleMarkAllPublished?: () => void;
}

export const PublishChecklistSection: React.FC<PublishChecklistSectionProps> = ({
  checklistDefs,
  checklist,
  toggleChecklistItem,
  handleSyncChecklistWithQuickLinks,
  onOpenChecklistModal,
  onSelectUrl,
  handleMarkAllPublished
}) => {
  const completedChecklistCount = checklistDefs.filter(item => checklist[item.id]).length;
  const progressPercent = checklistDefs.length > 0 ? (completedChecklistCount / checklistDefs.length) * 100 : 0;
  const isAllDone = checklistDefs.length > 0 && completedChecklistCount === checklistDefs.length;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-semibold text-white">Чек-лист публикации</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800/60 font-semibold">
            {completedChecklistCount} / {checklistDefs.length}
          </span>
          <button
            onClick={handleSyncChecklistWithQuickLinks}
            className="px-2 py-1 bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 text-xs rounded-lg transition flex items-center gap-1 border border-purple-800/50 font-medium cursor-pointer"
            title="Синхронизировать чек-лист с быстрыми кнопками загрузки"
          >
            <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
            <span>Синхрон.</span>
          </button>
          <button
            onClick={onOpenChecklistModal}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded-lg transition flex items-center gap-1 border border-neutral-700/60 font-medium cursor-pointer"
            title="Настройка списка пунктов чек-листа"
          >
            <Settings2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Настроить</span>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
        <div 
          className="bg-emerald-500 h-full transition-all duration-300" 
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Mark Everything Done Action */}
      {handleMarkAllPublished && (
        <button
          onClick={handleMarkAllPublished}
          className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer shadow-md ${
            isAllDone
              ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white hover:shadow-emerald-900/30'
          }`}
          title="Отметить все пункты выполненными и перевести серию в статус завершённой"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isAllDone ? 'Всё выложено (Серия завершена) ✓' : '✅ Отметить: Всё выложено!'}</span>
        </button>
      )}

      {/* Items */}
      <div className="space-y-1.5 pt-1">
        {checklistDefs.map(item => {
          const checked = !!checklist[item.id];
          return (
            <div key={item.id} className="flex items-center gap-2">
              <button
                onClick={() => toggleChecklistItem(item.id)}
                className={`flex-1 flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition text-left cursor-pointer ${
                  checked ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40' : 'bg-neutral-950 text-neutral-300 hover:bg-neutral-800 border border-neutral-800'
                }`}
              >
                <span className="truncate pr-2">{item.label}</span>
                {checked ? (
                  <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-neutral-600 flex-shrink-0" />
                )}
              </button>
              {item.url && (
                <button
                  onClick={() => onSelectUrl(item.url!, item.label)}
                  className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded-lg transition cursor-pointer flex-shrink-0"
                  title={`Открыть ${item.url}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
