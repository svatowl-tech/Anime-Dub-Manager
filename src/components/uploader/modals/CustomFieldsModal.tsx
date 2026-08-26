import React from 'react';
import { Copy, X, Trash2, Plus } from 'lucide-react';
import { CustomFieldItem } from '../types';

interface CustomFieldsModalProps {
  customFields: CustomFieldItem[];
  newFieldLabel: string;
  setNewFieldLabel: (val: string) => void;
  newFieldValue: string;
  setNewFieldValue: (val: string) => void;
  onAddField: () => void;
  onDeleteField: (id: string) => void;
  onClose: () => void;
}

export const CustomFieldsModal: React.FC<CustomFieldsModalProps> = ({
  customFields,
  newFieldLabel,
  setNewFieldLabel,
  newFieldValue,
  setNewFieldValue,
  onAddField,
  onDeleteField,
  onClose
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-purple-400" />
            <h3 className="font-bold text-white text-sm">Управление быстрыми полями</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Existing Custom Fields */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {customFields.map((field) => (
              <div key={field.id} className="flex items-center justify-between p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs">
                <div className="truncate pr-2 min-w-0">
                  <div className="font-semibold text-white truncate">{field.label}</div>
                  <div className="text-neutral-400 truncate text-[11px] font-mono">{field.value}</div>
                </div>
                <button
                  onClick={() => onDeleteField(field.id)}
                  className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-950/50 rounded-lg transition flex-shrink-0 cursor-pointer"
                  title="Удалить поле"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <hr className="border-neutral-800" />

          {/* Add Form */}
          <div className="space-y-2 bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-xs">
            <span className="font-semibold text-neutral-200 block">Новое поле:</span>
            <input
              type="text"
              placeholder="Метка (например, Хэштеги)"
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <input
              type="text"
              placeholder="Значение для копирования"
              value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <button
              onClick={onAddField}
              className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить поле</span>
            </button>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition cursor-pointer"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
