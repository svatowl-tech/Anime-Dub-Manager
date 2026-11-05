import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ipcSafe } from '../../lib/ipcSafe';
import { TelegramMTProtoSettings } from '../../types';

export interface TelegramAuthViewProps {
  settings?: TelegramMTProtoSettings;
  status?: string;
  savedPhone?: string;
  savedApiId?: string;
  savedApiHash?: string;
  savedBotToken?: string;
  onSuccess: () => Promise<void>;
}

export const DEFAULT_TG_API_ID = '2040';
export const DEFAULT_TG_API_HASH = 'b18441a1ed607e10a39be2731a544f07';

export type TelegramAuthMode = 'qr' | 'phone' | 'session' | 'bot';

export function useTelegramAuthController({
  settings,
  status = 'disconnected',
  savedPhone = '',
  savedApiId = '',
  savedApiHash = '',
  savedBotToken = '',
  onSuccess
}: TelegramAuthViewProps) {
  const [authMode, setAuthMode] = useState<TelegramAuthMode>('qr');

  const [apiId, setApiId] = useState<string>(
    savedApiId || (settings?.apiId ? String(settings.apiId) : DEFAULT_TG_API_ID)
  );
  const [apiHash, setApiHash] = useState<string>(
    savedApiHash || settings?.apiHash || DEFAULT_TG_API_HASH
  );
  const [showAdvancedApiSettings, setShowAdvancedApiSettings] = useState<boolean>(false);

  // Phone Auth State
  const [phoneNumber, setPhoneNumber] = useState<string>(
    savedPhone || settings?.phoneNumber || ''
  );
  const [phoneCode, setPhoneCode] = useState<string>('');
  const [password2FA, setPassword2FA] = useState<string>('');
  const [passwordHint, setPasswordHint] = useState<string>('');

  const [isCodeSent, setIsCodeSent] = useState<boolean>(
    status === 'code_sent' || status === 'password_required'
  );
  const [is2FARequired, setIs2FARequired] = useState<boolean>(status === 'password_required');
  const [deliveryMethod, setDeliveryMethod] = useState<'app' | 'sms'>('app');
  const [resendTimer, setResendTimer] = useState<number>(0);

  // QR Auth State
  const [isQrActive, setIsQrActive] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [qrExpiresAt, setQrExpiresAt] = useState<number>(0);
  const [qrExpiresIn, setQrExpiresIn] = useState<number>(30);
  const [isQr2FARequired, setIsQr2FARequired] = useState<boolean>(false);
  const [qr2FAPassword, setQr2FAPassword] = useState<string>('');

  // StringSession Direct Import State
  const [sessionStringInput, setSessionStringInput] = useState<string>('');

  // Bot Token Auth State
  const [botToken, setBotToken] = useState<string>(
    savedBotToken || settings?.botToken || ''
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [logs, setLogs] = useState<{ time: string; text: string; isError?: boolean }[]>([]);

  const qrPollRef = useRef<any>(null);
  const qrCountdownRef = useRef<any>(null);
  const qrCheckBusyRef = useRef<boolean>(false);

  const addLog = (text: string, isError = false) => {
    const time = new Date().toLocaleTimeString('ru-RU');
    setLogs((prev) => [...prev.slice(-40), { time, text, isError }]);
  };

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((t) => (t > 0 ? t - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  // Countdown display for QR expiration
  useEffect(() => {
    if (isQrActive && !isQr2FARequired && qrExpiresAt > 0) {
      qrCountdownRef.current = setInterval(() => {
        const rem = Math.max(0, qrExpiresAt - Math.floor(Date.now() / 1000));
        setQrExpiresIn(rem);
      }, 1000);
    }
    return () => {
      if (qrCountdownRef.current) clearInterval(qrCountdownRef.current);
    };
  }, [isQrActive, isQr2FARequired, qrExpiresAt]);

  // Poll QR status every 3 seconds without regenerating the token unless expired
  useEffect(() => {
    if (isQrActive && !isQr2FARequired) {
      qrPollRef.current = setInterval(async () => {
        await checkQrStatusOnce(false);
      }, 3000);
    }

    return () => {
      if (qrPollRef.current) clearInterval(qrPollRef.current);
    };
  }, [isQrActive, isQr2FARequired]);

  // Cleanup QR on unmount
  useEffect(() => {
    return () => {
      if (qrPollRef.current) clearInterval(qrPollRef.current);
      if (qrCountdownRef.current) clearInterval(qrCountdownRef.current);
    };
  }, []);

  const checkQrStatusOnce = async (forceRefresh = false) => {
    if (qrCheckBusyRef.current) return;
    qrCheckBusyRef.current = true;
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-check-qr', { forceRefresh });
      if (!res) return;

      if (res.status === 'authorized' || res.authorized) {
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        if (qrCountdownRef.current) clearInterval(qrCountdownRef.current);
        setIsQrActive(false);
        addLog(
          `QR-код подтвержден! Выполнен вход: ${res.me?.firstName || 'Пользователь'}`
        );
        toast.success(
          `Добро пожаловать, ${res.me?.firstName || res.me?.username || 'в Telegram'}!`
        );
        await onSuccess();
        return;
      }

      if (res.status === 'password_required') {
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        if (qrCountdownRef.current) clearInterval(qrCountdownRef.current);
        setIsQr2FARequired(true);
        if (res.passwordHint) setPasswordHint(res.passwordHint);
        addLog('QR-код отсканирован! Введите облачный пароль двухфакторной защиты (2FA).');
        toast.info('Введите ваш облачный пароль 2FA для завершения входа');
        return;
      }

      if (res.qrDataUrl && res.qrDataUrl !== qrDataUrl) {
        setQrDataUrl(res.qrDataUrl);
      }
      if (res.qrUrl) {
        setQrUrl(res.qrUrl);
      }
      if (res.expires) {
        setQrExpiresAt(Number(res.expires));
        const rem = Math.max(0, Number(res.expires) - Math.floor(Date.now() / 1000));
        setQrExpiresIn(rem);
      }
    } catch (err: any) {
      addLog(`Проверка QR: ${err.message || String(err)}`, true);
    } finally {
      qrCheckBusyRef.current = false;
    }
  };

  // Start QR Login Flow
  const handleStartQrAuth = async () => {
    const finalApiId = Number(apiId.trim() || DEFAULT_TG_API_ID);
    const finalApiHash = apiHash.trim() || DEFAULT_TG_API_HASH;

    setIsLoading(true);
    setIsQr2FARequired(false);
    addLog(`Запуск генерации QR-кода (API ID: ${finalApiId})...`);

    try {
      const res = await ipcSafe.invoke('telegram-mtproto-start-qr', {
        apiId: finalApiId,
        apiHash: finalApiHash
      });

      if (res && (res.status === 'authorized' || res.authorized)) {
        addLog('Сессия уже авторизована!');
        toast.success('Вход выполнен!');
        await onSuccess();
        return;
      }

      if (res && res.qrDataUrl) {
        setQrDataUrl(res.qrDataUrl);
        setQrUrl(res.qrUrl || '');
        const exp = Number(res.expires) || Math.floor(Date.now() / 1000) + 30;
        setQrExpiresAt(exp);
        setQrExpiresIn(Math.max(5, exp - Math.floor(Date.now() / 1000)));
        setIsQrActive(true);
        addLog('QR-код готов. Отсканируйте его камерой в мобильном Telegram.');
      } else {
        throw new Error(res?.error || 'Не удалось получить QR-токен от Telegram');
      }
    } catch (err: any) {
      const msg = err.message || 'Ошибка генерации QR-кода';
      addLog(`Ошибка QR: ${msg}`, true);
      toast.error(msg);
      setIsQrActive(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshQr = async () => {
    addLog('Проверка статуса сканирования QR-кода...');
    await checkQrStatusOnce(true);
  };

  const handleCancelQr = async () => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    if (qrCountdownRef.current) clearInterval(qrCountdownRef.current);
    setIsQrActive(false);
    setIsQr2FARequired(false);
    setQrDataUrl('');
    try {
      await ipcSafe.invoke('telegram-mtproto-cancel-qr');
    } catch {}
  };

  const handleSubmitQr2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qr2FAPassword.trim()) {
      toast.error('Введите ваш облачный пароль 2FA');
      return;
    }

    setIsLoading(true);
    addLog('Проверка облачного пароля 2FA...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-submit-password', {
        password: qr2FAPassword
      });

      if (res && (res.success || res.status === 'connected')) {
        addLog('Пароль 2FA подтвержден! Сессия сохранена.');
        toast.success(
          `Успешный вход: ${res.me?.firstName || res.me?.username || 'Telegram'}`
        );
        setIsQrActive(false);
        setIsQr2FARequired(false);
        await onSuccess();
      }
    } catch (err: any) {
      const msg = err.message || 'Неверный пароль 2FA';
      addLog(`Ошибка 2FA: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Phone Code Login Flow
  const handleSendCode = async (e?: React.FormEvent, forceSMS = false) => {
    if (e) e.preventDefault();

    const finalApiId = Number(apiId.trim() || DEFAULT_TG_API_ID);
    const finalApiHash = apiHash.trim() || DEFAULT_TG_API_HASH;

    if (!phoneNumber.trim()) {
      toast.error('Введите номер телефона в международном формате (+7...)');
      return;
    }

    setIsLoading(true);
    addLog(`Запрос кода подтверждения для ${phoneNumber.trim()}...`);

    try {
      const res = await ipcSafe.invoke('telegram-mtproto-send-code', {
        phoneNumber: phoneNumber.trim(),
        apiId: finalApiId,
        apiHash: finalApiHash,
        forceSMS
      });

      if (res && res.phoneCodeHash) {
        setIsCodeSent(true);
        setDeliveryMethod(res.deliveryMethod === 'sms' ? 'sms' : 'app');
        setResendTimer(45);
        addLog(res.message || 'Код отправлен');
        toast.success(res.message || 'Код подтверждения отправлен!');
      }
    } catch (err: any) {
      const msg = err.message || 'Ошибка отправки кода';
      addLog(`Ошибка: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignInPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneCode.trim() && !is2FARequired) {
      toast.error('Введите полученный код подтверждения');
      return;
    }

    setIsLoading(true);
    addLog(
      is2FARequired
        ? 'Проверка облачного пароля 2FA...'
        : `Проверка кода ${phoneCode.trim()}...`
    );

    try {
      if (is2FARequired && password2FA.trim()) {
        const pwdRes = await ipcSafe.invoke('telegram-mtproto-submit-password', {
          password: password2FA
        });
        if (pwdRes && (pwdRes.success || pwdRes.status === 'connected')) {
          addLog('Авторизация с 2FA успешно завершена!');
          toast.success(
            `Успешный вход: ${pwdRes.me?.firstName || pwdRes.me?.username || 'Telegram'}`
          );
          await onSuccess();
          return;
        }
      }

      const res = await ipcSafe.invoke('telegram-mtproto-sign-in', {
        phoneCode: phoneCode.trim(),
        password: password2FA
      });

      if (res && res.status === 'password_required') {
        setIs2FARequired(true);
        if (res.passwordHint) setPasswordHint(res.passwordHint);
        addLog('На аккаунте включена двухфакторная защита. Введите пароль 2FA.');
        toast.info('Введите облачный пароль 2FA от вашего аккаунта');
      } else if (res && res.status === 'connected') {
        addLog(`Вход выполнен! Аккаунт: ${res.me?.firstName || res.me?.username}`);
        toast.success(
          `Подключен аккаунт ${res.me?.firstName || res.me?.username || 'Telegram'}!`
        );
        await onSuccess();
      }
    } catch (err: any) {
      const msg = err.message || 'Ошибка авторизации';
      addLog(`Ошибка входа: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0) return;
    setIsLoading(true);
    addLog('Повторный запрос кода подтверждения...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-resend-code', { forceSMS: true });
      if (res && res.success) {
        setDeliveryMethod(res.deliveryMethod === 'sms' ? 'sms' : 'app');
        setResendTimer(60);
        addLog(res.message || 'Код отправлен повторно');
        toast.success(res.message || 'Код отправлен повторно!');
      }
    } catch (err: any) {
      addLog(`Ошибка повторной отправки: ${err.message}`, true);
      toast.error(err.message || 'Не удалось переотправить код');
    } finally {
      setIsLoading(false);
    }
  };

  // StringSession Direct Import Flow
  const handleImportSessionString = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionStringInput.trim()) {
      toast.error('Вставьте строку StringSession');
      return;
    }

    const finalApiId = Number(apiId.trim() || DEFAULT_TG_API_ID);
    const finalApiHash = apiHash.trim() || DEFAULT_TG_API_HASH;

    setIsLoading(true);
    addLog('Проверка и подключение по StringSession...');
    try {
      const res = await ipcSafe.invoke('telegram-mtproto-import-session', {
        sessionString: sessionStringInput.trim(),
        apiId: finalApiId,
        apiHash: finalApiHash
      });

      if (res && (res.success || res.status === 'connected')) {
        addLog(`Сессия успешно импортирована: ${res.me?.firstName || res.me?.username}`);
        toast.success(
          `Аккаунт ${res.me?.firstName || res.me?.username || 'Telegram'} успешно подключен!`
        );
        setSessionStringInput('');
        await onSuccess();
      }
    } catch (err: any) {
      const msg = err.message || 'Не удалось подключиться по StringSession';
      addLog(`Ошибка импорта StringSession: ${msg}`, true);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Bot Token Connect
  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken.trim()) {
      toast.error('Введите токен бота от @BotFather');
      return;
    }

    setIsLoading(true);
    addLog('Проверка токена Telegram Bot API...');
    try {
      const res = await ipcSafe.invoke('telegram-bot-test-connection', {
        botToken: botToken.trim()
      });
      if (res && res.success && res.bot) {
        addLog(`Бот успешно подключен: @${res.bot.username}`);
        toast.success(`Подключен бот @${res.bot.username} (${res.bot.firstName})!`);
        await onSuccess();
      } else {
        throw new Error(res?.error || 'Некорректный токен бота');
      }
    } catch (err: any) {
      addLog(`Ошибка Bot API: ${err.message}`, true);
      toast.error(err.message || 'Ошибка подключения бота');
    } finally {
      setIsLoading(false);
    }
  };

  return {
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
    qrUrl,
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
  };
}
