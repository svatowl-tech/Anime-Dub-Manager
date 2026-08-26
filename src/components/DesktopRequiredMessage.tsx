import React from 'react';
import { AlertTriangle, Download } from 'lucide-react';

export function DesktopRequiredMessage({ title = 'Требуется Desktop-версия' }: { title?: string }) {
  return (
    <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-5 mb-4 shadow-lg flex items-start gap-4">
      <AlertTriangle className="w-8 h-8 text-amber-500 shrink-0 mt-1" />
      <div>
        <div className="font-bold text-amber-500 mb-2 text-lg">{title}</div>
        <p className="text-amber-200/80 text-sm leading-relaxed mb-3">
          Для работы ресурсоемких функций (рендеринг финального видео, наложение хардсаба с помощью FFmpeg, создание обложек) 
          необходимо установить десктопное приложение. В web-версии эти действия технически ограничены.
        </p>
        <a 
          href="https://github.com/svatowl-tech/DubStudio" 
          target="_blank" 
          rel="noreferrer" 
          className="inline-flex items-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white px-4 py-2 rounded-md transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Скачать с GitHub
        </a>
      </div>
    </div>
  );
}
