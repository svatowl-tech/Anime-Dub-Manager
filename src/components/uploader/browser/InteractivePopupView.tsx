import React, { useState } from 'react';
import { BrowserTab, BrowserEngineType } from './types';
import { Episode, ProjectLinks } from '../../../types';
import { TemplateType, CustomFieldItem } from '../types';

interface InteractivePopupViewProps {
  tab: BrowserTab;
  onChangeEngine: (engine: BrowserEngineType) => void;
  onReload: () => void;
  currentEpisode?: Episode | null;
  generatedPost?: string;
  templateType?: TemplateType;
  onBuildPostText?: (type: TemplateType) => void;
  customFields?: CustomFieldItem[];
  projectLinks?: ProjectLinks;
}

export const InteractivePopupView: React.FC<InteractivePopupViewProps> = ({
  tab,
  onReload
}) => {
  const [key, setKey] = useState<number>(1);
  const targetIframeSrc = `/api/web-proxy?url=${encodeURIComponent(tab.url)}`;

  return (
    <div className="w-full h-full relative overflow-hidden bg-white">
      <iframe
        key={`full_tab_frame_${tab.id}_${key}`}
        src={targetIframeSrc}
        className="w-full h-full border-0 bg-white"
        title={tab.title || 'Вкладка'}
        style={{
          width: `${100000 / tab.zoom}%`,
          height: `${100000 / tab.zoom}%`,
          transform: `scale(${tab.zoom / 100})`,
          transformOrigin: 'top left'
        }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation allow-downloads allow-modals"
      />
    </div>
  );
};
