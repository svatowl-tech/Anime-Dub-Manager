import React from 'react';
import {
  Smartphone,
  Lock,
  Key,
  Send,
  ShieldCheck,
  RefreshCw,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle2,
  QrCode,
  Sparkles,
  Camera,
  XCircle,
  Bot,
  FileKey
} from 'lucide-react';
import {
  TelegramAuthViewProps,
  DEFAULT_TG_API_ID,
  DEFAULT_TG_API_HASH,
  useTelegramAuthController
} from './useTelegramAuthController';

export { DEFAULT_TG_API_ID, DEFAULT_TG_API_HASH, useTelegramAuthController };
export type { TelegramAuthViewProps };

export const TelegramAuthView: React.FC<TelegramAuthViewProps> = (props) => {
  const {
    authMode,
    setAuthMode,
    apiId,
    setApiId,
    apiHash,
    setApiHash,
    showAdvancedApiSettings,
    setShowAdvancedApiSettings,
    phoneNumber,
    setPhoneNumber,
    phoneCode,
    setPhoneCode,
    password2FA,
    setPassword2FA,
    passwordHint,
    isCodeSent,
    setIsCodeSent,
    is2FARequired,
    setIs2FARequired,
    deliveryMethod,
    resendTimer,
    isQrActive,
    qrDataUrl,
    qrExpiresIn,
    isQr2FARequired,
    qr2FAPassword,
    setQr2FAPassword,
    sessionStringInput,
    setSessionStringInput,
    botToken,
    setBotToken,
    isLoading,
    showLogs,
    setShowLogs,
    logs,
    handleStartQrAuth,
    handleRefreshQr,
    handleCancelQr,
    handleSubmitQr2FA,
    handleSendCode,
    handleSignInPhone,
    handleResendCode,
    handleImportSessionString,
    handleConnectBot
  } = useTelegramAuthController(props);

  return (
    <div className="max-w-2xl mx-auto p-2 sm:p-4 space-y-5">
      {/* Header Info */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 flex-shrink-0">
            <Send className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
              Подключение Telegram MTProto & Bot API
            </h3>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Прямое подключение к серверам Telegram позволяет сканировать рабочие чаты и темы (Forum Topics),
              скачивать дорожки даберов, публиковать релизы и отправлять автоматические уведомления.
            </p>
          </div>
        </div>

        <div className="mt-3.5 pt-3 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-400">
          <span>Персональные ключи API (опционально):</span>
          <a
            href="https://my.telegram.org"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 font-medium hover:underline"
          >
            my.telegram.org <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* 4-Mode Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-neutral-950 p-1.5 rounded-2xl border border-neutral-800">
        <button
          type="button"
          onClick={() => {
            setAuthMode('qr');
            setIsCodeSent(false);
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            authMode === 'qr'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <QrCode className="w-3.5 h-3.5 shrink-0" />
          <span>QR-код</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode('phone');
            handleCancelQr();
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            authMode === 'phone'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span>По номеру</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode('session');
            handleCancelQr();
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            authMode === 'session'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <FileKey className="w-3.5 h-3.5 shrink-0" />
          <span>StringSession</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode('bot');
            handleCancelQr();
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
            authMode === 'bot'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span>Bot Token</span>
        </button>
      </div>

      {/* Main Auth Form Container */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-xl space-y-5">
        {authMode === 'qr' && (
          /* =================== 1. QR CODE MODE =================== */
          <div className="space-y-4">
            {!isQrActive ? (
              <div className="space-y-4">
                <div className="p-3.5 bg-sky-950/30 border border-sky-800/40 rounded-xl text-xs text-sky-200 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block text-white mb-0.5">
                      Нативный вход по QR-коду (GramJS MTProto):
                    </span>
                    Откройте Telegram на смартфоне → Настройки → Устройства → Подключить устройство.
                    Если на аккаунте включен облачный пароль 2FA, форма сама попросит ввести его после сканирования.
                  </div>
                </div>

                {/* Optional Advanced API Credentials Toggle */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedApiSettings(!showAdvancedApiSettings)}
                    className="text-xs text-neutral-400 hover:text-sky-400 transition flex items-center gap-1.5 cursor-pointer py-1 font-medium"
                  >
                    <span>
                      {showAdvancedApiSettings
                        ? '▾ Скрыть настройки API ID / Hash'
                        : '▸ Настройки API ID / Hash (по умолчанию активны)'}
                    </span>
                  </button>

                  {showAdvancedApiSettings && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 p-3 bg-neutral-950/60 rounded-xl border border-neutral-800">
                      <div>
                        <label className="block text-[11px] font-semibold text-neutral-300 mb-1 flex items-center gap-1.5">
                          <Key className="w-3 h-3 text-sky-400" />
                          API ID
                        </label>
                        <input
                          type="text"
                          value={apiId}
                          onChange={(e) => setApiId(e.target.value)}
                          placeholder="2040"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-sky-500 outline-none transition font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-neutral-300 mb-1 flex items-center gap-1.5">
                          <ShieldCheck className="w-3 h-3 text-sky-400" />
                          API Hash
                        </label>
                        <input
                          type="password"
                          value={apiHash}
                          onChange={(e) => setApiHash(e.target.value)}
                          placeholder="По умолчанию встроен"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-sky-500 outline-none transition font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleStartQrAuth}
                  disabled={isLoading}
                  className="w-full py-3.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Генерация QR-кода...
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4" />
                      Сгенерировать QR-код для входа
                    </>
                  )}
                </button>
              </div>
            ) : isQr2FARequired ? (
              /* QR Step 2: 2FA Password Submit */
              <form onSubmit={handleSubmitQr2FA} className="space-y-4">
                <div className="p-4 bg-amber-950/40 border border-amber-600/50 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 text-amber-300 font-bold">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    QR-код успешно подтвержден на телефоне!
                  </div>
                  <p className="text-neutral-300">
                    На вашем аккаунте включен <strong>облачный пароль 2FA</strong>. Введите его ниже для завершения входа:
                  </p>
                  {passwordHint && (
                    <div className="text-amber-200 font-mono text-[11px] bg-amber-950/60 px-2.5 py-1 rounded border border-amber-800/50">
                      Подсказка к паролю: <strong>{passwordHint}</strong>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    Пароль двухфакторной аутентификации (2FA)
                  </label>
                  <input
                    type="password"
                    value={qr2FAPassword}
                    onChange={(e) => setQr2FAPassword(e.target.value)}
                    placeholder={passwordHint ? `Подсказка: ${passwordHint}` : 'Введите ваш 2FA пароль'}
                    required
                    autoFocus
                    className="w-full bg-neutral-950 border border-amber-500/60 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none transition"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCancelQr}
                    className="px-4 py-2.5 rounded-xl border border-neutral-800 text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Проверка...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Завершить вход
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* QR Display & Instructions */
              <div className="flex flex-col items-center text-center space-y-5">
                <div className="relative p-3 bg-white rounded-2xl shadow-2xl border-4 border-sky-500/30 inline-block">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Telegram Login QR Code"
                      referrerPolicy="no-referrer"
                      className="w-60 h-60 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="w-60 h-60 flex items-center justify-center bg-neutral-100 text-neutral-500">
                      <RefreshCw className="w-8 h-8 animate-spin text-sky-600" />
                    </div>
                  )}

                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-neutral-900 border border-neutral-700 text-neutral-300 rounded-full text-[11px] font-mono tabular-nums shadow-md flex items-center gap-1.5 whitespace-nowrap">
                    <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
                    Действителен: <span className="text-white font-bold">{qrExpiresIn}с</span>
                  </div>
                </div>

                <div className="w-full bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 text-left space-y-2">
                  <h4 className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5" />
                    Инструкция по сканированию:
                  </h4>
                  <ol className="text-xs text-neutral-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Откройте <strong>Telegram</strong> на смартфоне.</li>
                    <li>Перейдите в <strong>Настройки → Устройства → Подключить устройство</strong>.</li>
                    <li>Наведите камеру телефона на QR-код выше и дождитесь автоматического входа.</li>
                  </ol>
                </div>

                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={handleRefreshQr}
                    className="flex-1 py-2.5 px-4 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-200 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                    Я отсканировал (Проверить сейчас)
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelQr}
                    className="py-2.5 px-4 border border-neutral-800 hover:bg-red-500/10 hover:border-red-500/30 text-neutral-400 hover:text-red-300 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {authMode === 'phone' && (
          /* =================== 2. PHONE NUMBER MODE =================== */
          <div>
            {!isCodeSent ? (
              <form onSubmit={(e) => handleSendCode(e, false)} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                    Номер телефона Telegram
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+79991234567"
                    required
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition font-mono"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Отправка кода...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Получить код подтверждения
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignInPhone} className="space-y-4">
                <div className="bg-sky-950/40 border border-sky-800/60 rounded-xl p-3.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-sky-300">
                    <CheckCircle2 className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <span>
                      Код отправлен в{' '}
                      <strong>
                        {deliveryMethod === 'app' ? 'чат «Telegram» в приложении' : 'SMS'}
                      </strong>{' '}
                      на номер {phoneNumber}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCodeSent(false);
                      setIs2FARequired(false);
                    }}
                    className="text-neutral-400 hover:text-white underline cursor-pointer"
                  >
                    Изменить
                  </button>
                </div>

                {!is2FARequired && (
                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-sky-400" />
                      Код подтверждения из Telegram / SMS
                    </label>
                    <input
                      type="text"
                      value={phoneCode}
                      onChange={(e) => setPhoneCode(e.target.value)}
                      placeholder="5-значный код"
                      required={!is2FARequired}
                      autoFocus
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-lg text-white font-mono tracking-widest text-center focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition"
                    />
                  </div>
                )}

                {is2FARequired && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                      Облачный пароль 2FA {passwordHint ? `(подсказка: ${passwordHint})` : ''}
                    </label>
                    <input
                      type="password"
                      value={password2FA}
                      onChange={(e) => setPassword2FA(e.target.value)}
                      placeholder="Введите ваш 2FA пароль от аккаунта"
                      required
                      autoFocus
                      className="w-full bg-neutral-950 border border-amber-500/50 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none transition"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  {!is2FARequired && (
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={resendTimer > 0 || isLoading}
                      className="px-3.5 py-2.5 rounded-xl border border-neutral-800 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 transition cursor-pointer tabular-nums"
                    >
                      {resendTimer > 0
                        ? `Повторно через ${resendTimer}с`
                        : 'Запросить по SMS'}
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Вход...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        {is2FARequired ? 'Подтвердить пароль 2FA' : 'Войти в аккаунт'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {authMode === 'session' && (
          /* =================== 3. DIRECT STRING SESSION IMPORT =================== */
          <form onSubmit={handleImportSessionString} className="space-y-4">
            <div className="p-3.5 bg-emerald-950/30 border border-emerald-800/40 rounded-xl text-xs text-emerald-200 flex items-start gap-2.5">
              <FileKey className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block text-white mb-0.5">
                  Мгновенный вход по готовой StringSession:
                </span>
                Если у вас уже есть строка сессии GramJS (или вы экспортировали её ранее в настройках),
                вставьте её ниже — подключение произойдет мгновенно без SMS и без QR-кода.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                Строка сессии GramJS (StringSession)
              </label>
              <textarea
                value={sessionStringInput}
                onChange={(e) => setSessionStringInput(e.target.value)}
                rows={3}
                placeholder="1BVtsO... (вставьте строку StringSession)"
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-white font-mono focus:border-emerald-500 outline-none transition resize-y"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !sessionStringInput.trim()}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Проверка сессии...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Импортировать и войти
                </>
              )}
            </button>
          </form>
        )}

        {authMode === 'bot' && (
          /* =================== 4. BOT TOKEN MODE =================== */
          <form onSubmit={handleConnectBot} className="space-y-4">
            <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl text-xs text-purple-200 flex items-start gap-2.5">
              <Bot className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block text-white mb-0.5">
                  Подключение студийного бота (@BotFather):
                </span>
                Позволяет мгновенно публиковать релизные посты, закреплять анонсы и отправлять командные уведомления в чаты, темы (Forum Topics) и каналы без входа в личный аккаунт.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-purple-400" />
                HTTP API Токен бота (от @BotFather)
              </label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz..."
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-purple-500 outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Проверка токена...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Проверить и подключить бота
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Live Logs Collapsible */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg">
        <button
          type="button"
          onClick={() => setShowLogs(!showLogs)}
          className="w-full px-4 py-2.5 bg-neutral-950/80 flex items-center justify-between text-xs font-medium text-neutral-400 hover:text-white transition cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            Лог подключения Telegram ({logs.length})
          </span>
          {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showLogs && (
          <div className="p-3 bg-neutral-950 font-mono text-[11px] max-h-36 overflow-y-auto space-y-1">
            {logs.length === 0 ? (
              <div className="text-neutral-600 italic">Ожидание действий...</div>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 ${
                    l.isError ? 'text-red-400' : 'text-neutral-300'
                  }`}
                >
                  <span className="text-neutral-500 flex-shrink-0">[{l.time}]</span>
                  <span className="break-all">{l.text}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
