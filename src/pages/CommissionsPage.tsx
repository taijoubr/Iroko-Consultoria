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
  UserPlus,
  Users,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import {
  createCommission,
  deleteCommission,
  deleteSeller,
  registerCommissionPayment,
  saveSeller,
  updateCommission,
} from '../services/firestoreOperations';
import type { Commission, Seller } from '../types';
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

function formatSellerContact(seller: Seller): string {
  const parts: string[] = [];
  if (seller.whatsapp.trim()) parts.push(`WhatsApp: ${seller.whatsapp.trim()}`);
  else if (seller.phone.trim()) parts.push(`Tel: ${seller.phone.trim()}`);
  if (seller.pixKey.trim()) parts.push(`PIX: ${seller.pixKey.trim()}`);
  return parts.join(' · ').slice(0, 120);
}

export function CommissionsPage({
  externalOpenNew,
  onClearExternalNew,
  onGoToFinancePayables,
}: CommissionsPageProps) {
  const { user, commissions, sales, sellers } = useAppData();

  const [subTab, setSubTab] = useState<'COMISSOES' | 'VENDEDORES'>('COMISSOES');
  const [statusFilter, setStatusFilter] = useState<'ABERTO' | 'VENCIDO' | 'PAGO' | 'TODOS'>('ABERTO');
  const [sellerFilter, setSellerFilter] = useState<string>('TODOS');
  const [search, setSearch] = useState('');

  // Seller management tab state
  const [sellerSearch, setSellerSearch] = useState('');
  const [sellerStatusFilter, setSellerStatusFilter] = useState<'ATIVOS' | 'INATIVOS' | 'TODOS'>('ATIVOS');
  const [showSellerModal, setShowSellerModal] = useState(false);
  const [editingSeller, setEditingSeller] = useState<Seller | null>(null);
  const [sFullName, setSFullName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sWhatsapp, setSWhatsapp] = useState('');
  const [sPixKey, setSPixKey] = useState('');
  const [sDefaultPct, setSDefaultPct] = useState<number>(10);
  const [sActive, setSActive] = useState(true);
  const [sNotes, setSNotes] = useState('');
  const [savingSeller, setSavingSeller] = useState(false);
  const [sellerFormError, setSellerFormError] = useState<string | null>(null);
  const [deleteSellerTarget, setDeleteSellerTarget] = useState<Seller | null>(null);
  const [deletingSeller, setDeletingSeller] = useState(false);
  const [deleteSellerError, setDeleteSellerError] = useState<string | null>(null);

  // Create / Edit Commission modal state
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCommission, setEditingCommission] = useState<Commission | null>(null);
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');
  const [quickSellerOpen, setQuickSellerOpen] = useState(false);
  const [quickSellerName, setQuickSellerName] = useState('');
  const [quickSellerWhatsapp, setQuickSellerWhatsapp] = useState('');
  const [quickSellerPix, setQuickSellerPix] = useState('');
  const [quickSellerPct, setQuickSellerPct] = useState<number>(10);
  const [savingQuickSeller, setSavingQuickSeller] = useState(false);

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

  // Delete commission modal state
  const [deleteTarget, setDeleteTarget] = useState<Commission | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const today = getTodayISO();

  const sortedSales = useMemo(
    () => [...sales].sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
    [sales]
  );

  const sortedSellers = useMemo(
    () => [...sellers].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [sellers]
  );

  const activeSellers = useMemo(
    () => sortedSellers.filter((s) => s.active),
    [sortedSellers]
  );

  // Per-seller commission totals across both registered and historical names
  const commissionTotalsBySellerName = useMemo(() => {
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
      const lowerKey = key.toLowerCase();
      const existing = map.get(lowerKey) || {
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
      map.set(lowerKey, existing);
    }

    return map;
  }, [commissions]);

  const sellerSummaries = useMemo(
    () =>
      Array.from(commissionTotalsBySellerName.values()).sort(
        (a, b) => b.totalPending - a.totalPending || a.sellerName.localeCompare(b.sellerName)
      ),
    [commissionTotalsBySellerName]
  );

  const filteredSellers = useMemo(() => {
    const q = sellerSearch.trim().toLowerCase();
    return sortedSellers.filter((s) => {
      if (sellerStatusFilter === 'ATIVOS' && !s.active) return false;
      if (sellerStatusFilter === 'INATIVOS' && s.active) return false;
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.whatsapp.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.pixKey.toLowerCase().includes(q)
      );
    });
  }, [sortedSellers, sellerSearch, sellerStatusFilter]);

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
      registeredSellersCount: activeSellers.length,
    };
  }, [commissions, activeSellers.length, today]);

  const filteredCommissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...commissions]
      .filter((c) => {
        if (statusFilter === 'ABERTO' && c.status === 'PAGO') return false;
        if (statusFilter === 'VENCIDO' && (c.status === 'PAGO' || c.dueDate >= today)) return false;
        if (statusFilter === 'PAGO' && c.status !== 'PAGO') return false;
        if (sellerFilter !== 'TODOS' && c.sellerName.trim().toLowerCase() !== sellerFilter.trim().toLowerCase()) {
          return false;
        }
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

  // Seller Modal Handlers
  const openNewSellerModal = () => {
    setEditingSeller(null);
    setSellerFormError(null);
    setSFullName('');
    setSPhone('');
    setSWhatsapp('');
    setSPixKey('');
    setSDefaultPct(10);
    setSActive(true);
    setSNotes('');
    setShowSellerModal(true);
  };

  const openEditSellerModal = (seller: Seller) => {
    setEditingSeller(seller);
    setSellerFormError(null);
    setSFullName(seller.fullName);
    setSPhone(seller.phone || '');
    setSWhatsapp(seller.whatsapp || '');
    setSPixKey(seller.pixKey || '');
    setSDefaultPct(seller.defaultCommissionPercent ?? 10);
    setSActive(seller.active);
    setSNotes(seller.notes || '');
    setShowSellerModal(true);
  };

  const handleSellerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSellerFormError(null);
    if (!sFullName.trim()) {
      setSellerFormError('Informe o nome completo do(a) vendedor(a).');
      return;
    }
    setSavingSeller(true);
    try {
      await saveSeller(
        user.uid,
        {
          fullName: sFullName,
          phone: sPhone,
          whatsapp: sWhatsapp,
          pixKey: sPixKey,
          defaultCommissionPercent: sDefaultPct,
          active: sActive,
          notes: sNotes,
        },
        editingSeller?.id
      );
      setShowSellerModal(false);
      setEditingSeller(null);
    } catch (err) {
      setSellerFormError(err instanceof Error ? err.message : 'Erro ao salvar vendedor(a).');
    } finally {
      setSavingSeller(false);
    }
  };

  const handleToggleSellerActive = async (seller: Seller) => {
    if (!user) return;
    await saveSeller(
      user.uid,
      {
        fullName: seller.fullName,
        phone: seller.phone,
        whatsapp: seller.whatsapp,
        pixKey: seller.pixKey,
        defaultCommissionPercent: seller.defaultCommissionPercent,
        active: !seller.active,
        notes: seller.notes,
      },
      seller.id
    );
  };

  const handleConfirmDeleteSeller = async () => {
    if (!deleteSellerTarget) return;
    setDeleteSellerError(null);
    setDeletingSeller(true);
    try {
      await deleteSeller(deleteSellerTarget.id);
      setDeleteSellerTarget(null);
    } catch (err) {
      setDeleteSellerError(err instanceof Error ? err.message : 'Erro ao excluir vendedor(a).');
    } finally {
      setDeletingSeller(false);
    }
  };

  // Commission Modal Handlers
  const applyRegisteredSeller = (seller: Seller, currentBase = baseAmount) => {
    setSelectedSellerId(seller.id);
    setSellerName(seller.fullName);
    setSellerContact(formatSellerContact(seller));
    const pct = seller.defaultCommissionPercent ?? 10;
    setCommissionPercent(pct);
    if (currentBase > 0 && pct > 0) {
      setCommissionAmount(round2((currentBase * pct) / 100));
    }
  };

  const openNewModal = (preselectedSeller?: Seller) => {
    setEditingCommission(null);
    setFormError(null);
    setQuickSellerOpen(false);
    setQuickSellerName('');
    setQuickSellerWhatsapp('');
    setQuickSellerPix('');
    setQuickSellerPct(10);

    setSaleId('');
    setSaleDocumentNumber('');
    setClientName('');
    setCommissionDate(getTodayISO());
    setDueDate(getTodayISO());
    setBaseAmount(0);
    setCommissionAmount(0);
    setPaidNow(false);
    setNotes('');

    const targetSeller =
      preselectedSeller ||
      (sellerFilter !== 'TODOS'
        ? sortedSellers.find((s) => s.fullName.toLowerCase() === sellerFilter.toLowerCase())
        : activeSellers[0]);

    if (targetSeller) {
      applyRegisteredSeller(targetSeller, 0);
    } else if (sellerFilter !== 'TODOS') {
      const matchedSummary = sellerSummaries.find(
        (s) => s.sellerName.toLowerCase() === sellerFilter.toLowerCase()
      );
      setSelectedSellerId('');
      setSellerName(sellerFilter);
      setSellerContact(matchedSummary?.sellerContact || '');
      setCommissionPercent(10);
    } else {
      setSelectedSellerId('');
      setSellerName('');
      setSellerContact('');
      setCommissionPercent(10);
    }
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
    setQuickSellerOpen(false);
    const matched = sortedSellers.find(
      (s) => s.fullName.toLowerCase() === c.sellerName.trim().toLowerCase()
    );
    setSelectedSellerId(matched ? matched.id : '');
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

  const handleQuickCreateSellerInModal = async () => {
    if (!user || !quickSellerName.trim()) return;
    setFormError(null);
    setSavingQuickSeller(true);
    try {
      const newId = await saveSeller(user.uid, {
        fullName: quickSellerName,
        phone: '',
        whatsapp: quickSellerWhatsapp,
        pixKey: quickSellerPix,
        defaultCommissionPercent: quickSellerPct,
        active: true,
        notes: '',
      });
      setSelectedSellerId(newId);
      setSellerName(quickSellerName.trim());
      const contactParts: string[] = [];
      if (quickSellerWhatsapp.trim()) contactParts.push(`WhatsApp: ${quickSellerWhatsapp.trim()}`);
      if (quickSellerPix.trim()) contactParts.push(`PIX: ${quickSellerPix.trim()}`);
      setSellerContact(contactParts.join(' · ').slice(0, 120));
      setCommissionPercent(quickSellerPct);
      if (baseAmount > 0 && quickSellerPct > 0) {
        setCommissionAmount(round2((baseAmount * quickSellerPct) / 100));
      }
      setQuickSellerName('');
      setQuickSellerWhatsapp('');
      setQuickSellerPix('');
      setQuickSellerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao cadastrar vendedor(a).');
    } finally {
      setSavingQuickSeller(false);
    }
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
      setFormError('Selecione um(a) vendedor(a) cadastrado(a) ou informe o nome.');
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
      {/* Sub-navigation + quick actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          <button
            type="button"
            onClick={() => setSubTab('COMISSOES')}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === 'COMISSOES'
                ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Lançamentos de Comissões
          </button>
          <button
            type="button"
            onClick={() => setSubTab('VENDEDORES')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === 'VENDEDORES'
                ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Vendedores Cadastrados ({sellers.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openNewSellerModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
          >
            <UserPlus className="h-3.5 w-3.5 text-emerald-400" />
            Cadastrar Vendedor
          </button>
          <button
            type="button"
            onClick={() => openNewModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Nova Comissão
          </button>
        </div>
      </div>

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
          <span className="text-[11px] font-medium text-zinc-400">Vendedores Ativos</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-zinc-100">
            {kpis.registeredSellersCount}
          </p>
          {onGoToFinancePayables ? (
            <button
              type="button"
              onClick={onGoToFinancePayables}
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:underline"
            >
              Dar baixa no Financeiro
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : (
            <p className="mt-0.5 text-[11px] text-zinc-500">{sellers.length} cadastrado(s)</p>
          )}
        </div>
      </div>

      {subTab === 'VENDEDORES' ? (
        <div className="space-y-4">
          {/* Sellers Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                {(
                  [
                    { id: 'ATIVOS', label: 'Ativos' },
                    { id: 'INATIVOS', label: 'Inativos' },
                    { id: 'TODOS', label: 'Todos' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSellerStatusFilter(f.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      sellerStatusFilter === f.id
                        ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[220px] flex-1 sm:w-72 sm:flex-initial">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={sellerSearch}
                  onChange={(e) => setSellerSearch(e.target.value)}
                  placeholder="Buscar por nome, WhatsApp ou PIX..."
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={openNewSellerModal}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
            >
              <UserPlus className="h-4 w-4" />
              Novo Vendedor
            </button>
          </div>

          {/* Sellers List */}
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            {filteredSellers.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-medium text-zinc-200">
                  Nenhum vendedor encontrado.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Cadastre seus vendedores com WhatsApp, chave PIX e comissão padrão (%) para selecioná-los rapidamente nas vendas e lançamentos.
                </p>
              </div>
            ) : (
              <>
                {/* Mobile Cards */}
                <div className="divide-y divide-zinc-800 md:hidden">
                  {filteredSellers.map((s) => {
                    const stats = commissionTotalsBySellerName.get(s.fullName.trim().toLowerCase());
                    return (
                      <div key={s.id} className="space-y-2.5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-zinc-100">{s.fullName}</p>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  s.active
                                    ? 'bg-emerald-950/70 text-emerald-300'
                                    : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {s.active ? 'Ativo' : 'Inativo'}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-zinc-400">
                              {s.whatsapp || s.phone || 'Sem telefone'}
                              {s.pixKey ? ` · PIX: ${s.pixKey}` : ''}
                            </p>
                          </div>
                          <span className="font-mono-num shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                            {formatPercent(s.defaultCommissionPercent)}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                          <div>
                            <span className="text-zinc-500">Comissões</span>
                            <p className="font-mono-num font-medium text-zinc-200">
                              {stats ? formatCurrency(stats.totalCommission) : 'R$ 0,00'}
                            </p>
                          </div>
                          <div>
                            <span className="text-zinc-500">Pago</span>
                            <p className="font-mono-num font-medium text-emerald-400">
                              {stats ? formatCurrency(stats.totalPaid) : 'R$ 0,00'}
                            </p>
                          </div>
                          <div>
                            <span className="text-zinc-500">A Pagar</span>
                            <p className="font-mono-num font-semibold text-amber-400">
                              {stats ? formatCurrency(stats.totalPending) : 'R$ 0,00'}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openNewModal(s)}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                          >
                            + Comissão
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleSellerActive(s)}
                            className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                          >
                            {s.active ? 'Desativar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditSellerModal(s)}
                            title="Editar vendedor"
                            className="rounded-md border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-300 hover:bg-zinc-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteSellerError(null);
                              setDeleteSellerTarget(s);
                            }}
                            title="Excluir vendedor"
                            className="rounded-md border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
                        <th className="px-4 py-3 font-medium">WhatsApp / Telefone</th>
                        <th className="px-4 py-3 font-medium">Chave PIX</th>
                        <th className="px-4 py-3 text-right font-medium">Comissão Padrão</th>
                        <th className="px-4 py-3 text-right font-medium">Pago</th>
                        <th className="px-4 py-3 text-right font-medium">A Pagar</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {filteredSellers.map((s) => {
                        const stats = commissionTotalsBySellerName.get(s.fullName.trim().toLowerCase());
                        return (
                          <tr key={s.id} className="hover:bg-zinc-800/40">
                            <td className="px-4 py-3">
                              <p className="font-medium text-zinc-100">{s.fullName}</p>
                              {s.notes && (
                                <p className="line-clamp-1 text-[11px] text-zinc-500">{s.notes}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-zinc-300">
                              {s.whatsapp || s.phone || '—'}
                            </td>
                            <td className="px-4 py-3 text-zinc-300">
                              {s.pixKey || '—'}
                            </td>
                            <td className="font-mono-num px-4 py-3 text-right font-semibold text-emerald-300">
                              {formatPercent(s.defaultCommissionPercent)}
                            </td>
                            <td className="font-mono-num px-4 py-3 text-right text-emerald-400">
                              {stats ? formatCurrency(stats.totalPaid) : 'R$ 0,00'}
                            </td>
                            <td className="font-mono-num px-4 py-3 text-right font-semibold text-amber-400">
                              {stats ? formatCurrency(stats.totalPending) : 'R$ 0,00'}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
                                  s.active
                                    ? 'bg-emerald-950/70 text-emerald-300'
                                    : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {s.active ? 'Ativo' : 'Inativo'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openNewModal(s)}
                                  className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                                >
                                  + Comissão
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleSellerActive(s)}
                                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                                >
                                  {s.active ? 'Desativar' : 'Ativar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditSellerModal(s)}
                                  title="Editar vendedor"
                                  className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteSellerError(null);
                                    setDeleteSellerTarget(s);
                                  }}
                                  title="Excluir vendedor"
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
        </div>
      ) : (
        <>
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
                  const selected = sellerFilter.toLowerCase() === s.sellerName.toLowerCase();
                  return (
                    <button
                      key={s.sellerName}
                      type="button"
                      onClick={() =>
                        setSellerFilter((prev) =>
                          prev.toLowerCase() === s.sellerName.toLowerCase() ? 'TODOS' : s.sellerName
                        )
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

            {onGoToFinancePayables && (
              <button
                type="button"
                onClick={onGoToFinancePayables}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                <HandCoins className="h-3.5 w-3.5 text-emerald-400" />
                Ir para Contas a Pagar no Financeiro
              </button>
            )}
          </div>

          {/* Commissions List */}
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            {filteredCommissions.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-medium text-zinc-200">
                  Nenhuma comissão encontrada neste filtro.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Cadastre seus vendedores e lance comissões aqui ou ao registrar uma venda. Todos os lançamentos ficam sincronizados com Financeiro → Contas a Pagar.
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
        </>
      )}

      {/* Modal: Create / Edit Seller */}
      <Modal
        open={showSellerModal}
        onClose={() => {
          setShowSellerModal(false);
          setEditingSeller(null);
        }}
        title={editingSeller ? 'Editar Vendedor(a)' : 'Cadastrar Novo(a) Vendedor(a)'}
        subtitle="Salve dados de contato, chave PIX e % padrão de comissão para usar nas vendas."
        maxWidth="md"
      >
        <form onSubmit={handleSellerSubmit} className="space-y-4">
          {sellerFormError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {sellerFormError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300">Nome Completo *</label>
            <input
              type="text"
              required
              value={sFullName}
              onChange={(e) => setSFullName(e.target.value)}
              placeholder="Nome completo do(a) vendedor(a)"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">WhatsApp</label>
              <input
                type="text"
                value={sWhatsapp}
                onChange={(e) => setSWhatsapp(e.target.value)}
                placeholder="(11) 99999-9999"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Telefone</label>
              <input
                type="text"
                value={sPhone}
                onChange={(e) => setSPhone(e.target.value)}
                placeholder="Opcional"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Chave PIX</label>
              <input
                type="text"
                value={sPixKey}
                onChange={(e) => setSPixKey(e.target.value)}
                placeholder="CPF, celular, e-mail ou aleatória"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Comissão Padrão (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={sDefaultPct}
                onChange={(e) => setSDefaultPct(Number(e.target.value))}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300">Observações</label>
            <input
              type="text"
              value={sNotes}
              onChange={(e) => setSNotes(e.target.value)}
              placeholder="Ex.: Dia combinado de acerto ou observações gerais"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={sActive}
              onChange={(e) => setSActive(e.target.checked)}
              className="accent-emerald-500"
            />
            Vendedor(a) ativo(a) para novas vendas e comissões
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowSellerModal(false);
                setEditingSeller(null);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingSeller}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {savingSeller
                ? 'Salvando...'
                : editingSeller
                  ? 'Salvar Alterações'
                  : 'Cadastrar Vendedor'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Delete Seller Confirmation */}
      <Modal
        open={Boolean(deleteSellerTarget)}
        onClose={() => setDeleteSellerTarget(null)}
        title="Excluir Vendedor(a)"
        subtitle={deleteSellerTarget?.fullName}
        maxWidth="md"
      >
        {deleteSellerTarget && (
          <div className="space-y-4">
            {deleteSellerError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                {deleteSellerError}
              </div>
            )}
            <p className="text-xs text-zinc-300">
              Deseja excluir o cadastro de <strong>{deleteSellerTarget.fullName}</strong>? As comissões já lançadas serão preservadas no histórico financeiro (se preferir apenas ocultar para novas vendas, use <strong>Desativar</strong>).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteSellerTarget(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSeller}
                disabled={deletingSeller}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deletingSeller ? 'Excluindo...' : 'Excluir Vendedor'}
              </button>
            </div>
          </div>
        )}
      </Modal>

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

          {/* Seller picker + inline quick seller create */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-zinc-300">
                Vendedor(a) Cadastrado(a)
              </label>
              <button
                type="button"
                onClick={() => setQuickSellerOpen((v) => !v)}
                className="text-[11px] font-medium text-emerald-400 hover:underline"
              >
                {quickSellerOpen ? 'Fechar cadastro rápido' : '+ Cadastrar novo vendedor'}
              </button>
            </div>

            <select
              value={selectedSellerId}
              onChange={(e) => {
                const sid = e.target.value;
                setSelectedSellerId(sid);
                const found = sortedSellers.find((s) => s.id === sid);
                if (found) {
                  applyRegisteredSeller(found);
                }
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">
                {sortedSellers.length > 0
                  ? 'Selecionar vendedor cadastrado (ou digitar abaixo)...'
                  : 'Nenhum vendedor cadastrado ainda — digite abaixo ou cadastre acima'}
              </option>
              {sortedSellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({formatPercent(s.defaultCommissionPercent)}){!s.active ? ' [Inativo]' : ''}
                </option>
              ))}
            </select>

            {quickSellerOpen && (
              <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-emerald-300">
                  Cadastro Rápido de Vendedor(a)
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={quickSellerName}
                    onChange={(e) => setQuickSellerName(e.target.value)}
                    placeholder="Nome completo *"
                    className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
                  />
                  <input
                    type="text"
                    value={quickSellerWhatsapp}
                    onChange={(e) => setQuickSellerWhatsapp(e.target.value)}
                    placeholder="WhatsApp"
                    className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
                  />
                  <input
                    type="text"
                    value={quickSellerPix}
                    onChange={(e) => setQuickSellerPix(e.target.value)}
                    placeholder="Chave PIX (opcional)"
                    className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-zinc-400 shrink-0">Padrão %:</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={quickSellerPct}
                      onChange={(e) => setQuickSellerPct(Number(e.target.value))}
                      className="font-mono-num w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingQuickSeller || !quickSellerName.trim()}
                    onClick={handleQuickCreateSellerInModal}
                    className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {savingQuickSeller ? 'Salvando...' : 'Salvar e Selecionar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Nome do(a) Vendedor(a) *
              </label>
              <input
                type="text"
                required
                value={sellerName}
                onChange={(e) => {
                  setSellerName(e.target.value);
                  setSelectedSellerId('');
                }}
                placeholder="Nome de quem realizou a venda"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">
                WhatsApp / Chave PIX (opcional)
              </label>
              <input
                type="text"
                value={sellerContact}
                onChange={(e) => setSellerContact(e.target.value)}
                placeholder="Ex.: (11) 99999-9999 · PIX"
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

      {/* Modal: Delete Commission Confirmation */}
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
