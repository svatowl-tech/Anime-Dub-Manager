import React, { createContext, useContext, useRef, useCallback, useMemo } from 'react';

interface PlayerControls {
  togglePlayPause: () => void;
  seekToNext?: () => void;
}

interface VideoContextType {
  togglePlayPause: () => void;
  seekToNext: () => void;
  registerPlayer: (controls: PlayerControls) => void;
  unregisterPlayer: () => void;
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);

export const VideoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const controlsRef = useRef<PlayerControls | null>(null);

  const registerPlayer = useCallback((controls: PlayerControls) => {
    controlsRef.current = controls;
  }, []);

  const unregisterPlayer = useCallback(() => {
    controlsRef.current = null;
  }, []);

  const togglePlayPause = useCallback(() => {
    if (controlsRef.current?.togglePlayPause) {
      try {
        controlsRef.current.togglePlayPause();
      } catch (error) {
        console.error('VideoContext: Error in togglePlayPause', error);
      }
    }
  }, []);

  const seekToNext = useCallback(() => {
    if (controlsRef.current?.seekToNext) {
      try {
        controlsRef.current.seekToNext();
      } catch (error) {
        console.error('VideoContext: Error in seekToNext', error);
      }
    }
  }, []);

  const contextValue = useMemo(() => ({
    togglePlayPause,
    seekToNext,
    registerPlayer,
    unregisterPlayer
  }), [togglePlayPause, seekToNext, registerPlayer, unregisterPlayer]);

  return (
    <VideoContext.Provider value={contextValue}>
      {children}
    </VideoContext.Provider>
  );
};

export const useVideoContext = () => {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideoContext must be used within a VideoProvider');
  }
  return context;
};
