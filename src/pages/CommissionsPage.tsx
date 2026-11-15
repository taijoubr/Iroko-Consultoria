import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  HandCoins,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import {
  createCommission,
  deleteCommission,
  registerCommissionPayment,
  updateCommission,
} from '../services/firestoreOperations';
import type { Commission } from '../types';
import {
  formatCurrency,
  formatDateBR,
  formatPercent,
  getTodayISO,
  round2,
  translateStatus,
} from '../utils/formatters';

interface CommissionsPageProps {
  externalOpenNew?: boolean;
  onClearExternalNew?: () => void;
  onGoToFinancePayables?: () => void;
}

export function CommissionsPage({
  externalOpenNew,
  onClearExternalNew,
  onGoToFinancePayables,
}: CommissionsPageProps) {
  const { user, commissions, sales } = useAppData();

  const [statusFilter, setStatusFilter] = useState<'ABERTO' | 'VENCIDO' | 'PAGO' | 'TODOS'>('ABERTO');
  const [sellerFilter, setSellerFilter] = useState<string>('TODOS');
  const [search, setSearch] = useState('');

  // Create / Edit modal state
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCommission, setEditingCommission] = useState<Commission | null>(null);
  const [sellerName, setSellerName] = useState('');
  const [sellerContact, setSellerContact] = useState('');
  const [saleId, setSaleId] = useState('');
  const [saleDocumentNumber, setSaleDocumentNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [commissionDate, setCommissionDate] = useState(getTodayISO());
  const [dueDate, setDueDate] = useState(getTodayISO());
  const [baseAmount, setBaseAmount] = useState<number>(0);
  const [commissionPercent, setCommissionPercent] = useState<number>(10);
  const [commissionAmount, setCommissionAmount] = useState<number>(0);
  const [paidNow, setPaidNow] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Payment / Settlement modal state
  const [payingCommission, setPayingCommission] = useState<Commission | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState(getTodayISO());
  const [payNotes, setPayNotes] = useState('');
  const [payingSaving, setPayingSaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<Commission | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const today = getTodayISO();

  const sortedSales = useMemo(
    () => [...sales].sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
    [sales]
  );

  // Distinct known sellers for quick autocomplete & summary
  const sellerSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        sellerName: string;
        sellerContact: string;
        count: number;
        totalCommission: number;
        totalPaid: number;
        totalPending: number;
      }
    >();

    for (const c of commissions) {
      const key = c.sellerName.trim();
      const existing = map.get(key) || {
        sellerName: key,
        sellerContact: c.sellerContact || '',
        count: 0,
        totalCommission: 0,
        totalPaid: 0,
        totalPending: 0,
      };
      if (!existing.sellerContact && c.sellerContact) {
        existing.sellerContact = c.sellerContact;
      }
      existing.count += 1;
      existing.totalCommission = round2(existing.totalCommission + c.commissionAmount);
      existing.totalPaid = round2(existing.totalPaid + c.paidAmount);
      existing.totalPending = round2(
        existing.totalPending + Math.max(0, c.commissionAmount - c.paidAmount)
      );
      map.set(key, existing);
    }

    return Array.from(map.values()).sort((a, b) => b.totalPending - a.totalPending || a.sellerName.localeCompare(b.sellerName));
  }, [commissions]);

  const kpis = useMemo(() => {
    const totalPending = round2(
      commissions.reduce((acc, c) => acc + Math.max(0, c.commissionAmount - c.paidAmount), 0)
    );
    const totalPaid = round2(commissions.reduce((acc, c) => acc + c.paidAmount, 0));
    const totalLaunched = round2(commissions.reduce((acc, c) => acc + c.commissionAmount, 0));
    const overdueCount = commissions.filter(
      (c) => c.status !== 'PAGO' && c.dueDate < today
    ).length;

    return {
      totalPending,
      totalPaid,
      totalLaunched,
      overdueCount,
      sellersCount: sellerSummaries.length,
    };
  }, [commissions, sellerSummaries.length, today]);

  const filteredCommissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...commissions]
      .filter((c) => {
        if (statusFilter === 'ABERTO' && c.status === 'PAGO') return false;
        if (statusFilter === 'VENCIDO' && (c.status === 'PAGO' || c.dueDate >= today)) return false;
        if (statusFilter === 'PAGO' && c.status !== 'PAGO') return false;
        if (sellerFilter !== 'TODOS' && c.sellerName.trim() !== sellerFilter) return false;
        if (!q) return true;
        return (
          c.sellerName.toLowerCase().includes(q) ||
          c.saleDocumentNumber.toLowerCase().includes(q) ||
          c.clientName.toLowerCase().includes(q) ||
          c.notes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === 'PAGO') return 1;
          if (b.status === 'PAGO') return -1;
        }
        return a.dueDate.localeCompare(b.dueDate);
      });
  }, [commissions, statusFilter, sellerFilter, search, today]);

  const openNewModal = () => {
    setEditingCommission(null);
    setFormError(null);
    setSellerName(sellerFilter !== 'TODOS' ? sellerFilter : '');
    const matchedSeller =
      sellerFilter !== 'TODOS'
        ? sellerSummaries.find((s) => s.sellerName === sellerFilter)
        : undefined;
    setSellerContact(matchedSeller?.sellerContact || '');
    setSaleId('');
    setSaleDocumentNumber('');
    setClientName('');
    setCommissionDate(getTodayISO());
    setDueDate(getTodayISO());
    setBaseAmount(0);
    setCommissionPercent(10);
    setCommissionAmount(0);
    setPaidNow(false);
    setNotes('');
    setShowFormModal(true);
  };

  React.useEffect(() => {
    if (externalOpenNew) {
      openNewModal();
      onClearExternalNew?.();
    }
  }, [externalOpenNew, onClearExternalNew]);

  const openEditModal = (c: Commission) => {
    setEditingCommission(c);
    setFormError(null);
    setSellerName(c.sellerName);
    setSellerContact(c.sellerContact || '');
    setSaleId(c.saleId || '');
    setSaleDocumentNumber(c.saleDocumentNumber || '');
    setClientName(c.clientName || '');
    setCommissionDate(c.commissionDate);
    setDueDate(c.dueDate);
    setBaseAmount(c.baseAmount || 0);
    setCommissionPercent(c.commissionPercent || 0);
    setCommissionAmount(c.commissionAmount);
    setPaidNow(false);
    setNotes(c.notes || '');
    setShowFormModal(true);
  };

  const handleSelectSale = (selectedId: string) => {
    setSaleId(selectedId);
    if (!selectedId) {
      setSaleDocumentNumber('');
      setClientName('');
      return;
    }
    const sale = sales.find((s) => s.id === selectedId);
    if (!sale) return;
    setSaleDocumentNumber(sale.documentNumber);
    setClientName(sale.clientName);
    setCommissionDate(sale.saleDate);
    setBaseAmount(sale.originalSaleAmount);
    if (commissionPercent > 0) {
      setCommissionAmount(round2((sale.originalSaleAmount * commissionPercent) / 100));
    }
  };

  const handleBaseOrPercentChange = (nextBase: number, nextPercent: number) => {
    setBaseAmount(nextBase);
    setCommissionPercent(nextPercent);
    if (nextBase > 0 && nextPercent > 0) {
      setCommissionAmount(round2((nextBase * nextPercent) / 100));
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    if (!sellerName.trim()) {
      setFormError('Informe o nome do(a) vendedor(a).');
      return;
    }
    if (commissionAmount <= 0) {
      setFormError('Informe um valor de comissão maior que zero.');
      return;
    }

    setSaving(true);
    try {
      if (editingCommission) {
        await updateCommission(editingCommission, {
          sellerName,
          sellerContact,
          saleId,
          saleDocumentNumber,
          clientName,
          commissionDate,
          dueDate,
          baseAmount,
          commissionPercent,
          commissionAmount,
          notes,
        });
      } else {
        await createCommission(user.uid, {
          sellerName,
          sellerContact,
          saleId,
          saleDocumentNumber,
          clientName,
          commissionDate,
          dueDate,
          baseAmount,
          commissionPercent,
          commissionAmount,
          paidNow,
          paidDate: paidNow ? dueDate : '',
          notes,
        });
      }
      setShowFormModal(false);
      setEditingCommission(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível salvar a comissão.');
    } finally {
      setSaving(false);
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCommission) return;
    setPayError(null);
    setPayingSaving(true);
    try {
      await registerCommissionPayment(payingCommission, payAmount, payDate, payNotes);
      setPayingCommission(null);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Não foi possível registrar o pagamento.');
    } finally {
      setPayingSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteCommission(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Não foi possível excluir a comissão.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <span className="text-[11px] font-medium text-zinc-400">Comissões em Aberto</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-amber-400">
            {formatCurrency(kpis.totalPending)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {kpis.overdueCount > 0
              ? `${kpis.overdueCount} vencida(s) aguardando baixa`
              : 'Sincronizado com Contas a Pagar'}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <span className="text-[11px] font-medium text-zinc-400">Total Já Pago</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-emerald-400">
            {formatCurrency(kpis.totalPaid)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Lançado automaticamente no Fluxo de Caixa</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <span className="text-[11px] font-medium text-zinc-400">Total Lançado</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-zinc-100">
            {formatCurrency(kpis.totalLaunched)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{commissions.length} registro(s) no total</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <span className="text-[11px] font-medium text-zinc-400">Vendedores Comissionados</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-zinc-100">
            {kpis.sellersCount}
          </p>
          {onGoToFinancePayables && (
            <button
              type="button"
              onClick={onGoToFinancePayables}
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:underline"
            >
              Dar baixa no Financeiro
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Per-Seller Summary Cards */}
      {sellerSummaries.length > 0 && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-zinc-100">
                Resumo por Vendedor(a)
              </h2>
              <p className="text-xs text-zinc-400">
                Clique em um vendedor para filtrar os lançamentos abaixo.
              </p>
            </div>
            {sellerFilter !== 'TODOS' && (
              <button
                type="button"
                onClick={() => setSellerFilter('TODOS')}
                className="text-xs font-medium text-emerald-400 hover:underline"
              >
                Mostrar todos os vendedores
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {sellerSummaries.map((s) => {
              const selected = sellerFilter === s.sellerName;
              return (
                <button
                  key={s.sellerName}
                  type="button"
                  onClick={() =>
                    setSellerFilter((prev) => (prev === s.sellerName ? 'TODOS' : s.sellerName))
                  }
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? 'border-emerald-500/70 bg-emerald-950/30'
                      : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-700 hover:bg-zinc-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 truncate text-xs font-semibold text-zinc-100">
                      <UserCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate">{s.sellerName}</span>
                    </span>
                    <span className="text-[10px] text-zinc-500">{s.count}x</span>
                  </div>
                  {s.sellerContact && (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-400">{s.sellerContact}</p>
                  )}
                  <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="text-zinc-400">
                      Pago:{' '}
                      <strong className="font-mono-num text-emerald-400">
                        {formatCurrency(s.totalPaid)}
                      </strong>
                    </span>
                    <span className="text-zinc-400">
                      A pagar:{' '}
                      <strong
                        className={`font-mono-num ${
                          s.totalPending > 0 ? 'text-amber-400' : 'text-zinc-300'
                        }`}
                      >
                        {formatCurrency(s.totalPending)}
                      </strong>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter & Action Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {(
              [
                { id: 'ABERTO', label: 'Em Aberto' },
                { id: 'VENCIDO', label: 'Vencidas' },
                { id: 'PAGO', label: 'Pagas' },
                { id: 'TODOS', label: 'Todas' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === f.id
                    ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[220px] flex-1 sm:w-64 sm:flex-initial">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar vendedor, venda ou cliente..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onGoToFinancePayables && (
            <button
              type="button"
              onClick={onGoToFinancePayables}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <HandCoins className="h-3.5 w-3.5 text-emerald-400" />
              Ir para Contas a Pagar
            </button>
          )}
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Nova Comissão
          </button>
        </div>
      </div>

      {/* Commissions List */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {filteredCommissions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-zinc-200">
              Nenhuma comissão encontrada neste filtro.
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Cadastre uma nova comissão ou vincule um vendedor ao registrar uma venda. Todos os lançamentos aparecem automaticamente em Financeiro → Contas a Pagar.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="divide-y divide-zinc-800 md:hidden">
              {filteredCommissions.map((c) => {
                const rem = round2(c.commissionAmount - c.paidAmount);
                const isOverdue = c.status !== 'PAGO' && c.dueDate < today;
                return (
                  <div key={c.id} className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-100">{c.sellerName}</p>
                        <p className="text-xs text-zinc-400">
                          {c.saleDocumentNumber
                            ? `${c.saleDocumentNumber}${c.clientName ? ` · ${c.clientName}` : ''}`
                            : 'Comissão avulsa'}
                        </p>
                        {c.sellerContact && (
                          <p className="text-[11px] text-zinc-500">{c.sellerContact}</p>
                        )}
                      </div>
                      <span
                        className={`font-mono-num shrink-0 text-xs ${
                          isOverdue ? 'font-semibold text-red-400' : 'text-zinc-300'
                        }`}
                      >
                        Venc: {formatDateBR(c.dueDate)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                      <div>
                        <span className="text-zinc-500">Comissão</span>
                        <p className="font-mono-num font-medium text-zinc-200">
                          {formatCurrency(c.commissionAmount)}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Pago</span>
                        <p className="font-mono-num font-medium text-emerald-400">
                          {formatCurrency(c.paidAmount)}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Saldo</span>
                        <p className="font-mono-num font-semibold text-amber-400">
                          {formatCurrency(rem)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`text-[11px] font-medium ${
                          c.status === 'PAGO'
                            ? 'text-emerald-400'
                            : c.status === 'PARCIAL'
                              ? 'text-amber-400'
                              : isOverdue
                                ? 'text-red-400'
                                : 'text-zinc-400'
                        }`}
                      >
                        {c.status === 'PAGO'
                          ? `Pago em ${formatDateBR(c.paidDate)}`
                          : isOverdue
                            ? 'Vencida · Pendente no Financeiro'
                            : `${translateStatus(c.status)} · Aberta no Financeiro`}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {c.status !== 'PAGO' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayingCommission(c);
                              setPayAmount(rem);
                              setPayDate(getTodayISO());
                              setPayNotes('');
                              setPayError(null);
                            }}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                          >
                            Dar Baixa
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(c)}
                          title="Editar comissão"
                          className="rounded-md border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-300 hover:bg-zinc-800"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(c);
                          }}
                          title="Excluir comissão"
                          className="rounded-md border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Vendedor(a)</th>
                    <th className="px-4 py-3 font-medium">Venda / Referência</th>
                    <th className="px-4 py-3 font-medium">Vencimento</th>
                    <th className="px-4 py-3 text-right font-medium">Base / %</th>
                    <th className="px-4 py-3 text-right font-medium">Comissão</th>
                    <th className="px-4 py-3 text-right font-medium">Pago</th>
                    <th className="px-4 py-3 text-right font-medium">Saldo</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredCommissions.map((c) => {
                    const rem = round2(c.commissionAmount - c.paidAmount);
                    const isOverdue = c.status !== 'PAGO' && c.dueDate < today;
                    return (
                      <tr key={c.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-100">{c.sellerName}</p>
                          {c.sellerContact && (
                            <p className="text-[11px] text-zinc-400">{c.sellerContact}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {c.saleDocumentNumber ? (
                            <>
                              <p className="font-mono-num font-medium text-zinc-200">
                                {c.saleDocumentNumber}
                              </p>
                              <p className="text-[11px] text-zinc-400">
                                {c.clientName || formatDateBR(c.commissionDate)}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-zinc-300">Comissão avulsa</p>
                              <p className="text-[11px] text-zinc-500">
                                Comp.: {formatDateBR(c.commissionDate)}
                              </p>
                            </>
                          )}
                          {c.notes && (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">
                              {c.notes}
                            </p>
                          )}
                        </td>
                        <td
                          className={`font-mono-num px-4 py-3 ${
                            isOverdue ? 'font-semibold text-red-400' : 'text-zinc-300'
                          }`}
                        >
                          {formatDateBR(c.dueDate)}
                          {isOverdue && (
                            <span className="block text-[10px] text-red-400">Vencida</span>
                          )}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                          {c.baseAmount > 0 ? (
                            <>
                              <span className="block text-zinc-300">
                                {formatCurrency(c.baseAmount)}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                {c.commissionPercent > 0 ? formatPercent(c.commissionPercent) : 'Valor fixo'}
                              </span>
                            </>
                          ) : (
                            <span>Valor fixo</span>
                          )}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right font-medium text-zinc-200">
                          {formatCurrency(c.commissionAmount)}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-emerald-400">
                          {formatCurrency(c.paidAmount)}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right font-semibold text-amber-400">
                          {formatCurrency(rem)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {c.status !== 'PAGO' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingCommission(c);
                                  setPayAmount(rem);
                                  setPayDate(getTodayISO());
                                  setPayNotes('');
                                  setPayError(null);
                                }}
                                className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                              >
                                Dar Baixa
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Pago
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(c)}
                              title="Editar comissão"
                              className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(c);
                              }}
                              title="Excluir comissão"
                              className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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

      {/* Modal: Create / Edit Commission */}
      <Modal
        open={showFormModal}
        onClose={() => {
          setShowFormModal(false);
          setEditingCommission(null);
        }}
        title={editingCommission ? 'Editar Comissão' : 'Lançar Nova Comissão'}
        subtitle="Sincronizada automaticamente com Financeiro → Contas a Pagar para baixa."
        maxWidth="lg"
      >
        <form onSubmit={handleFormSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Vendedor(a) / Comissionado(a) *
              </label>
              <input
                type="text"
                required
                list="commission-sellers-list"
                value={sellerName}
                onChange={(e) => {
                  const val = e.target.value;
                  setSellerName(val);
                  const found = sellerSummaries.find(
                    (s) => s.sellerName.toLowerCase() === val.trim().toLowerCase()
                  );
                  if (found && !sellerContact) {
                    setSellerContact(found.sellerContact);
                  }
                }}
                placeholder="Nome de quem realizou a venda"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
              <datalist id="commission-sellers-list">
                {sellerSummaries.map((s) => (
                  <option key={s.sellerName} value={s.sellerName} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">
                WhatsApp / Chave PIX (opcional)
              </label>
              <input
                type="text"
                value={sellerContact}
                onChange={(e) => setSellerContact(e.target.value)}
                placeholder="Ex.: (11) 99999-9999 ou PIX"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300">
              Vincular a uma Venda (opcional)
            </label>
            <select
              value={saleId}
              onChange={(e) => handleSelectSale(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Sem vínculo (comissão avulsa / manual)</option>
              {sortedSales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.documentNumber} · {formatDateBR(s.saleDate)} · {s.clientName} ({formatCurrency(s.originalSaleAmount)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Valor Base (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={baseAmount || ''}
                onChange={(e) => handleBaseOrPercentChange(Number(e.target.value), commissionPercent)}
                placeholder="0,00"
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Comissão (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={commissionPercent || ''}
                onChange={(e) => handleBaseOrPercentChange(baseAmount, Number(e.target.value))}
                placeholder="Ex.: 10"
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Valor a Pagar (R$) *
              </label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                value={commissionAmount || ''}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCommissionAmount(val);
                  if (baseAmount > 0 && val >= 0) {
                    setCommissionPercent(round2((val / baseAmount) * 100));
                  }
                }}
                className="font-mono-num mt-1 w-full rounded-lg border border-emerald-700/70 bg-zinc-950 px-3 py-2 text-xs font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Data de Competência *
              </label>
              <input
                type="date"
                required
                value={commissionDate}
                onChange={(e) => setCommissionDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Previsão / Vencimento no Financeiro *
              </label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {!editingCommission && (
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={paidNow}
                onChange={(e) => setPaidNow(e.target.checked)}
                className="accent-emerald-500"
              />
              Comissão já foi paga agora (dá baixa automática no Financeiro e Fluxo de Caixa)
            </label>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300">Observações</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Repasse combinado após quitação do cliente"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-[11px] text-zinc-400">
            Ao salvar, esta comissão também fica disponível em{' '}
            <strong className="text-zinc-200">Financeiro → Contas a Pagar</strong> para que você dê baixa parcial ou total por lá ou por aqui.
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowFormModal(false);
                setEditingCommission(null);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? 'Salvando...' : editingCommission ? 'Salvar Alterações' : 'Lançar Comissão'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Pay / Settle Commission */}
      <Modal
        open={Boolean(payingCommission)}
        onClose={() => setPayingCommission(null)}
        title="Dar Baixa em Comissão"
        subtitle={
          payingCommission
            ? `${payingCommission.sellerName}${payingCommission.saleDocumentNumber ? ` · ${payingCommission.saleDocumentNumber}` : ''}`
            : undefined
        }
        maxWidth="md"
      >
        {payingCommission && (
          <form onSubmit={handlePaySubmit} className="space-y-4">
            {payError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                {payError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300">Valor Pago (R$)</label>
                <input
                  type="number"
                  min={0.01}
                  max={round2(payingCommission.commissionAmount - payingCommission.paidAmount)}
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300">Data do Pagamento</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Observações</label>
              <input
                type="text"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Ex.: Transferência PIX realizada"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-zinc-400">
              A baixa atualiza automaticamente a conta a pagar correspondente no{' '}
              <strong className="text-zinc-200">Financeiro</strong> e entra como saída no{' '}
              <strong className="text-zinc-200">Fluxo de Caixa</strong>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayingCommission(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={payingSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {payingSaving ? 'Confirmando...' : 'Confirmar Baixa'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Delete Confirmation */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Excluir Comissão"
        subtitle={deleteTarget?.sellerName}
        maxWidth="md"
      >
        {deleteTarget && (
          <div className="space-y-4">
            {deleteError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                {deleteError}
              </div>
            )}
            <p className="text-xs text-zinc-300">
              Deseja realmente excluir a comissão de{' '}
              <strong>{deleteTarget.sellerName}</strong> no valor de{' '}
              <strong className="font-mono-num">{formatCurrency(deleteTarget.commissionAmount)}</strong>?
              O lançamento vinculado em{' '}
              <strong>Financeiro → Contas a Pagar</strong> também será removido.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deleting ? 'Excluindo...' : 'Excluir Comissão'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
