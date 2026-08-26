import React, { useState, useEffect } from 'react';
import { 
  FileSearch, 
  Copy, 
  Check, 
  ExternalLink, 
  Loader2, 
  Image as ImageIcon, 
  Film, 
  Link as LinkIcon, 
  Sparkles,
  RefreshCw,
  Send
} from 'lucide-react';
import { BrowserTab, PageExtractedData } from './types';
import { toast } from 'sonner';
import { isWeb } from '../../../lib/ipcSafe';

interface ContentExtractorViewProps {
  tab: BrowserTab;
  onUpdateTab: (tabId: string, partial: Partial<BrowserTab>) => void;
}

export const ContentExtractorView: React.FC<ContentExtractorViewProps> = ({
  tab,
  onUpdateTab
}) => {
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<PageExtractedData | null>(tab.extractedData || null);

  const fetchAndExtract = async () => {
    if (!tab.url) return;
    setLoading(true);

    try {
      const fetchUrl = isWeb ? `/api/web-proxy?url=${encodeURIComponent(tab.url)}` : tab.url;
      const res = await fetch(fetchUrl);
      const htmlText = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      const title = doc.title || doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') 
        || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') 
        || '';
      const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
      const canonicalUrl = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || tab.url;

      // Extract all media / video links
      const videoSources: string[] = [];
      doc.querySelectorAll('video source, video, iframe').forEach(el => {
        const src = el.getAttribute('src');
        if (src && !videoSources.includes(src)) {
          videoSources.push(src);
        }
      });

      // Extract high quality images
      const links: Array<{ text: string; href: string }> = [];
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        const text = (a.textContent || '').trim();
        if (href && text && text.length > 2 && text.length < 80 && !href.startsWith('#') && !href.startsWith('javascript:')) {
          if (links.length < 20) {
            links.push({ text, href });
          }
        }
      });

      const extractedData: PageExtractedData = {
        title,
        description,
        ogImage,
        canonicalUrl,
        videoSources,
        links,
        status: 'Готово'
      };

      setExtracted(extractedData);
      onUpdateTab(tab.id, { extractedData });
      toast.success('Метаданные страницы успешно извлечены');
    } catch (err: any) {
      toast.error('Не удалось распарсить страницу: ' + (err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!extracted) {
      fetchAndExtract();
    }
  }, [tab.url]);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
    toast.success(`Скопировано: ${fieldName}`);
  };

  return (
    <div className="w-full h-full bg-neutral-950 flex flex-col p-6 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
              <FileSearch className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-100 flex items-center gap-2">
                Инспектор метаданных страницы
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                  Readability Engine
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Автоматическое извлечение названий, описаний, постеров и медиа-потоков для релиза
              </p>
            </div>
          </div>

          <button
            onClick={fetchAndExtract}
            disabled={loading}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Обновить данные</span>
          </button>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3 text-neutral-400">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            <p className="text-sm">Анализ структуры страницы и извлечение данных...</p>
          </div>
        ) : extracted ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left 2 Cols: Main Info */}
            <div className="md:col-span-2 space-y-4">
              {/* Title Card */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    Заголовок страницы / Название тайтла
                  </span>
                  <button
                    onClick={() => copyToClipboard(extracted.title || '', 'Название')}
                    className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'Название' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Скопировать
                  </button>
                </div>
                <p className="text-sm font-medium text-neutral-100 bg-neutral-950 p-3 rounded-lg border border-neutral-800/80 select-all">
                  {extracted.title || 'Не найдено'}
                </p>
              </div>

              {/* Description Card */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    Описание / Синопсис
                  </span>
                  <button
                    onClick={() => copyToClipboard(extracted.description || '', 'Описание')}
                    className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'Описание' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Скопировать
                  </button>
                </div>
                <p className="text-xs text-neutral-300 bg-neutral-950 p-3 rounded-lg border border-neutral-800/80 whitespace-pre-wrap leading-relaxed select-all max-h-48 overflow-y-auto">
                  {extracted.description || 'Описание отсутствует в мета-тегах'}
                </p>
              </div>

              {/* Video Sources / Embeds */}
              {extracted.videoSources && extracted.videoSources.length > 0 && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-sky-400" /> Найденные медиа / iframe потоки ({extracted.videoSources.length})
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {extracted.videoSources.map((src, i) => (
                      <div key={i} className="flex items-center justify-between bg-neutral-950 p-2 rounded border border-neutral-800 text-xs font-mono text-neutral-300">
                        <span className="truncate flex-1 mr-2">{src}</span>
                        <button
                          onClick={() => copyToClipboard(src, `Видео-поток #${i+1}`)}
                          className="p-1 text-neutral-400 hover:text-white cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Col: Poster & Found Links */}
            <div className="space-y-4">
              {/* Poster Card */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-pink-400" /> Обложка (OG Image)
                </span>
                {extracted.ogImage ? (
                  <div className="space-y-2">
                    <img
                      src={extracted.ogImage}
                      alt="OG Poster"
                      className="w-full h-44 object-cover rounded-lg border border-neutral-800"
                    />
                    <button
                      onClick={() => copyToClipboard(extracted.ogImage || '', 'Ссылка на постер')}
                      className="w-full py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded-lg border border-neutral-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" /> Копировать ссылку
                    </button>
                  </div>
                ) : (
                  <div className="h-32 bg-neutral-950 rounded-lg border border-neutral-800 flex items-center justify-center text-xs text-neutral-500">
                    Обложка не найдена
                  </div>
                )}
              </div>

              {/* Quick Links */}
              {extracted.links && extracted.links.length > 0 && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5 text-emerald-400" /> Ссылки ({extracted.links.length})
                  </span>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {extracted.links.map((lnk, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs p-1.5 bg-neutral-950 rounded border border-neutral-800/60 hover:border-neutral-700">
                        <span className="truncate flex-1 text-neutral-300 mr-2">{lnk.text}</span>
                        <a
                          href={lnk.href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 p-0.5"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-neutral-500 text-sm">
            Нет извлеченных данных. Нажмите «Обновить данные».
          </div>
        )}
      </div>
    </div>
  );
};
