import React, { useMemo, useState } from 'react';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import {
  canFullEditOrDeletePurchase,
  DEFAULT_CATEGORIES,
  deletePurchase,
  registerPurchase,
  updatePurchase,
  updatePurchaseMetadata,
} from '../services/firestoreOperations';
import type { Brand, Purchase, PurchaseBrand, PurchasePaymentMethod } from '../types';
import {
  calculatePurchaseFinancials,
  type PurchaseDraftItem,
} from '../utils/finance';
import {
  formatCurrency,
  formatDateBR,
  formatPercent,
  getTodayISO,
  round2,
  translatePaymentMethod,
} from '../utils/formatters';

export function PurchasesPage({
  externalOpenNew,
  onClearExternalNew,
}: {
  externalOpenNew?: boolean;
  onClearExternalNew?: () => void;
}) {
  const { user, settings, products, purchases, stockLots, stockMovements, payables } = useAppData();

  const [showNewModal, setShowNewModal] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [editBillingDate, setEditBillingDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [brandFilter, setBrandFilter] = useState<'TODAS' | PurchaseBrand>('TODAS');
  const [searchTerm, setSearchTerm] = useState('');

  // Form state
  const [brand, setBrand] = useState<PurchaseBrand>('Avon');
  const [orderNumber, setOrderNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(getTodayISO());
  const [billingDate, setBillingDate] = useState('');
  const [referenceDate, setReferenceDate] = useState(getTodayISO());
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('BOLETO_2X');
  const [overrideOriginalTotal, setOverrideOriginalTotal] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);
  const [draftItem, setDraftItem] = useState<PurchaseDraftItem>({
    name: '',
    code: '',
    brand: 'Avon',
    category: 'Perfumaria',
    quantity: 1,
    unitOriginalCost: 0,
    qtyForClients: 0,
    qtyForStock: 1,
  });
  const [draftUnitCostText, setDraftUnitCostText] = useState('');
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const productNameInputRef = React.useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const categories = settings?.categories?.length ? settings.categories : DEFAULT_CATEGORIES;

  const createEmptyDraft = (
    targetBrand: PurchaseBrand = brand,
    preferredCategory?: string
  ): PurchaseDraftItem => ({
    name: '',
    code: '',
    brand: targetBrand === 'Natura' ? 'Natura' : 'Avon',
    category: preferredCategory || categories[0] || 'Perfumaria',
    quantity: 1,
    unitOriginalCost: 0,
    qtyForClients: 0,
    qtyForStock: 1,
  });

  const resetFormToNew = () => {
    const initialCat = settings?.categories?.[0] || 'Perfumaria';
    setEditingPurchase(null);
    setBrand('Avon');
    setOrderNumber('');
    setPurchaseDate(getTodayISO());
    setBillingDate('');
    setReferenceDate(getTodayISO());
    setPaymentMethod('BOLETO_2X');
    setOverrideOriginalTotal('');
    setNotes('');
    setItems([]);
    setDraftItem(createEmptyDraft('Avon', initialCat));
    setDraftUnitCostText('');
    setEditingItemIndex(null);
    setErrorMsg(null);
  };

  const openEditPurchase = (p: Purchase) => {
    setEditingPurchase(p);
    setBrand(p.brand);
    setOrderNumber(p.orderNumber);
    setPurchaseDate(p.purchaseDate);
    setBillingDate(p.billingDate || '');
    setReferenceDate(p.referenceDate || p.purchaseDate);
    setPaymentMethod(p.paymentMethod);
    const itemsOrigSum = p.items.reduce((acc, it) => acc + it.quantity * it.unitOriginalCost, 0);
    setOverrideOriginalTotal(
      Math.abs(itemsOrigSum - p.originalTotal) > 0.02 ? p.originalTotal.toFixed(2) : ''
    );
    setNotes(p.notes || '');
    setItems(
      p.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        code: it.code,
        brand: it.brand,
        category: it.category,
        quantity: it.quantity,
        unitOriginalCost: it.unitOriginalCost,
        qtyForClients: it.qtyForClients,
        qtyForStock: it.qtyForStock,
      }))
    );
    setDraftItem(createEmptyDraft(p.brand, p.items[0]?.category || categories[0] || 'Perfumaria'));
    setDraftUnitCostText('');
    setEditingItemIndex(null);
    setErrorMsg(null);
    setSelectedPurchase(null);
    setShowNewModal(true);
  };

  React.useEffect(() => {
    if (externalOpenNew) {
      resetFormToNew();
      setShowNewModal(true);
      onClearExternalNew?.();
    }
  }, [externalOpenNew, onClearExternalNew]);

  const effectiveItemsForPreview = useMemo(() => {
    if (items.length > 0) return items;
    if (draftItem.name.trim()) return [draftItem];
    return [];
  }, [items, draftItem]);

  const liveCalc = useMemo(() => {
    const parsedOverride =
      overrideOriginalTotal.trim() !== '' ? Number(overrideOriginalTotal) : undefined;
    return calculatePurchaseFinancials(
      effectiveItemsForPreview,
      paymentMethod,
      settings?.boletoSurchargePercent ?? 5,
      referenceDate || purchaseDate,
      settings?.boletoInstallment1Days ?? 24,
      settings?.boletoInstallment2Days ?? 45,
      parsedOverride
    );
  }, [
    effectiveItemsForPreview,
    paymentMethod,
    settings,
    referenceDate,
    purchaseDate,
    overrideOriginalTotal,
  ]);

  const filteredPurchases = useMemo(() => {
    return purchases
      .filter((p) => {
        if (brandFilter !== 'TODAS' && p.brand !== brandFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          return (
            p.orderNumber.toLowerCase().includes(q) ||
            p.brand.toLowerCase().includes(q) ||
            p.items.some((i) => i.name.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
  }, [purchases, brandFilter, searchTerm]);

  const handleBrandChange = (newBrand: PurchaseBrand) => {
    setBrand(newBrand);
    if (newBrand === 'Avon' || newBrand === 'Natura') {
      setItems((prev) => prev.map((it) => ({ ...it, brand: newBrand })));
      setDraftItem((prev) => ({ ...prev, brand: newBrand }));
    }
  };

  const updateDraftItem = (patch: Partial<PurchaseDraftItem>) => {
    setDraftItem((prev) => {
      const next = { ...prev, ...patch };
      if (patch.quantity !== undefined) {
        const qty = Math.max(1, Math.floor(patch.quantity));
        next.quantity = qty;
        next.qtyForClients = Math.min(next.qtyForClients, qty);
        next.qtyForStock = qty - next.qtyForClients;
      } else if (patch.qtyForClients !== undefined) {
        const cli = Math.max(0, Math.min(next.quantity, Math.floor(patch.qtyForClients)));
        next.qtyForClients = cli;
        next.qtyForStock = next.quantity - cli;
      } else if (patch.qtyForStock !== undefined) {
        const stk = Math.max(0, Math.min(next.quantity, Math.floor(patch.qtyForStock)));
        next.qtyForStock = stk;
        next.qtyForClients = next.quantity - stk;
      }
      return next;
    });
  };

  const handleSelectExistingProduct = (productId: string) => {
    if (!productId) {
      updateDraftItem({ productId: undefined });
      return;
    }
    const found = products.find((p) => p.id === productId);
    if (!found) return;
    updateDraftItem({
      productId: found.id,
      name: found.name,
      code: found.code,
      brand: brand === 'Mista' ? found.brand : brand === 'Natura' ? 'Natura' : 'Avon',
      category: found.category,
    });
  };

  const handleSaveDraftItem = () => {
    setErrorMsg(null);
    if (!draftItem.name.trim()) {
      setErrorMsg('Informe o nome do produto antes de adicionar à lista.');
      productNameInputRef.current?.focus();
      return;
    }
    if (draftItem.quantity <= 0) {
      setErrorMsg('A quantidade deve ser maior que zero.');
      return;
    }

    const normalizedItem: PurchaseDraftItem = {
      ...draftItem,
      name: draftItem.name.trim(),
      code: draftItem.code.trim(),
      brand: brand === 'Mista' ? draftItem.brand : brand === 'Natura' ? 'Natura' : 'Avon',
      unitOriginalCost: Math.max(0, Number(draftItem.unitOriginalCost) || 0),
    };

    if (editingItemIndex !== null) {
      setItems((prev) => prev.map((it, i) => (i === editingItemIndex ? normalizedItem : it)));
      setEditingItemIndex(null);
    } else {
      setItems((prev) => [...prev, normalizedItem]);
    }

    // Keep the last selected category for fast sequential entry of products in the same line
    setDraftItem(createEmptyDraft(brand, normalizedItem.category));
    setDraftUnitCostText('');
    setTimeout(() => productNameInputRef.current?.focus(), 0);
  };

  const handleEditAddedItem = (index: number) => {
    const target = items[index];
    if (!target) return;
    setEditingItemIndex(index);
    setDraftItem({ ...target });
    setDraftUnitCostText(target.unitOriginalCost > 0 ? String(target.unitOriginalCost) : '');
    setErrorMsg(null);
    setTimeout(() => productNameInputRef.current?.focus(), 0);
  };

  const handleCancelEditDraftItem = () => {
    setEditingItemIndex(null);
    setDraftItem(createEmptyDraft(brand, draftItem.category));
    setDraftUnitCostText('');
    setErrorMsg(null);
  };

  const removeItemRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    if (editingItemIndex === index) {
      handleCancelEditDraftItem();
    } else if (editingItemIndex !== null && index < editingItemIndex) {
      setEditingItemIndex(editingItemIndex - 1);
    }
  };

  const editEligibility = useMemo(() => {
    if (!editingPurchase) return { allowed: true };
    return canFullEditOrDeletePurchase(editingPurchase, stockLots, payables);
  }, [editingPurchase, stockLots, payables]);

  const deleteEligibility = useMemo(() => {
    if (!deleteTarget) return { allowed: true };
    return canFullEditOrDeletePurchase(deleteTarget, stockLots, payables);
  }, [deleteTarget, stockLots, payables]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !settings) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (editingItemIndex !== null) {
      setErrorMsg('Salve ou cancele a edição do produto em andamento antes de confirmar o pedido.');
      return;
    }

    if (items.length > 0 && draftItem.name.trim()) {
      setErrorMsg(
        `Você preencheu "${draftItem.name.trim()}" acima, mas ainda não clicou em "Adicionar à Lista". Adicione-o à lista ou limpe o campo antes de confirmar.`
      );
      return;
    }

    const itemsToSubmit: PurchaseDraftItem[] =
      items.length > 0
        ? items
        : draftItem.name.trim()
          ? [
              {
                ...draftItem,
                name: draftItem.name.trim(),
                code: draftItem.code.trim(),
                brand: brand === 'Mista' ? draftItem.brand : brand === 'Natura' ? 'Natura' : 'Avon',
                unitOriginalCost: Math.max(0, Number(draftItem.unitOriginalCost) || 0),
              },
            ]
          : [];

    if (itemsToSubmit.length === 0) {
      setErrorMsg('Adicione pelo menos um produto à lista do pedido.');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        brand,
        orderNumber,
        purchaseDate,
        billingDate,
        referenceDate,
        paymentMethod,
        overrideOriginalTotal:
          overrideOriginalTotal.trim() !== '' ? Number(overrideOriginalTotal) : undefined,
        notes,
        items: itemsToSubmit,
      };

      if (editingPurchase) {
        await updatePurchase(
          user.uid,
          editingPurchase,
          payload,
          settings,
          products,
          stockLots,
          stockMovements,
          payables
        );
        setSuccessMsg(`Pedido ${orderNumber} atualizado com sucesso.`);
      } else {
        await registerPurchase(user.uid, payload, settings, products);
        setSuccessMsg(`Pedido ${orderNumber} registrado e integrado ao estoque e financeiro.`);
      }

      resetFormToNew();
      setShowNewModal(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar compra.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deletePurchase(deleteTarget, products, stockLots, stockMovements, payables);
      setSuccessMsg(`Pedido ${deleteTarget.orderNumber} excluído com sucesso.`);
      setDeleteTarget(null);
      setSelectedPurchase(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir pedido.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSavePurchaseMeta = async () => {
    if (!selectedPurchase) return;
    await updatePurchaseMetadata(selectedPurchase.id, editBillingDate, editNotes);
    setSelectedPurchase(null);
  };

  return (
    <div className="space-y-5">
      {successMsg && (
        <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/50 px-4 py-3 text-xs font-medium text-emerald-300">
          {successMsg}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {(['TODAS', 'Avon', 'Natura', 'Mista'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBrandFilter(b)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  brandFilter === b
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {b === 'TODAS' ? 'Todas' : b}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar pedido ou produto..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none sm:w-64"
          />
        </div>

        <button
          type="button"
          onClick={() => {
            resetFormToNew();
            setShowNewModal(true);
          }}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" />
          Registrar Nova Compra
        </button>
      </div>

      {/* Purchases Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {filteredPurchases.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-zinc-200">Nenhuma compra registrada ainda.</p>
            <p className="mt-1 text-xs text-zinc-400">
              Registre seus pedidos Avon, Natura ou mistos para alimentar o estoque FIFO e gerar boletos automaticamente.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="divide-y divide-zinc-800 md:hidden">
              {filteredPurchases.map((p) => (
                <div key={p.id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-num text-sm font-semibold text-zinc-100">
                        Pedido #{p.orderNumber}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {formatDateBR(p.purchaseDate)} · {p.brand} · {p.itemsCount} item(ns)
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPurchase(p);
                          setEditBillingDate(p.billingDate || '');
                          setEditNotes(p.notes || '');
                        }}
                        aria-label="Ver pedido"
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditPurchase(p)}
                        aria-label="Editar pedido"
                        className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-200 hover:bg-zinc-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(p);
                        }}
                        aria-label="Excluir pedido"
                        className="inline-flex items-center justify-center rounded-lg border border-red-900/50 bg-red-950/30 p-1.5 text-red-400 hover:bg-red-950/60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                    <div>
                      <span className="text-zinc-500">Original</span>
                      <p className="font-mono-num font-medium text-zinc-300">
                        {formatCurrency(p.originalTotal)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Acréscimo</span>
                      <p className="font-mono-num font-medium text-zinc-400">
                        {formatCurrency(p.surchargeAmount)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Total Efetivo</span>
                      <p className="font-mono-num font-semibold text-zinc-100">
                        {formatCurrency(p.effectiveTotal)}
                      </p>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-400">
                    {translatePaymentMethod(p.paymentMethod)}
                    {p.surchargePercentApplied > 0 && ` (${formatPercent(p.surchargePercentApplied)})`}
                  </p>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Pedido</th>
                    <th className="px-4 py-3 font-medium">Marca</th>
                    <th className="px-4 py-3 font-medium">Pagamento</th>
                    <th className="px-4 py-3 text-right font-medium">Itens</th>
                    <th className="px-4 py-3 text-right font-medium">Original</th>
                    <th className="px-4 py-3 text-right font-medium">Acréscimo</th>
                    <th className="px-4 py-3 text-right font-medium">Total Efetivo</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredPurchases.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-800/40">
                      <td className="font-mono-num px-4 py-3 text-zinc-400">
                        {formatDateBR(p.purchaseDate)}
                      </td>
                      <td className="font-mono-num px-4 py-3 font-semibold text-zinc-100">
                        {p.orderNumber}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{p.brand}</td>
                      <td className="px-4 py-3 text-zinc-400">
                        {translatePaymentMethod(p.paymentMethod)}
                        {p.surchargePercentApplied > 0 && ` (${formatPercent(p.surchargePercentApplied)})`}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                        {p.itemsCount}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-zinc-300">
                        {formatCurrency(p.originalTotal)}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                        {formatCurrency(p.surchargeAmount)}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                        {formatCurrency(p.effectiveTotal)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPurchase(p);
                              setEditBillingDate(p.billingDate || '');
                              setEditNotes(p.notes || '');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Ver
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditPurchase(p)}
                            title="Editar pedido"
                            aria-label="Editar pedido"
                            className="inline-flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-200 hover:bg-zinc-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(p);
                            }}
                            title="Excluir pedido"
                            aria-label="Excluir pedido"
                            className="inline-flex items-center justify-center rounded-md border border-red-900/50 bg-red-950/30 p-1.5 text-red-400 hover:bg-red-950/60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* New / Edit Purchase Modal */}
      <Modal
        open={showNewModal}
        onClose={() => {
          setShowNewModal(false);
          setEditingPurchase(null);
        }}
        title={
          editingPurchase
            ? `Editar Pedido #${editingPurchase.orderNumber}`
            : 'Registrar Entrada de Compra'
        }
        subtitle={
          editingPurchase
            ? 'Altere os dados do pedido. O estoque FIFO e o financeiro serão recalculados automaticamente.'
            : 'Cadastre pedidos Avon, Natura ou mistos com rateio automático do custo financeiro e criação de lotes FIFO.'
        }
        maxWidth="4xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {errorMsg && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          {editingPurchase && !editEligibility.allowed && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              {editEligibility.reason} Por segurança, apenas Número do Pedido, Data de Faturamento e Observações podem ser alterados.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Marca do Pedido</label>
              <select
                value={brand}
                disabled={Boolean(editingPurchase && !editEligibility.allowed)}
                onChange={(e) => handleBrandChange(e.target.value as PurchaseBrand)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="Avon">Avon</option>
                <option value="Natura">Natura</option>
                <option value="Mista">Mista (Avon + Natura)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Número do Pedido *</label>
              <input
                type="text"
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="Ex.: 9845120"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Forma de Pagamento</label>
              <select
                value={paymentMethod}
                disabled={Boolean(editingPurchase && !editEligibility.allowed)}
                onChange={(e) => setPaymentMethod(e.target.value as PurchasePaymentMethod)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="A_VISTA">À vista (sem acréscimo)</option>
                <option value="BOLETO_2X">
                  Boleto parcelado 2x (+{settings?.boletoSurchargePercent ?? 5}% estimado)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Data da Compra *</label>
              <input
                type="date"
                required
                disabled={Boolean(editingPurchase && !editEligibility.allowed)}
                value={purchaseDate}
                onChange={(e) => {
                  setPurchaseDate(e.target.value);
                  if (!referenceDate || referenceDate === purchaseDate) {
                    setReferenceDate(e.target.value);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Data de Faturamento (opcional)
              </label>
              <input
                type="date"
                value={billingDate}
                onChange={(e) => setBillingDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Data de Referência (Prazos Boleto)
              </label>
              <input
                type="date"
                required
                disabled={Boolean(editingPurchase && !editEligibility.allowed)}
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Fixed Single-Item Composer + Compact Added Items List */}
          {(() => {
            const isLocked = Boolean(editingPurchase && !editEligibility.allowed);
            const handleDraftKeyDown = (e: React.KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!isLocked) handleSaveDraftItem();
              }
            };
            const draftSubtotal = round2(
              (Number(draftItem.unitOriginalCost) || 0) * (Number(draftItem.quantity) || 0)
            );

            return (
              <div className="space-y-3">
                {!isLocked && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-xs font-semibold text-zinc-100">
                        {editingItemIndex !== null
                          ? `Editando Produto #${editingItemIndex + 1} da Lista`
                          : 'Adicionar Produto à Lista'}
                      </h3>
                      <span className="text-[11px] text-zinc-400">
                        Subtotal:{' '}
                        <strong className="font-mono-num text-zinc-200">
                          {formatCurrency(draftSubtotal)}
                        </strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                      {products.length > 0 && (
                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-medium text-zinc-400">
                            Reutilizar Cadastro
                          </label>
                          <select
                            value={draftItem.productId || ''}
                            onChange={(e) => handleSelectExistingProduct(e.target.value)}
                            className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                          >
                            <option value="">Novo produto...</option>
                            {products.map((pr) => (
                              <option key={pr.id} value={pr.id}>
                                {pr.brand} · {pr.name} {pr.code ? `(${pr.code})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className={products.length > 0 ? 'sm:col-span-5' : 'sm:col-span-6'}>
                        <label className="block text-[11px] font-medium text-zinc-400">
                          Nome do Produto *
                        </label>
                        <input
                          ref={productNameInputRef}
                          type="text"
                          value={draftItem.name}
                          onChange={(e) => updateDraftItem({ name: e.target.value })}
                          onKeyDown={handleDraftKeyDown}
                          placeholder="Ex.: Kaiak Clássico 100ml"
                          className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-zinc-400">Código</label>
                        <input
                          type="text"
                          value={draftItem.code}
                          onChange={(e) => updateDraftItem({ code: e.target.value })}
                          onKeyDown={handleDraftKeyDown}
                          placeholder="Opcional"
                          className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className={products.length > 0 ? 'sm:col-span-2' : 'sm:col-span-4'}>
                        <label className="block text-[11px] font-medium text-zinc-400">Marca</label>
                        <select
                          value={draftItem.brand}
                          disabled={brand !== 'Mista'}
                          onChange={(e) => updateDraftItem({ brand: e.target.value as Brand })}
                          className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 disabled:bg-zinc-950 disabled:text-zinc-500 disabled:opacity-70"
                        >
                          <option value="Avon">Avon</option>
                          <option value="Natura">Natura</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-12 sm:items-end">
                      <div className="col-span-2 sm:col-span-3">
                        <label className="block text-[11px] font-medium text-zinc-400">
                          Categoria
                        </label>
                        <select
                          value={draftItem.category}
                          onChange={(e) => updateDraftItem({ category: e.target.value })}
                          className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                        >
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-zinc-400">Qtd.</label>
                        <input
                          type="number"
                          min={1}
                          value={draftItem.quantity}
                          onChange={(e) => updateDraftItem({ quantity: Number(e.target.value) })}
                          onKeyDown={handleDraftKeyDown}
                          className="font-mono-num mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-zinc-400">
                          Custo Unit. (R$)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draftUnitCostText}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9.,]/g, '');
                            setDraftUnitCostText(raw);
                            const parsed = Number(raw.replace(',', '.'));
                            updateDraftItem({
                              unitOriginalCost: Number.isFinite(parsed) ? parsed : 0,
                            });
                          }}
                          onKeyDown={handleDraftKeyDown}
                          placeholder="0,00"
                          className="font-mono-num mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-medium text-zinc-400" title="Quantidade reservada para encomendas de clientes">
                          Cli.
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={draftItem.quantity}
                          value={draftItem.qtyForClients}
                          onChange={(e) =>
                            updateDraftItem({ qtyForClients: Number(e.target.value) })
                          }
                          onKeyDown={handleDraftKeyDown}
                          className="font-mono-num mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-medium text-zinc-400" title="Quantidade disponível para estoque">
                          Est.
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={draftItem.quantity}
                          value={draftItem.qtyForStock}
                          onChange={(e) =>
                            updateDraftItem({ qtyForStock: Number(e.target.value) })
                          }
                          onKeyDown={handleDraftKeyDown}
                          className="font-mono-num mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="col-span-2 flex gap-1.5 sm:col-span-3">
                        {editingItemIndex !== null && (
                          <button
                            type="button"
                            onClick={handleCancelEditDraftItem}
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                          >
                            Cancelar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleSaveDraftItem}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {editingItemIndex !== null ? 'Atualizar Item' : 'Adicionar à Lista'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Added Items Compact List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xs font-semibold text-zinc-200">
                      Lista de Produtos Adicionados ({items.length})
                    </h3>
                    {items.length > 0 && (
                      <span className="font-mono-num text-[11px] text-zinc-400">
                        {items.reduce((acc, it) => acc + it.quantity, 0)} un. no total
                      </span>
                    )}
                  </div>

                  {items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-4 text-center text-xs text-zinc-500">
                      Nenhum produto na lista ainda. Preencha acima e clique em{' '}
                      <strong className="text-zinc-300">Adicionar à Lista</strong> (ou aperte Enter).
                    </div>
                  ) : (
                    <>
                      {/* Mobile Compact List */}
                      <div className="space-y-2 sm:hidden">
                        {items.map((item, idx) => {
                          const calcItem = liveCalc.items[idx];
                          const isBeingEdited = editingItemIndex === idx;
                          return (
                            <div
                              key={idx}
                              className={`rounded-lg border p-2.5 text-xs ${
                                isBeingEdited
                                  ? 'border-emerald-600/80 bg-emerald-950/25'
                                  : 'border-zinc-800 bg-zinc-950/60'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-zinc-100">
                                    {item.quantity}x {item.name}
                                  </p>
                                  <p className="text-[11px] text-zinc-400">
                                    {item.brand} · {item.category}
                                    {item.code ? ` · Cód. ${item.code}` : ''}
                                  </p>
                                  <p className="font-mono-num mt-1 text-[11px] text-zinc-300">
                                    Orig.: {formatCurrency(item.unitOriginalCost)} · Efetivo:{' '}
                                    <strong className="text-emerald-400">
                                      {formatCurrency(calcItem?.unitEffectiveCost ?? item.unitOriginalCost)}
                                    </strong>{' '}
                                    · Est: {item.qtyForStock} / Cli: {item.qtyForClients}
                                  </p>
                                </div>
                                {!isLocked && (
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleEditAddedItem(idx)}
                                      aria-label="Editar item"
                                      className="rounded border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeItemRow(idx)}
                                      aria-label="Remover item"
                                      className="rounded border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Compact Table */}
                      <div className="hidden overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 sm:block">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-zinc-800 bg-zinc-950 text-[11px] text-zinc-400">
                            <tr>
                              <th className="px-3 py-2 font-medium">Produto</th>
                              <th className="px-3 py-2 font-medium">Categoria</th>
                              <th className="px-3 py-2 text-right font-medium">Qtd (Est/Cli)</th>
                              <th className="px-3 py-2 text-right font-medium">Orig. Unit.</th>
                              <th className="px-3 py-2 text-right font-medium">Efetivo Unit.</th>
                              {!isLocked && (
                                <th className="px-3 py-2 text-right font-medium">Ações</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/70">
                            {items.map((item, idx) => {
                              const calcItem = liveCalc.items[idx];
                              const isBeingEdited = editingItemIndex === idx;
                              return (
                                <tr
                                  key={idx}
                                  className={
                                    isBeingEdited ? 'bg-emerald-950/25' : 'hover:bg-zinc-900/60'
                                  }
                                >
                                  <td className="px-3 py-2">
                                    <p className="font-medium text-zinc-100">{item.name}</p>
                                    <p className="text-[11px] text-zinc-400">
                                      {item.brand}
                                      {item.code ? ` · Cód. ${item.code}` : ''}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2 text-zinc-300">{item.category}</td>
                                  <td className="font-mono-num px-3 py-2 text-right text-zinc-200">
                                    <strong>{item.quantity}</strong>{' '}
                                    <span className="text-[10px] text-zinc-500">
                                      ({item.qtyForStock}/{item.qtyForClients})
                                    </span>
                                  </td>
                                  <td className="font-mono-num px-3 py-2 text-right text-zinc-300">
                                    {formatCurrency(item.unitOriginalCost)}
                                  </td>
                                  <td className="font-mono-num px-3 py-2 text-right">
                                    <span className="font-semibold text-emerald-400">
                                      {formatCurrency(calcItem?.unitEffectiveCost ?? item.unitOriginalCost)}
                                    </span>
                                    <span className="block text-[10px] text-zinc-500">
                                      +{formatCurrency(calcItem?.allocatedFinancialCost ?? 0)}
                                    </span>
                                  </td>
                                  {!isLocked && (
                                    <td className="px-3 py-2 text-right">
                                      <div className="inline-flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => handleEditAddedItem(idx)}
                                          aria-label="Editar item"
                                          title="Carregar para editar"
                                          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removeItemRow(idx)}
                                          aria-label="Remover item"
                                          title="Remover da lista"
                                          className="rounded p-1 text-zinc-500 hover:bg-red-950/60 hover:text-red-400"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {!isLocked && items.length > 0 && draftItem.name.trim() && editingItemIndex === null && (
                    <p className="text-[11px] text-amber-400">
                      Você digitou &ldquo;{draftItem.name.trim()}&rdquo; acima. Clique em{' '}
                      <strong>Adicionar à Lista</strong> para incluí-lo neste pedido.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Override original total + Notes */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Valor Original do Pedido (opcional se igual aos itens)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={Boolean(editingPurchase && !editEligibility.allowed)}
                value={overrideOriginalTotal}
                onChange={(e) => setOverrideOriginalTotal(e.target.value)}
                placeholder={liveCalc.originalTotal.toFixed(2)}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300">Observações</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anotações do ciclo, campanha ou entrega"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>

          {/* Financial Preview */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-xs font-semibold text-zinc-100">
                Resumo Financeiro da Compra
              </span>
              <span className="text-[11px] text-zinc-400">
                Parâmetros informativos: Juros {formatPercent(settings?.refMonthlyInterestRate ?? 3)} a.m. ·{' '}
                {formatPercent(settings?.refAnnualInterestRate ?? 42.58)} a.a. · CET{' '}
                {formatPercent(settings?.refMonthlyCet ?? 5.33)} a.m. /{' '}
                {formatPercent(settings?.refAnnualCet ?? 88.25)} a.a. · IOF{' '}
                {formatCurrency(settings?.refIofAmount ?? 2.98)} (não somado aos {settings?.boletoSurchargePercent ?? 5}%)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-zinc-400">Valor Original</p>
                <p className="font-mono-num text-sm font-semibold text-zinc-100">
                  {formatCurrency(liveCalc.originalTotal)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">
                  Acréscimo ({formatPercent(liveCalc.surchargePercentApplied)})
                </p>
                <p className="font-mono-num text-sm font-semibold text-amber-400">
                  {formatCurrency(liveCalc.surchargeAmount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Total Efetivo</p>
                <p className="font-mono-num text-sm font-semibold text-emerald-400">
                  {formatCurrency(liveCalc.effectiveTotal)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Vencimentos Gerados</p>
                {liveCalc.installments.map((inst) => (
                  <p key={inst.installmentNumber} className="font-mono-num text-xs text-zinc-300">
                    {inst.installmentNumber}ª: {formatDateBR(inst.dueDate)} ·{' '}
                    <strong className="text-zinc-100">{formatCurrency(inst.totalAmount)}</strong>
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowNewModal(false);
                setEditingPurchase(null);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {submitting
                ? 'Salvando...'
                : editingPurchase
                  ? 'Salvar Alterações do Pedido'
                  : 'Confirmar Entrada da Compra'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Purchase Detail Modal */}
      <Modal
        open={Boolean(selectedPurchase)}
        onClose={() => setSelectedPurchase(null)}
        title={`Pedido ${selectedPurchase?.orderNumber ?? ''}`}
        subtitle={
          selectedPurchase
            ? `${selectedPurchase.brand} · Compra em ${formatDateBR(selectedPurchase.purchaseDate)} · ${translatePaymentMethod(selectedPurchase.paymentMethod)}`
            : undefined
        }
        maxWidth="2xl"
      >
        {selectedPurchase && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs sm:grid-cols-4">
              <div>
                <span className="text-zinc-400">Valor Original</span>
                <p className="font-mono-num font-semibold text-zinc-100">
                  {formatCurrency(selectedPurchase.originalTotal)}
                </p>
              </div>
              <div>
                <span className="text-zinc-400">
                  Acréscimo ({formatPercent(selectedPurchase.surchargePercentApplied)})
                </span>
                <p className="font-mono-num font-semibold text-amber-400">
                  {formatCurrency(selectedPurchase.surchargeAmount)}
                </p>
              </div>
              <div>
                <span className="text-zinc-400">Total Efetivo</span>
                <p className="font-mono-num font-semibold text-emerald-400">
                  {formatCurrency(selectedPurchase.effectiveTotal)}
                </p>
              </div>
              <div>
                <span className="text-zinc-400">Data de Referência</span>
                <p className="font-mono-num font-medium text-zinc-200">
                  {formatDateBR(selectedPurchase.referenceDate)}
                </p>
              </div>
            </div>

            <div className="text-[11px] text-zinc-400">
              Condições históricas salvas neste pedido: Juros{' '}
              {formatPercent(selectedPurchase.financialParamsSnapshot?.refMonthlyInterestRate)} a.m. ·{' '}
              CET {formatPercent(selectedPurchase.financialParamsSnapshot?.refMonthlyCet)} a.m. ·{' '}
              IOF informado {formatCurrency(selectedPurchase.financialParamsSnapshot?.refIofAmount)} ·{' '}
              Prazos {selectedPurchase.financialParamsSnapshot?.boletoInstallment1Days}/
              {selectedPurchase.financialParamsSnapshot?.boletoInstallment2Days} dias.
            </div>

            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                    <th className="px-3 py-2 text-right font-medium">Clientes / Estoque</th>
                    <th className="px-3 py-2 text-right font-medium">Unit. Orig.</th>
                    <th className="px-3 py-2 text-right font-medium">Rateio Fin.</th>
                    <th className="px-3 py-2 text-right font-medium">Unit. Efetivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {selectedPurchase.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-zinc-100">{it.name}</p>
                        <p className="text-[11px] text-zinc-400">
                          {it.brand} {it.code ? `· Cód. ${it.code}` : ''}
                        </p>
                      </td>
                      <td className="font-mono-num px-3 py-2 text-right text-zinc-300">{it.quantity}</td>
                      <td className="font-mono-num px-3 py-2 text-right text-zinc-400">
                        {it.qtyForClients} / {it.qtyForStock}
                      </td>
                      <td className="font-mono-num px-3 py-2 text-right text-zinc-300">
                        {formatCurrency(it.unitOriginalCost)}
                      </td>
                      <td className="font-mono-num px-3 py-2 text-right text-zinc-400">
                        {formatCurrency(it.allocatedFinancialCost)}
                      </td>
                      <td className="font-mono-num px-3 py-2 text-right font-semibold text-zinc-100">
                        {formatCurrency(it.unitEffectiveCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300">
                  Data de Faturamento
                </label>
                <input
                  type="date"
                  value={editBillingDate}
                  onChange={(e) => setEditBillingDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300">Observações</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openEditPurchase(selectedPurchase)}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar Pedido
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(selectedPurchase);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPurchase(null)}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handleSavePurchaseMeta}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Salvar Atualização
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Purchase Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={`Excluir Pedido #${deleteTarget?.orderNumber ?? ''}`}
        subtitle="Confirme a remoção deste pedido de compra."
        maxWidth="md"
      >
        {deleteTarget && (
          <div className="space-y-4 text-xs">
            {!deleteEligibility.allowed ? (
              <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-amber-200">
                <p className="font-semibold">Não é possível excluir este pedido</p>
                <p className="mt-1">{deleteEligibility.reason}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-zinc-200">
                <p>
                  Tem certeza que deseja excluir o pedido{' '}
                  <strong>#{deleteTarget.orderNumber}</strong> ({deleteTarget.brand} ·{' '}
                  {formatCurrency(deleteTarget.effectiveTotal)})?
                </p>
                <p className="mt-1.5 text-zinc-400">
                  Os lotes adicionados no estoque e os boletos/contas a pagar vinculados a este pedido também serão removidos.
                </p>
              </div>
            )}

            {deleteError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-red-300">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
              >
                Cancelar
              </button>
              {deleteEligibility.allowed && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
                >
                  {deleting ? 'Excluindo...' : 'Confirmar Exclusão'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
