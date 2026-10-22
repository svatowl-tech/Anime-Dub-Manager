import React from 'react';
import { Sparkles, Plus, Code, Sliders, Hash, Globe, Users, Music } from 'lucide-react';

interface Props {
  onInsertVariable: (varSyntax: string) => void;
  onOpenBlockConfigurator: () => void;
}

export default function TemplateVariablesBar({ onInsertVariable, onOpenBlockConfigurator }: Props) {
  const BLOCKS = [
    { label: 'Блок главных ролей', var: '{mainRoles:[➤ {character} - [{nickname}]({tgLink})\n]}', icon: Users, color: 'text-purple-400' },
    { label: 'Второстепенные роли', var: '{secondaryDubbers:[[{nickname}]({tgLink})], }', icon: Users, color: 'text-indigo-400' },
    { label: 'Все актеры', var: '{dubbers:[[{nickname}]({tgLink})], }', icon: Users, color: 'text-blue-400' },
    { label: 'Блок ссылок', var: '{platformLinks}', icon: Globe, color: 'text-emerald-400' },
    { label: 'Звукарь', var: '{seMention}', icon: Music, color: 'text-amber-400' },
    { label: 'Пред. серия (TG)', var: '{prevLinkTg}', icon: Code, color: 'text-sky-400' },
    { label: 'След. серия (TG)', var: '{nextLinkTg}', icon: Code, color: 'text-sky-400' },
    { label: 'Дедлайн', var: '{deadline}', icon: Sparkles, color: 'text-rose-400' },
    { label: 'Хэштег проекта', var: '#{projectSlug}', icon: Hash, color: 'text-neutral-400' }
  ];

  return (
    <div className="p-3 bg-neutral-950 border-b border-neutral-800 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Быстрая вставка блоков и переменных:</span>
        </div>

        <button
          onClick={onOpenBlockConfigurator}
          className="flex items-center gap-1.5 px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-bold transition-all shadow-sm"
          title="Открыть визуальный конструктор шаблона"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Конструктор блоков шаблона</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
        {BLOCKS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              onClick={() => onInsertVariable(item.var)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800/80 rounded-lg text-xs text-neutral-300 hover:text-white transition-all whitespace-nowrap group"
              title={`Вставить: ${item.var}`}
            >
              <Icon className={`w-3 h-3 ${item.color}`} />
              <span>{item.label}</span>
              <Plus className="w-3 h-3 text-neutral-500 group-hover:text-purple-400 transition-colors" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
