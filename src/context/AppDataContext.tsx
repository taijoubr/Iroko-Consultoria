import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  auth,
  AUTHORIZED_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firebase';
import { ensureDefaultSettings } from '../services/firestoreOperations';
import type {
  AppSettings,
  CardSettlement,
  Client,
  Payable,
  Payment,
  PersonalConsumption,
  Product,
  Purchase,
  Receivable,
  Sale,
  SettingsHistory,
  StockLot,
  StockMovement,
} from '../types';

interface AppDataContextValue {
  user: User | null;
  authLoading: boolean;
  isAuthorized: boolean;
  authError: string | null;
  dataLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  settings: AppSettings | null;
  settingsHistory: SettingsHistory[];
  products: Product[];
  stockLots: StockLot[];
  stockMovements: StockMovement[];
  purchases: Purchase[];
  payables: Payable[];
  clients: Client[];
  sales: Sale[];
  receivables: Receivable[];
  payments: Payment[];
  cardSettlements: CardSettlement[];
  personalConsumptions: PersonalConsumption[];
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsHistory, setSettingsHistory] = useState<SettingsHistory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockLots, setStockLots] = useState<StockLot[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [cardSettlements, setCardSettlements] = useState<CardSettlement[]>([]);
  const [personalConsumptions, setPersonalConsumptions] = useState<PersonalConsumption[]>([]);

  const isAuthorized = Boolean(
    user &&
      user.emailVerified &&
      user.email?.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase()
  );

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u && u.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
        setAuthError(
          `A conta "${u.email}" não possui permissão de administrador. Acesse com ${AUTHORIZED_ADMIN_EMAIL}.`
        );
      } else {
        setAuthError(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !isAuthorized) {
      setSettings(null);
      setSettingsHistory([]);
      setProducts([]);
      setStockLots([]);
      setStockMovements([]);
      setPurchases([]);
      setPayables([]);
      setClients([]);
      setSales([]);
      setReceivables([]);
      setPayments([]);
      setCardSettlements([]);
      setPersonalConsumptions([]);
      return;
    }

    setDataLoading(true);
    const uid = user.uid;
    let initialLoaded = 0;
    const totalStreams = 13;
    const markLoaded = () => {
      initialLoaded += 1;
      if (initialLoaded >= totalStreams) setDataLoading(false);
    };

    const subscribeCol = <T extends { id: string }>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      onFirstSnap?: (items: T[]) => void
    ) => {
      const q = query(collection(db, colName), where('ownerId', '==', uid));
      let first = true;
      return onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
          setter(items);
          if (first) {
            first = false;
            markLoaded();
            onFirstSnap?.(items);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      );
    };

    const unsubs = [
      subscribeCol<AppSettings>('settings', (updater) => {
        const list = typeof updater === 'function' ? updater([]) : updater;
        if (list.length > 0) setSettings(list[0]);
      }, (items) => {
        if (items.length === 0) {
          ensureDefaultSettings(uid).catch(console.error);
        } else {
          setSettings(items[0]);
        }
      }),
      subscribeCol<SettingsHistory>('settingsHistory', setSettingsHistory),
      subscribeCol<Product>('products', setProducts),
      subscribeCol<StockLot>('stockLots', setStockLots),
      subscribeCol<StockMovement>('stockMovements', setStockMovements),
      subscribeCol<Purchase>('purchases', setPurchases),
      subscribeCol<Payable>('payables', setPayables),
      subscribeCol<Client>('clients', setClients),
      subscribeCol<Sale>('sales', setSales),
      subscribeCol<Receivable>('receivables', setReceivables),
      subscribeCol<Payment>('payments', setPayments),
      subscribeCol<CardSettlement>('cardSettlements', setCardSettlements),
      subscribeCol<PersonalConsumption>('personalConsumptions', setPersonalConsumptions),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user, isAuthorized]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      if (res.user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
        setAuthError(
          `A conta "${res.user.email}" não é o administrador autorizado (${AUTHORIZED_ADMIN_EMAIL}).`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao autenticar com o Google.';
      setAuthError(msg);
    }
  };

  const signOutUser = async () => {
    await signOut(auth);
  };

  return (
    <AppDataContext.Provider
      value={{
        user,
        authLoading,
        isAuthorized,
        authError,
        dataLoading,
        signInWithGoogle,
        signOutUser,
        settings,
        settingsHistory,
        products,
        stockLots,
        stockMovements,
        purchases,
        payables,
        clients,
        sales,
        receivables,
        payments,
        cardSettlements,
        personalConsumptions,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData deve ser utilizado dentro de AppDataProvider.');
  }
  return ctx;
}
