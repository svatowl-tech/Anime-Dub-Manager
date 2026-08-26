import React from 'react';
import { Copy, Settings2 } from 'lucide-react';
import { Episode } from '../../types';
import { CustomFieldItem } from './types';

interface QuickCopyFieldsSectionProps {
  currentEpisode: Episode | null;
  customFields: CustomFieldItem[];
  copyToClipboard: (text: string, label: string) => void;
  onOpenFieldsModal: () => void;
}

export const QuickCopyFieldsSection: React.FC<QuickCopyFieldsSectionProps> = ({
  currentEpisode,
  customFields,
  copyToClipboard,
  onOpenFieldsModal
}) => {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Copy className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-semibold text-white">Быстрые поля для копирования</h3>
        </div>
        <button
          onClick={onOpenFieldsModal}
          className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded-lg transition flex items-center gap-1 border border-neutral-700/60 font-medium cursor-pointer"
          title="Управление быстрыми полями"
        >
          <Settings2 className="w-3.5 h-3.5 text-purple-400" />
          <span>Настроить</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <button
          onClick={() => copyToClipboard(currentEpisode?.project?.title || '', 'Название проекта')}
          className="p-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-left text-neutral-300 flex items-center justify-between truncate cursor-pointer"
        >
          <span className="truncate">Название: {currentEpisode?.project?.title || '—'}</span>
          <Copy className="w-3 h-3 text-neutral-500 flex-shrink-0" />
        </button>

        <button
          onClick={() => copyToClipboard(currentEpisode?.number ? `${currentEpisode.number} серия` : '', 'Номер серии')}
          className="p-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-left text-neutral-300 flex items-center justify-between cursor-pointer"
        >
          <span>Серия: #{currentEpisode?.number || '—'}</span>
          <Copy className="w-3 h-3 text-neutral-500 flex-shrink-0" />
        </button>

        <button
          onClick={() => copyToClipboard(currentEpisode?.project?.synopsis || '', 'Синопсис')}
          className="p-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-left text-neutral-300 flex items-center justify-between col-span-2 cursor-pointer"
        >
          <span className="truncate">Описание: {currentEpisode?.project?.synopsis || '—'}</span>
          <Copy className="w-3 h-3 text-neutral-500 flex-shrink-0" />
        </button>

        {customFields.map(field => (
          <button
            key={field.id}
            onClick={() => copyToClipboard(field.value, field.label)}
            className="p-2 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-left text-neutral-300 flex items-center justify-between truncate col-span-2 cursor-pointer"
          >
            <span className="truncate">{field.label}: {field.value}</span>
            <Copy className="w-3 h-3 text-neutral-500 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};
