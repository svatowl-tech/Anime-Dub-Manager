export type BrowserEngineType = 
  | 'smart-proxy' 
  | 'direct-webview' 
  | 'sandbox-iframe' 
  | 'popup-overlay' 
  | 'reader-extractor';

export interface PageExtractedData {
  title?: string;
  description?: string;
  ogImage?: string;
  canonicalUrl?: string;
  videoSources?: string[];
  links?: Array<{ text: string; href: string }>;
  tags?: string[];
  status?: string;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  engine: BrowserEngineType;
  error?: string | null;
  extractedData?: PageExtractedData | null;
  isMuted?: boolean;
  isAudible?: boolean;
  capturedMedia?: string[];
}

export interface BookmarkItem {
  id: string;
  name: string;
  url: string;
  color?: string;
  defaultEngine?: BrowserEngineType;
}
