import React, { useState } from 'react';
import {
  BarChart3,
  Boxes,
  Coffee,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Settings,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react';
import type { AppModule } from '../types';
import { BrandLogo } from './BrandLogo';

interface LayoutProps {
  activeModule: AppModule;
  onSelectModule: (mod: AppModule) => void;
  userEmail: string;
  onSignOut: () => Promise<void>;
  primaryAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}

const NAV_ITEMS: { id: AppModule; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'purchases', label: 'Entrada de Compras', icon: PackagePlus },
  { id: 'inventory', label: 'Estoque', icon: Boxes },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'sales', label: 'Vendas', icon: ShoppingBag },
  { id: 'finance', label: 'Financeiro', icon: CreditCard },
  { id: 'consumption', label: 'Consumo Próprio', icon: Coffee },
  { id: 'reports', label: 'Relatórios', icon: BarChart3 },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

export function Layout({
  activeModule,
  onSelectModule,
  userEmail,
  onSignOut,
  primaryAction,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeItem = NAV_ITEMS.find((i) => i.id === activeModule) ?? NAV_ITEMS[0];

  const handleNav = (id: AppModule) => {
    onSelectModule(id);
    setMobileOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 lg:flex">
        <div className="flex h-16 items-center justify-center border-b border-zinc-800 px-5">
          <BrandLogo className="h-12 w-12 shrink-0 rounded-xl bg-white p-1 object-contain" />
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeModule;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-950/80 text-emerald-300'
                    : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-zinc-800 p-4">
          <p className="truncate text-xs font-medium text-zinc-300" title={userEmail}>
            {userEmail}
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair da conta
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 flex w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-900 shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-zinc-800 px-4">
              <BrandLogo className="h-11 w-11 shrink-0 rounded-xl bg-white p-1 object-contain" />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Fechar menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeModule;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNav(item.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      active
                        ? 'bg-emerald-950/80 text-emerald-300'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-zinc-800 p-4">
              <p className="truncate text-xs text-zinc-400">{userEmail}</p>
              <button
                type="button"
                onClick={onSignOut}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sair da conta
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <h1 className="font-display truncate text-base font-semibold text-zinc-100">
                {activeItem.label}
              </h1>
            </div>
          </div>

          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="whitespace-nowrap shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 sm:text-sm"
            >
              {primaryAction.label}
            </button>
          )}
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-[1360px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
