/**
 * ============================================================================
 * STEM SEPARATION & AUDIO HARDWARE RESOURCE SERVICE
 * ============================================================================
 */

export interface DeviceMemoryCheckResult {
  supported: boolean;
  availableMemoryMb?: number;
  reason?: string;
}

/**
 * Проверяет доступность оперативной памяти браузера / устройства перед загрузкой нейросетевых моделей.
 */
export function checkDeviceMemoryForModel(requiredMb = 30): DeviceMemoryCheckResult {
  if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
    const memGb = (navigator as any).deviceMemory || 4;
    const memMb = memGb * 1024;
    if (memMb < requiredMb * 2) {
      return {
        supported: false,
        availableMemoryMb: memMb,
        reason: `Недостаточно оперативной памяти устройства (${memMb} МБ доступно, требуется минимум ${requiredMb} МБ).`
      };
    }
    return {
      supported: true,
      availableMemoryMb: memMb
    };
  }

  // Если API недоступно, предполагаем стандартную рабочую среду десктопа
  return {
    supported: true,
    availableMemoryMb: 4096
  };
}
