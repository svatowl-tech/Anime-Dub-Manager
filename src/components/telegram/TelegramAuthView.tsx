import React, { useState, useEffect, useRef } from 'react';
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
  Bot
} from 'lucide-react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';

interface TelegramAuthViewProps {
  onSuccess: () => void;
  savedPhone?: string;
  savedApiId?: string;
  savedApiHash?: string;
  savedBotToken?: string;
}

const DEFAULT_TG_API_ID = '2040';
const DEFAULT_TG_API_HASH = 'b18441a1ff607e10a989891a5462e627';

export const TelegramAuthView: React.FC<TelegramAuthViewProps> = ({
  onSuccess,
  savedPhone = '',
  savedApiId = '',
  savedApiHash = '',
  savedBotToken = ''
}) => {
  // Auth Mode: 'qr' | 'phone' | 'bot'
  const [authMode, setAuthMode] = useState<'qr' | 'phone' | 'bot'>('qr');

  // Shared API credentials
  const [apiId, setApiId] = useState<string>(savedApiId);
  const [apiHash, setApiHash] = useState<string>(savedApiHash);
  const [showAdvancedApiSettings, setShowAdvancedApiSettings] = useState<boolean>(false);

  // Phone Auth State
  const [phoneNumber, setPhoneNumber] = useState<string>(savedPhone);
  const [phoneCode, setPhoneCode] = useState<string>('');
  const [password2FA, setPassword2FA] = useState<string>('');
  const [passwordHint, setPasswordHint] = useState<string>('');
  const [isCodeSent, setIsCodeSent] = useState<boolean>(false);
  const [is2FARequired, setIs2FARequired] = useState<boolean>(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'app' | 'sms'>('app');
  const [resendTimer, setResendTimer] = useState<number>(0);

  // QR Auth State
  const [isQrActive, setIsQrActive] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrExpiresIn, setQrExpiresIn] = useState<number>(30);
  const [isQr2FARequired, setIsQr2FARequired] = useState<boolean>(false);
  const [qr2FAPassword, setQr2FAPassword] = useState<string>('');

  // Bot Token Auth State
  const [botToken, setBotToken] = useState<string>(savedBotToken);

  // General state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showLogs, setShowLogs] = useState<boolean>(true);
  const [logs, setLogs] = useState<Array<{ time: string; text: string; isError?: boolean }>>([]);

  const qrPollIntervalRef = useRef<any>(null);
  const lastBackendLogRef = useRef<string>('');
  const lastQrDataUrlRef = useRef<string>('');
  const qrExpiresUnixRef = useRef<number>(0);

  const getEffectiveCredentials = () => {
    const effId = apiId.trim() ? Number(apiId.trim()) : Number(DEFAULT_TG_API_ID);
    const effHash = apiHash.trim() ? apiHash.trim() : DEFAULT_TG_API_HASH;
    return { apiId: effId, apiHash: effHash };
  };

  const addLog = (text: string, isError = false) => {
    const time = new Date().toLocaleTimeString('ru-RU');
    setLogs(prev => [...prev.slice(-30), { time, text, isError }]);
  };

  // Resend SMS timer countdown
  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  // QR Code Expiry Countdown synced with actual token expiration timestamp
  useEffect(() => {
    let interval: any;
    if (isQrActive && !isQr2FARequired) {
      interval = setInterval(() => {
        if (qrExpiresUnixRef.current > 0) {
          const remaining = Math.max(1, qrExpiresUnixRef.current - Math.floor(Date.now() / 1000));
          setQrExpiresIn(remaining);
        } else {
          setQrExpiresIn(prev => (prev > 1 ? prev - 1 : 1));
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isQrActive, isQr2FARequired]);

  // Clean up QR polling on unmount
  useEffect(() => {
    return () => {
      if (qrPollIntervalRef.current) {
        clearInterval(qrPollIntervalRef.current);
      }
    };
  }, []);

  // START QR AUTH FLOW
  const handleStartQrAuth = async () => {
    const creds = getEffectiveCredentials();

    setIsLoading(true);
    addLog('Инициализация сессии и генерация QR-кода авторизации MTProto...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-start-qr', {
        apiId: creds.apiId,
        apiHash: creds.apiHash
      });

      if (res && res.success) {
        if (res.me) {
          addLog(`Успешный вход: ${res.me?.firstName || res.me?.username || 'Авторизован'}`);
          toast.success('Сессия Telegram подтверждена!');
          onSuccess();
          return;
        }

        const initialUrl = res.qrDataUrl || '';
        lastQrDataUrlRef.current = initialUrl;
        setQrDataUrl(initialUrl);

        const expUnix = Number(res.expires || 0);
        qrExpiresUnixRef.current = expUnix;
        const remaining = expUnix > 0 ? Math.max(1, expUnix - Math.floor(Date.now() / 1000)) : 30;
        setQrExpiresIn(remaining);

        setIsQrActive(true);
        setIsQr2FARequired(false);
        addLog('QR-код сгенерирован. Ожидание сканирования с мобильного устройства...');
        toast.success('QR-код готов к сканированию!');

        startQrPolling();
      } else {
        throw new Error(res?.error || 'Не удалось запустить авторизацию по QR');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Ошибка генерации QR: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const startQrPolling = () => {
    if (qrPollIntervalRef.current) {
      clearInterval(qrPollIntervalRef.current);
    }

    qrPollIntervalRef.current = setInterval(async () => {
      try {
        const status = await ipcSafe.invoke('telegram-mtproto-check-qr');
        if (!status) return;

        // Fetch latest backend logs to show live progress only when changed
        try {
          const backendLogs = await ipcSafe.invoke('telegram-mtproto-get-logs', { limit: 5 });
          if (Array.isArray(backendLogs) && backendLogs.length > 0) {
            const latest = backendLogs[backendLogs.length - 1];
            if (latest && latest.message && latest.message !== lastBackendLogRef.current) {
              lastBackendLogRef.current = latest.message;
              addLog(`[${latest.tag}] ${latest.message}`, latest.level === 'error');
            }
          }
        } catch (lErr) {}

        if (
          status.status === 'authenticated' ||
          (status.me && (status.status === 'connected' || status.status === 'authenticated'))
        ) {
          clearInterval(qrPollIntervalRef.current);
          qrPollIntervalRef.current = null;
          setIsQrActive(false);
          const userName =
            status.me?.firstName || status.me?.username || status.me?.id || 'Пользователь';
          addLog(`Вход по QR-коду успешно выполнен: ${userName}`);
          toast.success(`Успешная авторизация в Telegram: ${userName}`);
          onSuccess();
        } else if (status.status === 'password_required') {
          clearInterval(qrPollIntervalRef.current);
          qrPollIntervalRef.current = null;
          if (status.passwordHint) {
            setPasswordHint(status.passwordHint);
          }
          setIsQr2FARequired(true);
          addLog(
            `QR-код подтвержден на телефоне. Требуется ввод 2FA пароля${
              status.passwordHint ? ` (подсказка: ${status.passwordHint})` : ''
            }`
          );
          toast.info('Введите облачный пароль 2FA двухфакторной защиты Telegram');
        } else if (status.qrDataUrl && status.qrDataUrl !== lastQrDataUrlRef.current) {
          lastQrDataUrlRef.current = status.qrDataUrl;
          setQrDataUrl(status.qrDataUrl);
          if (status.expires) {
            qrExpiresUnixRef.current = Number(status.expires);
            setQrExpiresIn(Math.max(1, Number(status.expires) - Math.floor(Date.now() / 1000)));
          } else {
            setQrExpiresIn(30);
          }
        } else if (status.expires && status.expires !== qrExpiresUnixRef.current) {
          qrExpiresUnixRef.current = Number(status.expires);
        } else if (status.status === 'error') {
          clearInterval(qrPollIntervalRef.current);
          qrPollIntervalRef.current = null;
          setIsQrActive(false);
          addLog(`Ошибка QR: ${status.error}`, true);
          toast.error(status.error || 'Ошибка авторизации по QR');
        }
      } catch (e: any) {
        console.warn('QR polling check error:', e);
      }
    }, 1800);
  };

  const handleRefreshQr = async () => {
    try {
      addLog('Принудительное обновление токена QR-кода...');
      const creds = getEffectiveCredentials();
      const res = await ipcSafe.invoke('telegram-mtproto-start-qr', {
        apiId: creds.apiId,
        apiHash: creds.apiHash
      });
      if (res && res.qrDataUrl) {
        lastQrDataUrlRef.current = res.qrDataUrl;
        setQrDataUrl(res.qrDataUrl);
        const expUnix = Number(res.expires || 0);
        qrExpiresUnixRef.current = expUnix;
        setQrExpiresIn(expUnix > 0 ? Math.max(1, expUnix - Math.floor(Date.now() / 1000)) : 30);
      }
    } catch (e: any) {
      console.warn('Refresh QR failed:', e);
    }
  };

  const handleCancelQr = async () => {
    if (qrPollIntervalRef.current) {
      clearInterval(qrPollIntervalRef.current);
      qrPollIntervalRef.current = null;
    }
    setIsQrActive(false);
    setIsQr2FARequired(false);
    await ipcSafe.invoke('telegram-mtproto-cancel-qr');
    addLog('Авторизация по QR-коду отменена.');
  };

  const handleSubmitQr2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qr2FAPassword.trim()) {
      toast.error('Введите пароль 2FA');
      return;
    }

    setIsLoading(true);
    addLog('Проверка пароля двухфакторной аутентификации...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-submit-password', {
        password: qr2FAPassword.trim()
      });

      if (res && res.success) {
        addLog(`Успешный вход: ${res.me?.firstName || res.me?.username || 'Авторизован'}`);
        toast.success('Успешная авторизация в Telegram!');
        setIsQrActive(false);
        onSuccess();
      } else {
        throw new Error(res?.error || 'Неверный пароль 2FA');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Ошибка 2FA: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // PHONE AUTH FLOW
  const handleSendCode = async (e?: React.FormEvent, forceSMS = false) => {
    if (e) e.preventDefault();
    if (!phoneNumber.trim()) {
      toast.error('Введите номер телефона (напр. +79991234567)');
      return;
    }

    const creds = getEffectiveCredentials();

    setIsLoading(true);
    addLog(`Отправка запроса на получение кода для ${phoneNumber}...`);
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-send-code', {
        phoneNumber: phoneNumber.trim(),
        apiId: creds.apiId,
        apiHash: creds.apiHash,
        forceSMS
      });

      if (res && res.success) {
        setIsCodeSent(true);
        setDeliveryMethod(res.deliveryMethod || (res.isCodeViaApp ? 'app' : 'sms'));
        setResendTimer(60);
        addLog(res.message || 'Код успешно отправлен!');
        toast.success(res.message || 'Код авторизации отправлен');
      } else {
        throw new Error(res?.error || 'Не удалось отправить код');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Ошибка отправки: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignInPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneCode.trim()) {
      toast.error('Введите код подтверждения из Telegram');
      return;
    }

    setIsLoading(true);
    addLog('Проверка кода подтверждения...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-sign-in', {
        phoneCode: phoneCode.trim(),
        password: password2FA.trim() || undefined
      });

      if (res && res.requiresPassword) {
        setIs2FARequired(true);
        if (res.hint) setPasswordHint(res.hint);
        addLog(
          `Требуется пароль двухфакторной аутентификации (2FA Cloud Password)${
            res.hint ? ` — подсказка: ${res.hint}` : ''
          }`
        );
        toast.info('На аккаунте включен 2FA пароль. Введите его для завершения входа.');
        return;
      }

      if (res && (res.success || res.status === 'connected')) {
        addLog(`Успешный вход: ${res.me?.firstName || res.me?.username || 'Авторизован'}`);
        toast.success('Успешная авторизация в Telegram MTProto!');
        onSuccess();
      } else {
        throw new Error(res?.error || 'Ошибка входа');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Ошибка авторизации: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0) return;
    setIsLoading(true);
    addLog('Запрос повторной отправки кода...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-resend-code', { forceSMS: true });
      if (res && res.success) {
        setResendTimer(60);
        setDeliveryMethod(res.deliveryMethod || 'sms');
        addLog(res.message || 'Новый код отправлен!');
        toast.success(res.message || 'Код отправлен повторно');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Ошибка повторной отправки: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // BOT TOKEN AUTH FLOW
  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken.trim()) {
      toast.error('Введите токен бота от @BotFather');
      return;
    }

    setIsLoading(true);
    addLog('Проверка токена бота через Telegram Bot API...');
    try {
      const res = await ipcSafe.invoke('telegram-bot-test-connection', {
        botToken: botToken.trim()
      });
      if (res && res.success && res.bot) {
        await ipcSafe.invoke('telegram-mtproto-save-settings', {
          botToken: botToken.trim()
        });
        addLog(`Бот успешно подключен: @${res.bot.username} (${res.bot.firstName})`);
        toast.success(`Бот @${res.bot.username} успешно подключен!`);
        onSuccess();
      } else {
        throw new Error(res?.error || 'Не удалось проверить токен бота');
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Ошибка Bot API: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

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
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                Direct Engine
              </span>
            </h3>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Прямое подключение к MTProto позволяет сканировать рабочие чаты, скачивать дорожки даберов,
              проверять выход постов и рассылать уведомления.
            </p>
          </div>
        </div>

        {/* Credentials guide note */}
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

      {/* Tabs Selector */}
      <div className="grid grid-cols-3 gap-1.5 bg-neutral-950 p-1.5 rounded-2xl border border-neutral-800">
        <button
          type="button"
          onClick={() => {
            setAuthMode('qr');
            setIsCodeSent(false);
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            authMode === 'qr'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>QR-код</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode('phone');
            handleCancelQr();
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            authMode === 'phone'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>По номеру</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthMode('bot');
            handleCancelQr();
          }}
          className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            authMode === 'bot'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Bot Token</span>
        </button>
      </div>

      {/* Main Auth Form Container */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-xl space-y-5">
        {authMode === 'qr' ? (
          /* =================== QR CODE MODE =================== */
          <div className="space-y-4">
            {!isQrActive ? (
              <div className="space-y-4">
                <div className="p-3.5 bg-sky-950/30 border border-sky-800/40 rounded-xl text-xs text-sky-200 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block text-white mb-0.5">
                      Самый быстрый и надежный способ входа:
                    </span>
                    Не требует ожидания SMS или ввода кодов. Отсканируйте QR-код камерой в мобильном приложении Telegram.
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
                        ? '▾ Скрыть настройки API Telegram'
                        : '▸ Настройки API ID / Hash (необязательно)'}
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.2 rounded">
                      Ключи по умолчанию активны
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
                          placeholder="2040 (по умолчанию)"
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
                  className="w-full py-3.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
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
                      className="w-60 h-60 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="w-60 h-60 flex items-center justify-center bg-neutral-100 text-neutral-500">
                      <RefreshCw className="w-8 h-8 animate-spin text-sky-600" />
                    </div>
                  )}

                  {/* QR refresh countdown badge */}
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-neutral-900 border border-neutral-700 text-neutral-300 rounded-full text-[11px] font-mono shadow-md flex items-center gap-1.5 whitespace-nowrap">
                    <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
                    Автообновление: <span className="text-white font-bold">{qrExpiresIn}с</span>
                  </div>
                </div>

                {/* Instructions Steps */}
                <div className="w-full bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 text-left space-y-2">
                  <h4 className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5" />
                    Инструкция по сканированию:
                  </h4>
                  <ol className="text-xs text-neutral-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Откройте <strong>Telegram</strong> на смартфоне.</li>
                    <li>Перейдите в <strong>Настройки → Устройства → Подключить устройство</strong>.</li>
                    <li>Наведите камеру телефона на QR-код выше.</li>
                  </ol>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={handleRefreshQr}
                    className="flex-1 py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Обновить код сейчас
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
        ) : authMode === 'phone' ? (
          /* =================== PHONE NUMBER MODE =================== */
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
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition"
                  />
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedApiSettings(!showAdvancedApiSettings)}
                    className="text-xs text-neutral-400 hover:text-sky-400 transition flex items-center gap-1.5 cursor-pointer py-1 font-medium"
                  >
                    <span>
                      {showAdvancedApiSettings
                        ? '▾ Скрыть настройки API Telegram'
                        : '▸ Настройки API ID / Hash (необязательно)'}
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.2 rounded">
                      Ключи по умолчанию активны
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
                          placeholder="2040 (по умолчанию)"
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

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-sky-400" />
                    Код подтверждения
                  </label>
                  <input
                    type="text"
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    placeholder="5-значный код"
                    required
                    autoFocus
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-lg text-white font-mono tracking-widest text-center focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition"
                  />
                </div>

                {is2FARequired && (
                  <div className="space-y-1.5 animate-fadeIn">
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
                      className="w-full bg-neutral-950 border border-amber-500/50 rounded-xl px-3.5 py-2.5 text-sm text-white focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none transition"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={resendTimer > 0 || isLoading}
                    className="px-3.5 py-2.5 rounded-xl border border-neutral-800 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 transition cursor-pointer"
                  >
                    {resendTimer > 0
                      ? `Повторно через ${resendTimer}с`
                      : 'Запросить код повторно'}
                  </button>

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
                        Войти в аккаунт
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          /* =================== BOT TOKEN MODE =================== */
          <form onSubmit={handleConnectBot} className="space-y-4">
            <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl text-xs text-purple-200 flex items-start gap-2.5">
              <Bot className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block text-white mb-0.5">
                  Подключение студийного бота (@BotFather):
                </span>
                Позволяет мгновенно публиковать релизные посты, закреплять анонсы и отправлять командные уведомления в чаты и каналы без входа в личный аккаунт.
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
            Лог подключения Telegram
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
