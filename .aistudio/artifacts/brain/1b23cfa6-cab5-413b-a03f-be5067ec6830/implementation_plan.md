# План полной переработки Telegram-клиента с нуля (MTProto GramJS + Bot API)

## 1. Диагностика: почему старая реализация не работала

Анализ текущего монолита `electron/services/TelegramMTProtoService.cjs` (2284 строки) и исходного кода `telegram@2.26.22` (`node_modules/telegram/client/auth.js`) выявил **5 критических архитектурных ошибок**, из-за которых ломались и вход, и загрузка чатов/файлов:

1. **Ручной вызов `client._switchDC()` внутри `_invokeWithMigration` ломал ключи авторизации**:
   - В GramJS `v2.26.22` транспорт `MTProtoSender` сам обрабатывает миграции дата-центров (`PHONE_MIGRATE_X`, `USER_MIGRATE_X`, `NETWORK_MIGRATE_X`). Принудительный вызов `_switchDC()` поверх `sendCode` и `SignIn` сбрасывал контекст `phoneCodeHash` и сессионные ключи.
2. **Агрессивный поллинг `ExportLoginToken` каждые 2.5 секунды инвалидировал QR-код**:
   - Старый код вызывал `Api.auth.ExportLoginToken` в цикле каждые 2.5 секунды. В протоколе Telegram каждый новый вызов `ExportLoginToken` аннулирует предыдущий токен — пока телефон сканировал QR-код, токен уже протухал, либо срабатывал `FloodWaitError`.
   - В эталонных open-source реализациях на GramJS используется нативный метод `client.signInUserWithQrCode()`, который ждет push-события `Api.UpdateLoginToken` (или 30 секунд таймаута токена), автоматически обрабатывает `LoginTokenMigrateTo` (`ImportLoginToken`) и перехватывает `SESSION_PASSWORD_NEEDED` через `client.signInWithPassword()`.
3. **Разрозненные stateless-вызовы вместо единого Promise-автомата авторизации**:
   - Вместо поддержания живой сессии `TelegramClient` с управляемыми Promise-резолверами (`phoneCode`, `password`, `qrCode`), старый код пересоздавал клиент на разных шагах и терял состояние рукопожатия MTProto.
4. **Ошибки `PeerIdInvalidError` и `Could not find the input entity` из-за `BigInteger`**:
   - GramJS v2.26 использует `big-integer` для `id`, `accessHash` и `channelId`. Передача строковых ID без реконструкции `Api.InputPeerChannel` / `Api.InputPeerChat` / `Api.InputPeerUser` с сохраненным `accessHash` приводила к падению получения сообщений, отправки постов и скачивания аудио при холодном кэше диалогов.
5. **Отсутствие поддержки тем в супергруппах (Forum Topics / `topMsgId`)**:
   - Студии озвучки ведут работу в супергруппах с включенными темами (отдельный топик под тайтл, звук или релиз). Старый клиент не умел запрашивать список тем (`channels.GetForumTopics`) и не передавал `replyToMsgId` / `topMsgId` при сканировании дорожек, чтении и отправке сообщений.

---

## 2. Целевая архитектура бэкенда (строго модульная, ≤ 600 строк на файл)

Монолит `electron/services/TelegramMTProtoService.cjs` (2284 строки) заменяется на чистую модульную систему в `electron/services/telegram/` и тонкий фасад обратной совместимости:

- **`electron/services/telegram/telegramConfigStore.cjs`** (~220 строк)
  - Надёжное чтение/запись конфигурации и `StringSession`, кэширование известных `InputPeer` (`id + accessHash + type`) на диск, чтобы чаты и каналы открывались мгновенно даже сразу после перезапуска без повторного вызова `getDialogs`.
  - Кольцевой буфер логов с уровнями (`info`, `warn`, `error`) и экспортом статуса.
- **`electron/services/telegram/telegramAuthEngine.cjs`** (~420 строк)
  - Единый конечный автомат авторизации (`IDLE` → `QR_READY` / `CODE_SENT` → `AWAITING_2FA` → `AUTHORIZED` / `ERROR`).
  - **Вход по QR-коду**: нативный `client.signInUserWithQrCode()` с подпиской на `UpdateLoginToken`, автоматической миграцией DC и бесшовным запросом 2FA пароля через Promise-резолвер.
  - **Вход по номеру телефона + 2FA**: нативный поток через `auth.SendCode` / `auth.ResendCode` и `client.signInWithPassword()` для SRP 2FA без ручного `_switchDC`.
  - **Прямой импорт и экспорт `StringSession`**: возможность вставить готовую `StringSession` строку (или скопировать текущую для бэкапа) в один клик.
  - **Параллельный или автономный Bot API**: проверка токена через `/getMe`, отправка сообщений, медиа и кнопок даже без входа в личный MTProto-аккаунт.
- **`electron/services/telegram/telegramEntityResolver.cjs`** (~320 строк)
  - Безотказное разрешение любого `chatId` (`-100...`, `@username`, `t.me/...`, числовой ID) в валидный `Api.TypeInputPeer` с поддержкой `big-integer` и кэша `accessHash`.
  - Получение списка диалогов (`getDialogs`) с определением флага `isForum` (супергруппы с темами).
  - Получение тем форума (`Api.channels.GetForumTopics`) для любого рабочего чата студии.
- **`electron/services/telegram/telegramMediaTracks.cjs`** (~420 строк)
  - Сканирование аудиодорожек (`.wav`, `.flac`, `.mp3`, `.ogg`, `.m4a`, голосовых и архивов `.zip`/`.rar`/`.7z`) во всем чате или **внутри конкретной темы (`topMsgId` / `replyTo`)** с фильтрацией по номеру серии и имени дабера.
  - Потоковое скачивание больших файлов через `client.downloadMedia` с прогрессом, защитой от обрыва соединения и сохранением метаданных (исходное имя файла, отправитель, дата).
- **`electron/services/telegram/telegramMessagingAndPosts.cjs`** (~450 строк)
  - Чтение истории чата или ветки форума (`topMsgId`), отправка сообщений, ответов и медиафайлов (обложки, аудио, документы) через MTProto или Bot API с поддержкой HTML-разметки и закрепления (`pinMessage`).
  - Проверка вышедших постов в каналах двумя способами: через MTProto (`messages.Search` / `getMessages`) и через публичный веб-парсер `https://t.me/s/<channel>` (работает даже без авторизации).
  - Автоматические уведомления по расписанию и событиям проекта (старт записи, напоминания о дедлайнах, сдача дорожки, фиксы).
- **`electron/services/TelegramMTProtoService.cjs`** (~180 строк)
  - Тонкий фасад, объединяющий модули и сохраняющий 100% существующих IPC/HTTP методов + добавляющий новые методы (`importSessionString`, `exportSessionString`, `getAuthState`, `getForumTopics`).

---

## 3. Целевая архитектура фронтенда (`src/components/telegram/`)

Все компоненты рефакторятся с соблюдением лимита ≤ 600 строк, единого состояния и мгновенной обратной связи:

1. **Экран подключения и авторизации (`TelegramAuthView.tsx` + `useTelegramAuthController.ts`)**:
   - **4 вкладки подключения**:
     1. **QR-код (Нативный GramJS)**: мгновенная генерация QR, живой статус ожидания сканирования (`UpdateLoginToken`), автоматический переход к полю 2FA пароля при включенной двухфакторной защите.
     2. **По номеру телефона**: отправка кода в приложение Telegram / SMS, ввод кода и 2FA пароля с подсказкой (`passwordHint`).
     3. **StringSession (Быстрый токен сессии)**: импорт готовой строки сессии GramJS в 1 клик (идеально для мгновенного входа без СМС/QR) и экспорт активной сессии.
     4. **Bot API (@BotFather)**: подключение студийного бота для автопостинга и уведомлений.
2. **Селектор чатов и тем форума (`Forum Topics`)**:
   - Во вкладках **«Аудиодорожки даберов» (`TelegramTracksTab.tsx`)**, **«Мессенджер» (`TelegramMessengerTab.tsx`)**, **«Публикация постов» (`TelegramComposerTab.tsx`)** и в модальном окне чата проекта (`ProjectChatModal.tsx`) при выборе супергруппы с темами автоматически подгружается список тем (`Все сообщения чата` или конкретный топик тайтла/звука).
3. **Скачивание дорожек и архивов (`TelegramTracksTab.tsx`)**:
   - Фильтрация по топику форума, эпизоду, формату (`WAV/FLAC/MP3/ZIP`) и даберу; пакетное скачивание выбранных дорожек сразу в папку эпизода с привязкой к актеру.
4. **Проверка постов и публикация (`TelegramPostVerifyTab.tsx`, `TelegramComposerTab.tsx`, `TelegramAutomationsTab.tsx`)**:
   - Работают как через MTProto, так и через Bot API / публичный парсер `t.me/s/` (даже если пользователь подключил только бота или проверяет публичный канал).

---

## 4. План верификации

1. Проверка всех новых и обновленных модулей на соблюдение лимита размера (строго ≤ 800 строк, целевой диапазон 250–550 строк).
2. Проверка типизации и сборки через `compile_applet` и `lint_applet` (`tsc --noEmit`).
3. Проверка работы API-маршрутов в `server.ts`, IPC-хендлеров в `TelegramController.cjs` и клиентского моста `src/lib/ipc.ts`.
