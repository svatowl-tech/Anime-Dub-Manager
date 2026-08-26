import React, { useState, useRef } from 'react';
import { FileText, X, Upload, Wand2, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

interface TextToSubtitlesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (lines: any[]) => void;
}

export const TextToSubtitlesModal: React.FC<TextToSubtitlesModalProps> = ({ isOpen, onClose, onSave }) => {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [readingSpeed, setReadingSpeed] = useState(15); // characters per second
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith('.txt') && !name.endsWith('.rtf') && !name.endsWith('.doc') && !name.endsWith('.docx')) {
      toast.error('Пожалуйста, выберите текстовый файл (.txt, .rtf, .doc, .docx)');
      return;
    }

    if (name.endsWith('.docx') || name.endsWith('.doc')) {
      toast.warning('Форматы Word лучше копировать вручную в текстовое поле, файл может быть прочитан некорректно.');
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setText(event.target.result as string);
        toast.success('Файл загружен');
      }
    };
    reader.onerror = () => {
      toast.error('Ошибка при чтении файла');
    };
    reader.readAsText(file);
  };

  const formatAssTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const ms = Math.floor((totalSeconds % 1) * 100); // centiseconds
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const parseTime = (timeStr: string) => {
    // Basic parser for HH:MM:SS.ms, MM:SS, [MM:SS.ms], etc.
    const clean = timeStr.replace(/[\[\]]/g, '').trim();
    const parts = clean.split(':');
    let h = 0, m = 0, s = 0;
    
    if (parts.length === 3) {
      h = parseInt(parts[0], 10) || 0;
      m = parseInt(parts[1], 10) || 0;
      s = parseFloat(parts[2].replace(',', '.')) || 0;
    } else if (parts.length === 2) {
      m = parseInt(parts[0], 10) || 0;
      s = parseFloat(parts[1].replace(',', '.')) || 0;
    } else {
      s = parseFloat(clean.replace(',', '.')) || 0;
    }
    
    return (h * 3600) + (m * 60) + s;
  };

  const processText = () => {
    if (!text.trim()) {
      toast.error('Текст пуст');
      return;
    }

    setIsProcessing(true);
    
    setTimeout(() => {
      try {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        const resultLines: any[] = [];
        
        let hasTimestamps = false;
        
        // Regex to find timestamps at the beginning of the line
        // Examples: [00:00:00], 00:00:00.000, 00:15, [00:15.50]
        const timeRegex = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]?\s*(.*)$/;

        let currentSeconds = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(timeRegex);
          
          if (match) {
            hasTimestamps = true;
            const timeStr = match[1];
            const content = match[2];
            
            const startSec = parseTime(timeStr);
            // Guess end time based on reading speed, or next timestamp
            let endSec = startSec + Math.max(1, content.length / readingSpeed);
            
            // Look ahead for next timestamp to prevent overlaps
            if (i + 1 < lines.length) {
                const nextMatch = lines[i+1].match(timeRegex);
                if (nextMatch) {
                    const nextTime = parseTime(nextMatch[1]);
                    if (nextTime > startSec && nextTime < endSec) {
                        endSec = nextTime - 0.1;
                    }
                }
            }

            if (content.trim()) {
              resultLines.push({
                start: formatAssTime(startSec),
                end: formatAssTime(endSec),
                text: content,
                name: 'Default',
                style: 'Default'
              });
            }
          } else {
            // No timestamp on this line, but what if there are timestamps on other lines?
            // If the whole file uses mixed, this might be tricky, but we assume it's either all timed or not.
            if (!hasTimestamps) {
              // Attempt to parse sentences
              // Split by . ! ? 
              const sentences = line.match(/[^.!?]+[.!?]*/g) || [line];
              
              for (const sentence of sentences) {
                const cleanSentence = sentence.trim();
                if (!cleanSentence) continue;
                
                const duration = Math.max(1, cleanSentence.length / readingSpeed);
                const startSec = currentSeconds;
                const endSec = startSec + duration;
                
                resultLines.push({
                  start: formatAssTime(startSec),
                  end: formatAssTime(endSec),
                  text: cleanSentence,
                  name: 'Default',
                  style: 'Default'
                });
                
                currentSeconds = endSec + 0.1; // small gap
              }
            }
          }
        }
        
        if (resultLines.length === 0) {
          toast.error('Не удалось сгенерировать субтитры');
        } else {
          toast.success(`Сгенерировано ${resultLines.length} строк`);
          onSave(resultLines);
          onClose();
        }
      } catch (err: any) {
        toast.error(`Ошибка обработки: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    }, 100); // small delay to show loader
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-none">Сгенерировать субтитры из текста</h2>
              <p className="text-[10px] text-neutral-400 mt-1 uppercase tracking-wider font-bold">Парсер сырого текста</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Исходный текст</label>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all border border-neutral-700/50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Загрузить файл</span>
              </button>
              <input 
                type="file" 
                ref={fileInputRef}
                accept=".txt,.rtf,.doc,.docx" 
                className="hidden" 
                onChange={handleFileUpload} 
              />
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Вставьте текст с таймингами (например: [00:01:23] Привет!) или просто сплошной текст, который будет разбит по предложениям..."
              className="w-full h-64 bg-black/50 border border-neutral-800 rounded-xl p-4 text-sm text-neutral-300 font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none"
            />
          </div>

          <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-3">
            <h4 className="text-sm font-bold text-white">Настройки генерации</h4>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-neutral-400">Скорость чтения (символов в секунду)</label>
                <span className="text-xs font-bold text-emerald-400">{readingSpeed} симв/с</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="30" 
                value={readingSpeed} 
                onChange={(e) => setReadingSpeed(parseInt(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <p className="text-[10px] text-neutral-500">
                Используется для расчета длительности субтитров, если в тексте нет таймингов. Стандартная скорость 15-18 симв/с.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-neutral-800 bg-neutral-900/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-neutral-400 hover:text-white hover:bg-neutral-800 transition-all"
          >
            Отмена
          </button>
          <button 
            onClick={processText}
            disabled={isProcessing || !text.trim()}
            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/20"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Сгенерировать
          </button>
        </div>
      </div>
    </div>
  );
};
