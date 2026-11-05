import React, { useEffect, useRef } from "react";
import { Languages, FileText, Loader2, RefreshCw, Save, Edit3, Check, X, AlertCircle, ChevronDown, BrainCircuit, Eye, EyeOff, Trash2, Plus, Copy, Sparkles } from "lucide-react";
import { SIGN_KEYWORDS } from "../constants";
import { bulkFilterHonorifics, DEFAULT_HONORIFICS_OPTIONS } from "../lib/honorificsFilter";
import {
  TranslatePanelProps,
  GENRES,
  LANGUAGES,
  TRANSLATION_MODELS,
  parseAssTimeToSeconds,
  secondsToAssTime,
  useTranslateController
} from "./translate/useTranslateController";

export {
  type TranslatePanelProps,
  GENRES,
  LANGUAGES,
  TRANSLATION_MODELS,
  parseAssTimeToSeconds,
  secondsToAssTime,
  useTranslateController
};

export interface TranslatedLineRowProps {
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

export const TranslatedLineRow = React.memo(({
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
  const {
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
    translateSingleLine,
    handleTranslate,
    handleSave,
    startEditing,
    saveEdit,
    handleDeleteLine,
    handleDuplicateLine,
    handleAddLine
  } = useTranslateController(currentEpisode);

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

              <div className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white">Японские обращения</span>
                  <span className="text-[10px] text-neutral-500 italic">Фильтровать -кун, -тян, -сан, -сенсей</span>
                </div>
                <button
                  onClick={() => setFilterHonorifics(!filterHonorifics)}
                  className={`w-12 h-6 rounded-full transition-all relative ${filterHonorifics ? 'bg-indigo-600' : 'bg-neutral-800'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${filterHonorifics ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>
            
            <div className="pt-4 space-y-3">
              <button
                onClick={() => {
                  const { updatedLines, changedCount } = bulkFilterHonorifics(translatedLines, DEFAULT_HONORIFICS_OPTIONS);
                  setTranslatedLines(updatedLines);
                  setStatus(`Удалены обращения в ${changedCount} репликах.`);
                }}
                disabled={isProcessing || translatedLines.length === 0}
                className="w-full px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-indigo-300 rounded-xl font-medium text-xs transition-all flex items-center justify-center gap-2 border border-neutral-700"
                title="Очистить все текущие реплики от японских обращений (-кун, -тян, -сан, -сама, -сэнсэй...)"
              >
                <Sparkles className="w-4 h-4 text-indigo-400" />
                Фильтровать обращения в списке
              </button>

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
