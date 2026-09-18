import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Languages, 
  Play, 
  Pause, 
  Clock, 
  Check, 
  X, 
  Loader2, 
  Volume2, 
  Copy, 
  RotateCcw, 
  User, 
  ArrowRight,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { ipcSafe } from "../../lib/ipcSafe";

interface WhisperSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStartSec: number;
  initialEndSec: number;
  videoPath?: string;
  characterNames: string[];
  defaultCharacterName?: string;
  onAddSubtitle: (data: {
    startSec: number;
    endSec: number;
    text: string;
    characterName?: string;
    mode?: 'new' | 'replace';
  }) => void;
  onPlayRange?: (startSec: number, endSec: number) => void;
  secondsToAssTime: (sec: number) => string;
  parseAssTimeToSeconds: (str: string) => number;
  activeLineText?: string;
}

const WHISPER_LANGUAGES = [
  { code: 'ja', label: 'Японский (Japanese)' },
  { code: 'en', label: 'Английский (English)' },
  { code: 'ru', label: 'Русский (Russian)' },
  { code: 'zh', label: 'Китайский (Chinese)' },
  { code: 'ko', label: 'Корейский (Korean)' },
];

const WHISPER_MODELS = [
  { id: 'tiny', name: 'Tiny (Быстрая, минимальный размер)' },
  { id: 'base', name: 'Base (Базовая)' },
  { id: 'small', name: 'Small (Рекомендуется, оптимальный баланс)' },
  { id: 'medium', name: 'Medium (Высокая точность)' },
  { id: 'large-v3-turbo', name: 'Large V3 Turbo (Максимальное качество)' },
];

export const WhisperSnippetModal: React.FC<WhisperSnippetModalProps> = ({
  isOpen,
  onClose,
  initialStartSec,
  initialEndSec,
  videoPath,
  characterNames,
  defaultCharacterName = '',
  onAddSubtitle,
  onPlayRange,
  secondsToAssTime,
  parseAssTimeToSeconds,
  activeLineText = ''
}) => {
  const [startSec, setStartSec] = useState<number>(initialStartSec);
  const [endSec, setEndSec] = useState<number>(initialEndSec);
  const [startInputStr, setStartInputStr] = useState<string>('');
  const [endInputStr, setEndInputStr] = useState<string>('');

  const [language, setLanguage] = useState<string>('ja');
  const [model, setModel] = useState<string>('small');
  const [characterName, setCharacterName] = useState<string>(defaultCharacterName);

  const [recognizedText, setRecognizedText] = useState<string>('');
  const [translatedText, setTranslatedText] = useState<string>('');

  const [isRecognizing, setIsRecognizing] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);

  const [insertMode, setInsertMode] = useState<'new' | 'replace'>('new');
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state whenever modal opens or initial values change
  useEffect(() => {
    if (isOpen) {
      const s = Math.max(0, initialStartSec);
      const e = Math.max(s + 0.3, initialEndSec);
      setStartSec(s);
      setEndSec(e);
      setStartInputStr(secondsToAssTime(s));
      setEndInputStr(secondsToAssTime(e));
      setCharacterName(defaultCharacterName || '');
      setRecognizedText('');
      setTranslatedText('');
      setInsertMode('new');
    }
  }, [isOpen, initialStartSec, initialEndSec, defaultCharacterName]);

  // Clean up audio preview timer
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const duration = Math.max(0, endSec - startSec);

  const handleNudgeStart = (delta: number) => {
    const next = Math.max(0, parseFloat((startSec + delta).toFixed(2)));
    if (next < endSec) {
      setStartSec(next);
      setStartInputStr(secondsToAssTime(next));
    }
  };

  const handleNudgeEnd = (delta: number) => {
    const next = Math.max(startSec + 0.1, parseFloat((endSec + delta).toFixed(2)));
    setEndSec(next);
    setEndInputStr(secondsToAssTime(next));
  };

  const handleStartInputChange = (val: string) => {
    setStartInputStr(val);
    const parsed = parseAssTimeToSeconds(val);
    if (!isNaN(parsed) && parsed >= 0 && parsed < endSec) {
      setStartSec(parsed);
    }
  };

  const handleEndInputChange = (val: string) => {
    setEndInputStr(val);
    const parsed = parseAssTimeToSeconds(val);
    if (!isNaN(parsed) && parsed > startSec) {
      setEndSec(parsed);
    }
  };

  const handlePlaySnippet = () => {
    if (isPlayingPreview) {
      setIsPlayingPreview(false);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      return;
    }

    if (onPlayRange) {
      setIsPlayingPreview(true);
      onPlayRange(startSec, endSec);
      const playDurationMs = Math.max(200, (endSec - startSec) * 1000);
      previewTimerRef.current = setTimeout(() => {
        setIsPlayingPreview(false);
      }, playDurationMs);
    }
  };

  const handleTranscribeWhisper = async () => {
    if (endSec <= startSec) {
      toast.error('Конец фрагмента должен быть позже начала');
      return;
    }

    setIsRecognizing(true);
    try {
      const res = await ipcSafe.invoke('transcribe-whisper-snippet', {
        videoPath,
        startSec,
        endSec,
        language,
        model
      });

      if (res && res.text) {
        setRecognizedText(res.text);
        toast.success('Текст успешно распознан через Whisper!');
        // Auto-trigger translation to Russian as user requested: "Whisper её распознает. Нажимаю 'Перевести'..."
      } else {
        toast.error('Whisper не обнаружил речи в данном фрагменте');
      }
    } catch (err: any) {
      console.error('Whisper recognition failed:', err);
      toast.error(`Ошибка Whisper: ${err.message || 'Сбой распознавания'}`);
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleTranslateText = async () => {
    const textToTranslate = recognizedText.trim();
    if (!textToTranslate) {
      toast.error('Сначала распознайте текст или введите его вручную');
      return;
    }

    setIsTranslating(true);
    try {
      const res = await ipcSafe.invoke('translate-text', {
        text: textToTranslate,
        sourceLang: language,
        destLang: 'ru'
      });

      if (res && res['destination-text']) {
        setTranslatedText(res['destination-text']);
        toast.success('Перевод на русский успешно получен!');
      } else {
        toast.error('Не удалось получить перевод');
      }
    } catch (err: any) {
      console.error('Translation error:', err);
      toast.error(`Ошибка перевода: ${err.message || 'Сервис перевода недоступен'}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSaveToSubtitles = () => {
    const finalText = (translatedText || recognizedText).trim();
    if (!finalText) {
      toast.error('Нет текста для добавления в субтитры');
      return;
    }

    onAddSubtitle({
      startSec,
      endSec,
      text: finalText,
      characterName: characterName.trim() || undefined,
      mode: insertMode
    });

    toast.success('Реплика успешно сохранена в субтитры!');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div 
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
                Распознать через Whisper
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Выделенный тайминг
                </span>
              </h3>
              <p className="text-[11px] text-neutral-400">
                Распознавание фразы на оригинале и перевод Google Translate в субтитры
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
            title="Закрыть (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* 1. Timing Configuration Section */}
          <div className="p-3.5 bg-neutral-950/80 rounded-xl border border-neutral-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-neutral-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                Границы аудиофрагмента:
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
                  Длительность: <strong className="text-emerald-400">{duration.toFixed(2)}s</strong>
                </span>
                {onPlayRange && (
                  <button
                    onClick={handlePlaySnippet}
                    className={`text-[10px] px-2.5 py-1 rounded-md flex items-center gap-1.5 border transition-all cursor-pointer ${
                      isPlayingPreview
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-neutral-200'
                    }`}
                    title="Воспроизвести выделенный отрезок"
                  >
                    {isPlayingPreview ? (
                      <>
                        <Pause className="w-3 h-3" />
                        Стоп
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        Прослушать
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Start Time */}
              <div className="bg-neutral-900/90 p-2.5 rounded-lg border border-neutral-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-neutral-400">Начало (Start):</span>
                  <span className="text-[9px] font-mono text-neutral-500">{startSec.toFixed(2)}s</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={startInputStr}
                    onChange={(e) => handleStartInputChange(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 focus:outline-none focus:border-indigo-500"
                    placeholder="0:00:00.00"
                  />
                  <button
                    onClick={() => handleNudgeStart(-0.1)}
                    className="px-1.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[10px] font-mono cursor-pointer"
                    title="-0.1s"
                  >
                    -0.1
                  </button>
                  <button
                    onClick={() => handleNudgeStart(+0.1)}
                    className="px-1.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[10px] font-mono cursor-pointer"
                    title="+0.1s"
                  >
                    +0.1
                  </button>
                </div>
              </div>

              {/* End Time */}
              <div className="bg-neutral-900/90 p-2.5 rounded-lg border border-neutral-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-neutral-400">Конец (End):</span>
                  <span className="text-[9px] font-mono text-neutral-500">{endSec.toFixed(2)}s</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={endInputStr}
                    onChange={(e) => handleEndInputChange(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 focus:outline-none focus:border-indigo-500"
                    placeholder="0:00:00.00"
                  />
                  <button
                    onClick={() => handleNudgeEnd(-0.1)}
                    className="px-1.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[10px] font-mono cursor-pointer"
                    title="-0.1s"
                  >
                    -0.1
                  </button>
                  <button
                    onClick={() => handleNudgeEnd(+0.1)}
                    className="px-1.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[10px] font-mono cursor-pointer"
                    title="+0.1s"
                  >
                    +0.1
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Whisper Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                Язык распознавания (Оригинал):
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-purple-500 cursor-pointer"
              >
                {WHISPER_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                Модель Whisper:
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-purple-500 cursor-pointer"
              >
                {WHISPER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Whisper Recognition Step */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-200 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-purple-500/20 text-purple-400 text-[10px] flex items-center justify-center font-bold">1</span>
                Оригинал фразы (Whisper ASR):
              </span>
              <button
                onClick={handleTranscribeWhisper}
                disabled={isRecognizing}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                {isRecognizing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Распознавание речи...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Распознать через Whisper
                  </>
                )}
              </button>
            </div>

            <div className="relative">
              <textarea
                value={recognizedText}
                onChange={(e) => setRecognizedText(e.target.value)}
                placeholder="Нажмите «Распознать через Whisper» или введите распознанный текст оригинала..."
                rows={2}
                className="w-full bg-neutral-950 border border-neutral-800 focus:border-purple-500/80 rounded-lg p-2.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none transition-colors resize-none leading-relaxed"
              />
              {recognizedText && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(recognizedText);
                    toast.success('Оригинальный текст скопирован');
                  }}
                  className="absolute right-2 bottom-2 p-1 text-neutral-500 hover:text-neutral-300 bg-neutral-900/80 rounded"
                  title="Скопировать оригинал"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 4. Google Translate Step */}
          <div className="space-y-2 pt-1 border-t border-neutral-800/60">
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] font-semibold text-neutral-200 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-400 text-[10px] flex items-center justify-center font-bold">2</span>
                Перевод на русский (Google Translate):
              </span>
              <button
                onClick={handleTranslateText}
                disabled={isTranslating || !recognizedText.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                {isTranslating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Перевод текста...
                  </>
                ) : (
                  <>
                    <Languages className="w-3.5 h-3.5" />
                    Перевести через Google
                  </>
                )}
              </button>
            </div>

            <div className="relative">
              <textarea
                value={translatedText}
                onChange={(e) => setTranslatedText(e.target.value)}
                placeholder="Здесь появится готовый русский перевод фразы..."
                rows={2}
                className="w-full bg-neutral-950 border border-neutral-800 focus:border-blue-500/80 rounded-lg p-2.5 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none transition-colors resize-none leading-relaxed"
              />
              {translatedText && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(translatedText);
                    toast.success('Перевод скопирован');
                  }}
                  className="absolute right-2 bottom-2 p-1 text-neutral-500 hover:text-neutral-300 bg-neutral-900/80 rounded"
                  title="Скопировать перевод"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 5. Character Assignment & Insertion Option */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-neutral-800/60">
            <div>
              <label className="block text-[11px] font-medium text-neutral-300 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                Персонаж (спикер):
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  placeholder="Имя персонажа или оставьте пустым..."
                  list="character-names-list"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
                />
                <datalist id="character-names-list">
                  {characterNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                Режим вставки:
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInsertMode('new')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    insertMode === 'new'
                      ? 'bg-neutral-800 border-neutral-600 text-white shadow-xs'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-900'
                  }`}
                >
                  Новая реплика
                </button>
                {activeLineText && (
                  <button
                    type="button"
                    onClick={() => setInsertMode('replace')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      insertMode === 'replace'
                        ? 'bg-indigo-950 border-indigo-700 text-indigo-200 shadow-xs'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-900'
                    }`}
                    title="Заменить текст текущей выделенной строки"
                  >
                    Заменить текущую
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-neutral-800 flex items-center justify-between bg-neutral-950/70 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 text-xs font-medium transition-colors cursor-pointer"
          >
            Отмена
          </button>

          <button
            onClick={handleSaveToSubtitles}
            disabled={!translatedText.trim() && !recognizedText.trim()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Добавить в сабы по этому таймингу
          </button>
        </div>
      </div>
    </div>
  );
};
