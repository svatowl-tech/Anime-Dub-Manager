import React from "react";

interface SubtitleShiftModalProps {
  isOpen: boolean;
  shiftAmountMs: string;
  onChangeShiftAmount: (val: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export const SubtitleShiftModal: React.FC<SubtitleShiftModalProps> = ({
  isOpen,
  shiftAmountMs,
  onChangeShiftAmount,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4">
      <div className="bg-[#111111] border border-neutral-800 rounded-lg p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2">Сдвиг времени</h3>
        <p className="text-xs text-neutral-400 mb-4">
          Введите сдвиг в миллисекундах (например: 1000 для +1 сек, -500 для -0.5 сек). Если выделены строки, сдвиг применится только к ним.
        </p>
        
        <input
          type="number"
          autoFocus
          value={shiftAmountMs}
          onChange={(e) => onChangeShiftAmount(e.target.value)}
          placeholder="Например: 1000 или -500"
          className="w-full bg-neutral-900 border border-neutral-700 rounded p-2 text-white text-sm mb-6 outline-none focus:border-indigo-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onClose();
          }}
        />
        
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors cursor-pointer"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};
