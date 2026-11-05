import { useState, useEffect } from "react";
import { ipcSafe } from "../../lib/ipcSafe";
import { Episode } from "../../types";
import { bulkFilterHonorifics, DEFAULT_HONORIFICS_OPTIONS } from "../../lib/honorificsFilter";

export interface TranslatePanelProps {
  currentEpisode: Episode | null;
}

export const GENRES = [
  { id: 'shonen', name: 'Сёнен (Экшен, Энергично)', prompt: 'Тон: энергичный, молодежный, много восклицаний, боевой дух.' },
  { id: 'shojo', name: 'Сёдзе (Романтика, Эмоции)', prompt: 'Тон: эмоциональный, нежный, вежливый, акцент на чувствах.' },
  { id: 'seinen', name: 'Сейнен (Серьезно, Мрачно)', prompt: 'Тон: взрослый, реалистичный, иногда грубый или философский.' },
  { id: 'comedy', name: 'Комедия (Юмор, Сленг)', prompt: 'Тон: забавный, ироничный, использование современного сленга.' },
  { id: 'drama', name: 'Драма (Трагедия, Официоз)', prompt: 'Тон: тяжелый, официальный, глубокий, без лишнего сленга.' },
];

export const LANGUAGES = [
  { code: 'ja', name: 'Японский' },
  { code: 'en', name: 'Английский' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: 'Китайский' },
  { code: 'ko', name: 'Корейский' },
];

export const TRANSLATION_MODELS = [
  { id: 'Xenova/m2m100_418M', name: 'M2M-100 (418M)', size: '~400 MB', description: 'Самая легкая и быстрая модель.' },
  { id: 'Xenova/nllb-200-distilled-600M', name: 'NLLB-200 (600M) - Рекомендуется', size: '~600 MB', description: 'Оптимальный баланс скорости и качества.' },
  { id: 'Xenova/m2m100_1.2b', name: 'M2M-100 (1.2B)', size: '~1.2 GB', description: 'Высокое качество перевода, требует больше памяти.' },
];

export const parseAssTimeToSeconds = (timeStr: string) => {
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

export const secondsToAssTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

export function useTranslateController(currentEpisode: Episode | null) {
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
  const [filterHonorifics, setFilterHonorifics] = useState(true);
  const [showSigns, setShowSigns] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'unchecked' | 'running' | 'error'>('unchecked');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("");

  useEffect(() => {
    // Force set provider to google by default initially
    ipcSafe.invoke('get-config').then(() => {
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
            await new Promise(r => setTimeout(r, 300));
          } else {
            newTranslatedLines[i] = { ...line, originalText: line.text };
          }
        }
      }

      if (filterHonorifics) {
        const { updatedLines, changedCount } = bulkFilterHonorifics(newTranslatedLines, DEFAULT_HONORIFICS_OPTIONS);
        setTranslatedLines(updatedLines);
        setStatus(`Перевод завершен! Авто-удалено обращений в ${changedCount} репликах.`);
      } else {
        setTranslatedLines(newTranslatedLines);
        setStatus("Перевод завершен!");
      }
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
    
    if (duration < 0.05) return;

    const mid = start + duration / 2;
    const midTime = secondsToAssTime(mid);

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
    let newEnd = endA;

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

  return {
    sourceLang,
    setSourceLang,
    destLang,
    setDestLang,
    selectedGenre,
    setSelectedGenre,
    status,
    setStatus,
    isProcessing,
    translatedLines,
    setTranslatedLines,
    editingId,
    setEditingId,
    editText,
    setEditText,
    editStart,
    setEditStart,
    editEnd,
    setEditEnd,
    aiProvider,
    setAiProvider,
    allowProfanity,
    setAllowProfanity,
    filterHonorifics,
    setFilterHonorifics,
    showSigns,
    setShowSigns,
    ollamaStatus,
    ollamaModels,
    selectedOllamaModel,
    setSelectedOllamaModel,
    loadLines,
    translateSingleLine,
    handleTranslate,
    handleSave,
    startEditing,
    saveEdit,
    handleDeleteLine,
    handleDuplicateLine,
    handleAddLine
  };
}
