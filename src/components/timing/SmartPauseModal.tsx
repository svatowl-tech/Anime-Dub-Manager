import React from 'react';

export function SmartPauseModal({ isOpen, onClose, onApply }: { isOpen: boolean; onClose: () => void; onApply: (diffs: any[]) => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 w-[480px] max-w-full text-white">
        <h3 className="text-lg font-bold mb-3">Умные паузы и дыхание</h3>
        <p className="text-sm text-neutral-400 mb-6">Автоматическая оптимизация пауз между репликами.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm">Закрыть</button>
          <button onClick={() => { onApply([]); onClose(); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold">Применить</button>
        </div>
      </div>
    </div>
  );
}
