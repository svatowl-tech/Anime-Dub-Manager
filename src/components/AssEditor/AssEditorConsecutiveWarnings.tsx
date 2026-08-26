import React from "react";
import { Edit3, CheckSquare } from "lucide-react";

interface AssEditorConsecutiveWarningsProps {
  show: boolean;
  onClose: () => void;
  warnings: any[];
}

export default function AssEditorConsecutiveWarnings({ show, onClose, warnings }: AssEditorConsecutiveWarningsProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-4xl w-full max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between mb-6 shrink-0">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Edit3 className="w-6 h-6 text-amber-500" />
            Проверка на склейки
          </h2>
          <button 
            onClick={onClose}
            className="text-neutral-500 hover:text-white transition-colors"
          >
            Закрыть
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-2">
          {warnings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-green-500">
              <CheckSquare className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">Склеек не найдено!</p>
              <p className="text-sm text-neutral-400 mt-2">Все даберы имеют достаточно времени между репликами разных персонажей.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-amber-400 mb-4">
                Найдено {warnings.length} потенциальных склеек (разрыв менее 2 секунд между репликами разных персонажей у одного дабера).
              </p>
              {warnings.map((w, i) => (
                <div key={w.dubberName + i} className="bg-neutral-950 border border-neutral-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded text-xs font-bold">
                      {w.dubberName}
                    </span>
                    <span className="text-neutral-500 text-xs">
                      зазор: <span className={w.gap < 0 ? "text-red-400 font-bold" : "text-amber-400 font-bold"}>{w.gap.toFixed(2)}с</span>
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-neutral-900 border border-neutral-800 p-3 rounded">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-blue-400">{w.char1}</span>
                        <span className="text-[10px] text-neutral-500 font-mono">{w.time1} - {w.end1}</span>
                      </div>
                      <p className="text-sm text-neutral-300">{w.text1}</p>
                    </div>
                    <div className="bg-neutral-900 border border-neutral-800 p-3 rounded">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-purple-400">{w.char2}</span>
                        <span className="text-[10px] text-neutral-500 font-mono">{w.time2} - {w.end2}</span>
                      </div>
                      <p className="text-sm text-neutral-300">{w.text2}</p>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
