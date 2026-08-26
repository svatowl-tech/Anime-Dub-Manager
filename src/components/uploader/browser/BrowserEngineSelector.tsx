import React, { useState, useRef, useEffect } from 'react';
import { 
  ShieldCheck, 
  Cpu, 
  Layers, 
  ExternalLink, 
  FileSearch, 
  ChevronDown, 
  Check, 
  Sparkles,
  Info
} from 'lucide-react';
import { BrowserEngineType } from './types';
import { isWeb } from '../../../lib/ipcSafe';

interface BrowserEngineSelectorProps {
  currentEngine: BrowserEngineType;
  onChangeEngine: (engine: BrowserEngineType) => void;
}

interface EngineOption {
  id: BrowserEngineType;
  title: string;
  shortLabel: string;
  description: string;
  icon: React.ElementType;
  badge: string;
  color: string;
}

export const BrowserEngineSelector: React.FC<BrowserEngineSelectorProps> = ({
  currentEngine,
  onChangeEngine
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const engines: EngineOption[] = isWeb ? [
    {
      id: 'smart-proxy',
      title: 'Smart Proxy v2',
      shortLabel: 'Proxy v2',
      description: 'Умный прокси-сервер с обходом CORS, анти-фрейм заголовков и поддержкой cookies',
      icon: ShieldCheck,
      badge: 'Рекомендуется для веб',
      color: 'text-sky-400 border-sky-500/40 bg-sky-950/40'
    },
    {
      id: 'sandbox-iframe',
      title: 'Direct Embed (Iframe)',
      shortLabel: 'Direct',
      description: 'Прямое встраивание плееров и страниц без проксирования (Kodik, Sibnet, RuTube embed)',
      icon: Layers,
      badge: 'Быстрый',
      color: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40'
    },
    {
      id: 'popup-overlay',
      title: 'Интерактивное окно (Cloudflare Bypass)',
      shortLabel: 'Окно / CF',
      description: 'Изолированное всплывающее окно для сайтов с Cloudflare Turnstile, капчей, VK ID и Anime365',
      icon: ExternalLink,
      badge: 'Для сложной защиты',
      color: 'text-amber-400 border-amber-500/40 bg-amber-950/40'
    },
    {
      id: 'reader-extractor',
      title: 'Инспектор метаданных (Экстрактор)',
      shortLabel: 'Экстрактор',
      description: 'Извлечение названий, описаний, тегов и ссылок со страницы для быстрого релиза',
      icon: FileSearch,
      badge: 'Утилита',
      color: 'text-purple-400 border-purple-500/40 bg-purple-950/40'
    }
  ] : [
    {
      id: 'direct-webview',
      title: 'Chromium Native Webview',
      shortLabel: 'Chromium',
      description: 'Полноценный нативный движок Chromium со сквозной авторизацией, куки и загрузкой файлов',
      icon: Cpu,
      badge: 'Нативный (Рекомендуется)',
      color: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40'
    },
    {
      id: 'sandbox-iframe',
      title: 'Direct Sandbox Iframe',
      shortLabel: 'Iframe',
      description: 'Ограниченный iframe режим без доступа к внутренним плагинам',
      icon: Layers,
      badge: 'Песочница',
      color: 'text-sky-400 border-sky-500/40 bg-sky-950/40'
    },
    {
      id: 'reader-extractor',
      title: 'Инспектор метаданных (Экстрактор)',
      shortLabel: 'Экстрактор',
      description: 'Извлечение названий, описаний, тегов и ссылок со страницы для быстрого релиза',
      icon: FileSearch,
      badge: 'Утилита',
      color: 'text-purple-400 border-purple-500/40 bg-purple-950/40'
    }
  ];

  const currentOption = engines.find(e => e.id === currentEngine) || engines[0];
  const CurrentIcon = currentOption.icon;

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-sm ${currentOption.color} hover:brightness-110`}
        title="Сменить браузерный движок для этой вкладки"
      >
        <CurrentIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline font-mono">{currentOption.shortLabel}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-72 sm:w-80 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-50 p-2 space-y-1 backdrop-blur-md">
          <div className="px-2 py-1 flex items-center justify-between border-b border-neutral-800 pb-1.5 mb-1">
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" /> Выбор браузерного движка
            </span>
            <span className="text-[10px] text-neutral-500 font-mono">5 режимов</span>
          </div>

          {engines.map((eng) => {
            const Icon = eng.icon;
            const isSelected = eng.id === currentEngine;
            return (
              <button
                key={eng.id}
                onClick={() => {
                  onChangeEngine(eng.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left p-2 rounded-lg border transition flex items-start gap-2.5 cursor-pointer ${
                  isSelected
                    ? 'bg-neutral-800 border-sky-500/60 shadow-sm'
                    : 'bg-neutral-950/50 border-neutral-800/80 hover:bg-neutral-800/60 hover:border-neutral-700'
                }`}
              >
                <div className={`p-1.5 rounded-md border mt-0.5 ${eng.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-neutral-200 truncate">
                      {eng.title}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono flex-shrink-0">
                      {eng.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 line-clamp-2 mt-0.5 leading-tight">
                    {eng.description}
                  </p>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-sky-400 flex-shrink-0 mt-1" />
                )}
              </button>
            );
          })}

          <div className="px-2 pt-1 border-t border-neutral-800 text-[10px] text-neutral-400 flex items-center gap-1">
            <Info className="w-3 h-3 text-neutral-400" />
            <span>Если сайт не грузится или выдает ошибку, переключитесь на «Интерактивное окно».</span>
          </div>
        </div>
      )}
    </div>
  );
};
