import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  Plus,
  Trash2,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import {
  markSaleAsDelivered,
  registerAdvanceFullPayment,
  registerReceivablePayment,
  registerSale,
  saveClient,
  updateReceivableDueDate,
} from '../services/firestoreOperations';
import type {
  DeliveryStatus,
  PaymentSplit,
  Receivable,
  Sale,
  SalePaymentMethod,
} from '../types';
import {
  allocateFifoFromLots,
  calculateOwnCreditPlan,
  type OwnCreditIntervalType,
} from '../utils/finance';
import {
  addMonthsISO,
  formatCurrency,
  formatDateBR,
  formatPercent,
  getTodayISO,
  round2,
  translatePaymentMethod,
  translateStatus,
} from '../utils/formatters';
import { generatePaymentReceiptPDF, generateSaleReceiptPDF } from '../utils/pdfGenerator';

export function SalesPage({
  externalOpenNew,
  onClearExternalNew,
}: {
  externalOpenNew?: boolean;
  onClearExternalNew?: () => void;
}) {
  const {
    user,
    settings,
    products,
    stockLots,
    clients,
    sales,
    receivables,
    payments,
  } = useAppData();

  const [statusFilter, setStatusFilter] = useState<
    'TODAS' | 'PAGO' | 'PARCIAL' | 'PENDENTE' | 'CREDITO_PROPRIO' | 'ENTREGA_PENDENTE'
  >('TODAS');
  const [search, setSearch] = useState('');

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  // Quick inline client creation inside sale modal
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientName, setQuickClientName] = useState('');
  const [quickClientWhatsapp, setQuickClientWhatsapp] = useState('');

  // New Sale form state
  const [clientId, setClientId] = useState('');
  const [saleDate, setSaleDate] = useState(getTodayISO());
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('ENTREGUE');
  const [saleItems, setSaleItems] = useState<{ productId: string; quantity: number }[]>([
    { productId: '', quantity: 1 },
  ]);
  const [originalSaleAmount, setOriginalSaleAmount] = useState<number>(0);
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([
    { method: 'PIX', amount: 0 },
  ]);
  const [ownCreditInterestPercent, setOwnCreditInterestPercent] = useState<number>(0);
  const [ownCreditInstallmentsCount, setOwnCreditInstallmentsCount] = useState<number>(2);
  const [ownCreditFirstDueDate, setOwnCreditFirstDueDate] = useState<string>(
    addMonthsISO(getTodayISO(), 1)
  );
  const [ownCreditIntervalType, setOwnCreditIntervalType] =
    useState<OwnCreditIntervalType>('MONTHLY');
  const [ownCreditIntervalDays, setOwnCreditIntervalDays] = useState<number>(30);
  const [customDueDates, setCustomDueDates] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Payment / Due date sub-actions inside Sale Detail
  const [payTargetRec, setPayTargetRec] = useState<Receivable | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState(getTodayISO());
  const [payMethod, setPayMethod] = useState<SalePaymentMethod>('PIX');
  const [payNotes, setPayNotes] = useState('');

  const [dueEditRec, setDueEditRec] = useState<Receivable | null>(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [dueChangeReason, setDueChangeReason] = useState('');

  React.useEffect(() => {
    if (externalOpenNew) {
      openNewSaleModal();
      onClearExternalNew?.();
    }
  }, [externalOpenNew, onClearExternalNew]);

  const openNewSaleModal = () => {
    setFormError(null);
    setClientId(clients[0]?.id || '');
    setSaleDate(getTodayISO());
    setDeliveryStatus('ENTREGUE');
    setSaleItems([{ productId: products[0]?.id || '', quantity: 1 }]);
    setOriginalSaleAmount(0);
    setPaymentSplits([{ method: 'PIX', amount: 0 }]);
    setOwnCreditInterestPercent(0);
    setOwnCreditInstallmentsCount(2);
    setOwnCreditFirstDueDate(addMonthsISO(getTodayISO(), 1));
    setOwnCreditIntervalType('MONTHLY');
    setOwnCreditIntervalDays(30);
    setCustomDueDates([]);
    setNotes('');
    setShowNewModal(true);
  };

  // Live FIFO Cost Preview (computed automatically, user never enters cost/profit manually)
  const liveCostPreview = useMemo(() => {
    if (!settings) return { totalCost: 0, error: null as string | null };
    try {
      const workingLots = stockLots.map((l) => ({ ...l }));
      let sum = 0;
      for (const it of saleItems) {
        if (!it.productId || it.quantity <= 0) continue;
        const prod = products.find((p) => p.id === it.productId);
        if (!prod) continue;
        const fifo = allocateFifoFromLots(
          workingLots,
          prod.id,
          prod.name,
          it.quantity,
          settings.allowNegativeStock
        );
        for (const a of fifo.allocations) {
          const wl = workingLots.find((l) => l.id === a.lotId);
          if (wl) wl.availableQty -= a.quantity;
        }
        sum = round2(sum + fifo.totalEffectiveCost);
      }
      return { totalCost: sum, error: null };
    } catch (err) {
      return {
        totalCost: 0,
        error: err instanceof Error ? err.message : 'Erro no cálculo de estoque',
      };
    }
  }, [saleItems, products, stockLots, settings]);

  const ownCreditAmount = useMemo(
    () =>
      round2(
        paymentSplits
          .filter((s) => s.method === 'CREDITO_PROPRIO')
          .reduce((acc, s) => acc + (Number(s.amount) || 0), 0)
      ),
    [paymentSplits]
  );

  const ownCreditPlan = useMemo(() => {
    if (ownCreditAmount <= 0) return null;
    return calculateOwnCreditPlan(
      ownCreditAmount,
      ownCreditInterestPercent,
      ownCreditInstallmentsCount,
      ownCreditFirstDueDate,
      ownCreditIntervalType,
      ownCreditIntervalDays
    );
  }, [
    ownCreditAmount,
    ownCreditInterestPercent,
    ownCreditInstallmentsCount,
    ownCreditFirstDueDate,
    ownCreditIntervalType,
    ownCreditIntervalDays,
  ]);

  React.useEffect(() => {
    if (ownCreditPlan) {
      setCustomDueDates(ownCreditPlan.installments.map((i) => i.dueDate));
    } else {
      setCustomDueDates([]);
    }
  }, [
    ownCreditFirstDueDate,
    ownCreditInstallmentsCount,
    ownCreditIntervalType,
    ownCreditIntervalDays,
    ownCreditAmount > 0,
  ]);

  const filteredSales = useMemo(() => {
    return sales
      .filter((s) => {
        if (statusFilter === 'PAGO' && s.paymentStatus !== 'PAGO') return false;
        if (statusFilter === 'PARCIAL' && s.paymentStatus !== 'PARCIAL') return false;
        if (statusFilter === 'PENDENTE' && s.paymentStatus !== 'PENDENTE') return false;
        if (statusFilter === 'CREDITO_PROPRIO' && !s.hasOwnCredit) return false;
        if (statusFilter === 'ENTREGA_PENDENTE' && s.deliveryStatus === 'ENTREGUE') return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            s.documentNumber.toLowerCase().includes(q) ||
            s.clientName.toLowerCase().includes(q) ||
            s.items.some((i) => i.productName.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => b.saleDate.localeCompare(a.saleDate));
  }, [sales, statusFilter, search]);

  const selectedSale = useMemo(
    () => sales.find((s) => s.id === selectedSaleId) || null,
    [sales, selectedSaleId]
  );

  const selectedSaleReceivables = useMemo(
    () =>
      selectedSale
        ? receivables
            .filter((r) => r.saleId === selectedSale.id)
            .sort((a, b) => a.installmentNumber - b.installmentNumber)
        : [],
    [selectedSale, receivables]
  );

  const selectedSalePayments = useMemo(
    () =>
      selectedSale
        ? payments
            .filter((p) => p.saleId === selectedSale.id)
            .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
        : [],
    [selectedSale, payments]
  );

  const selectedSaleClient = useMemo(
    () => (selectedSale ? clients.find((c) => c.id === selectedSale.clientId) || null : null),
    [selectedSale, clients]
  );

  const handleQuickClientCreate = async () => {
    if (!user || !quickClientName.trim()) return;
    const newId = await saveClient(user.uid, {
      fullName: quickClientName,
      phone: '',
      whatsapp: quickClientWhatsapp,
      address: '',
      notes: '',
    });
    setClientId(newId);
    setQuickClientName('');
    setQuickClientWhatsapp('');
    setQuickClientOpen(false);
  };

  const handleSaleAmountChange = (val: number) => {
    setOriginalSaleAmount(val);
    if (paymentSplits.length === 1) {
      setPaymentSplits([{ ...paymentSplits[0], amount: val }]);
    }
  };

  const handleSubmitSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !settings) return;
    setFormError(null);

    const selectedClientObj = clients.find((c) => c.id === clientId);
    if (!selectedClientObj) {
      setFormError('Selecione ou cadastre um cliente antes de registrar a venda.');
      return;
    }

    const validItems = saleItems.filter((i) => i.productId && i.quantity > 0);
    if (validItems.length === 0) {
      setFormError('Adicione pelo menos um produto válido do estoque.');
      return;
    }

    setSubmitting(true);
    try {
      const newSaleId = await registerSale(
        user.uid,
        {
          client: selectedClientObj,
          saleDate,
          items: validItems,
          originalSaleAmount,
          deliveryStatus,
          paymentSplits: paymentSplits.filter((s) => s.amount > 0),
          ownCreditInterestPercent,
          ownCreditInstallmentsCount,
          ownCreditFirstDueDate,
          customDueDates,
          notes,
        },
        products,
        stockLots,
        settings,
        sales.length
      );
      setShowNewModal(false);
      setSelectedSaleId(newSaleId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao registrar venda.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayReceivable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedSale || !payTargetRec) return;
    await registerReceivablePayment(
      user.uid,
      selectedSale,
      payTargetRec,
      payAmount,
      payDate,
      payMethod,
      payNotes,
      payments.length
    );
    setPayTargetRec(null);
  };

  const handleAdvanceFull = async () => {
    if (!user || !selectedSale) return;
    const open = selectedSaleReceivables.filter((r) => r.status !== 'PAGO');
    if (open.length === 0) return;
    await registerAdvanceFullPayment(
      user.uid,
      selectedSale,
      open,
      getTodayISO(),
      'PIX',
      'Quitação antecipada integral',
      payments.length
    );
  };

  const handleSaveDueDateChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dueEditRec) return;
    await updateReceivableDueDate(dueEditRec, newDueDate, dueChangeReason);
    setDueEditRec(null);
  };

  const splitsSum = round2(paymentSplits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0));
  const estimatedGrossProfit = round2(originalSaleAmount - liveCostPreview.totalCost);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {(
              [
                { id: 'TODAS', label: 'Todas' },
                { id: 'PAGO', label: 'Pagas' },
                { id: 'PARCIAL', label: 'Parciais' },
                { id: 'PENDENTE', label: 'Pendentes' },
                { id: 'CREDITO_PROPRIO', label: 'Crédito Próprio' },
                { id: 'ENTREGA_PENDENTE', label: 'Entrega Pendente' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === f.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar venda, cliente ou produto..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none sm:w-64"
          />
        </div>

        <button
          type="button"
          onClick={openNewSaleModal}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" />
          Nova Venda
        </button>
      </div>

      {/* Sales Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {filteredSales.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-zinc-200">Nenhuma venda registrada ainda.</p>
            <p className="mt-1 text-xs text-zinc-400">
              Ao registrar uma venda, o custo FIFO e o lucro são calculados automaticamente pelo estoque.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="divide-y divide-zinc-800 md:hidden">
              {filteredSales.map((s) => (
                <div key={s.id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-100">{s.clientName}</p>
                      <p className="font-mono-num text-[11px] text-zinc-400">
                        {formatDateBR(s.saleDate)} · {s.documentNumber}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">
                        {s.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSaleId(s.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Gerenciar
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                    <div>
                      <span className="text-zinc-500">Venda</span>
                      <p className="font-mono-num font-semibold text-zinc-100">
                        {formatCurrency(s.originalSaleAmount)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Lucro Prod.</span>
                      <p
                        className={`font-mono-num font-semibold ${
                          s.grossProfitOnProducts >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatCurrency(s.grossProfitOnProducts)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">A Receber</span>
                      <p className="font-mono-num font-semibold text-amber-400">
                        {formatCurrency(s.pendingAmount)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                    <span className="text-zinc-400">
                      {s.paymentSplits.map((sp) => translatePaymentMethod(sp.method)).join(' + ')}
                    </span>
                    <span
                      className={`font-medium ${
                        s.paymentStatus === 'PAGO'
                          ? 'text-emerald-400'
                          : s.paymentStatus === 'PARCIAL'
                            ? 'text-amber-400'
                            : 'text-red-400'
                      }`}
                    >
                      {translateStatus(s.paymentStatus)} · {translateStatus(s.deliveryStatus)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data · Doc.</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Pagamento · Entrega</th>
                    <th className="px-4 py-3 text-right font-medium">Venda</th>
                    <th className="px-4 py-3 text-right font-medium">Custo FIFO</th>
                    <th className="px-4 py-3 text-right font-medium">Lucro Prod.</th>
                    <th className="px-4 py-3 text-right font-medium">A Receber</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredSales.map((s) => (
                    <tr key={s.id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-3">
                        <p className="font-mono-num font-semibold text-zinc-100">
                          {formatDateBR(s.saleDate)}
                        </p>
                        <p className="font-mono-num text-[11px] text-zinc-400">{s.documentNumber}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-100">{s.clientName}</p>
                        <p className="text-[11px] text-zinc-400">
                          {s.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        <p>
                          {s.paymentSplits.map((sp) => translatePaymentMethod(sp.method)).join(' + ')}
                        </p>
                        <p
                          className={`text-[11px] font-medium ${
                            s.paymentStatus === 'PAGO'
                              ? 'text-emerald-400'
                              : s.paymentStatus === 'PARCIAL'
                                ? 'text-amber-400'
                                : 'text-red-400'
                          }`}
                        >
                          {translateStatus(s.paymentStatus)} · Entrega: {translateStatus(s.deliveryStatus)}
                        </p>
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                        {formatCurrency(s.originalSaleAmount)}
                        {s.ownCreditInterestAmount > 0 && (
                          <span className="block text-[10px] font-normal text-zinc-400">
                            +{formatCurrency(s.ownCreditInterestAmount)} juros
                          </span>
                        )}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                        {formatCurrency(s.totalProductCost)}
                      </td>
                      <td
                        className={`font-mono-num px-4 py-3 text-right font-semibold ${
                          s.grossProfitOnProducts >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatCurrency(s.grossProfitOnProducts)}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right font-medium text-amber-400">
                        {formatCurrency(s.pendingAmount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedSaleId(s.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Gerenciar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* New Sale Modal */}
      <Modal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        title="Registrar Nova Venda"
        subtitle="Informe somente os produtos e o valor final da venda. O custo FIFO e o lucro são calculados automaticamente."
        maxWidth="4xl"
      >
        <form onSubmit={handleSubmitSale} className="space-y-5">
          {formError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          {/* Client, Date, Delivery */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-zinc-300">Cliente *</label>
                <button
                  type="button"
                  onClick={() => setQuickClientOpen((v) => !v)}
                  className="text-[11px] font-medium text-emerald-400 hover:underline"
                >
                  {quickClientOpen ? 'Fechar cadastro rápido' : '+ Cadastro rápido'}
                </button>
              </div>
              <select
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Selecione um cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} {c.whatsapp ? `(${c.whatsapp})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Data da Venda *</label>
              <input
                type="date"
                required
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Situação da Entrega</label>
              <select
                value={deliveryStatus}
                onChange={(e) => setDeliveryStatus(e.target.value as DeliveryStatus)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="ENTREGUE">Entregue no ato</option>
                <option value="RESERVADO">Reservado para entrega</option>
                <option value="PENDENTE">Entrega pendente</option>
              </select>
            </div>
          </div>

          {quickClientOpen && (
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-0 flex-1">
                <label className="block text-[11px] font-medium text-zinc-400">
                  Nome Completo do Cliente
                </label>
                <input
                  type="text"
                  value={quickClientName}
                  onChange={(e) => setQuickClientName(e.target.value)}
                  className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
                />
              </div>
              <div className="w-full sm:w-44">
                <label className="block text-[11px] font-medium text-zinc-400">WhatsApp</label>
                <input
                  type="text"
                  value={quickClientWhatsapp}
                  onChange={(e) => setQuickClientWhatsapp(e.target.value)}
                  className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
                />
              </div>
              <button
                type="button"
                onClick={handleQuickClientCreate}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 sm:w-auto sm:py-1.5"
              >
                Salvar Cliente
              </button>
            </div>
          )}

          {/* Products */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xs font-semibold text-zinc-200">
                Produtos da Venda
              </h3>
              <button
                type="button"
                onClick={() =>
                  setSaleItems((prev) => [
                    ...prev,
                    { productId: products[0]?.id || '', quantity: 1 },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar Produto
              </button>
            </div>

            {saleItems.map((item, idx) => {
              const prod = products.find((p) => p.id === item.productId);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 sm:col-span-9">
                    <select
                      required
                      value={item.productId}
                      onChange={(e) =>
                        setSaleItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, productId: e.target.value } : it
                          )
                        )
                      }
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                    >
                      <option value="">Selecione um produto do estoque...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.brand} · {p.name} {p.code ? `(${p.code})` : ''} — Disp.: {p.availableQty} un.
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-9 sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      required
                      value={item.quantity}
                      onChange={(e) =>
                        setSaleItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, quantity: Math.max(1, Number(e.target.value)) } : it
                          )
                        )
                      }
                      aria-label="Quantidade"
                      className="font-mono-num w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100"
                    />
                    {prod && (
                      <span className="block pt-0.5 text-[10px] text-zinc-500">
                        Disp: {prod.availableQty}
                      </span>
                    )}
                  </div>
                  <div className="col-span-3 flex items-start justify-end pt-1 sm:col-span-1">
                    <button
                      type="button"
                      disabled={saleItems.length === 1}
                      onClick={() =>
                        setSaleItems((prev) =>
                          prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev
                        )
                      }
                      className="rounded p-1.5 text-zinc-500 hover:bg-red-950/60 hover:text-red-400 disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}

            {liveCostPreview.error && (
              <p className="text-xs font-medium text-red-400">{liveCostPreview.error}</p>
            )}
          </div>

          {/* Final Sale Value & Automatic Profit Display */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Valor Final da Venda (R$) *
              </label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                value={originalSaleAmount || ''}
                onChange={(e) => handleSaleAmountChange(Number(e.target.value))}
                placeholder="0,00"
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <span className="text-xs text-zinc-400">Custo FIFO (Automático)</span>
              <p className="font-mono-num mt-1.5 text-base font-semibold text-zinc-200">
                {formatCurrency(liveCostPreview.totalCost)}
              </p>
              <span className="text-[11px] text-zinc-500">Inclui custo financeiro rateado</span>
            </div>

            <div>
              <span className="text-xs text-zinc-400">Lucro Bruto Estimado</span>
              <p
                className={`font-mono-num mt-1.5 text-base font-semibold ${
                  estimatedGrossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatCurrency(estimatedGrossProfit)}
              </p>
              <span className="text-[11px] text-zinc-500">
                {originalSaleAmount > 0
                  ? `Margem: ${formatPercent((estimatedGrossProfit / originalSaleAmount) * 100)}`
                  : 'Informe o valor da venda'}
              </span>
            </div>
          </div>

          {/* Payment Splits (Mixed payments allowed) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-xs font-semibold text-zinc-200">
                  Formas de Pagamento (Múltiplas Formas Permitidas)
                </h3>
                <p className="text-[11px] text-zinc-400">
                  Soma alocada: <strong className="font-mono-num text-zinc-200">{formatCurrency(splitsSum)}</strong>{' '}
                  de <strong className="font-mono-num text-zinc-200">{formatCurrency(originalSaleAmount)}</strong>
                  {originalSaleAmount - splitsSum > 0.01 &&
                    ` · Restante (${formatCurrency(originalSaleAmount - splitsSum)}) irá para Contas a Receber`}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setPaymentSplits((prev) => [
                    ...prev,
                    {
                      method: 'DINHEIRO',
                      amount: Math.max(0, round2(originalSaleAmount - splitsSum)),
                    },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar Forma
              </button>
            </div>

            {paymentSplits.map((split, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <div className="col-span-12 sm:col-span-5">
                  <select
                    value={split.method}
                    onChange={(e) =>
                      setPaymentSplits((prev) =>
                        prev.map((sp, i) =>
                          i === idx
                            ? {
                                ...sp,
                                method: e.target.value as SalePaymentMethod,
                                cardInstallments: e.target.value === 'CREDITO' ? 1 : undefined,
                              }
                            : sp
                        )
                      )
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="PIX">PIX</option>
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="DEBITO">Cartão de Débito</option>
                    <option value="CREDITO">Cartão de Crédito</option>
                    <option value="CREDITO_PROPRIO">Crédito Próprio (Parcelado)</option>
                  </select>
                </div>

                <div className="col-span-7 sm:col-span-4">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={split.amount || ''}
                    onChange={(e) =>
                      setPaymentSplits((prev) =>
                        prev.map((sp, i) =>
                          i === idx ? { ...sp, amount: Number(e.target.value) } : sp
                        )
                      )
                    }
                    placeholder="Valor (R$)"
                    className="font-mono-num w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {split.method === 'CREDITO' ? (
                  <div className="col-span-3 sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      max={18}
                      value={split.cardInstallments || 1}
                      onChange={(e) =>
                        setPaymentSplits((prev) =>
                          prev.map((sp, i) =>
                            i === idx
                              ? { ...sp, cardInstallments: Math.max(1, Number(e.target.value)) }
                              : sp
                          )
                        )
                      }
                      title="Parcelas no cartão"
                      className="font-mono-num w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="col-span-3 sm:col-span-2" />
                )}

                <div className="col-span-2 flex items-center justify-end sm:col-span-1">
                  <button
                    type="button"
                    disabled={paymentSplits.length === 1}
                    onClick={() =>
                      setPaymentSplits((prev) =>
                        prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev
                      )
                    }
                    className="rounded p-1.5 text-zinc-500 hover:bg-red-950/60 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Crédito Próprio Configuration Panel */}
          {ownCreditPlan && (
            <div className="space-y-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display text-xs font-semibold text-emerald-300">
                  Condições do Crédito Próprio (Juros Simples em Parcela Única sobre o Original)
                </h4>
                <span className="font-mono-num text-xs font-semibold text-emerald-400">
                  Financiado: {formatCurrency(ownCreditPlan.financedAmount)} + Juros:{' '}
                  {formatCurrency(ownCreditPlan.interestAmount)} = Total:{' '}
                  {formatCurrency(ownCreditPlan.totalDue)}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300">
                    Juros Personalizado (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={ownCreditInterestPercent}
                    onChange={(e) => setOwnCreditInterestPercent(Number(e.target.value))}
                    className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300">
                    Quantidade de Parcelas
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={ownCreditInstallmentsCount}
                    onChange={(e) =>
                      setOwnCreditInstallmentsCount(Math.max(1, Number(e.target.value)))
                    }
                    className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300">
                    1º Vencimento
                  </label>
                  <input
                    type="date"
                    value={ownCreditFirstDueDate}
                    onChange={(e) => setOwnCreditFirstDueDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300">
                    Intervalo de Pagamento
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <select
                      value={ownCreditIntervalType}
                      onChange={(e) =>
                        setOwnCreditIntervalType(e.target.value as OwnCreditIntervalType)
                      }
                      className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="MONTHLY">Mensal</option>
                      <option value="DAYS">A cada X dias</option>
                    </select>
                    {ownCreditIntervalType === 'DAYS' && (
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={ownCreditIntervalDays}
                        onChange={(e) =>
                          setOwnCreditIntervalDays(Math.max(1, Number(e.target.value)))
                        }
                        title="Dias entre cada parcela"
                        aria-label="Dias entre cada parcela"
                        className="font-mono-num w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              </div>

              {ownCreditIntervalType === 'DAYS' && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                  <span>Atalhos de intervalo:</span>
                  {[7, 15, 20, 30, 45].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setOwnCreditIntervalDays(days)}
                      className={`rounded-md border px-2 py-0.5 font-medium transition-colors ${
                        ownCreditIntervalDays === days
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {days} dias
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ownCreditPlan.installments.map((inst, idx) => (
                  <div
                    key={inst.installmentNumber}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium text-zinc-200">
                      {inst.installmentNumber}ª ({formatCurrency(inst.totalAmount)})
                    </span>
                    <input
                      type="date"
                      value={customDueDates[idx] || inst.dueDate}
                      onChange={(e) =>
                        setCustomDueDates((prev) =>
                          prev.map((d, i) => (i === idx ? e.target.value : d))
                        )
                      }
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300">Observações</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => setShowNewModal(false)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(liveCostPreview.error)}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {submitting ? 'Registrando...' : 'Confirmar Venda'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Sale Detail & Installment Management Modal */}
      <Modal
        open={Boolean(selectedSale)}
        onClose={() => {
          setSelectedSaleId(null);
          setPayTargetRec(null);
          setDueEditRec(null);
        }}
        title={`Venda ${selectedSale?.documentNumber ?? ''}`}
        subtitle={
          selectedSale
            ? `${selectedSale.clientName} · ${formatDateBR(selectedSale.saleDate)} · Pagamento: ${translateStatus(selectedSale.paymentStatus)} · Entrega: ${translateStatus(selectedSale.deliveryStatus)}`
            : undefined
        }
        maxWidth="4xl"
      >
        {selectedSale && (
          <div className="space-y-5">
            {/* Top actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex flex-wrap gap-4 text-xs">
                <div>
                  <span className="text-zinc-400">Original</span>
                  <p className="font-mono-num font-semibold text-zinc-100">
                    {formatCurrency(selectedSale.originalSaleAmount)}
                  </p>
                </div>
                {selectedSale.hasOwnCredit && (
                  <div>
                    <span className="text-zinc-400">
                      Juros ({formatPercent(selectedSale.ownCreditInterestPercent)})
                    </span>
                    <p className="font-mono-num font-semibold text-amber-400">
                      {formatCurrency(selectedSale.ownCreditInterestAmount)}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-zinc-400">Total c/ Juros</span>
                  <p className="font-mono-num font-semibold text-zinc-100">
                    {formatCurrency(selectedSale.totalWithInterest)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-400">Pago</span>
                  <p className="font-mono-num font-semibold text-emerald-400">
                    {formatCurrency(selectedSale.paidAmount)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-400">Saldo Devedor</span>
                  <p className="font-mono-num font-semibold text-red-400">
                    {formatCurrency(selectedSale.pendingAmount)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedSale.deliveryStatus !== 'ENTREGUE' && (
                  <button
                    type="button"
                    onClick={() =>
                      user &&
                      markSaleAsDelivered(
                        user.uid,
                        selectedSale,
                        products,
                        stockLots,
                        getTodayISO()
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Marcar Entregue
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    generateSaleReceiptPDF(
                      selectedSale,
                      selectedSaleClient,
                      selectedSaleReceivables,
                      settings
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Comprovante de Venda (PDF)
                </button>
              </div>
            </div>

            {/* Items & FIFO Cost */}
            <div>
              <h3 className="font-display mb-2 text-xs font-semibold text-zinc-200">
                Produtos Vendidos e Custeio FIFO
              </h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                      <th className="px-3 py-2 text-right font-medium">Custo Unit. Efetivo</th>
                      <th className="px-3 py-2 text-right font-medium">Custo Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedSale.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-zinc-100">
                          {it.productName} · <span className="text-zinc-400">{it.brand}</span>
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-200">{it.quantity}</td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-300">
                          {formatCurrency(it.unitEffectiveCost)}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right font-semibold text-zinc-100">
                          {formatCurrency(it.totalCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Installments / Receivables */}
            {selectedSaleReceivables.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xs font-semibold text-zinc-200">
                    Parcelas e Contas a Receber
                  </h3>
                  {selectedSaleReceivables.some((r) => r.status !== 'PAGO') && (
                    <button
                      type="button"
                      onClick={handleAdvanceFull}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      Quitação Antecipada Integral
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Parcela</th>
                        <th className="px-3 py-2 font-medium">Vencimento</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">Pago</th>
                        <th className="px-3 py-2 text-right font-medium">Saldo</th>
                        <th className="px-3 py-2 font-medium">Situação</th>
                        <th className="px-3 py-2 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {selectedSaleReceivables.map((rec) => {
                        const rem = round2(rec.totalAmount - rec.paidAmount);
                        return (
                          <tr key={rec.id}>
                            <td className="px-3 py-2 font-medium text-zinc-200">
                              {rec.installmentNumber}/{rec.totalInstallments}
                            </td>
                            <td className="font-mono-num px-3 py-2 text-zinc-300">
                              {formatDateBR(rec.dueDate)}
                              {rec.dueDateHistory.length > 0 && (
                                <span className="block text-[10px] text-zinc-500">
                                  Alterado {rec.dueDateHistory.length}x
                                </span>
                              )}
                            </td>
                            <td className="font-mono-num px-3 py-2 text-right text-zinc-200">
                              {formatCurrency(rec.totalAmount)}
                            </td>
                            <td className="font-mono-num px-3 py-2 text-right text-emerald-400">
                              {formatCurrency(rec.paidAmount)}
                            </td>
                            <td className="font-mono-num px-3 py-2 text-right font-semibold text-zinc-100">
                              {formatCurrency(rem)}
                            </td>
                            <td className="px-3 py-2 text-zinc-300">{translateStatus(rec.status)}</td>
                            <td className="px-3 py-2 text-right">
                              {rec.status !== 'PAGO' ? (
                                <div className="inline-flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPayTargetRec(rec);
                                      setPayAmount(rem);
                                      setPayDate(getTodayISO());
                                      setPayMethod('PIX');
                                      setPayNotes('');
                                    }}
                                    className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                                  >
                                    Receber
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDueEditRec(rec);
                                      setNewDueDate(rec.dueDate);
                                      setDueChangeReason('');
                                    }}
                                    title="Alterar vencimento"
                                    className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                                  >
                                    <CalendarClock className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] text-emerald-400">Quitada</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Inline Pay Installment Form */}
            {payTargetRec && (
              <form
                onSubmit={handlePayReceivable}
                className="space-y-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4"
              >
                <h4 className="font-display text-xs font-semibold text-emerald-300">
                  Registrar Pagamento — Parcela {payTargetRec.installmentNumber}/
                  {payTargetRec.totalInstallments}
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300">Valor (R$)</label>
                    <input
                      type="number"
                      min={0.01}
                      max={round2(payTargetRec.totalAmount - payTargetRec.paidAmount)}
                      step="0.01"
                      required
                      value={payAmount}
                      onChange={(e) => setPayAmount(Number(e.target.value))}
                      className="font-mono-num mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300">Data</label>
                    <input
                      type="date"
                      required
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300">Forma</label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as SalePaymentMethod)}
                      className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="PIX">PIX</option>
                      <option value="DINHEIRO">Dinheiro</option>
                      <option value="DEBITO">Cartão de Débito</option>
                      <option value="CREDITO">Cartão de Crédito</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300">Observação</label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPayTargetRec(null)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Confirmar Baixa
                  </button>
                </div>
              </form>
            )}

            {/* Inline Edit Due Date Form */}
            {dueEditRec && (
              <form
                onSubmit={handleSaveDueDateChange}
                className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <h4 className="font-display text-xs font-semibold text-zinc-100">
                  Alterar Vencimento — Parcela {dueEditRec.installmentNumber}/
                  {dueEditRec.totalInstallments}
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300">
                      Nova Data de Vencimento
                    </label>
                    <input
                      type="date"
                      required
                      value={newDueDate}
                      onChange={(e) => setNewDueDate(e.target.value)}
                      className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300">
                      Motivo / Histórico
                    </label>
                    <input
                      type="text"
                      required
                      value={dueChangeReason}
                      onChange={(e) => setDueChangeReason(e.target.value)}
                      placeholder="Ex.: Cliente solicitou adiamento"
                      className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDueEditRec(null)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Salvar Vencimento
                  </button>
                </div>
              </form>
            )}

            {/* Payment History & Individual Payment Receipts */}
            <div>
              <h3 className="font-display mb-2 text-xs font-semibold text-zinc-200">
                Pagamentos Recebidos ({selectedSalePayments.length})
              </h3>
              {selectedSalePayments.length === 0 ? (
                <p className="text-xs text-zinc-500">Nenhum pagamento registrado nesta venda ainda.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Data</th>
                        <th className="px-3 py-2 font-medium">Recibo</th>
                        <th className="px-3 py-2 font-medium">Forma</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                        <th className="px-3 py-2 text-right font-medium">Comprovante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {selectedSalePayments.map((p) => (
                        <tr key={p.id}>
                          <td className="font-mono-num px-3 py-2 text-zinc-300">{formatDateBR(p.paymentDate)}</td>
                          <td className="font-mono-num px-3 py-2 font-medium text-zinc-100">{p.receiptNumber}</td>
                          <td className="px-3 py-2 text-zinc-300">{translatePaymentMethod(p.method)}</td>
                          <td className="font-mono-num px-3 py-2 text-right font-semibold text-emerald-400">
                            {formatCurrency(p.amount)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                generatePaymentReceiptPDF(
                                  p,
                                  selectedSale,
                                  selectedSaleClient,
                                  settings
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                              <FileText className="h-3 w-3" />
                              Recibo de Pagamento (PDF)
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
