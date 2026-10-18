export function createTimingPassport(episode: any, clipsByTrack: Record<string, any[]>, collisions: any[]): any {
  return {
    episodeId: episode?.id,
    createdAt: new Date().toISOString(),
    clips: clipsByTrack,
    collisions
  };
}

export async function saveTimingPassportToDisk(episodeId: string, passport: any): Promise<void> {
  // No-op or implementation
}
