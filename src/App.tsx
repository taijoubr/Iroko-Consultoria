import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { LoginScreen } from './components/LoginScreen';
import { AppDataProvider, useAppData } from './context/AppDataContext';
import { ClientsPage } from './pages/ClientsPage';
import { CommissionsPage } from './pages/CommissionsPage';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { InventoryPage } from './pages/InventoryPage';
import { PersonalConsumptionPage } from './pages/PersonalConsumptionPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { SettingsPage } from './pages/SettingsPage';
import type { AppModule } from './types';

function MainApp() {
  const {
    user,
    authLoading,
    isAuthorized,
    authError,
    signInWithGoogle,
    signOutUser,
  } = useAppData();

  const [activeModule, setActiveModule] = useState<AppModule>('dashboard');
  const [financeInitialTab, setFinanceInitialTab] = useState<'FLUXO' | 'RECEBER' | 'PAGAR' | 'CARTAO' | undefined>(undefined);
  const [triggerNewPurchase, setTriggerNewPurchase] = useState(false);
  const [triggerNewClient, setTriggerNewClient] = useState(false);
  const [triggerNewSale, setTriggerNewSale] = useState(false);
  const [triggerNewCommission, setTriggerNewCommission] = useState(false);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <p className="mt-3 text-xs font-medium text-zinc-400">
            Carregando Iroko Consultoria...
          </p>
        </div>
      </div>
    );
  }

  if (!user || !isAuthorized) {
    return (
      <LoginScreen
        onSignIn={signInWithGoogle}
        onSignOut={user ? signOutUser : undefined}
        loading={authLoading}
        error={authError}
        wrongAccountEmail={user && !isAuthorized ? user.email : null}
      />
    );
  }

  const getPrimaryAction = (): { label: string; onClick: () => void } | undefined => {
    switch (activeModule) {
      case 'dashboard':
      case 'sales':
        return {
          label: 'Nova Venda',
          onClick: () => {
            setActiveModule('sales');
            setTriggerNewSale(true);
          },
        };
      case 'purchases':
        return {
          label: 'Nova Compra',
          onClick: () => setTriggerNewPurchase(true),
        };
      case 'clients':
        return {
          label: 'Novo Cliente',
          onClick: () => setTriggerNewClient(true),
        };
      case 'commissions':
        return {
          label: 'Nova Comissão',
          onClick: () => setTriggerNewCommission(true),
        };
      default:
        return undefined;
    }
  };

  return (
    <Layout
      activeModule={activeModule}
      onSelectModule={setActiveModule}
      userEmail={user.email || ''}
      onSignOut={signOutUser}
      primaryAction={getPrimaryAction()}
    >
      {activeModule === 'dashboard' && <DashboardPage onNavigate={setActiveModule} />}
      {activeModule === 'purchases' && (
        <PurchasesPage
          externalOpenNew={triggerNewPurchase}
          onClearExternalNew={() => setTriggerNewPurchase(false)}
        />
      )}
      {activeModule === 'inventory' && <InventoryPage />}
      {activeModule === 'clients' && (
        <ClientsPage
          externalOpenNew={triggerNewClient}
          onClearExternalNew={() => setTriggerNewClient(false)}
        />
      )}
      {activeModule === 'sales' && (
        <SalesPage
          externalOpenNew={triggerNewSale}
          onClearExternalNew={() => setTriggerNewSale(false)}
        />
      )}
      {activeModule === 'commissions' && (
        <CommissionsPage
          externalOpenNew={triggerNewCommission}
          onClearExternalNew={() => setTriggerNewCommission(false)}
          onGoToFinancePayables={() => {
            setFinanceInitialTab('PAGAR');
            setActiveModule('finance');
          }}
        />
      )}
      {activeModule === 'finance' && (
        <FinancePage
          initialTab={financeInitialTab}
          onClearInitialTab={() => setFinanceInitialTab(undefined)}
        />
      )}
      {activeModule === 'consumption' && <PersonalConsumptionPage />}
      {activeModule === 'reports' && <ReportsPage />}
      {activeModule === 'settings' && <SettingsPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <AppDataProvider>
      <MainApp />
    </AppDataProvider>
  );
}
