import React from "react";
import { Scissors } from "lucide-react";
import { Episode } from "../../types";

interface AssEditorHeaderProps {
  currentEpisode: Episode | null;
}

export default function AssEditorHeader({ currentEpisode }: AssEditorHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
        <Scissors className="w-5 h-5 text-white" />
      </div>
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">
          Работа с субтитрами
        </h1>
        {currentEpisode && (
          <p className="text-neutral-400 text-sm mt-1">
            Проект:{" "}
            <span className="text-indigo-400">
              {currentEpisode.project?.title}
            </span>{" "}
            • Серия {currentEpisode.number}
          </p>
        )}
      </div>
    </div>
  );
}
