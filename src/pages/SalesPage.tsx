import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  Minus,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import {
  canFullEditSale,
  deleteSale,
  markSaleAsDelivered,
  registerAdvanceFullPayment,
  registerReceivablePayment,
  registerSale,
  saveClient,
  saveSeller,
  updateReceivableDueDate,
  updateSale,
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
    stockMovements,
    clients,
    sales,
    receivables,
    payments,
    cardSettlements,
    commissions,
    sellers,
  } = useAppData();

  const [statusFilter, setStatusFilter] = useState<
    'TODAS' | 'PAGO' | 'PARCIAL' | 'PENDENTE' | 'CREDITO_PROPRIO' | 'ENTREGA_PENDENTE'
  >('TODAS');
  const [search, setSearch] = useState('');

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [deleteTargetSale, setDeleteTargetSale] = useState<Sale | null>(null);
  const [deletingSale, setDeletingSale] = useState(false);
  const [deleteSaleError, setDeleteSaleError] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const skipDueDatesSyncRef = React.useRef(false);

  // Quick inline client creation inside sale modal
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientName, setQuickClientName] = useState('');
  const [quickClientWhatsapp, setQuickClientWhatsapp] = useState('');

  // New Sale form state
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [highlightedClientIdx, setHighlightedClientIdx] = useState(0);
  const clientDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const clientSearchInputRef = React.useRef<HTMLInputElement | null>(null);

  const [saleDate, setSaleDate] = useState(getTodayISO());
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('ENTREGUE');
  const [saleItems, setSaleItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [draftProductId, setDraftProductId] = useState('');
  const [draftQty, setDraftQty] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [highlightedProductIdx, setHighlightedProductIdx] = useState(0);
  const productDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const productSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const draftQtyInputRef = React.useRef<HTMLInputElement | null>(null);

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
  const [hasCommission, setHasCommission] = useState(false);
  const [commSellerId, setCommSellerId] = useState('');
  const [commSellerName, setCommSellerName] = useState('');
  const [commSellerContact, setCommSellerContact] = useState('');
  const [commPercent, setCommPercent] = useState<number>(10);
  const [commAmount, setCommAmount] = useState<number>(0);
  const [commDueDate, setCommDueDate] = useState(getTodayISO());
  const [quickSellerOpen, setQuickSellerOpen] = useState(false);
  const [quickSellerName, setQuickSellerName] = useState('');
  const [quickSellerWhatsapp, setQuickSellerWhatsapp] = useState('');
  const [quickSellerPix, setQuickSellerPix] = useState('');
  const [quickSellerPct, setQuickSellerPct] = useState<number>(10);
  const [savingQuickSeller, setSavingQuickSeller] = useState(false);
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
    const handleClickOutside = (event: MouseEvent) => {
      if (
        productDropdownRef.current &&
        !productDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProductDropdownOpen(false);
      }
      if (
        clientDropdownRef.current &&
        !clientDropdownRef.current.contains(event.target as Node)
      ) {
        setIsClientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (externalOpenNew) {
      openNewSaleModal();
      onClearExternalNew?.();
    }
  }, [externalOpenNew, onClearExternalNew]);

  const openNewSaleModal = () => {
    skipDueDatesSyncRef.current = false;
    setEditingSale(null);
    setFormError(null);
    setClientId(clients[0]?.id || '');
    setClientSearch('');
    setIsClientDropdownOpen(false);
    setSaleDate(getTodayISO());
    setDeliveryStatus('ENTREGUE');
    setSaleItems([]);
    setDraftProductId('');
    setDraftQty(1);
    setProductSearch('');
    setIsProductDropdownOpen(false);
    setOriginalSaleAmount(0);
    setPaymentSplits([{ method: 'PIX', amount: 0 }]);
    setOwnCreditInterestPercent(0);
    setOwnCreditInstallmentsCount(2);
    setOwnCreditFirstDueDate(addMonthsISO(getTodayISO(), 1));
    setOwnCreditIntervalType('MONTHLY');
    setOwnCreditIntervalDays(30);
    setCustomDueDates([]);
    setNotes('');
    setHasCommission(false);
    setCommSellerId('');
    setCommSellerName('');
    setCommSellerContact('');
    setCommPercent(10);
    setCommAmount(0);
    setCommDueDate(getTodayISO());
    setQuickSellerOpen(false);
    setShowNewModal(true);
  };

  const openEditSale = (sale: Sale) => {
    const saleRecs = receivables
      .filter((r) => r.saleId === sale.id)
      .sort((a, b) => a.installmentNumber - b.installmentNumber);

    skipDueDatesSyncRef.current = sale.hasOwnCredit && saleRecs.length > 0;
    setEditingSale(sale);
    setFormError(null);
    setQuickClientOpen(false);
    setClientId(sale.clientId);
    setClientSearch('');
    setIsClientDropdownOpen(false);
    setSaleDate(sale.saleDate);
    setDeliveryStatus(sale.deliveryStatus);
    setSaleItems(
      sale.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
      }))
    );
    setDraftProductId('');
    setDraftQty(1);
    setProductSearch('');
    setIsProductDropdownOpen(false);
    setOriginalSaleAmount(sale.originalSaleAmount);
    setPaymentSplits(
      sale.paymentSplits.length > 0
        ? sale.paymentSplits.map((sp) => ({ ...sp }))
        : [{ method: 'PIX', amount: 0 }]
    );
    setOwnCreditInterestPercent(sale.ownCreditInterestPercent || 0);
    setOwnCreditInstallmentsCount(
      sale.hasOwnCredit && sale.ownCreditInstallmentsCount > 0
        ? sale.ownCreditInstallmentsCount
        : 2
    );
    setOwnCreditFirstDueDate(saleRecs[0]?.dueDate || addMonthsISO(sale.saleDate, 1));
    setOwnCreditIntervalType('MONTHLY');
    setOwnCreditIntervalDays(30);
    setCustomDueDates(
      saleRecs.filter((r) => r.type === 'CREDITO_PROPRIO').map((r) => r.dueDate)
    );
    setNotes(sale.notes || '');
    setHasCommission(false);
    setCommSellerId('');
    setCommSellerName('');
    setCommSellerContact('');
    setCommPercent(10);
    setCommAmount(0);
    setCommDueDate(sale.saleDate);
    setQuickSellerOpen(false);
    setSelectedSaleId(null);
    setShowNewModal(true);
  };

  const editSaleEligibility = useMemo(() => {
    if (!editingSale) return { allowed: true };
    return canFullEditSale(editingSale, payments, cardSettlements);
  }, [editingSale, payments, cardSettlements]);

  const effectiveAvailableByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      map.set(p.id, p.availableQty);
    }
    if (editingSale) {
      for (const it of editingSale.items) {
        map.set(it.productId, (map.get(it.productId) ?? 0) + it.quantity);
      }
    }
    return map;
  }, [products, editingSale]);

  const normalizeSearch = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const queuedQtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of saleItems) {
      map.set(it.productId, (map.get(it.productId) || 0) + it.quantity);
    }
    return map;
  }, [saleItems]);

  const filteredClientsForPicker = useMemo(() => {
    const q = normalizeSearch(clientSearch);
    const list = clients.filter((c) => {
      if (!q) return true;
      return (
        normalizeSearch(c.fullName).includes(q) ||
        normalizeSearch(c.whatsapp || '').includes(q) ||
        normalizeSearch(c.phone || '').includes(q)
      );
    });
    return [...list].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [clients, clientSearch]);

  const selectedClientObj = useMemo(
    () => clients.find((c) => c.id === clientId) || null,
    [clients, clientId]
  );

  const filteredProductsForPicker = useMemo(() => {
    const q = normalizeSearch(productSearch);
    const list = products.filter((p) => {
      if (!q) return true;
      return (
        normalizeSearch(p.name).includes(q) ||
        normalizeSearch(p.code).includes(q) ||
        normalizeSearch(p.brand).includes(q) ||
        normalizeSearch(p.category).includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (q) {
        const aCode = normalizeSearch(a.code);
        const bCode = normalizeSearch(b.code);
        if (aCode === q && bCode !== q) return -1;
        if (bCode === q && aCode !== q) return 1;
        if (aCode.startsWith(q) && !bCode.startsWith(q)) return -1;
        if (bCode.startsWith(q) && !aCode.startsWith(q)) return 1;
      }
      const aRem = (effectiveAvailableByProduct.get(a.id) ?? a.availableQty) - (queuedQtyByProduct.get(a.id) || 0);
      const bRem = (effectiveAvailableByProduct.get(b.id) ?? b.availableQty) - (queuedQtyByProduct.get(b.id) || 0);
      if (aRem > 0 && bRem <= 0) return -1;
      if (bRem > 0 && aRem <= 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [products, productSearch, effectiveAvailableByProduct, queuedQtyByProduct]);

  const visibleProductsForPicker = useMemo(
    () => filteredProductsForPicker.slice(0, 40),
    [filteredProductsForPicker]
  );

  const selectedDraftProduct = useMemo(
    () => products.find((p) => p.id === draftProductId) || null,
    [products, draftProductId]
  );

  // Live FIFO evaluation for queued items + single-item preview
  const liveSaleEvaluation = useMemo(() => {
    const itemsToEval =
      saleItems.length > 0
        ? saleItems
        : draftProductId && draftQty > 0
          ? [{ productId: draftProductId, quantity: draftQty }]
          : [];

    if (!settings) {
      return {
        totalCost: 0,
        totalQty: itemsToEval.reduce((acc, i) => acc + i.quantity, 0),
        error: null as string | null,
        evaluatedItems: [] as {
          productId: string;
          quantity: number;
          product: (typeof products)[number] | null;
          unitCost: number;
          totalCost: number;
          error: string | null;
        }[],
        draftPreview: { unitCost: 0, totalCost: 0, error: null as string | null },
      };
    }

    if (editingSale && !editSaleEligibility.allowed) {
      return {
        totalCost: editingSale.totalProductCost,
        totalQty: editingSale.items.reduce((acc, i) => acc + i.quantity, 0),
        error: null as string | null,
        evaluatedItems: editingSale.items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          product: products.find((p) => p.id === it.productId) || null,
          unitCost: it.unitEffectiveCost,
          totalCost: it.totalCost,
          error: null as string | null,
        })),
        draftPreview: { unitCost: 0, totalCost: 0, error: null as string | null },
      };
    }

    const workingLots = stockLots.map((l) => ({ ...l }));
    if (editingSale) {
      for (const oldItem of editingSale.items) {
        for (const alloc of oldItem.lotAllocations) {
          if (alloc.lotId) {
            const wl = workingLots.find((l) => l.id === alloc.lotId);
            if (wl) {
              wl.availableQty += alloc.quantity;
              if (editingSale.deliveryStatus === 'ENTREGUE') {
                wl.deliveredQty = Math.max(0, wl.deliveredQty - alloc.quantity);
              } else {
                wl.reservedQty = Math.max(0, wl.reservedQty - alloc.quantity);
              }
            }
          }
        }
      }
    }

    let sum = 0;
    let firstError: string | null = null;
    const evaluatedItems = saleItems.map((it) => {
      const prod = products.find((p) => p.id === it.productId) || null;
      if (!prod || it.quantity <= 0) {
        const err = !prod ? 'Produto não encontrado' : 'Quantidade inválida';
        if (!firstError) firstError = err;
        return {
          productId: it.productId,
          quantity: it.quantity,
          product: prod,
          unitCost: 0,
          totalCost: 0,
          error: err,
        };
      }
      try {
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
        return {
          productId: it.productId,
          quantity: it.quantity,
          product: prod,
          unitCost: fifo.unitEffectiveCostAvg,
          totalCost: fifo.totalEffectiveCost,
          error: null as string | null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Estoque insuficiente';
        if (!firstError) firstError = msg;
        return {
          productId: it.productId,
          quantity: it.quantity,
          product: prod,
          unitCost: 0,
          totalCost: 0,
          error: msg,
        };
      }
    });

    let draftPreview = { unitCost: 0, totalCost: 0, error: null as string | null };
    if (draftProductId && draftQty > 0) {
      const draftProd = products.find((p) => p.id === draftProductId);
      if (draftProd) {
        try {
          const fifo = allocateFifoFromLots(
            workingLots,
            draftProd.id,
            draftProd.name,
            draftQty,
            settings.allowNegativeStock
          );
          draftPreview = {
            unitCost: fifo.unitEffectiveCostAvg,
            totalCost: fifo.totalEffectiveCost,
            error: null,
          };
          if (saleItems.length === 0) {
            sum = fifo.totalEffectiveCost;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Estoque insuficiente';
          draftPreview = { unitCost: 0, totalCost: 0, error: msg };
          if (saleItems.length === 0 && !firstError) {
            firstError = msg;
          }
        }
      }
    }

    return {
      totalCost: sum,
      totalQty: itemsToEval.reduce((acc, i) => acc + i.quantity, 0),
      error: firstError,
      evaluatedItems,
      draftPreview,
    };
  }, [
    saleItems,
    draftProductId,
    draftQty,
    products,
    stockLots,
    settings,
    editingSale,
    editSaleEligibility.allowed,
  ]);

  const liveCostPreview = {
    totalCost: liveSaleEvaluation.totalCost,
    error: liveSaleEvaluation.error,
  };

  const handleSelectProductInComposer = (pickedId: string) => {
    setDraftProductId(pickedId);
    setProductSearch('');
    setIsProductDropdownOpen(false);
    setFormError(null);
    setTimeout(() => draftQtyInputRef.current?.focus(), 0);
  };

  const handleAddDraftProductToSale = () => {
    if (!selectedDraftProduct || draftQty <= 0) return;
    setFormError(null);
    if (liveSaleEvaluation.draftPreview.error) {
      setFormError(liveSaleEvaluation.draftPreview.error);
      return;
    }

    setSaleItems((prev) => {
      const idx = prev.findIndex((i) => i.productId === selectedDraftProduct.id);
      if (idx >= 0) {
        return prev.map((it, i) =>
          i === idx ? { ...it, quantity: it.quantity + draftQty } : it
        );
      }
      return [...prev, { productId: selectedDraftProduct.id, quantity: draftQty }];
    });

    setDraftProductId('');
    setDraftQty(1);
    setProductSearch('');
    setIsProductDropdownOpen(false);
    setTimeout(() => productSearchInputRef.current?.focus(), 0);
  };

  const handleUpdateSaleItemQty = (targetProductId: string, nextQty: number) => {
    const safeQty = Math.max(1, Math.floor(nextQty || 1));
    setSaleItems((prev) =>
      prev.map((it) => (it.productId === targetProductId ? { ...it, quantity: safeQty } : it))
    );
  };

  const handleRemoveSaleItem = (targetProductId: string) => {
    setSaleItems((prev) => prev.filter((it) => it.productId !== targetProductId));
  };

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
    if (skipDueDatesSyncRef.current) {
      skipDueDatesSyncRef.current = false;
      return;
    }
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

    const pickedClient = clients.find((c) => c.id === clientId);
    if (!pickedClient) {
      setFormError('Selecione ou cadastre um cliente antes de registrar a venda.');
      return;
    }

    if (saleItems.length > 0 && draftProductId) {
      setFormError(
        `Você selecionou "${selectedDraftProduct?.name || 'um produto'}" acima, mas ainda não clicou em "Adicionar à Lista". Adicione-o à lista ou limpe a seleção antes de confirmar.`
      );
      return;
    }

    const validItems =
      saleItems.length > 0
        ? saleItems.filter((i) => i.productId && i.quantity > 0)
        : draftProductId && draftQty > 0
          ? [{ productId: draftProductId, quantity: draftQty }]
          : [];

    if (validItems.length === 0) {
      setFormError('Adicione pelo menos um produto válido do estoque à lista da venda.');
      return;
    }

    if (!editingSale && hasCommission) {
      if (!commSellerName.trim()) {
        setFormError('Informe o nome do(a) vendedor(a) para lançar a comissão.');
        return;
      }
      if (commAmount <= 0) {
        setFormError('Informe um valor de comissão maior que zero.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const inputPayload = {
        client: pickedClient,
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
        ...(!editingSale && hasCommission && commSellerName.trim() && commAmount > 0
          ? {
              commission: {
                sellerName: commSellerName,
                sellerContact: commSellerContact,
                commissionPercent: commPercent,
                commissionAmount: commAmount,
                dueDate: commDueDate || saleDate,
                notes: '',
              },
            }
          : {}),
      };

      if (editingSale) {
        await updateSale(
          user.uid,
          editingSale,
          inputPayload,
          products,
          stockLots,
          stockMovements,
          receivables,
          payments,
          cardSettlements,
          settings
        );
        const savedId = editingSale.id;
        setShowNewModal(false);
        setEditingSale(null);
        setSelectedSaleId(savedId);
      } else {
        const newSaleId = await registerSale(
          user.uid,
          inputPayload,
          products,
          stockLots,
          settings,
          sales.length
        );
        setShowNewModal(false);
        setSelectedSaleId(newSaleId);
      }
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : editingSale
            ? 'Erro ao atualizar venda.'
            : 'Erro ao registrar venda.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeleteSale = async () => {
    if (!deleteTargetSale) return;
    setDeleteSaleError(null);
    setDeletingSale(true);
    try {
      await deleteSale(
        deleteTargetSale,
        products,
        stockLots,
        stockMovements,
        receivables,
        payments,
        cardSettlements,
        commissions
      );
      if (selectedSaleId === deleteTargetSale.id) {
        setSelectedSaleId(null);
      }
      setDeleteTargetSale(null);
    } catch (err) {
      setDeleteSaleError(err instanceof Error ? err.message : 'Erro ao excluir venda.');
    } finally {
      setDeletingSale(false);
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
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditSale(s)}
                        aria-label="Editar venda"
                        title="Editar venda"
                        className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteSaleError(null);
                          setDeleteTargetSale(s);
                        }}
                        aria-label="Excluir venda"
                        title="Excluir venda"
                        className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSaleId(s.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Gerenciar
                      </button>
                    </div>
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
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditSale(s)}
                            title="Editar venda"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteSaleError(null);
                              setDeleteTargetSale(s);
                            }}
                            title="Excluir venda"
                            aria-label="Excluir venda"
                            className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-950/60 p-1 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedSaleId(s.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Gerenciar
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

      {/* New / Edit Sale Modal */}
      <Modal
        open={showNewModal}
        onClose={() => {
          setShowNewModal(false);
          setEditingSale(null);
        }}
        title={editingSale ? `Editar Venda ${editingSale.documentNumber}` : 'Registrar Nova Venda'}
        subtitle={
          editingSale
            ? 'Altere os itens, cliente ou condições. O estoque FIFO e os recebimentos são recalculados automaticamente.'
            : 'Informe somente os produtos e o valor final da venda. O custo FIFO e o lucro são calculados automaticamente.'
        }
        maxWidth="4xl"
      >
        <form onSubmit={handleSubmitSale} className="space-y-5">
          {formError && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          {editingSale && !editSaleEligibility.allowed && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              {editSaleEligibility.reason} Por segurança, apenas o campo de Observações pode ser editado diretamente aqui.
            </div>
          )}

          {/* Client, Date, Delivery */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2" ref={clientDropdownRef}>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-zinc-300">Cliente *</label>
                <div className="flex items-center gap-3">
                  {clients.length > 0 && !(editingSale && !editSaleEligibility.allowed) && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsClientDropdownOpen((prev) => !prev);
                        setHighlightedClientIdx(0);
                        clientSearchInputRef.current?.focus();
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
                    >
                      {isClientDropdownOpen
                        ? 'Ocultar lista'
                        : `Ver lista (${clients.length})`}
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${
                          isClientDropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  )}
                  {!(editingSale && !editSaleEligibility.allowed) && (
                    <button
                      type="button"
                      onClick={() => setQuickClientOpen((v) => !v)}
                      className="text-[11px] font-medium text-emerald-400 hover:underline"
                    >
                      {quickClientOpen ? 'Fechar cadastro rápido' : '+ Cadastro rápido'}
                    </button>
                  )}
                </div>
              </div>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  ref={clientSearchInputRef}
                  type="text"
                  disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                  value={
                    clientSearch.length > 0
                      ? clientSearch
                      : selectedClientObj
                        ? `${selectedClientObj.fullName}${selectedClientObj.whatsapp ? ` (${selectedClientObj.whatsapp})` : ''}`
                        : ''
                  }
                  onFocus={(e) => {
                    setHighlightedClientIdx(0);
                    setIsClientDropdownOpen(true);
                    e.currentTarget.select();
                  }}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setHighlightedClientIdx(0);
                    setIsClientDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && selectedClientObj && clientSearch === '') {
                      e.preventDefault();
                      setClientId('');
                      setClientSearch('');
                      setIsClientDropdownOpen(true);
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setIsClientDropdownOpen(true);
                      setHighlightedClientIdx((prev) =>
                        filteredClientsForPicker.length > 0
                          ? Math.min(prev + 1, filteredClientsForPicker.length - 1)
                          : 0
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlightedClientIdx((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === 'Enter' && isClientDropdownOpen) {
                      e.preventDefault();
                      const picked = filteredClientsForPicker[highlightedClientIdx];
                      if (picked) {
                        setClientId(picked.id);
                        setClientSearch('');
                        setIsClientDropdownOpen(false);
                      }
                    } else if (e.key === 'Escape') {
                      setIsClientDropdownOpen(false);
                    }
                  }}
                  placeholder="Buscar cliente pelo nome ou WhatsApp..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-8 pr-14 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                />
                {!(editingSale && !editSaleEligibility.allowed) && (
                  <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    {(clientSearch || selectedClientObj) && (
                      <button
                        type="button"
                        onClick={() => {
                          setClientId('');
                          setClientSearch('');
                          setIsClientDropdownOpen(true);
                          clientSearchInputRef.current?.focus();
                        }}
                        aria-label="Trocar cliente"
                        className="text-zinc-400 hover:text-zinc-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsClientDropdownOpen((prev) => !prev)}
                      aria-label="Abrir ou fechar lista de clientes"
                      className="text-zinc-400 hover:text-zinc-100"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                          isClientDropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                )}

                {isClientDropdownOpen && !(editingSale && !editSaleEligibility.allowed) && (
                  <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
                    {filteredClientsForPicker.length === 0 ? (
                      <div className="px-3 py-2.5 text-xs text-zinc-400">
                        Nenhum cliente encontrado. Use <strong>+ Cadastro rápido</strong> acima.
                      </div>
                    ) : (
                      filteredClientsForPicker.map((c, idx) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseEnter={() => setHighlightedClientIdx(idx)}
                          onClick={() => {
                            setClientId(c.id);
                            setClientSearch('');
                            setIsClientDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 border-b border-zinc-800/70 px-3 py-2 text-left text-xs last:border-b-0 ${
                            c.id === clientId
                              ? 'bg-emerald-950/75 text-emerald-200'
                              : idx === highlightedClientIdx
                                ? 'bg-emerald-950/50 text-zinc-100'
                                : 'text-zinc-200 hover:bg-zinc-800/70'
                          }`}
                        >
                          <span className="truncate font-medium">{c.fullName}</span>
                          {c.whatsapp && (
                            <span className="font-mono-num shrink-0 text-[11px] text-zinc-400">
                              {c.whatsapp}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Data da Venda *</label>
              <input
                type="date"
                required
                disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300">Situação da Entrega</label>
              <select
                value={deliveryStatus}
                disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                onChange={(e) => setDeliveryStatus(e.target.value as DeliveryStatus)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
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

          {/* Fixed Product Composer + Compact Added Products List */}
          {(() => {
            const isLockedSale = Boolean(editingSale && !editSaleEligibility.allowed);
            const selectedAvail = selectedDraftProduct
              ? (effectiveAvailableByProduct.get(selectedDraftProduct.id) ??
                  selectedDraftProduct.availableQty) -
                (queuedQtyByProduct.get(selectedDraftProduct.id) || 0)
              : 0;

            return (
              <div className="space-y-3">
                {!isLockedSale && (
                  <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-xs font-semibold text-zinc-100">
                        Adicionar Produto à Venda
                      </h3>
                      {selectedDraftProduct && (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-800/70 bg-emerald-950/50 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          <Check className="h-3 w-3" />
                          {selectedDraftProduct.name}
                          {selectedDraftProduct.code ? ` (#${selectedDraftProduct.code})` : ''} · Disp.:{' '}
                          {selectedAvail} un.
                          <button
                            type="button"
                            onClick={() => {
                              setDraftProductId('');
                              setProductSearch('');
                              productSearchInputRef.current?.focus();
                            }}
                            aria-label="Limpar produto selecionado"
                            className="ml-1 text-emerald-400 hover:text-emerald-200"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
                      <div ref={productDropdownRef} className="relative sm:col-span-7">
                        <div className="flex items-center justify-between gap-2">
                          <label className="block text-[11px] font-medium text-zinc-400">
                            Buscar Produto do Estoque (nome ou código)
                          </label>
                          {products.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsProductDropdownOpen((prev) => !prev);
                                setHighlightedProductIdx(0);
                                productSearchInputRef.current?.focus();
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                            >
                              {isProductDropdownOpen
                                ? 'Ocultar lista'
                                : `Ver lista (${products.length})`}
                              <ChevronDown
                                className={`h-3 w-3 transition-transform ${
                                  isProductDropdownOpen ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>
                        <div className="relative mt-0.5">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                          <input
                            ref={productSearchInputRef}
                            type="text"
                            value={
                              productSearch.length > 0
                                ? productSearch
                                : selectedDraftProduct
                                  ? `${selectedDraftProduct.brand} · ${selectedDraftProduct.name}${selectedDraftProduct.code ? ` (#${selectedDraftProduct.code})` : ''}`
                                  : ''
                            }
                            onFocus={(e) => {
                              setHighlightedProductIdx(0);
                              setIsProductDropdownOpen(true);
                              e.currentTarget.select();
                            }}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              setProductSearch(nextVal);
                              setHighlightedProductIdx(0);
                              setIsProductDropdownOpen(true);

                              const norm = normalizeSearch(nextVal);
                              const exactCodeMatch = norm
                                ? products.find((p) => normalizeSearch(p.code) === norm)
                                : undefined;
                              if (exactCodeMatch) {
                                setDraftProductId(exactCodeMatch.id);
                                setFormError(null);
                              } else if (selectedDraftProduct) {
                                setDraftProductId('');
                              }
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.key === 'Backspace' &&
                                selectedDraftProduct &&
                                productSearch === ''
                              ) {
                                e.preventDefault();
                                setDraftProductId('');
                                setProductSearch('');
                                setIsProductDropdownOpen(true);
                                return;
                              }
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setIsProductDropdownOpen(true);
                                setHighlightedProductIdx((prev) =>
                                  visibleProductsForPicker.length > 0
                                    ? Math.min(prev + 1, visibleProductsForPicker.length - 1)
                                    : 0
                                );
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlightedProductIdx((prev) => Math.max(prev - 1, 0));
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                if (isProductDropdownOpen) {
                                  const picked = visibleProductsForPicker[highlightedProductIdx];
                                  if (picked) {
                                    handleSelectProductInComposer(picked.id);
                                  }
                                } else if (selectedDraftProduct) {
                                  handleAddDraftProductToSale();
                                }
                              } else if (e.key === 'Escape') {
                                setIsProductDropdownOpen(false);
                              }
                            }}
                            placeholder={`Pesquisar entre ${products.length} produto(s) por nome ou código...`}
                            className="w-full rounded border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-14 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                          />
                          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                            {(productSearch || selectedDraftProduct) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setProductSearch('');
                                  setDraftProductId('');
                                  setHighlightedProductIdx(0);
                                  setIsProductDropdownOpen(true);
                                  productSearchInputRef.current?.focus();
                                }}
                                aria-label="Limpar busca de produto"
                                className="text-zinc-400 hover:text-zinc-100"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setIsProductDropdownOpen((prev) => !prev)}
                              aria-label="Abrir ou fechar lista de produtos"
                              className="text-zinc-400 hover:text-zinc-100"
                            >
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${
                                  isProductDropdownOpen ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {isProductDropdownOpen && (
                          <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
                            {visibleProductsForPicker.length === 0 ? (
                              <div className="px-3 py-3 text-xs text-zinc-400">
                                Nenhum produto encontrado para &ldquo;{productSearch}&rdquo;.
                              </div>
                            ) : (
                              <>
                                {visibleProductsForPicker.map((pr, idx) => {
                                  const remaining =
                                    (effectiveAvailableByProduct.get(pr.id) ?? pr.availableQty) -
                                    (queuedQtyByProduct.get(pr.id) || 0);
                                  const isActive = idx === highlightedProductIdx;
                                  return (
                                    <button
                                      key={pr.id}
                                      type="button"
                                      onMouseEnter={() => setHighlightedProductIdx(idx)}
                                      onClick={() => handleSelectProductInComposer(pr.id)}
                                      className={`flex w-full items-center justify-between gap-2 border-b border-zinc-800/70 px-3 py-2 text-left text-xs last:border-b-0 ${
                                        isActive
                                          ? 'bg-emerald-950/60 text-zinc-100'
                                          : 'text-zinc-200 hover:bg-zinc-800/70'
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">
                                          {pr.name}
                                          {pr.code && (
                                            <span className="font-mono-num ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                                              #{pr.code}
                                            </span>
                                          )}
                                        </p>
                                        <p className="text-[11px] text-zinc-400">
                                          {pr.brand} · {pr.category}
                                        </p>
                                      </div>
                                      <span
                                        className={`font-mono-num shrink-0 text-[11px] font-medium ${
                                          remaining > 0 ? 'text-emerald-400' : 'text-red-400'
                                        }`}
                                      >
                                        Disp.: {remaining} un.
                                      </span>
                                    </button>
                                  );
                                })}
                                {filteredProductsForPicker.length >
                                  visibleProductsForPicker.length && (
                                  <div className="border-t border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-[11px] text-zinc-400">
                                    Mostrando {visibleProductsForPicker.length} de{' '}
                                    {filteredProductsForPicker.length} produtos — digite mais para filtrar.
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-zinc-400">
                          Quantidade
                        </label>
                        <input
                          ref={draftQtyInputRef}
                          type="number"
                          min={1}
                          value={draftQty}
                          onChange={(e) => setDraftQty(Math.max(1, Number(e.target.value)))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddDraftProductToSale();
                            }
                          }}
                          aria-label="Quantidade"
                          className="font-mono-num mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <button
                          type="button"
                          onClick={handleAddDraftProductToSale}
                          disabled={
                            !selectedDraftProduct || Boolean(liveSaleEvaluation.draftPreview.error)
                          }
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Adicionar à Lista
                        </button>
                      </div>
                    </div>

                    {selectedDraftProduct && !liveSaleEvaluation.draftPreview.error && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span>
                          Custo FIFO unit.:{' '}
                          <strong className="font-mono-num text-zinc-200">
                            {formatCurrency(liveSaleEvaluation.draftPreview.unitCost)}
                          </strong>
                        </span>
                        <span>
                          Subtotal FIFO:{' '}
                          <strong className="font-mono-num text-zinc-100">
                            {formatCurrency(liveSaleEvaluation.draftPreview.totalCost)}
                          </strong>
                        </span>
                      </div>
                    )}

                    {selectedDraftProduct && liveSaleEvaluation.draftPreview.error && (
                      <p className="text-[11px] font-medium text-red-400">
                        {liveSaleEvaluation.draftPreview.error}
                      </p>
                    )}
                  </div>
                )}

                {/* Added Sale Items List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                      <ShoppingBag className="h-4 w-4 text-emerald-400" />
                      <span>
                        Lista de Produtos da Venda ({saleItems.length}{' '}
                        {saleItems.length === 1 ? 'item' : 'itens'})
                      </span>
                    </div>
                    {saleItems.length > 0 && (
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="font-mono-num text-zinc-400">
                          {saleItems.reduce((acc, it) => acc + it.quantity, 0)} un. no total
                        </span>
                        {!isLockedSale && (
                          <button
                            type="button"
                            onClick={() => setSaleItems([])}
                            className="text-zinc-400 hover:text-red-400"
                          >
                            Limpar lista
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {saleItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-4 text-center text-xs text-zinc-500">
                      Nenhum produto na lista ainda. Busque acima por nome ou código e clique em{' '}
                      <strong className="text-zinc-300">Adicionar à Lista</strong> (ou selecione 1 produto e confirme diretamente).
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-950/60">
                      {liveSaleEvaluation.evaluatedItems.map((item) => {
                        const prod = item.product;
                        const availQty = prod
                          ? effectiveAvailableByProduct.get(prod.id) ?? prod.availableQty
                          : 0;
                        return (
                          <div
                            key={item.productId}
                            className={`flex flex-col gap-2 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between ${
                              item.error ? 'bg-red-950/20' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-zinc-100">
                                {prod?.name || 'Produto não encontrado'}
                                {prod?.code && (
                                  <span className="font-mono-num ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                                    #{prod.code}
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-zinc-400">
                                {prod?.brand} · {prod?.category} · Disp.: {availQty} un. · Custo FIFO:{' '}
                                <strong className="font-mono-num text-zinc-200">
                                  {formatCurrency(item.totalCost)}
                                </strong>{' '}
                                <span className="font-mono-num text-zinc-500">
                                  ({formatCurrency(item.unitCost)}/un.)
                                </span>
                              </p>
                              {item.error && (
                                <p className="mt-0.5 text-[11px] font-medium text-red-400">
                                  {item.error}
                                </p>
                              )}
                            </div>

                            {isLockedSale ? (
                              <span className="font-mono-num shrink-0 font-semibold text-zinc-200">
                                {item.quantity} un.
                              </span>
                            ) : (
                              <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                                <button
                                  type="button"
                                  disabled={item.quantity <= 1}
                                  onClick={() =>
                                    handleUpdateSaleItemQty(
                                      item.productId,
                                      Math.max(1, item.quantity - 1)
                                    )
                                  }
                                  aria-label="Diminuir quantidade"
                                  className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  value={item.quantity}
                                  onChange={(e) =>
                                    handleUpdateSaleItemQty(item.productId, Number(e.target.value))
                                  }
                                  aria-label="Quantidade do item"
                                  className="font-mono-num w-12 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-center text-xs text-zinc-100"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateSaleItemQty(item.productId, item.quantity + 1)
                                  }
                                  aria-label="Aumentar quantidade"
                                  className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSaleItem(item.productId)}
                                  aria-label="Remover item da venda"
                                  title="Remover da lista"
                                  className="ml-1 rounded p-1 text-zinc-500 hover:bg-red-950/60 hover:text-red-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!isLockedSale && saleItems.length > 0 && selectedDraftProduct && (
                    <p className="text-[11px] text-amber-400">
                      Você selecionou &ldquo;{selectedDraftProduct.name}&rdquo; acima. Clique em{' '}
                      <strong>Adicionar à Lista</strong> para incluí-lo nesta venda.
                    </p>
                  )}

                  {liveCostPreview.error && saleItems.length > 0 && (
                    <p className="text-xs font-medium text-red-400">{liveCostPreview.error}</p>
                  )}
                </div>
              </div>
            );
          })()}

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
                disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                value={originalSaleAmount || ''}
                onChange={(e) => handleSaleAmountChange(Number(e.target.value))}
                placeholder="0,00"
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
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
                disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                onClick={() =>
                  setPaymentSplits((prev) => [
                    ...prev,
                    {
                      method: 'DINHEIRO',
                      amount: Math.max(0, round2(originalSaleAmount - splitsSum)),
                    },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar Forma
              </button>
            </div>

            {paymentSplits.map((split, idx) => {
              const isLockedSale = Boolean(editingSale && !editSaleEligibility.allowed);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 sm:col-span-5">
                    <select
                      value={split.method}
                      disabled={isLockedSale}
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
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
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
                      disabled={isLockedSale}
                      value={split.amount || ''}
                      onChange={(e) =>
                        setPaymentSplits((prev) =>
                          prev.map((sp, i) =>
                            i === idx ? { ...sp, amount: Number(e.target.value) } : sp
                          )
                        )
                      }
                      placeholder="Valor (R$)"
                      className="font-mono-num w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  {split.method === 'CREDITO' ? (
                    <div className="col-span-3 sm:col-span-2">
                      <input
                        type="number"
                        min={1}
                        max={18}
                        disabled={isLockedSale}
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
                        className="font-mono-num w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  ) : (
                    <div className="col-span-3 sm:col-span-2" />
                  )}

                  <div className="col-span-2 flex items-center justify-end sm:col-span-1">
                    <button
                      type="button"
                      disabled={isLockedSale || paymentSplits.length === 1}
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
              );
            })}
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
                    disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                    value={ownCreditInterestPercent}
                    onChange={(e) => setOwnCreditInterestPercent(Number(e.target.value))}
                    className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
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
                    disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                    value={ownCreditInstallmentsCount}
                    onChange={(e) =>
                      setOwnCreditInstallmentsCount(Math.max(1, Number(e.target.value)))
                    }
                    className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300">
                    1º Vencimento
                  </label>
                  <input
                    type="date"
                    disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                    value={ownCreditFirstDueDate}
                    onChange={(e) => setOwnCreditFirstDueDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-300">
                    Intervalo de Pagamento
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <select
                      value={ownCreditIntervalType}
                      disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                      onChange={(e) =>
                        setOwnCreditIntervalType(e.target.value as OwnCreditIntervalType)
                      }
                      className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                    >
                      <option value="MONTHLY">Mensal</option>
                      <option value="DAYS">A cada X dias</option>
                    </select>
                    {ownCreditIntervalType === 'DAYS' && (
                      <input
                        type="number"
                        min={1}
                        max={365}
                        disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                        value={ownCreditIntervalDays}
                        onChange={(e) =>
                          setOwnCreditIntervalDays(Math.max(1, Number(e.target.value)))
                        }
                        title="Dias entre cada parcela"
                        aria-label="Dias entre cada parcela"
                        className="font-mono-num w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                      />
                    )}
                  </div>
                </div>
              </div>

              {ownCreditIntervalType === 'DAYS' && !(editingSale && !editSaleEligibility.allowed) && (
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
                      disabled={Boolean(editingSale && !editSaleEligibility.allowed)}
                      value={customDueDates[idx] || inst.dueDate}
                      onChange={(e) =>
                        setCustomDueDates((prev) =>
                          prev.map((d, i) => (i === idx ? e.target.value : d))
                        )
                      }
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!editingSale && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-3">
              <label className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-200 cursor-pointer">
                <span>Lançar comissão de vendedor(a) nesta venda</span>
                <input
                  type="checkbox"
                  checked={hasCommission}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHasCommission(checked);
                    if (checked && originalSaleAmount > 0 && commAmount <= 0) {
                      setCommAmount(round2((originalSaleAmount * commPercent) / 100));
                    }
                  }}
                  className="accent-emerald-500"
                />
              </label>

              {hasCommission && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-[11px] font-medium text-zinc-300">
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
                      value={commSellerId}
                      onChange={(e) => {
                        const sid = e.target.value;
                        setCommSellerId(sid);
                        const found = sellers.find((s) => s.id === sid);
                        if (found) {
                          setCommSellerName(found.fullName);
                          const cParts: string[] = [];
                          if (found.whatsapp.trim()) cParts.push(`WhatsApp: ${found.whatsapp.trim()}`);
                          else if (found.phone.trim()) cParts.push(`Tel: ${found.phone.trim()}`);
                          if (found.pixKey.trim()) cParts.push(`PIX: ${found.pixKey.trim()}`);
                          setCommSellerContact(cParts.join(' · ').slice(0, 120));
                          const pct = found.defaultCommissionPercent ?? 10;
                          setCommPercent(pct);
                          if (originalSaleAmount > 0 && pct > 0) {
                            setCommAmount(round2((originalSaleAmount * pct) / 100));
                          }
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">
                        {sellers.some((s) => s.active)
                          ? 'Selecionar vendedor cadastrado (ou digitar abaixo)...'
                          : 'Nenhum vendedor cadastrado — digite abaixo ou cadastre acima'}
                      </option>
                      {sellers
                        .filter((s) => s.active || s.id === commSellerId)
                        .sort((a, b) => a.fullName.localeCompare(b.fullName))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName} ({formatPercent(s.defaultCommissionPercent)})
                          </option>
                        ))}
                    </select>

                    {quickSellerOpen && (
                      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-2.5 space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="text"
                            value={quickSellerName}
                            onChange={(e) => setQuickSellerName(e.target.value)}
                            placeholder="Nome completo *"
                            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-500"
                          />
                          <input
                            type="text"
                            value={quickSellerWhatsapp}
                            onChange={(e) => setQuickSellerWhatsapp(e.target.value)}
                            placeholder="WhatsApp"
                            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-500"
                          />
                          <input
                            type="text"
                            value={quickSellerPix}
                            onChange={(e) => setQuickSellerPix(e.target.value)}
                            placeholder="Chave PIX (opcional)"
                            className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-500"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-zinc-400 shrink-0">Comissão %:</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              value={quickSellerPct}
                              onChange={(e) => setQuickSellerPct(Number(e.target.value))}
                              className="font-mono-num w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={savingQuickSeller || !quickSellerName.trim() || !user}
                            onClick={async () => {
                              if (!user || !quickSellerName.trim()) return;
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
                                setCommSellerId(newId);
                                setCommSellerName(quickSellerName.trim());
                                const cParts: string[] = [];
                                if (quickSellerWhatsapp.trim()) cParts.push(`WhatsApp: ${quickSellerWhatsapp.trim()}`);
                                if (quickSellerPix.trim()) cParts.push(`PIX: ${quickSellerPix.trim()}`);
                                setCommSellerContact(cParts.join(' · ').slice(0, 120));
                                setCommPercent(quickSellerPct);
                                if (originalSaleAmount > 0 && quickSellerPct > 0) {
                                  setCommAmount(round2((originalSaleAmount * quickSellerPct) / 100));
                                }
                                setQuickSellerName('');
                                setQuickSellerWhatsapp('');
                                setQuickSellerPix('');
                                setQuickSellerOpen(false);
                              } finally {
                                setSavingQuickSeller(false);
                              }
                            }}
                            className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {savingQuickSeller ? 'Salvando...' : 'Salvar e Selecionar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-zinc-300">
                        Nome do(a) Vendedor(a) *
                      </label>
                      <input
                        type="text"
                        value={commSellerName}
                        onChange={(e) => {
                          setCommSellerName(e.target.value);
                          setCommSellerId('');
                        }}
                        placeholder="Nome de quem vendeu"
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-zinc-300">
                        Comissão (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={commPercent || ''}
                        onChange={(e) => {
                          const pct = Number(e.target.value);
                          setCommPercent(pct);
                          if (originalSaleAmount > 0) {
                            setCommAmount(round2((originalSaleAmount * pct) / 100));
                          }
                        }}
                        className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-zinc-300">
                        Valor Comissão (R$) *
                      </label>
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={commAmount || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCommAmount(val);
                          if (originalSaleAmount > 0 && val >= 0) {
                            setCommPercent(round2((val / originalSaleAmount) * 100));
                          }
                        }}
                        className="font-mono-num mt-1 w-full rounded-lg border border-emerald-700/70 bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-zinc-300">
                        WhatsApp / PIX (opcional)
                      </label>
                      <input
                        type="text"
                        value={commSellerContact}
                        onChange={(e) => setCommSellerContact(e.target.value)}
                        placeholder="Para repasse"
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-zinc-300">
                        Vencimento no Financeiro
                      </label>
                      <input
                        type="date"
                        value={commDueDate}
                        onChange={(e) => setCommDueDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
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
              onClick={() => {
                setShowNewModal(false);
                setEditingSale(null);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(liveCostPreview.error)}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {submitting
                ? 'Salvando...'
                : editingSale
                  ? 'Salvar Alterações'
                  : 'Confirmar Venda'}
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
                  onClick={() => openEditSale(selectedSale)}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar Venda
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteSaleError(null);
                    setDeleteTargetSale(selectedSale);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir Venda
                </button>
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

      {/* Delete Sale Confirmation Modal */}
      <Modal
        open={Boolean(deleteTargetSale)}
        onClose={() => {
          if (!deletingSale) {
            setDeleteTargetSale(null);
            setDeleteSaleError(null);
          }
        }}
        title="Excluir Venda"
        subtitle={
          deleteTargetSale
            ? `${deleteTargetSale.documentNumber} · ${deleteTargetSale.clientName} (${formatCurrency(deleteTargetSale.originalSaleAmount)})`
            : undefined
        }
        maxWidth="md"
      >
        {deleteTargetSale && (
          <div className="space-y-4">
            {deleteSaleError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                {deleteSaleError}
              </div>
            )}

            <p className="text-xs text-zinc-300">
              Tem certeza que deseja excluir esta venda? Os produtos vendidos/reservados retornarão automaticamente para o estoque FIFO disponível e os lançamentos financeiros (recebíveis, pagamentos e recebimentos de cartão) vinculados a esta venda serão removidos.
            </p>

            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button
                type="button"
                disabled={deletingSale}
                onClick={() => {
                  setDeleteTargetSale(null);
                  setDeleteSaleError(null);
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingSale}
                onClick={handleConfirmDeleteSale}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deletingSale ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
