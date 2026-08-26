import React, { useState, useMemo } from 'react';
import { Check, X, CheckSquare, Square, Search, Sparkles, Filter, ArrowRight } from 'lucide-react';
import { CorrectionLine } from '../../types/diarization';

interface CorrectionReviewViewProps {
  correctionLines: CorrectionLine[];
  onApply: (approvedLines: CorrectionLine[]) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export const CorrectionReviewView: React.FC<CorrectionReviewViewProps> = ({
  correctionLines,
  onApply,
  onCancel,
  isSaving,
}) => {
  const [lines, setLines] = useState<CorrectionLine[]>(correctionLines);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyChanges, setOnlyChanges] = useState(false);

  const filteredLines = useMemo(() => {
    return lines.filter(l => {
      const matchesSearch = 
        (l.text || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (l.oldName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (l.proposedName || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      if (onlyChanges) {
        return matchesSearch && (l.oldName !== l.proposedName);
      }
      return matchesSearch;
    });
  }, [lines, searchQuery, onlyChanges]);

  const approvedCount = lines.filter(l => l.approved).length;

  const handleToggle = (lineId: string | number) => {
    setLines(prev => prev.map(l => l.lineId === lineId ? { ...l, approved: !l.approved } : l));
  };

  const handleSelectAll = () => {
    const allApproved = filteredLines.every(l => l.approved);
    const targetIds = new Set(filteredLines.map(l => l.lineId));
    setLines(prev => prev.map(l => targetIds.has(l.lineId) ? { ...l, approved: !allApproved } : l));
  };

  const handleProposedNameChange = (lineId: string | number, newName: string) => {
    setLines(prev => prev.map(l => l.lineId === lineId ? { ...l, proposedName: newName, approved: true } : l));
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-xl">
      {/* Top Bar */}
      <div className="p-4 border-b border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-neutral-950/60 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg">
              <Sparkles className="w-4 h-4" />
            </span>
            <h3 className="text-base font-bold text-white">
              Предпросмотр и утверждение персонажей
            </h3>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Утверждено {approvedCount} из {lines.length} реплик. Вы можете точечно изменить имя любого персонажа.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={() => onApply(lines)}
            disabled={isSaving || approvedCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-md transition-colors"
          >
            <Check className="w-4 h-4" />
            Применить ({approvedCount})
          </button>
        </div>
      </div>

      {/* Filter / Search Row */}
      <div className="p-3 border-b border-neutral-800 bg-neutral-900 flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск по тексту или персонажу..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 rounded-lg">
            <input
              type="checkbox"
              checked={onlyChanges}
              onChange={(e) => setOnlyChanges(e.target.checked)}
              className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Только измененные ({lines.filter(l => l.oldName !== l.proposedName).length})</span>
          </label>

          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 rounded-lg transition-colors"
          >
            {filteredLines.every(l => l.approved) ? (
              <>
                <Square className="w-3.5 h-3.5 text-indigo-400" />
                Снять все
              </>
            ) : (
              <>
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                Выбрать все
              </>
            )}
          </button>
        </div>
      </div>

      {/* Lines Table */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/60 min-h-0">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-neutral-950/80 sticky top-0 z-10 border-b border-neutral-800 text-neutral-400 uppercase tracking-wider font-semibold text-[10px]">
            <tr>
              <th className="p-3 w-10 text-center">✓</th>
              <th className="p-3 w-20">Время</th>
              <th className="p-3 w-36">Текущее имя</th>
              <th className="p-3 w-44">Новое имя</th>
              <th className="p-3">Текст реплики</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-850">
            {filteredLines.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-neutral-500">
                  Реплики не найдены
                </td>
              </tr>
            ) : (
              filteredLines.map((line) => {
                const isChanged = line.oldName !== line.proposedName;
                return (
                  <tr
                    key={line.lineId}
                    className={`hover:bg-neutral-800/40 transition-colors ${
                      line.approved ? 'bg-indigo-950/10' : 'opacity-60'
                    }`}
                  >
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={line.approved}
                        onChange={() => handleToggle(line.lineId)}
                        className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="p-3 font-mono text-neutral-400 whitespace-nowrap">
                      {line.start}
                    </td>
                    <td className="p-3 font-medium text-neutral-400">
                      {line.oldName || <span className="text-neutral-600">—</span>}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={line.proposedName}
                          onChange={(e) => handleProposedNameChange(line.lineId, e.target.value)}
                          className={`w-full px-2.5 py-1 text-xs rounded border bg-neutral-950 text-white focus:outline-none focus:border-indigo-500 font-semibold ${
                            isChanged ? 'border-indigo-500/50 text-indigo-200' : 'border-neutral-800'
                          }`}
                        />
                      </div>
                    </td>
                    <td className="p-3 text-neutral-200 font-normal line-clamp-2">
                      {line.text}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
