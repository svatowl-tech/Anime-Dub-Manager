export const SIGN_KEYWORDS = [
  "НАДПИСЬ", "Надпись", "надпись", 
  "НАДПИСИ", "Надписи", "надписи", 
  "SIGNS", "Signs", "signs", 
  "SIGN", "Sign", "sign", 
  "TEXT", "Text", "text", 
  "ТЕКСТ", "Текст", '"текст"'
];

export const GROUP_KEYWORDS = ["гуры", "все"];

export const BATCH_SIZE = 15;

export const ROLES = [
  { id: 'ADMIN', name: 'Администратор' },
  { id: 'DUBBER', name: 'Дабер' },
  { id: 'SOUND_ENGINEER', name: 'Звукорежиссер' },
  { id: 'TRANSLATOR', name: 'Переводчик' },
  { id: 'QA', name: 'Проверяющий (QA)' },
];

export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  'PENDING': { label: 'Ожидание', color: 'bg-neutral-500' },
  'RECORDED': { label: 'Записано', color: 'bg-blue-500' },
  'FIXES_NEEDED': { label: 'Нужны правки', color: 'bg-amber-500' },
  'APPROVED': { label: 'Одобрено', color: 'bg-green-500' },
  'REJECTED': { label: 'Отклонено', color: 'bg-red-500' },
};
