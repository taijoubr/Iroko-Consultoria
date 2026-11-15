import React from 'react';
import { LogIn, ShieldAlert } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface LoginScreenProps {
  onSignIn: () => Promise<void>;
  onSignOut?: () => Promise<void>;
  loading: boolean;
  error: string | null;
  wrongAccountEmail?: string | null;
}

export function LoginScreen({
  onSignIn,
  onSignOut,
  loading,
  error,
  wrongAccountEmail,
}: LoginScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl sm:p-8">
        <div className="mb-7 flex flex-col items-center justify-center">
          <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border border-zinc-700/60 bg-white p-3 shadow-lg">
            <BrandLogo className="h-full w-full object-contain" />
          </div>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-900/70 bg-red-950/60 p-3 text-xs text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold">Não foi possível entrar</p>
              <p className="mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        <div>
          {wrongAccountEmail && onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Trocar de conta Google ({wrongAccountEmail})
            </button>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={onSignIn}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {loading ? 'Verificando acesso...' : 'Entrar com Google'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
