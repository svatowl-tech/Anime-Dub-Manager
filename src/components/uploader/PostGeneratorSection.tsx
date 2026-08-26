import React from 'react';
import { Sparkles, RotateCw, Settings2, Copy, Check } from 'lucide-react';
import { Episode } from '../../types';
import { TemplateType } from './types';

interface PostGeneratorSectionProps {
  currentEpisode: Episode | null;
  templateType: TemplateType;
  generatedPost: string;
  setGeneratedPost: (post: string) => void;
  copiedField: string | null;
  buildPostText: (type: TemplateType) => void;
  copyToClipboard: (text: string, label: string) => void;
  openTemplateModal: () => void;
}

export const PostGeneratorSection: React.FC<PostGeneratorSectionProps> = ({
  currentEpisode,
  templateType,
  generatedPost,
  setGeneratedPost,
  copiedField,
  buildPostText,
  copyToClipboard,
  openTemplateModal
}) => {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-400" />
          Генератор постов
        </span>
        <div className="flex items-center gap-2">
          {currentEpisode && (
            <button 
              onClick={() => buildPostText(templateType)}
              className="text-emerald-400 hover:text-emerald-300 text-[11px] flex items-center gap-1 font-medium cursor-pointer"
              title="Обновить пост из текущих данных релиза"
            >
              <RotateCw className="w-3 h-3" />
              <span>Синхронизировать</span>
            </button>
          )}
          <button
            onClick={openTemplateModal}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded-lg transition flex items-center gap-1 border border-neutral-700/60 font-medium cursor-pointer"
            title="Настроить шаблон поста в модальном окне"
          >
            <Settings2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Шаблон</span>
          </button>
        </div>
      </div>

      {/* Template Buttons */}
      <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-xs overflow-x-auto no-scrollbar">
        <button
          onClick={() => buildPostText('TG')}
          className={`px-2.5 py-1.5 rounded-md font-medium transition flex-shrink-0 cursor-pointer ${
            templateType === 'TG' ? 'bg-sky-600 text-white shadow' : 'text-neutral-400 hover:text-white'
          }`}
        >
          Telegram
        </button>
        <button
          onClick={() => buildPostText('VK')}
          className={`px-2.5 py-1.5 rounded-md font-medium transition flex-shrink-0 cursor-pointer ${
            templateType === 'VK' ? 'bg-blue-600 text-white shadow' : 'text-neutral-400 hover:text-white'
          }`}
        >
          ВКонтакте
        </button>
        <button
          onClick={() => buildPostText('FINAL_TG')}
          className={`px-2.5 py-1.5 rounded-md font-medium transition flex-shrink-0 cursor-pointer ${
            templateType === 'FINAL_TG' ? 'bg-emerald-600 text-white shadow' : 'text-neutral-400 hover:text-white'
          }`}
        >
          Итог TG
        </button>
        <button
          onClick={() => buildPostText('YT')}
          className={`px-2.5 py-1.5 rounded-md font-medium transition flex-shrink-0 cursor-pointer ${
            templateType === 'YT' ? 'bg-red-600 text-white shadow' : 'text-neutral-400 hover:text-white'
          }`}
        >
          YouTube
        </button>
        <button
          onClick={() => buildPostText('TORRENT')}
          className={`px-2.5 py-1.5 rounded-md font-medium transition flex-shrink-0 cursor-pointer ${
            templateType === 'TORRENT' ? 'bg-teal-600 text-white shadow' : 'text-neutral-400 hover:text-white'
          }`}
        >
          Торрент / BBCode
        </button>
      </div>

      {/* Textarea Area */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">Текст поста для серии #{currentEpisode?.number || '?'}:</span>
          <button
            onClick={() => copyToClipboard(generatedPost, 'Текст поста')}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            {copiedField === 'Текст поста' ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Скопировано</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Скопировать пост</span>
              </>
            )}
          </button>
        </div>

        <textarea
          value={generatedPost}
          onChange={(e) => {
            setGeneratedPost(e.target.value);
            const epKey = currentEpisode?.id || 'global';
            localStorage.setItem(`uploader_draft_post_${epKey}`, e.target.value);
          }}
          placeholder="Текст поста..."
          rows={7}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-neutral-100 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-y"
        />
      </div>
    </div>
  );
};
