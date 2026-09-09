import React from 'react';
import { AlertCircle, Save, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  onSaveAndProceed: () => void | Promise<void>;
  onDiscardAndProceed: () => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  title = 'Несохраненные изменения',
  message = 'У вас есть несохраненные изменения. Сохранить их перед переходом?',
  onSaveAndProceed,
  onDiscardAndProceed,
  onCancel,
  isSaving = false,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
                <p className="text-neutral-400 text-sm leading-relaxed">{message}</p>
              </div>
              <button
                onClick={onCancel}
                disabled={isSaving}
                className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
                title="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-end">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors order-3 sm:order-1"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={onDiscardAndProceed}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-950/70 border border-red-800/40 rounded-lg transition-colors order-2"
              >
                Не сохранять
              </button>
              <button
                type="button"
                onClick={onSaveAndProceed}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 order-1 sm:order-3"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Сохранение...' : 'Сохранить и перейти'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
