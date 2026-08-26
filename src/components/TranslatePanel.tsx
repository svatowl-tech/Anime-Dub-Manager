import React, { useState, useEffect, useRef } from "react";
import { Languages, FileText, Loader2, RefreshCw, Save, Edit3, Check, X, AlertCircle, ChevronDown, BrainCircuit, Eye, EyeOff, Trash2, Plus, Copy, Scissors } from "lucide-react";
import { ipcSafe } from "../lib/ipcSafe";
import { Episode } from "../types";
import { BATCH_SIZE, SIGN_KEYWORDS } from "../constants";

interface TranslatePanelProps {
  currentEpisode: Episode | null;
}

const GENRES = [
  { id: 'shonen', name: 'Сёнен (Экшен, Энергично)', prompt: 'Тон: энергичный, молодежный, много восклицаний, боевой дух.' },
  { id: 'shojo', name: 'Сёдзе (Романтика, Эмоции)', prompt: 'Тон: эмоциональный, нежный, вежливый, акцент на чувствах.' },
  { id: 'seinen', name: 'Сейнен (Серьезно, Мрачно)', prompt: 'Тон: взрослый, реалистичный, иногда грубый или философский.' },
  { id: 'comedy', name: 'Комедия (Юмор, Сленг)', prompt: 'Тон: забавный, ироничный, использование современного сленга.' },
  { id: 'drama', name: 'Драма (Трагедия, Официоз)', prompt: 'Тон: тяжелый, официальный, глубокий, без лишнего сленга.' },
];

const LANGUAGES = [
  { code: 'ja', name: 'Японский' },
  { code: 'en', name: 'Английский' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: 'Китайский' },
  { code: 'ko', name: 'Корейский' },
];

const TRANSLATION_MODELS = [
  { id: 'Xenova/m2m100_418M', name: 'M2M-100 (418M)', size: '~400 MB', description: 'Самая легкая и быстрая модель.' },
  { id: 'Xenova/nllb-200-distilled-600M', name: 'NLLB-200 (600M) - Рекомендуется', size: '~600 MB', description: 'Оптимальный баланс скорости и качества.' },
  { id: 'Xenova/m2m100_1.2b', name: 'M2M-100 (1.2B)', size: '~1.2 GB', description: 'Высокое качество перевода, требует больше памяти.' },
];

interface TranslatedLineRowProps {
  line: any;
  idx: number;
  editingId: string | number | null;
  editText: string;
  editStart: string;
  editEnd: string;
  sourceLang: string;
  setEditText: (t: string) => void;
  setEditStart: (s: string) => void;
  setEditEnd: (e: string) => void;
  saveEdit: (id: string | number) => void;
  setEditingId: (id: string | number | null) => void;
  handleAddLine: (id: string | number) => void;
  handleDuplicateLine: (id: string | number) => void;
  translateSingleLine: (idx: number) => void;
  startEditing: (id: string | number, text: string, start: string, end: string) => void;
  handleDeleteLine: (id: string | number) => void;
}

const TranslatedLineRow = React.memo(({
  line,
  idx,
  editingId,
  editText,
  editStart,
  editEnd,
  setEditText,
  setEditStart,
  setEditEnd,
  saveEdit,
  setEditingId,
  handleAddLine,
  handleDuplicateLine,
  translateSingleLine,
  startEditing,
  handleDeleteLine
}: TranslatedLineRowProps) => {
  const isEditing = editingId === line.id;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Adjust height
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  return (
    <tr key={line.id} className="border-b border-neutral-800/50 hover:bg-white/5 transition-colors group">
      <td className="p-4 text-sm text-neutral-400 italic font-light border-r border-neutral-800/50">
        {line.originalText || line.text}
      </td>
      <td className="p-4 text-sm text-white relative">
        {isEditing ? (
          <div className="flex gap-2 w-full">
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editStart}
                  onChange={e => setEditStart(e.target.value)}
                  className="w-24 bg-neutral-950 border border-neutral-700/50 rounded-lg p-1 px-2 text-xs font-mono text-neutral-300 focus:outline-none focus:border-indigo-500"
                />
                <span className="text-neutral-500">-</span>
                <input
                  type="text"
                  value={editEnd}
                  onChange={e => setEditEnd(e.target.value)}
                  className="w-24 bg-neutral-950 border border-neutral-700/50 rounded-lg p-1 px-2 text-xs font-mono text-neutral-300 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                className="w-full bg-neutral-950 border border-indigo-500 rounded-lg p-2 text-sm text-white focus:outline-none min-h-[60px]"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = target.scrollHeight + 'px';
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <button 
                onClick={(e) => { e.stopPropagation(); saveEdit(line.id); }} 
                className="p-2 bg-emerald-600 rounded-lg text-white hover:bg-emerald-500"
              >
                <Check className="w-4 h-4" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setEditingId(null); }} 
                className="p-2 bg-neutral-800 rounded-lg text-white hover:bg-neutral-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-start gap-4" onClick={() => startEditing(line.id, line.text, line.start, line.end)}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-neutral-500 font-mono">{line.start} - {line.end}</span>
                {line.name && <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 rounded">{line.name}</span>}
              </div>
              <span>{line.text || <span className="opacity-20 italic">Пустая реплика</span>}</span>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all" onClick={e => e.stopPropagation()}>
              <button 
                onClick={() => handleAddLine(line.id)}
                title="Добавить пустую реплику ниже"
                className="p-1.5 text-neutral-500 hover:text-emerald-400"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button 
                onClick={() => handleDuplicateLine(line.id)}
                title="Дублировать / Разделить реплику"
                className="p-1.5 text-neutral-500 hover:text-indigo-400"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button 
                onClick={() => translateSingleLine(idx)}
                title="Перевести эту реплику"
                className="p-1.5 text-neutral-500 hover:text-indigo-400"
              >
                <BrainCircuit className="w-4 h-4" />
              </button>
              <button 
                onClick={() => startEditing(line.id, line.text, line.start, line.end)}
                title="Редактировать вручную"
                className="p-1.5 text-neutral-500 hover:text-amber-400"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button 
                onClick={() => handleDeleteLine(line.id)}
                title="Удалить реплику"
                className="p-1.5 text-neutral-500 hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
});

export default function TranslatePanel({ currentEpisode }: TranslatePanelProps) {
  const [sourceLang, setSourceLang] = useState("ja");
  const [destLang, setDestLang] = useState("ru");
  const [selectedGenre, setSelectedGenre] = useState(GENRES[0].id);
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [translatedLines, setTranslatedLines] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editText, setEditText] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [aiProvider, setAiProvider] = useState<string>("google");
  const [allowProfanity, setAllowProfanity] = useState(true);
  const [showSigns, setShowSigns] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'unchecked' | 'running' | 'error'>('unchecked');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("");

  useEffect(() => {
    // Force set provider to google by default initially
    ipcSafe.invoke('get-config').then(config => {
      setAiProvider('google');
    });

    // Check Ollama status
    const checkOllama = async () => {
      try {
        const res = await ipcSafe.invoke('check-ollama-status');
        if (res.success) {
          setOllamaStatus('running');
          const modelsRes = await ipcSafe.invoke('get-ollama-models');
          if (modelsRes.success && modelsRes.models.length > 0) {
            setOllamaModels(modelsRes.models);
            setSelectedOllamaModel(modelsRes.models[0]);
          }
        } else {
          setOllamaStatus('error');
        }
      } catch (err) {
        setOllamaStatus('error');
      }
    };
    checkOllama();
  }, []);

  useEffect(() => {
    if (currentEpisode?.subPath) {
      loadLines();
    } else {
      setTranslatedLines([]);
      setStatus("");
      setEditingId(null);
    }
  }, [currentEpisode]);

  const loadLines = async () => {
    if (!currentEpisode?.subPath) return;
    setIsProcessing(true);
    setStatus("Загрузка реплик...");
    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines = data.lines || data;
      setTranslatedLines(lines.map((l: any) => ({
        ...l,
        originalText: l.text,
        // We keep text as is initially, or we could clear it if we want to show it's not translated
        // But usually it's better to show the current state
      })));
      setStatus(`Загружено ${lines.length} реплик.`);
    } catch (error: any) {
      console.error("Load error:", error);
      setStatus(`Ошибка загрузки: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const translateSingleLine = async (index: number) => {
    if (!currentEpisode?.subPath) return;

    const line = translatedLines[index];
    if (!line.originalText || !line.originalText.trim()) return;

    setStatus(`Перевод реплики ${index + 1}...`);
    
    try {
      const result = await ipcSafe.invoke('translate-text', {
        text: line.originalText,
        sourceLang,
        destLang
      });
      const translatedText = result['destination-text'];

      const newLines = [...translatedLines];
      newLines[index] = { ...line, text: translatedText };
      setTranslatedLines(newLines);
      setStatus("Готово!");
    } catch (error: any) {
      console.error("Single line translation error:", error);
      setStatus(`Ошибка: ${error.message}`);
    }
  };
  const handleTranslate = async () => {
    if (!currentEpisode?.subPath) {
      setStatus("Файл субтитров не найден.");
      return;
    }

    setIsProcessing(true);
    setStatus("Загрузка субтитров...");

    try {
      // 1. Get raw subtitles
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines = data.lines || data;
      
      const genreInfo = GENRES.find(g => g.id === selectedGenre);
      const sourceLangName = LANGUAGES.find(l => l.code === sourceLang)?.name || sourceLang;
      const destLangName = LANGUAGES.find(l => l.code === destLang)?.name || destLang;

      const newTranslatedLines = [...lines];
      const glossary: Record<string, string> = {};
      
      // Parse glossary from project if available
      if (currentEpisode.project?.globalMapping) {
        try {
          const mapping = JSON.parse(currentEpisode.project.globalMapping);
          Object.assign(glossary, mapping);
        } catch (e) {}
      }
      if (currentEpisode.project?.characterAliases) {
        try {
          const aliases = JSON.parse(currentEpisode.project.characterAliases);
          Object.assign(glossary, aliases);
        } catch (e) {}
      }

      if (aiProvider === 'ollama' && selectedOllamaModel) {
        setStatus("Формирование батчей для перевода Ollama (сохранение контекста)...");
        
        // Group lines by context (up to 5 if no characters, or up to 10 if there are characters, or separate by big gaps)
        const batches: any[][] = [];
        let currentBatch: any[] = [];
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (currentBatch.length === 0) {
            currentBatch.push(line);
            continue;
          }
          
          const prevLine = currentBatch[currentBatch.length - 1];
          const prevEnd = parseAssTimeToSeconds(prevLine.end || '0:00:00.00');
          const currStart = parseAssTimeToSeconds(line.start || '0:00:00.00');
          const gap = currStart - prevEnd;
          
          const hasCharacters = currentBatch.some(l => l.name) || line.name;
          
          if (hasCharacters) {
            if (gap > 2.0 || currentBatch.length >= 10) {
              batches.push(currentBatch);
              currentBatch = [line];
            } else {
              currentBatch.push(line);
            }
          } else {
            if (currentBatch.length >= 5) {
              batches.push(currentBatch);
              currentBatch = [line];
            } else {
              currentBatch.push(line);
            }
          }
        }
        if (currentBatch.length > 0) batches.push(currentBatch);
        
        let translatedCount = 0;
        for (let bIdx = 0; bIdx < batches.length; bIdx++) {
          const batch = batches[bIdx];
          setStatus(`Оллама: Перевод батча ${bIdx + 1} из ${batches.length} (реплики ${translatedCount + 1}-${translatedCount + batch.length})...`);
          
          const res = await ipcSafe.invoke('translate-ollama-batch', {
            modelName: selectedOllamaModel,
            linesBatch: batch,
            sourceLang: sourceLangName,
            destLang: destLangName
          });
          
          if (res.success && res.batch && Array.isArray(res.batch)) {
            // Merge translated batch back
            const translatedBatch = res.batch;
            for (let i = 0; i < batch.length; i++) {
              const origLine = batch[i];
              const origIndex = lines.findIndex((l: any) => l.id === origLine.id);
              if (origIndex !== -1) {
                const translatedObj = translatedBatch.find((t: any) => t.id === origLine.id) || translatedBatch[i];
                newTranslatedLines[origIndex] = {
                  ...origLine,
                  originalText: origLine.text,
                  text: translatedObj?.translatedText || origLine.text,
                  name: translatedObj?.name || origLine.name
                };
              }
            }
          } else {
            console.error(`Ollama batch ${bIdx} failed:`, res.error);
            // Fallback for this batch if failed
            for (const line of batch) {
              const origIndex = lines.findIndex((l: any) => l.id === line.id);
              if (origIndex !== -1) {
                newTranslatedLines[origIndex] = { ...line, originalText: line.text };
              }
            }
          }
          translatedCount += batch.length;
        }

      } else {
        setStatus("Использую стандартный (внешний) перевод...");
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.text && line.text.trim()) {
            setStatus(`Перевод реплики ${i + 1} / ${lines.length}...`);
            const result = await ipcSafe.invoke('translate-text', {
              text: line.text,
              sourceLang,
              destLang
            });
            newTranslatedLines[i] = {
              ...line,
              originalText: line.text,
              text: result['destination-text']
            };
            // Небольшая задержка, чтобы не получить 429 Too Many Requests от публичного API Google
            await new Promise(r => setTimeout(r, 300));
          } else {
            newTranslatedLines[i] = { ...line, originalText: line.text };
          }
        }
      }

      setTranslatedLines(newTranslatedLines);
      setStatus("Перевод завершен!");
    } catch (error: any) {
      console.error("Translation error:", error);
      setStatus(`Ошибка: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!currentEpisode?.subPath || translatedLines.length === 0) return;
    
    setIsProcessing(true);
    setStatus("Сохранение перевода...");
    
    try {
      await ipcSafe.invoke('save-translated-subtitles', {
        assFilePath: currentEpisode.subPath,
        translatedLines
      });
      setStatus("Перевод успешно сохранен в файл!");
    } catch (error) {
      console.error("Save error:", error);
      setStatus("Ошибка при сохранении.");
    } finally {
      setIsProcessing(false);
    }
  };

  const startEditing = (id: string | number, text: string, start: string = "", end: string = "") => {
    setEditingId(id);
    setEditText(text);
    setEditStart(start);
    setEditEnd(end);
  };

  const saveEdit = (id: string | number) => {
    const newLines = [...translatedLines];
    const index = newLines.findIndex(l => l.id === id);
    if (index !== -1) {
      newLines[index].text = editText;
      newLines[index].start = editStart || newLines[index].start;
      newLines[index].end = editEnd || newLines[index].end;
      setTranslatedLines(newLines);
    }
    setEditingId(null);
  };

  const handleDeleteLine = (id: string | number) => {
    if (!confirm('Вы уверены, что хотите удалить эту реплику?')) return;
    const newLines = translatedLines.filter(l => l.id !== id);
    setTranslatedLines(newLines);
  };

  const handleDuplicateLine = (id: string | number) => {
    const index = translatedLines.findIndex(l => l.id === id);
    if (index === -1) return;
    
    const newLines = [...translatedLines];
    const line = newLines[index];
    const start = parseAssTimeToSeconds(line.start);
    const end = parseAssTimeToSeconds(line.end);
    const duration = end - start;
    
    if (duration < 0.05) return; // Prevent creating too small lines

    const mid = start + duration / 2;
    const midTime = secondsToAssTime(mid);

    // Update current line
    newLines[index] = { ...line, end: midTime };

    const newId = `dup-${Date.now()}-${Math.random()}`;
    const newLine = { 
      ...line, 
      start: midTime,
      id: newId, 
      originalIndex: undefined, 
      rawLineIndex: undefined 
    };
    newLines.splice(index + 1, 0, newLine);
    setTranslatedLines(newLines);
  };

  const parseAssTimeToSeconds = (timeStr: string) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    return 0;
  };

  const secondsToAssTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };

  const handleAddLine = (id: string | number) => {
    const index = translatedLines.findIndex(l => l.id === id);
    if (index === -1) return;
    
    const newLines = [...translatedLines];
    const prevLine = { ...newLines[index] };
    const nextLine = index + 1 < newLines.length ? { ...newLines[index + 1] } : undefined;
    
    const startA = parseAssTimeToSeconds(prevLine.start);
    const endA = parseAssTimeToSeconds(prevLine.end);
    const durationA = endA - startA;
    const takeA = durationA / 2;
    const newEndA = endA - takeA;

    prevLine.end = secondsToAssTime(newEndA);
    newLines[index] = prevLine;

    let newStart = newEndA;
    let newEnd = endA; // Default if no next line

    if (nextLine) {
      const startB = parseAssTimeToSeconds(nextLine.start);
      const endB = parseAssTimeToSeconds(nextLine.end);
      const durationB = endB - startB;
      const takeB = durationB / 2;
      const newStartB = startB + takeB;
      
      const updatedNext = { ...nextLine, start: secondsToAssTime(newStartB) };
      newLines[index + 1] = updatedNext;
      newEnd = newStartB;
    }

    const newId = `add-${Date.now()}-${Math.random()}`;
    const newLine = {
      ...prevLine,
      text: '',
      originalText: '',
      start: secondsToAssTime(newStart),
      end: secondsToAssTime(newEnd),
      originalIndex: undefined,
      id: newId,
      rawLineIndex: undefined
    };
    
    newLines.splice(index + 1, 0, newLine);
    setTranslatedLines(newLines);
  };

  return (
    <div className="space-y-6 w-full h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="p-2 bg-indigo-600/20 rounded-lg">
            <Languages className="w-6 h-6 text-indigo-400" />
          </div>
          Перевод субтитров
        </h2>
        {currentEpisode && (
          <div className="px-4 py-1.5 bg-neutral-800 rounded-full text-xs font-medium text-neutral-400 border border-neutral-700">
            Серия {currentEpisode.number}
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Settings Panel */}
        <div className="lg:col-span-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Способ перевода</label>
                <div className="relative">
                  <select 
                    value={aiProvider} 
                    onChange={e => setAiProvider(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    <option value="google">Google Облако (Стабильно)</option>
                    <option value="ollama">Ollama (Нейросеть с контекстом)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {aiProvider === 'ollama' && (
                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2 flex items-center justify-between">
                    Модель Ollama
                    <div className="flex items-center gap-1">
                      {ollamaStatus === 'running' ? (
                        <><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div><span className="text-[9px] text-green-500 normal-case">работает</span></>
                      ) : ollamaStatus === 'error' ? (
                        <><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div><span className="text-[9px] text-red-500 normal-case">недоступна</span></>
                      ) : (
                        <><div className="w-1.5 h-1.5 rounded-full bg-neutral-500"></div><span className="text-[9px] text-neutral-500 normal-case">проверка...</span></>
                      )}
                    </div>
                  </label>
                  <div className="relative">
                    <select 
                      value={selectedOllamaModel} 
                      onChange={e => setSelectedOllamaModel(e.target.value)} 
                      disabled={ollamaStatus !== 'running' || ollamaModels.length === 0}
                      className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors disabled:opacity-50"
                    >
                      {ollamaModels.length > 0 ? (
                        ollamaModels.map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))
                      ) : (
                        <option value="">{ollamaStatus === 'running' ? 'Нет установленных моделей' : 'Ollama не запущена'}</option>
                      )}
                    </select>
                    <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              )}


              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Исходный язык</label>
                <div className="relative">
                  <select 
                    value={sourceLang} 
                    onChange={e => setSourceLang(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Язык перевода</label>
                <div className="relative">
                  <select 
                    value={destLang} 
                    onChange={e => setDestLang(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Жанр / Тон перевода</label>
                <div className="relative">
                  <select 
                    value={selectedGenre} 
                    onChange={e => setSelectedGenre(e.target.value)} 
                    className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-xl px-4 py-3 appearance-none focus:border-indigo-500 outline-none transition-colors"
                  >
                    {GENRES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white">Бранная лексика</span>
                  <span className="text-[10px] text-neutral-500 italic">Разрешить мат в переводе</span>
                </div>
                <button
                  onClick={() => setAllowProfanity(!allowProfanity)}
                  className={`w-12 h-6 rounded-full transition-all relative ${allowProfanity ? 'bg-red-600' : 'bg-neutral-800'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${allowProfanity ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>
            
            <div className="pt-4 space-y-3">
              <button
                onClick={() => setShowSigns(!showSigns)}
                className={`w-full px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-3 border ${
                  showSigns 
                    ? "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30" 
                    : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"
                }`}
                title={showSigns ? "Скрыть технические субтитры" : "Показать технические субтитры"}
              >
                {showSigns ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                {showSigns ? "Надписи: ВКЛ" : "Надписи: ВЫКЛ"}
              </button>

              <button
                onClick={handleTranslate}
                disabled={isProcessing || !currentEpisode?.subPath}
                className="w-full px-4 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/20"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                {isProcessing ? "Обработка..." : "Запустить перевод"}
              </button>
              
              <button
                onClick={handleSave}
                disabled={isProcessing || translatedLines.length === 0}
                className="w-full px-4 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-600/20"
              >
                <Save className="w-5 h-5" />
                Применить и сохранить
              </button>
            </div>
            
            {status && (
              <div className={`p-4 rounded-xl text-xs flex gap-3 ${status.includes('Ошибка') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'}`}>
                {status.includes('Ошибка') ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
                <p>{status}</p>
              </div>
            )}
          </div>
        </div>

        {/* Lines List */}
        <div className="lg:col-span-3 flex flex-col min-h-0">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl flex flex-col flex-1 min-h-0">
            <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">Список реплик</span>
              </div>
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                Всего: {translatedLines.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {translatedLines.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-neutral-900 z-10">
                    <tr className="border-b border-neutral-800">
                      <th className="p-4 text-[10px] font-bold text-neutral-500 uppercase tracking-widest w-1/2">Оригинал ({sourceLang})</th>
                      <th className="p-4 text-[10px] font-bold text-neutral-500 uppercase tracking-widest w-1/2">Перевод ({destLang})</th>
                    </tr>
                  </thead>
                      <tbody>
                        {translatedLines
                          .filter(line => {
                            if (showSigns) return true;
                            const name = (line.name || "").toLowerCase();
                            const style = (line.style || "").toLowerCase();
                            
                            const signs = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];
                            
                            const isSign = signs.some(s => {
                              if (s === 'op' || s === 'ed') {
                                const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
                                return regex.test(name) || regex.test(style);
                              }
                              return name.includes(s) || style.includes(s);
                            }) || SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));

                            if (!name && style && isSign) return false;
                            return !isSign;
                          })
                          .map((line) => {
                            const idx = translatedLines.indexOf(line);
                            return (
                              <TranslatedLineRow
                                key={line.id}
                                line={line}
                                idx={idx}
                                editingId={editingId}
                                editText={editText}
                                editStart={editStart}
                                editEnd={editEnd}
                                sourceLang={sourceLang}
                                setEditText={setEditText}
                                setEditStart={setEditStart}
                                setEditEnd={setEditEnd}
                                saveEdit={saveEdit}
                                setEditingId={setEditingId}
                                handleAddLine={handleAddLine}
                                handleDuplicateLine={handleDuplicateLine}
                                translateSingleLine={translateSingleLine}
                                startEditing={startEditing}
                                handleDeleteLine={handleDeleteLine}
                              />
                            );
                          })}
                      </tbody>
                </table>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-4">
                  <Languages className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium uppercase tracking-widest opacity-40">Запустите перевод для отображения списка</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
