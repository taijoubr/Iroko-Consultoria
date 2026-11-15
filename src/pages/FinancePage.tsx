import React, { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Plus } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { PeriodFilterBar } from '../components/ui/PeriodFilterBar';
import { useAppData } from '../context/AppDataContext';
import {
  createManualExpense,
  registerPayablePayment,
  registerReceivablePayment,
  settleCardOperator,
  updateReceivableDueDate,
} from '../services/firestoreOperations';
import type {
  CardSettlement,
  Payable,
  PeriodPreset,
  Receivable,
  SalePaymentMethod,
} from '../types';
import {
  diffDaysISO,
  formatCurrency,
  formatDateBR,
  getDateRangeFromPreset,
  getTodayISO,
  isDateInRange,
  round2,
  translatePaymentMethod,
  translateStatus,
} from '../utils/formatters';

export function FinancePage() {
  const {
    user,
    payables,
    receivables,
    payments,
    sales,
    cardSettlements,
  } = useAppData();

  const [tab, setTab] = useState<'FLUXO' | 'RECEBER' | 'PAGAR' | 'CARTAO'>('FLUXO');
  const [preset, setPreset] = useState<PeriodPreset>('current_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'ABERTO' | 'VENCIDO' | 'PAGO'>('ABERTO');

  // Modals
  const [payingPayable, setPayingPayable] = useState<Payable | null>(null);
  const [payPayableAmount, setPayPayableAmount] = useState(0);
  const [payPayableDate, setPayPayableDate] = useState(getTodayISO());
  const [payPayableNotes, setPayPayableNotes] = useState('');

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expCategory, setExpCategory] = useState('Embalagens e Sacolas');
  const [expDueDate, setExpDueDate] = useState(getTodayISO());
  const [expAmount, setExpAmount] = useState(0);
  const [expPaidNow, setExpPaidNow] = useState(true);
  const [expNotes, setExpNotes] = useState('');

  const [payingRec, setPayingRec] = useState<Receivable | null>(null);
  const [recPayAmount, setRecPayAmount] = useState(0);
  const [recPayDate, setRecPayDate] = useState(getTodayISO());
  const [recPayMethod, setRecPayMethod] = useState<SalePaymentMethod>('PIX');
  const [recPayNotes, setRecPayNotes] = useState('');

  const [editingDueRec, setEditingDueRec] = useState<Receivable | null>(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [dueReason, setDueReason] = useState('');

  const [settlingCard, setSettlingCard] = useState<CardSettlement | null>(null);
  const [cardSettleDate, setCardSettleDate] = useState(getTodayISO());
  const [cardNetAmount, setCardNetAmount] = useState(0);
  const [cardOperator, setCardOperator] = useState('');
  const [cardNotes, setCardNotes] = useState('');

  const today = getTodayISO();
  const range = useMemo(
    () => getDateRangeFromPreset(preset, customStart, customEnd),
    [preset, customStart, customEnd]
  );

  // Cash flow computation (never double-counting card payments)
  const cashFlowData = useMemo(() => {
    const entries: {
      id: string;
      date: string;
      type: 'ENTRADA' | 'SAIDA';
      category: string;
      description: string;
      amount: number;
    }[] = [];

    // Direct cash inflows (Dinheiro, PIX, Crédito Próprio installments)
    const directPayments = payments.filter(
      (p) =>
        p.method !== 'DEBITO' &&
        p.method !== 'CREDITO' &&
        isDateInRange(p.paymentDate, range.start, range.end)
    );
    for (const p of directPayments) {
      entries.push({
        id: p.id,
        date: p.paymentDate,
        type: 'ENTRADA',
        category: translatePaymentMethod(p.method),
        description: `${p.clientName} · ${p.receiptNumber}`,
        amount: p.amount,
      });
    }

    // Card operator deposits (net deposited into bank account)
    const settledCards = cardSettlements.filter(
      (c) => c.status === 'RECEBIDO' && isDateInRange(c.settlementDate, range.start, range.end)
    );
    for (const c of settledCards) {
      entries.push({
        id: c.id,
        date: c.settlementDate,
        type: 'ENTRADA',
        category: `Operadora (${translatePaymentMethod(c.cardMethod)})`,
        description: `${c.saleDocumentNumber} · ${c.clientName} (Bruto ${formatCurrency(c.grossCardAmount)} - Taxa ${formatCurrency(c.feeAmount)})`,
        amount: c.netDepositedAmount,
      });
    }

    // Paid payables (Boletos + Expenses)
    const paidPayables = payables.filter(
      (p) => p.paidAmount > 0 && isDateInRange(p.paidDate || p.dueDate, range.start, range.end)
    );
    for (const p of paidPayables) {
      entries.push({
        id: p.id,
        date: p.paidDate || p.dueDate,
        type: 'SAIDA',
        category: p.type === 'DESPESA' ? 'Despesa' : 'Boleto Marca',
        description: p.description,
        amount: p.paidAmount,
      });
    }

    entries.sort((a, b) => b.date.localeCompare(a.date));

    const totalInflows = round2(
      entries.filter((e) => e.type === 'ENTRADA').reduce((acc, e) => acc + e.amount, 0)
    );
    const totalOutflows = round2(
      entries.filter((e) => e.type === 'SAIDA').reduce((acc, e) => acc + e.amount, 0)
    );
    const cashBalance = round2(totalInflows - totalOutflows);
    const cardFees = round2(settledCards.reduce((acc, c) => acc + c.feeAmount, 0));

    const interestReceived = round2(
      payments
        .filter((p) => isDateInRange(p.paymentDate, range.start, range.end))
        .reduce((acc, p) => acc + p.interestPortion, 0)
    );

    const interestPaid = round2(
      paidPayables.reduce((acc, p) => {
        if (p.totalAmount <= 0) return acc;
        const ratio = p.paidAmount / p.totalAmount;
        return acc + round2(p.interestAmount * ratio);
      }, 0)
    );

    const financialExpenses = round2(cardFees + interestPaid);

    return {
      entries,
      totalInflows,
      totalOutflows,
      cashBalance,
      cardFees,
      interestReceived,
      interestPaid,
      financialExpenses,
    };
  }, [payments, cardSettlements, payables, range]);

  const filteredReceivables = useMemo(() => {
    return receivables
      .filter((r) => {
        if (statusFilter === 'ABERTO' && r.status === 'PAGO') return false;
        if (statusFilter === 'VENCIDO' && (r.status === 'PAGO' || r.dueDate >= today)) return false;
        if (statusFilter === 'PAGO' && r.status !== 'PAGO') return false;
        return true;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [receivables, statusFilter, today]);

  const filteredPayables = useMemo(() => {
    return payables
      .filter((p) => {
        if (statusFilter === 'ABERTO' && p.status === 'PAGO') return false;
        if (statusFilter === 'VENCIDO' && (p.status === 'PAGO' || p.dueDate >= today)) return false;
        if (statusFilter === 'PAGO' && p.status !== 'PAGO') return false;
        return true;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [payables, statusFilter, today]);

  const sortedCardSettlements = useMemo(
    () =>
      [...cardSettlements].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'AGUARDANDO' ? -1 : 1;
        return b.saleDate.localeCompare(a.saleDate);
      }),
    [cardSettlements]
  );

  const handlePayPayableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingPayable) return;
    await registerPayablePayment(payingPayable, payPayableAmount, payPayableDate, payPayableNotes);
    setPayingPayable(null);
  };

  const handleCreateExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    await createManualExpense(user.uid, {
      description: expDesc,
      category: expCategory,
      dueDate: expDueDate,
      amount: expAmount,
      paidNow: expPaidNow,
      paidDate: expDueDate,
      notes: expNotes,
    });
    setExpDesc('');
    setExpAmount(0);
    setExpNotes('');
    setShowExpenseModal(false);
  };

  const handlePayReceivableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payingRec) return;
    const relSale = sales.find((s) => s.id === payingRec.saleId);
    if (!relSale) return;
    await registerReceivablePayment(
      user.uid,
      relSale,
      payingRec,
      recPayAmount,
      recPayDate,
      recPayMethod,
      recPayNotes,
      payments.length
    );
    setPayingRec(null);
  };

  const handleDueDateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDueRec) return;
    await updateReceivableDueDate(editingDueRec, newDueDate, dueReason);
    setEditingDueRec(null);
  };

  const handleSettleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingCard) return;
    await settleCardOperator(
      settlingCard,
      cardSettleDate,
      cardNetAmount,
      cardOperator,
      cardNotes
    );
    setSettlingCard(null);
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {(
            [
              { id: 'FLUXO', label: 'Fluxo de Caixa' },
              { id: 'RECEBER', label: 'Contas a Receber' },
              { id: 'PAGAR', label: 'Contas a Pagar' },
              { id: 'CARTAO', label: 'Operadoras de Cartão' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'FLUXO' ? (
          <PeriodFilterBar
            preset={preset}
            onPresetChange={setPreset}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        ) : tab === 'PAGAR' || tab === 'RECEBER' ? (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {(
                [
                  { id: 'ABERTO', label: 'Em Aberto' },
                  { id: 'VENCIDO', label: 'Vencidas' },
                  { id: 'PAGO', label: 'Pagas' },
                  { id: 'TODOS', label: 'Todas' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s.id
                      ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {tab === 'PAGAR' && (
              <button
                type="button"
                onClick={() => setShowExpenseModal(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova Despesa
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Tab 1: Fluxo de Caixa */}
      {tab === 'FLUXO' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryTile
              label="Entradas de Caixa"
              value={formatCurrency(cashFlowData.totalInflows)}
              tone="positive"
            />
            <SummaryTile
              label="Saídas Pagas"
              value={formatCurrency(cashFlowData.totalOutflows)}
              tone="danger"
            />
            <SummaryTile
              label="Saldo do Período"
              value={formatCurrency(cashFlowData.cashBalance)}
              tone={cashFlowData.cashBalance >= 0 ? 'positive' : 'danger'}
            />
            <SummaryTile
              label="Taxas de Cartão"
              value={formatCurrency(cashFlowData.cardFees)}
              tone="warning"
            />
            <SummaryTile
              label="Juros Recebidos"
              value={formatCurrency(cashFlowData.interestReceived)}
              tone="positive"
            />
            <SummaryTile
              label="Juros Pagos (Boletos)"
              value={formatCurrency(cashFlowData.interestPaid)}
              tone="neutral"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            {cashFlowData.entries.length === 0 ? (
              <div className="px-6 py-10 text-center text-xs text-zinc-500">
                Nenhuma movimentação financeira efetivada no período selecionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Data</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Categoria</th>
                      <th className="px-4 py-3 font-medium">Descrição</th>
                      <th className="px-4 py-3 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {cashFlowData.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-800/40">
                        <td className="font-mono-num px-4 py-2.5 text-zinc-400">
                          {formatDateBR(entry.date)}
                        </td>
                        <td
                          className={`px-4 py-2.5 font-medium ${
                            entry.type === 'ENTRADA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {entry.type === 'ENTRADA' ? 'Entrada' : 'Saída'}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-300">{entry.category}</td>
                        <td className="px-4 py-2.5 text-zinc-200">{entry.description}</td>
                        <td
                          className={`font-mono-num px-4 py-2.5 text-right font-semibold ${
                            entry.type === 'ENTRADA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {entry.type === 'ENTRADA' ? '+' : '-'}
                          {formatCurrency(entry.amount)}
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

      {/* Tab 2: Contas a Receber */}
      {tab === 'RECEBER' && (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
          {filteredReceivables.length === 0 ? (
            <div className="px-6 py-10 text-center text-xs text-zinc-500">
              Nenhuma conta a receber encontrada neste filtro.
            </div>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="divide-y divide-zinc-800 md:hidden">
                {filteredReceivables.map((rec) => {
                  const rem = round2(rec.totalAmount - rec.paidAmount);
                  const isOverdue = rec.status !== 'PAGO' && rec.dueDate < today;
                  const daysLate = isOverdue ? diffDaysISO(rec.dueDate, today) : 0;
                  return (
                    <div key={rec.id} className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-100">{rec.clientName}</p>
                          <p className="font-mono-num text-[11px] text-zinc-400">
                            {rec.documentNumber} · Parcela {rec.installmentNumber}/
                            {rec.totalInstallments}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-500">
                            {rec.type === 'CREDITO_PROPRIO' ? 'Crédito Próprio' : 'Saldo de Venda'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className={`font-mono-num text-xs ${
                              isOverdue ? 'font-semibold text-red-400' : 'text-zinc-300'
                            }`}
                          >
                            {formatDateBR(rec.dueDate)}
                          </p>
                          {isOverdue && (
                            <span className="block text-[10px] font-medium text-red-400">
                              {daysLate}d em atraso
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                        <div>
                          <span className="text-zinc-500">Total</span>
                          <p className="font-mono-num font-medium text-zinc-200">
                            {formatCurrency(rec.totalAmount)}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Pago</span>
                          <p className="font-mono-num font-medium text-emerald-400">
                            {formatCurrency(rec.paidAmount)}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Saldo</span>
                          <p className="font-mono-num font-semibold text-zinc-100">
                            {formatCurrency(rem)}
                          </p>
                        </div>
                      </div>

                      {rec.status !== 'PAGO' ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPayingRec(rec);
                              setRecPayAmount(rem);
                              setRecPayDate(getTodayISO());
                              setRecPayMethod('PIX');
                              setRecPayNotes('');
                            }}
                            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                          >
                            Receber
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDueRec(rec);
                              setNewDueDate(rec.dueDate);
                              setDueReason('');
                            }}
                            title="Alterar vencimento"
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            Vencimento
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs font-medium text-emerald-400">Quitado</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Cliente · Venda</th>
                      <th className="px-4 py-3 font-medium">Modalidade</th>
                      <th className="px-4 py-3 font-medium">Vencimento</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                      <th className="px-4 py-3 text-right font-medium">Pago</th>
                      <th className="px-4 py-3 text-right font-medium">Saldo</th>
                      <th className="px-4 py-3 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {filteredReceivables.map((rec) => {
                      const rem = round2(rec.totalAmount - rec.paidAmount);
                      const isOverdue = rec.status !== 'PAGO' && rec.dueDate < today;
                      const daysLate = isOverdue ? diffDaysISO(rec.dueDate, today) : 0;
                      return (
                        <tr key={rec.id} className="hover:bg-zinc-800/40">
                          <td className="px-4 py-3">
                            <p className="font-medium text-zinc-100">{rec.clientName}</p>
                            <p className="font-mono-num text-[11px] text-zinc-400">
                              {rec.documentNumber} · Parcela {rec.installmentNumber}/
                              {rec.totalInstallments}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-zinc-300">
                            {rec.type === 'CREDITO_PROPRIO' ? 'Crédito Próprio' : 'Saldo de Venda'}
                          </td>
                          <td
                            className={`font-mono-num px-4 py-3 ${
                              isOverdue ? 'font-semibold text-red-400' : 'text-zinc-300'
                            }`}
                          >
                            {formatDateBR(rec.dueDate)}
                            {isOverdue && (
                              <span className="block text-[10px] font-medium text-red-400">
                                Vencida há {daysLate} dia(s)
                              </span>
                            )}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right text-zinc-200">
                            {formatCurrency(rec.totalAmount)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right text-emerald-400">
                            {formatCurrency(rec.paidAmount)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                            {formatCurrency(rem)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {rec.status !== 'PAGO' ? (
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPayingRec(rec);
                                    setRecPayAmount(rem);
                                    setRecPayDate(getTodayISO());
                                    setRecPayMethod('PIX');
                                    setRecPayNotes('');
                                  }}
                                  className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                                >
                                  Receber
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingDueRec(rec);
                                    setNewDueDate(rec.dueDate);
                                    setDueReason('');
                                  }}
                                  title="Alterar vencimento"
                                  className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                                >
                                  <CalendarClock className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-400">Quitado</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 3: Contas a Pagar */}
      {tab === 'PAGAR' && (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
          {filteredPayables.length === 0 ? (
            <div className="px-6 py-10 text-center text-xs text-zinc-500">
              Nenhuma conta a pagar encontrada neste filtro.
            </div>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="divide-y divide-zinc-800 md:hidden">
                {filteredPayables.map((p) => {
                  const rem = round2(p.totalAmount - p.paidAmount);
                  const isOverdue = p.status !== 'PAGO' && p.dueDate < today;
                  return (
                    <div key={p.id} className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-100">{p.description}</p>
                          <p className="text-xs text-zinc-400">{p.category}</p>
                        </div>
                        <span
                          className={`font-mono-num shrink-0 text-xs ${
                            isOverdue ? 'font-semibold text-red-400' : 'text-zinc-300'
                          }`}
                        >
                          {formatDateBR(p.dueDate)}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                        <div>
                          <span className="text-zinc-500">Total</span>
                          <p className="font-mono-num font-medium text-zinc-200">
                            {formatCurrency(p.totalAmount)}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Pago</span>
                          <p className="font-mono-num font-medium text-emerald-400">
                            {formatCurrency(p.paidAmount)}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Saldo</span>
                          <p className="font-mono-num font-semibold text-zinc-100">
                            {formatCurrency(rem)}
                          </p>
                        </div>
                      </div>

                      {p.status !== 'PAGO' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPayingPayable(p);
                            setPayPayableAmount(rem);
                            setPayPayableDate(getTodayISO());
                            setPayPayableNotes('');
                          }}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
                        >
                          Registrar Pagamento
                        </button>
                      ) : (
                        <p className="text-xs text-emerald-400">
                          Pago em {formatDateBR(p.paidDate)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Descrição</th>
                      <th className="px-4 py-3 font-medium">Categoria</th>
                      <th className="px-4 py-3 font-medium">Vencimento</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                      <th className="px-4 py-3 text-right font-medium">Pago</th>
                      <th className="px-4 py-3 text-right font-medium">Saldo</th>
                      <th className="px-4 py-3 text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {filteredPayables.map((p) => {
                      const rem = round2(p.totalAmount - p.paidAmount);
                      const isOverdue = p.status !== 'PAGO' && p.dueDate < today;
                      return (
                        <tr key={p.id} className="hover:bg-zinc-800/40">
                          <td className="px-4 py-3 font-medium text-zinc-100">{p.description}</td>
                          <td className="px-4 py-3 text-zinc-400">{p.category}</td>
                          <td
                            className={`font-mono-num px-4 py-3 ${
                              isOverdue ? 'font-semibold text-red-400' : 'text-zinc-300'
                            }`}
                          >
                            {formatDateBR(p.dueDate)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right text-zinc-200">
                            {formatCurrency(p.totalAmount)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right text-emerald-400">
                            {formatCurrency(p.paidAmount)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                            {formatCurrency(rem)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {p.status !== 'PAGO' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingPayable(p);
                                  setPayPayableAmount(rem);
                                  setPayPayableDate(getTodayISO());
                                  setPayPayableNotes('');
                                }}
                                className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                              >
                                Registrar Pagamento
                              </button>
                            ) : (
                              <span className="text-[11px] text-emerald-400">
                                Pago em {formatDateBR(p.paidDate)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 4: Operadoras de Cartão */}
      {tab === 'CARTAO' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs text-zinc-400">
            Controle de repasses das operadoras de cartão. Ao confirmar o valor efetivamente depositado, a diferença é registrada como <strong className="text-zinc-200">Taxa / Despesa de Cartão</strong> sem gerar segunda baixa no cliente.
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            {sortedCardSettlements.length === 0 ? (
              <div className="px-6 py-10 text-center text-xs text-zinc-500">
                Nenhuma venda no cartão de crédito ou débito registrada ainda.
              </div>
            ) : (
              <>
                {/* Mobile Cards */}
                <div className="divide-y divide-zinc-800 md:hidden">
                  {sortedCardSettlements.map((cs) => (
                    <div key={cs.id} className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-zinc-100">{cs.clientName}</p>
                          <p className="font-mono-num text-[11px] text-zinc-400">
                            {formatDateBR(cs.saleDate)} · {cs.saleDocumentNumber}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-300">
                            {translatePaymentMethod(cs.cardMethod)} ({cs.installments}x)
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium ${
                            cs.status === 'RECEBIDO' ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {translateStatus(cs.status)}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                        <div>
                          <span className="text-zinc-500">Bruto</span>
                          <p className="font-mono-num font-medium text-zinc-200">
                            {formatCurrency(cs.grossCardAmount)}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Depositado</span>
                          <p className="font-mono-num font-semibold text-emerald-400">
                            {cs.status === 'RECEBIDO' ? formatCurrency(cs.netDepositedAmount) : '—'}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Taxa</span>
                          <p className="font-mono-num text-red-400">
                            {cs.status === 'RECEBIDO' ? formatCurrency(cs.feeAmount) : '—'}
                          </p>
                        </div>
                      </div>

                      {cs.status === 'AGUARDANDO' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSettlingCard(cs);
                            setCardSettleDate(getTodayISO());
                            setCardNetAmount(cs.grossCardAmount);
                            setCardOperator('');
                            setCardNotes('');
                          }}
                          className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Confirmar Depósito
                        </button>
                      ) : (
                        <p className="text-[11px] text-zinc-500">
                          {cs.operatorName || 'Conciliado'}
                          {cs.settlementDate ? ` · ${formatDateBR(cs.settlementDate)}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Data Venda · Doc.</th>
                        <th className="px-4 py-3 font-medium">Cliente</th>
                        <th className="px-4 py-3 font-medium">Modalidade</th>
                        <th className="px-4 py-3 text-right font-medium">Bruto Venda</th>
                        <th className="px-4 py-3 text-right font-medium">Depositado</th>
                        <th className="px-4 py-3 text-right font-medium">Taxa (Despesa)</th>
                        <th className="px-4 py-3 font-medium">Situação</th>
                        <th className="px-4 py-3 text-right font-medium">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {sortedCardSettlements.map((cs) => (
                        <tr key={cs.id} className="hover:bg-zinc-800/40">
                          <td className="px-4 py-3">
                            <p className="font-mono-num font-medium text-zinc-100">{formatDateBR(cs.saleDate)}</p>
                            <p className="font-mono-num text-[11px] text-zinc-400">
                              {cs.saleDocumentNumber}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-zinc-100">{cs.clientName}</td>
                          <td className="px-4 py-3 text-zinc-300">
                            {translatePaymentMethod(cs.cardMethod)} ({cs.installments}x)
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-medium text-zinc-200">
                            {formatCurrency(cs.grossCardAmount)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-semibold text-emerald-400">
                            {cs.status === 'RECEBIDO' ? formatCurrency(cs.netDepositedAmount) : '—'}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right text-red-400">
                            {cs.status === 'RECEBIDO' ? formatCurrency(cs.feeAmount) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-medium ${
                                cs.status === 'RECEBIDO' ? 'text-emerald-400' : 'text-amber-400'
                              }`}
                            >
                              {translateStatus(cs.status)}
                            </span>
                            {cs.settlementDate && (
                              <span className="block font-mono-num text-[10px] text-zinc-500">
                                {formatDateBR(cs.settlementDate)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {cs.status === 'AGUARDANDO' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSettlingCard(cs);
                                  setCardSettleDate(getTodayISO());
                                  setCardNetAmount(cs.grossCardAmount);
                                  setCardOperator('');
                                  setCardNotes('');
                                }}
                                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Confirmar Depósito
                              </button>
                            ) : (
                              <span className="text-[11px] text-zinc-500">
                                {cs.operatorName || 'Conciliado'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Pay Payable */}
      <Modal
        open={Boolean(payingPayable)}
        onClose={() => setPayingPayable(null)}
        title="Registrar Pagamento de Conta"
        subtitle={payingPayable?.description}
        maxWidth="md"
      >
        {payingPayable && (
          <form onSubmit={handlePayPayableSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300">Valor Pago (R$)</label>
                <input
                  type="number"
                  min={0.01}
                  max={round2(payingPayable.totalAmount - payingPayable.paidAmount)}
                  step="0.01"
                  required
                  value={payPayableAmount}
                  onChange={(e) => setPayPayableAmount(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300">Data do Pagamento</label>
                <input
                  type="date"
                  required
                  value={payPayableDate}
                  onChange={(e) => setPayPayableDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Observações</label>
              <input
                type="text"
                value={payPayableNotes}
                onChange={(e) => setPayPayableNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayingPayable(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Confirmar Pagamento
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: New Expense */}
      <Modal
        open={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        title="Registrar Despesa Operacional"
        maxWidth="md"
      >
        <form onSubmit={handleCreateExpenseSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300">Descrição *</label>
            <input
              type="text"
              required
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              placeholder="Ex.: Sacolas para entregas, Frete, Aluguel maquininha"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Categoria</label>
              <input
                type="text"
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Valor (R$) *</label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                value={expAmount || ''}
                onChange={(e) => setExpAmount(Number(e.target.value))}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Data / Vencimento</label>
              <input
                type="date"
                required
                value={expDueDate}
                onChange={(e) => setExpDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={expPaidNow}
                  onChange={(e) => setExpPaidNow(e.target.checked)}
                  className="accent-emerald-500"
                />
                Já foi pago
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300">Observações</label>
            <input
              type="text"
              value={expNotes}
              onChange={(e) => setExpNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowExpenseModal(false)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Salvar Despesa
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Pay Receivable */}
      <Modal
        open={Boolean(payingRec)}
        onClose={() => setPayingRec(null)}
        title="Receber Parcela de Cliente"
        subtitle={
          payingRec
            ? `${payingRec.clientName} · ${payingRec.documentNumber} (${payingRec.installmentNumber}/${payingRec.totalInstallments})`
            : undefined
        }
        maxWidth="md"
      >
        {payingRec && (
          <form onSubmit={handlePayReceivableSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300">Valor (R$)</label>
                <input
                  type="number"
                  min={0.01}
                  max={round2(payingRec.totalAmount - payingRec.paidAmount)}
                  step="0.01"
                  required
                  value={recPayAmount}
                  onChange={(e) => setRecPayAmount(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300">Data Recebimento</label>
                <input
                  type="date"
                  required
                  value={recPayDate}
                  onChange={(e) => setRecPayDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Forma de Pagamento</label>
              <select
                value={recPayMethod}
                onChange={(e) => setRecPayMethod(e.target.value as SalePaymentMethod)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="PIX">PIX</option>
                <option value="DINHEIRO">Dinheiro</option>
                <option value="DEBITO">Cartão de Débito</option>
                <option value="CREDITO">Cartão de Crédito</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Observações</label>
              <input
                type="text"
                value={recPayNotes}
                onChange={(e) => setRecPayNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayingRec(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Confirmar Recebimento
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Edit Due Date */}
      <Modal
        open={Boolean(editingDueRec)}
        onClose={() => setEditingDueRec(null)}
        title="Alterar Vencimento da Parcela"
        maxWidth="md"
      >
        {editingDueRec && (
          <form onSubmit={handleDueDateSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Nova Data de Vencimento
              </label>
              <input
                type="date"
                required
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Motivo</label>
              <input
                type="text"
                required
                value={dueReason}
                onChange={(e) => setDueReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingDueRec(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Salvar Nova Data
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Settle Card Operator */}
      <Modal
        open={Boolean(settlingCard)}
        onClose={() => setSettlingCard(null)}
        title="Confirmar Recebimento da Operadora de Cartão"
        subtitle={
          settlingCard
            ? `${settlingCard.saleDocumentNumber} · Valor bruto da venda: ${formatCurrency(settlingCard.grossCardAmount)}`
            : undefined
        }
        maxWidth="md"
      >
        {settlingCard && (
          <form onSubmit={handleSettleCardSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300">
                  Data do Depósito *
                </label>
                <input
                  type="date"
                  required
                  value={cardSettleDate}
                  onChange={(e) => setCardSettleDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300">
                  Valor Efetivamente Depositado (R$) *
                </label>
                <input
                  type="number"
                  min={0}
                  max={settlingCard.grossCardAmount}
                  step="0.01"
                  required
                  value={cardNetAmount}
                  onChange={(e) => setCardNetAmount(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
              Taxa / Despesa de Cartão calculada:{' '}
              <strong className="font-mono-num text-red-400">
                {formatCurrency(round2(settlingCard.grossCardAmount - cardNetAmount))}
              </strong>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Operadora / Maquininha (opcional)
              </label>
              <input
                type="text"
                value={cardOperator}
                onChange={(e) => setCardOperator(e.target.value)}
                placeholder="Ex.: Mercado Pago, PagBank, Stone"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Observações</label>
              <input
                type="text"
                value={cardNotes}
                onChange={(e) => setCardNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettlingCard(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Confirmar Recebimento
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'danger' | 'warning' | 'neutral';
}) {
  const color =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'danger'
        ? 'text-red-400'
        : tone === 'warning'
          ? 'text-amber-400'
          : 'text-zinc-100';

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
      <span className="text-[11px] font-medium text-zinc-400">{label}</span>
      <p className={`font-mono-num mt-1 text-base font-semibold ${color}`}>{value}</p>
    </div>
  );
}
