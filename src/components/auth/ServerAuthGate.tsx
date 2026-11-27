import React, { useEffect, useState, useCallback } from 'react';
import { Lock, Mic2, Eye, EyeOff, Loader2, ShieldCheck, Globe } from 'lucide-react';
import {
  getServerAuthStatus,
  loginServerAuth,
  setupServerAuth,
  ServerAuthStatus,
} from '../../lib/serverClient';

interface ServerAuthGateProps {
  children: React.ReactNode;
}

export const ServerAuthGate: React.FC<ServerAuthGateProps> = ({ children }) => {
  const [status, setStatus] = useState<ServerAuthStatus | null>(null);
  const [setupMode, setSetupMode] = useState<'password' | 'open'>('password');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await getServerAuthStatus();
    setStatus(next);
    if (next.reachable && !next.needsSetup && (!next.authRequired || next.authenticated)) {
      window.dispatchEvent(new Event('adm-auth-authenticated'));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (!status) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-sm text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span>Подключение к серверу...</span>
        </div>
      </div>
    );
  }

  // Pass straight through for Electron Desktop, offline preview, or authenticated / open server sessions
  if (!status.reachable || (!status.needsSetup && (!status.authRequired || status.authenticated))) {
    return <>{children}</>;
  }

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setupMode === 'password') {
      if (password.trim().length < 4) {
        setError('Введите пароль длиной не менее 4 символов.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Пароли не совпадают.');
        return;
      }
    }
    setSubmitting(true);
    try {
      await setupServerAuth(setupMode, password.trim());
      await refreshStatus();
    } catch (err: any) {
      setError(err?.message || 'Ошибка первоначальной настройки сервера');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Введите пароль или токен доступа.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await loginServerAuth(password.trim());
      setPassword('');
      await refreshStatus();
    } catch (err: any) {
      setError(err?.message || 'Неверный пароль или токен доступа');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <Mic2 className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Anime Dub Manager</h1>
            <p className="text-xs text-neutral-400">
              {status.needsSetup ? 'Первичная настройка домашнего сервера' : 'Вход в панель куратора'}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-950/50 border border-red-900/60 text-xs text-red-300">
            {error}
          </div>
        )}

        {status.needsSetup ? (
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={() => setSetupMode('password')}
                className={`p-3.5 rounded-lg border text-left transition-colors flex items-start gap-3 ${
                  setupMode === 'password'
                    ? 'bg-blue-600/10 border-blue-500/60 text-white'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold">Защитить паролем</div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    Рекомендуется для доступа с телефона, Tailscale или внешней сети.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSetupMode('open')}
                className={`p-3.5 rounded-lg border text-left transition-colors flex items-start gap-3 ${
                  setupMode === 'open'
                    ? 'bg-blue-600/10 border-blue-500/60 text-white'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <Globe className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold">Открытый доступ в локальной сети</div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    Вход без пароля внутри домашней сети (можно изменить позже в Настройках).
                  </div>
                </div>
              </button>
            </div>

            {setupMode === 'password' && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Пароль куратора</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Минимум 4 символа"
                      autoFocus
                      className="w-full min-h-[44px] bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 pr-11 text-sm text-white focus:border-blue-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-neutral-400 hover:text-white"
                      aria-label="Показать пароль"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Повторите пароль</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Повторите пароль"
                    className="w-full min-h-[44px] bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 text-sm text-white focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[46px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{setupMode === 'password' ? 'Сохранить пароль и войти' : 'Продолжить без пароля'}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">Пароль или токен доступа</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль куратора"
                  autoFocus
                  className="w-full min-h-[44px] bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-11 text-sm text-white focus:border-blue-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-neutral-400 hover:text-white"
                  aria-label="Показать пароль"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[46px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Войти</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
