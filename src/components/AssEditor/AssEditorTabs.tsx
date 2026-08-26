import React from "react";
import { Edit3, User, Languages } from "lucide-react";

interface AssEditorTabsProps {
  activeTab: "roles" | "raw" | "translate";
  setActiveTab: (tab: "roles" | "raw" | "translate") => void;
  unassignedLinesCount: number;
}

export default function AssEditorTabs({ activeTab, setActiveTab, unassignedLinesCount }: AssEditorTabsProps) {
  return (
    <div className="flex bg-neutral-900 rounded-lg p-1 border border-neutral-800">
      <button
        onClick={() => setActiveTab("raw")}
        title="Переключиться на редактор разметки реплик"
        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors relative ${
          activeTab === "raw"
            ? "bg-neutral-800 text-white shadow-sm"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
        }`}
      >
        <Edit3 className="w-4 h-4" />
        Разметка реплик
        {unassignedLinesCount > 0 && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-neutral-900 animate-pulse" />
        )}
      </button>
      <button
        onClick={() => setActiveTab("roles")}
        title="Переключиться на распределение ролей"
        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          activeTab === "roles"
            ? "bg-neutral-800 text-white shadow-sm"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
        }`}
      >
        <User className="w-4 h-4" />
        Распределение ролей
      </button>
      <button
        onClick={() => setActiveTab("translate")}
        title="Переключиться на панель перевода"
        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          activeTab === "translate"
            ? "bg-neutral-800 text-white shadow-sm"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
        }`}
      >
        <Languages className="w-4 h-4" />
        Перевод
      </button>
    </div>
  );
}
