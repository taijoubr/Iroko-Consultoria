import {
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AppSettings,
  Brand,
  CardSettlement,
  Client,
  DeliveryStatus,
  Payable,
  PaymentSplit,
  PaymentStatus,
  Product,
  PurchaseBrand,
  PurchasePaymentMethod,
  Receivable,
  Sale,
  SaleItem,
  SalePaymentMethod,
  StockLot,
} from '../types';
import {
  allocateFifoFromLots,
  calculateOwnCreditPlan,
  calculatePurchaseFinancials,
  type PurchaseDraftItem,
} from '../utils/finance';
import {
  generateId,
  getTodayISO,
  round2,
  sanitizeStr,
} from '../utils/formatters';

export const DEFAULT_CATEGORIES = [
  'Perfumaria',
  'Maquiagem',
  'Cuidados com a Pele',
  'Corpo e Banho',
  'Cabelos',
  'Presentes',
  'Casa e Estilo',
  'Outros',
];

export async function ensureDefaultSettings(ownerId: string): Promise<void> {
  const ref = doc(db, 'settings', ownerId);
  try {
    const batch = writeBatch(db);
    batch.set(ref, {
      ownerId,
      boletoSurchargePercent: 5,
      boletoInstallment1Days: 24,
      boletoInstallment2Days: 45,
      refMonthlyInterestRate: 3,
      refAnnualInterestRate: 42.58,
      refMonthlyCet: 5.33,
      refAnnualCet: 88.25,
      refIofAmount: 2.98,
      sellerName: 'Iroko Consultoria',
      sellerDocument: '',
      sellerPhone: '',
      sellerEmail: '',
      sellerAddress: '',
      receiptHeader: 'Comprovante Oficial de Venda e Recebimento',
      receiptFooter: 'Obrigado pela preferência!',
      allowNegativeStock: false,
      categories: DEFAULT_CATEGORIES,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `settings/${ownerId}`);
  }
}

export async function updateSettingsWithHistory(
  ownerId: string,
  current: AppSettings,
  updates: Omit<AppSettings, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  summary: string
): Promise<void> {
  const settingsRef = doc(db, 'settings', current.id);
  const historyId = generateId('shist');
  const historyRef = doc(db, 'settingsHistory', historyId);

  try {
    const batch = writeBatch(db);
    batch.update(settingsRef, {
      boletoSurchargePercent: Number(updates.boletoSurchargePercent),
      boletoInstallment1Days: Math.max(1, Math.round(updates.boletoInstallment1Days)),
      boletoInstallment2Days: Math.max(1, Math.round(updates.boletoInstallment2Days)),
      refMonthlyInterestRate: Number(updates.refMonthlyInterestRate),
      refAnnualInterestRate: Number(updates.refAnnualInterestRate),
      refMonthlyCet: Number(updates.refMonthlyCet),
      refAnnualCet: Number(updates.refAnnualCet),
      refIofAmount: Number(updates.refIofAmount),
      sellerName: sanitizeStr(updates.sellerName, 120),
      sellerDocument: sanitizeStr(updates.sellerDocument, 32),
      sellerPhone: sanitizeStr(updates.sellerPhone, 32),
      sellerEmail: sanitizeStr(updates.sellerEmail, 120),
      sellerAddress: sanitizeStr(updates.sellerAddress, 240),
      receiptHeader: sanitizeStr(updates.receiptHeader, 240),
      receiptFooter: sanitizeStr(updates.receiptFooter, 240),
      allowNegativeStock: Boolean(updates.allowNegativeStock),
      categories: updates.categories.slice(0, 40).map((c) => sanitizeStr(c, 60)).filter(Boolean),
      updatedAt: serverTimestamp(),
    });

    batch.set(historyRef, {
      ownerId,
      changedAt: new Date().toISOString(),
      summary: sanitizeStr(summary, 500),
      previousValues: {
        boletoSurchargePercent: current.boletoSurchargePercent,
        boletoInstallment1Days: current.boletoInstallment1Days,
        boletoInstallment2Days: current.boletoInstallment2Days,
        refMonthlyInterestRate: current.refMonthlyInterestRate,
        refAnnualInterestRate: current.refAnnualInterestRate,
        refMonthlyCet: current.refMonthlyCet,
        refAnnualCet: current.refAnnualCet,
        refIofAmount: current.refIofAmount,
        sellerName: current.sellerName,
        allowNegativeStock: current.allowNegativeStock,
      },
      newValues: {
        boletoSurchargePercent: updates.boletoSurchargePercent,
        boletoInstallment1Days: updates.boletoInstallment1Days,
        boletoInstallment2Days: updates.boletoInstallment2Days,
        refMonthlyInterestRate: updates.refMonthlyInterestRate,
        refAnnualInterestRate: updates.refAnnualInterestRate,
        refMonthlyCet: updates.refMonthlyCet,
        refAnnualCet: updates.refAnnualCet,
        refIofAmount: updates.refIofAmount,
        sellerName: updates.sellerName,
        allowNegativeStock: updates.allowNegativeStock,
      },
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `settings/${current.id}`);
  }
}

export interface RegisterPurchaseInput {
  brand: PurchaseBrand;
  orderNumber: string;
  purchaseDate: string;
  billingDate: string;
  referenceDate: string;
  paymentMethod: PurchasePaymentMethod;
  overrideOriginalTotal?: number;
  notes: string;
  items: PurchaseDraftItem[];
}

export async function registerPurchase(
  ownerId: string,
  input: RegisterPurchaseInput,
  settings: AppSettings,
  existingProducts: Product[]
): Promise<string> {
  if (!input.orderNumber.trim()) {
    throw new Error('Informe o número do pedido.');
  }
  if (input.items.length === 0) {
    throw new Error('Adicione pelo menos um produto na compra.');
  }

  for (const item of input.items) {
    if (!item.name.trim()) throw new Error('Todos os produtos devem possuir um nome.');
    if (item.quantity <= 0) throw new Error(`Quantidade inválida para ${item.name}.`);
    if (item.qtyForClients + item.qtyForStock !== item.quantity) {
      throw new Error(
        `No produto "${item.name}", a soma de Qtd. para Clientes + Qtd. para Estoque deve ser igual à Quantidade (${item.quantity}).`
      );
    }
  }

  const calc = calculatePurchaseFinancials(
    input.items,
    input.paymentMethod,
    settings.boletoSurchargePercent,
    input.referenceDate || input.purchaseDate,
    settings.boletoInstallment1Days,
    settings.boletoInstallment2Days,
    input.overrideOriginalTotal
  );

  const purchaseId = generateId('pur');
  const batch = writeBatch(db);

  // Track cumulative updates if multiple lines in same purchase hit same product
  const productAccum = new Map<
    string,
    { refId: string; isNew: boolean; prod: Product; addAvail: number; addRes: number }
  >();

  const finalizedItems = calc.items.map((item) => {
    const normalizedName = item.name.trim().toLowerCase();
    const normalizedCode = item.code.trim().toLowerCase();

    let matched = existingProducts.find(
      (p) =>
        p.brand === item.brand &&
        ((normalizedCode && p.code.trim().toLowerCase() === normalizedCode) ||
          p.name.trim().toLowerCase() === normalizedName)
    );

    let productId = matched?.id || '';
    if (!productId) {
      // Check if created earlier in this same purchase
      const tempKey = `${item.brand}::${normalizedCode || normalizedName}`;
      const existingNew = Array.from(productAccum.values()).find(
        (entry) =>
          entry.prod.brand === item.brand &&
          ((normalizedCode && entry.prod.code.trim().toLowerCase() === normalizedCode) ||
            entry.prod.name.trim().toLowerCase() === normalizedName)
      );
      if (existingNew) {
        productId = existingNew.refId;
      } else {
        productId = generateId('prd');
        const newProd: Product = {
          id: productId,
          ownerId,
          name: sanitizeStr(item.name, 160),
          code: sanitizeStr(item.code, 64),
          brand: item.brand,
          category: sanitizeStr(item.category || 'Outros', 80),
          availableQty: 0,
          reservedQty: 0,
          deliveredQty: 0,
          personalConsumedQty: 0,
        };
        productAccum.set(tempKey, {
          refId: productId,
          isNew: true,
          prod: newProd,
          addAvail: 0,
          addRes: 0,
        });
      }
    } else if (!productAccum.has(productId)) {
      productAccum.set(productId, {
        refId: productId,
        isNew: false,
        prod: matched!,
        addAvail: 0,
        addRes: 0,
      });
    }

    const accumEntry = Array.from(productAccum.values()).find((e) => e.refId === productId)!;
    accumEntry.addAvail += item.qtyForStock;
    accumEntry.addRes += item.qtyForClients;

    // Create StockLot
    const lotId = generateId('lot');
    batch.set(doc(db, 'stockLots', lotId), {
      ownerId,
      productId,
      productName: sanitizeStr(item.name, 160),
      productCode: sanitizeStr(item.code, 64),
      brand: item.brand,
      purchaseId,
      purchaseOrderNumber: sanitizeStr(input.orderNumber, 64),
      purchaseDate: input.purchaseDate,
      initialQty: item.quantity,
      availableQty: item.qtyForStock,
      reservedQty: item.qtyForClients,
      deliveredQty: 0,
      consumedQty: 0,
      unitBaseCost: item.unitOriginalCost,
      unitFinancialCost: item.unitFinancialCost,
      unitEffectiveCost: item.unitEffectiveCost,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Movement: Purchase entry
    const movId = generateId('mov');
    batch.set(doc(db, 'stockMovements', movId), {
      ownerId,
      productId,
      productName: sanitizeStr(item.name, 160),
      brand: item.brand,
      lotId,
      type: 'ENTRADA_COMPRA',
      quantity: item.quantity,
      unitBaseCost: item.unitOriginalCost,
      unitFinancialCost: item.unitFinancialCost,
      unitEffectiveCost: item.unitEffectiveCost,
      totalEffectiveCost: item.totalEffectiveCost,
      referenceType: 'purchase',
      referenceId: purchaseId,
      date: input.purchaseDate,
      notes: sanitizeStr(`Entrada Pedido ${input.orderNumber} (${item.brand})`, 300),
      createdAt: serverTimestamp(),
    });

    if (item.qtyForClients > 0) {
      const resMovId = generateId('mov');
      batch.set(doc(db, 'stockMovements', resMovId), {
        ownerId,
        productId,
        productName: sanitizeStr(item.name, 160),
        brand: item.brand,
        lotId,
        type: 'RESERVA_CLIENTE',
        quantity: item.qtyForClients,
        unitBaseCost: item.unitOriginalCost,
        unitFinancialCost: item.unitFinancialCost,
        unitEffectiveCost: item.unitEffectiveCost,
        totalEffectiveCost: round2(item.qtyForClients * item.unitEffectiveCost),
        referenceType: 'purchase',
        referenceId: purchaseId,
        date: input.purchaseDate,
        notes: sanitizeStr(`Destinado a encomendas de clientes no Pedido ${input.orderNumber}`, 300),
        createdAt: serverTimestamp(),
      });
    }

    return {
      ...item,
      productId,
    };
  });

  // Upsert products
  for (const entry of productAccum.values()) {
    const pRef = doc(db, 'products', entry.refId);
    if (entry.isNew) {
      batch.set(pRef, {
        ownerId,
        name: entry.prod.name,
        code: entry.prod.code,
        brand: entry.prod.brand,
        category: entry.prod.category,
        availableQty: entry.addAvail,
        reservedQty: entry.addRes,
        deliveredQty: 0,
        personalConsumedQty: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(pRef, {
        availableQty: entry.prod.availableQty + entry.addAvail,
        reservedQty: entry.prod.reservedQty + entry.addRes,
        updatedAt: serverTimestamp(),
      });
    }
  }

  // Create Purchase doc
  batch.set(doc(db, 'purchases', purchaseId), {
    ownerId,
    brand: input.brand,
    orderNumber: sanitizeStr(input.orderNumber, 64),
    purchaseDate: input.purchaseDate,
    billingDate: input.billingDate || '',
    referenceDate: input.referenceDate || input.purchaseDate,
    paymentMethod: input.paymentMethod,
    originalTotal: calc.originalTotal,
    surchargePercentApplied: calc.surchargePercentApplied,
    surchargeAmount: calc.surchargeAmount,
    effectiveTotal: calc.effectiveTotal,
    financialParamsSnapshot: {
      refMonthlyInterestRate: settings.refMonthlyInterestRate,
      refAnnualInterestRate: settings.refAnnualInterestRate,
      refMonthlyCet: settings.refMonthlyCet,
      refAnnualCet: settings.refAnnualCet,
      refIofAmount: settings.refIofAmount,
      boletoInstallment1Days: settings.boletoInstallment1Days,
      boletoInstallment2Days: settings.boletoInstallment2Days,
    },
    itemsCount: finalizedItems.length,
    items: finalizedItems,
    notes: sanitizeStr(input.notes, 400),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Create Payables
  const payableType =
    input.brand === 'Avon'
      ? 'BOLETO_AVON'
      : input.brand === 'Natura'
        ? 'BOLETO_NATURA'
        : 'BOLETO_MISTO';

  for (const inst of calc.installments) {
    const payableId = generateId('payb');
    const isVista = input.paymentMethod === 'A_VISTA';
    batch.set(doc(db, 'payables', payableId), {
      ownerId,
      type: payableType,
      purchaseId,
      orderNumber: sanitizeStr(input.orderNumber, 64),
      description: sanitizeStr(
        isVista
          ? `Compra ${input.brand} Pedido ${input.orderNumber} (À vista)`
          : `Boleto ${input.brand} Pedido ${input.orderNumber} (${inst.installmentNumber}/${calc.installments.length})`,
        200
      ),
      installmentNumber: inst.installmentNumber,
      totalInstallments: calc.installments.length,
      dueDate: inst.dueDate,
      originalAmount: inst.originalAmount,
      interestAmount: inst.interestAmount,
      totalAmount: inst.totalAmount,
      paidAmount: isVista ? inst.totalAmount : 0,
      status: isVista ? 'PAGO' : 'PENDENTE',
      paidDate: isVista ? input.purchaseDate : '',
      category: `Compra ${input.brand}`,
      notes: sanitizeStr(input.notes, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return purchaseId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `purchases/${purchaseId}`);
  }
}

export async function updatePurchaseMetadata(
  purchaseId: string,
  billingDate: string,
  notes: string
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'purchases', purchaseId), {
      billingDate,
      notes: sanitizeStr(notes, 400),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `purchases/${purchaseId}`);
  }
}

export async function releaseLotReservationToAvailable(
  ownerId: string,
  product: Product,
  lot: StockLot,
  quantity: number
): Promise<void> {
  if (quantity <= 0 || quantity > lot.reservedQty) {
    throw new Error('Quantidade inválida para liberação de reserva.');
  }
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'stockLots', lot.id), {
      availableQty: lot.availableQty + quantity,
      reservedQty: lot.reservedQty - quantity,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'products', product.id), {
      availableQty: product.availableQty + quantity,
      reservedQty: Math.max(0, product.reservedQty - quantity),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'stockMovements', generateId('mov')), {
      ownerId,
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      lotId: lot.id,
      type: 'LIBERACAO_RESERVA',
      quantity,
      unitBaseCost: lot.unitBaseCost,
      unitFinancialCost: lot.unitFinancialCost,
      unitEffectiveCost: lot.unitEffectiveCost,
      totalEffectiveCost: round2(quantity * lot.unitEffectiveCost),
      referenceType: 'manual',
      referenceId: lot.purchaseId,
      date: getTodayISO(),
      notes: sanitizeStr(`Reserva liberada para estoque disponível (Lote ${lot.purchaseOrderNumber})`, 300),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `stockLots/${lot.id}`);
  }
}

export async function saveClient(
  ownerId: string,
  data: {
    fullName: string;
    phone: string;
    whatsapp: string;
    address: string;
    notes: string;
  },
  existingId?: string
): Promise<string> {
  if (!data.fullName.trim()) {
    throw new Error('O nome completo do cliente é obrigatório.');
  }
  const clientId = existingId || generateId('cli');
  const ref = doc(db, 'clients', clientId);

  try {
    const batch = writeBatch(db);
    if (existingId) {
      batch.update(ref, {
        fullName: sanitizeStr(data.fullName, 140),
        phone: sanitizeStr(data.phone, 32),
        whatsapp: sanitizeStr(data.whatsapp, 32),
        address: sanitizeStr(data.address, 240),
        notes: sanitizeStr(data.notes, 500),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        ownerId,
        fullName: sanitizeStr(data.fullName, 140),
        phone: sanitizeStr(data.phone, 32),
        whatsapp: sanitizeStr(data.whatsapp, 32),
        address: sanitizeStr(data.address, 240),
        registeredAt: getTodayISO(),
        notes: sanitizeStr(data.notes, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return clientId;
  } catch (err) {
    handleFirestoreError(err, existingId ? OperationType.UPDATE : OperationType.CREATE, `clients/${clientId}`);
  }
}

export interface RegisterSaleInput {
  client: Client;
  saleDate: string;
  items: { productId: string; quantity: number }[];
  originalSaleAmount: number;
  deliveryStatus: DeliveryStatus;
  paymentSplits: PaymentSplit[];
  ownCreditInterestPercent: number;
  ownCreditInstallmentsCount: number;
  ownCreditFirstDueDate: string;
  customDueDates?: string[];
  notes: string;
}

export async function registerSale(
  ownerId: string,
  input: RegisterSaleInput,
  products: Product[],
  lots: StockLot[],
  settings: AppSettings,
  existingSalesCount: number
): Promise<string> {
  if (!input.client) throw new Error('Selecione um cliente.');
  if (input.items.length === 0) throw new Error('Adicione ao menos um produto na venda.');
  if (input.originalSaleAmount <= 0) throw new Error('Informe o valor final da venda.');

  const splitsTotal = round2(input.paymentSplits.reduce((acc, s) => acc + s.amount, 0));
  if (splitsTotal > round2(input.originalSaleAmount + 0.01)) {
    throw new Error('A soma das formas de pagamento não pode ultrapassar o valor da venda.');
  }

  // Track lot mutations in memory before writing
  const workingLots = lots.map((l) => ({ ...l }));
  const saleItems: SaleItem[] = [];
  const productDeltas = new Map<string, { product: Product; deductAvail: number; addRes: number; addDeliv: number }>();

  for (const reqItem of input.items) {
    const product = products.find((p) => p.id === reqItem.productId);
    if (!product) throw new Error('Produto não encontrado no estoque.');

    const fifo = allocateFifoFromLots(
      workingLots,
      product.id,
      product.name,
      reqItem.quantity,
      settings.allowNegativeStock
    );

    // Apply lot deductions to workingLots so multiple lines of same product work cleanly
    for (const alloc of fifo.allocations) {
      if (alloc.lotId) {
        const wLot = workingLots.find((l) => l.id === alloc.lotId);
        if (wLot) {
          wLot.availableQty -= alloc.quantity;
          if (input.deliveryStatus === 'ENTREGUE') {
            wLot.deliveredQty += alloc.quantity;
          } else {
            wLot.reservedQty += alloc.quantity;
          }
        }
      }
    }

    const existingDelta = productDeltas.get(product.id) || {
      product,
      deductAvail: 0,
      addRes: 0,
      addDeliv: 0,
    };
    existingDelta.deductAvail += reqItem.quantity;
    if (input.deliveryStatus === 'ENTREGUE') {
      existingDelta.addDeliv += reqItem.quantity;
    } else {
      existingDelta.addRes += reqItem.quantity;
    }
    productDeltas.set(product.id, existingDelta);

    saleItems.push({
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      brand: product.brand,
      quantity: reqItem.quantity,
      unitBaseCost: fifo.unitBaseCostAvg,
      unitFinancialCost: fifo.unitFinancialCostAvg,
      unitEffectiveCost: fifo.unitEffectiveCostAvg,
      totalCost: fifo.totalEffectiveCost,
      lotAllocations: fifo.allocations,
    });
  }

  const totalProductCost = round2(saleItems.reduce((acc, i) => acc + i.totalCost, 0));
  const totalBaseCost = round2(
    saleItems.reduce((acc, i) => acc + i.quantity * i.unitBaseCost, 0)
  );
  const totalFinancialCost = round2(
    saleItems.reduce((acc, i) => acc + i.quantity * i.unitFinancialCost, 0)
  );

  // Own Credit calculation
  const ownCreditSplitAmount = round2(
    input.paymentSplits
      .filter((s) => s.method === 'CREDITO_PROPRIO')
      .reduce((acc, s) => acc + s.amount, 0)
  );
  const hasOwnCredit = ownCreditSplitAmount > 0;
  const ownCreditPlan = hasOwnCredit
    ? calculateOwnCreditPlan(
        ownCreditSplitAmount,
        input.ownCreditInterestPercent,
        input.ownCreditInstallmentsCount,
        input.ownCreditFirstDueDate
      )
    : null;

  const ownCreditInterestAmount = ownCreditPlan ? ownCreditPlan.interestAmount : 0;
  const ownCreditTotalDue = ownCreditPlan ? ownCreditPlan.totalDue : 0;
  const totalWithInterest = round2(input.originalSaleAmount + ownCreditInterestAmount);

  // Immediate payments (Dinheiro, PIX, Débito, Crédito)
  const immediateSplits = input.paymentSplits.filter((s) => s.method !== 'CREDITO_PROPRIO' && s.amount > 0);
  const immediatePaid = round2(immediateSplits.reduce((acc, s) => acc + s.amount, 0));
  const pendingAmount = round2(Math.max(0, totalWithInterest - immediatePaid));

  const paymentStatus: PaymentStatus =
    pendingAmount <= 0.01 ? 'PAGO' : immediatePaid > 0 ? 'PARCIAL' : 'PENDENTE';

  const year = input.saleDate.slice(0, 4) || String(new Date().getFullYear());
  const seq = String(existingSalesCount + 1).padStart(4, '0');
  const documentNumber = `VND-${year}-${seq}`;
  const saleId = generateId('sal');

  const batch = writeBatch(db);

  // Update mutated lots
  for (const wLot of workingLots) {
    const orig = lots.find((l) => l.id === wLot.id);
    if (
      orig &&
      (orig.availableQty !== wLot.availableQty ||
        orig.reservedQty !== wLot.reservedQty ||
        orig.deliveredQty !== wLot.deliveredQty)
    ) {
      batch.update(doc(db, 'stockLots', wLot.id), {
        availableQty: wLot.availableQty,
        reservedQty: wLot.reservedQty,
        deliveredQty: wLot.deliveredQty,
        updatedAt: serverTimestamp(),
      });
    }
  }

  // Update products
  for (const delta of productDeltas.values()) {
    batch.update(doc(db, 'products', delta.product.id), {
      availableQty: delta.product.availableQty - delta.deductAvail,
      reservedQty: delta.product.reservedQty + delta.addRes,
      deliveredQty: delta.product.deliveredQty + delta.addDeliv,
      updatedAt: serverTimestamp(),
    });
  }

  // Stock movements
  for (const item of saleItems) {
    for (const alloc of item.lotAllocations) {
      batch.set(doc(db, 'stockMovements', generateId('mov')), {
        ownerId,
        productId: item.productId,
        productName: item.productName,
        brand: item.brand,
        lotId: alloc.lotId,
        type: input.deliveryStatus === 'ENTREGUE' ? 'SAIDA_VENDA' : 'RESERVA_CLIENTE',
        quantity: alloc.quantity,
        unitBaseCost: alloc.unitBaseCost,
        unitFinancialCost: alloc.unitFinancialCost,
        unitEffectiveCost: alloc.unitEffectiveCost,
        totalEffectiveCost: round2(alloc.quantity * alloc.unitEffectiveCost),
        referenceType: 'sale',
        referenceId: saleId,
        date: input.saleDate,
        notes: sanitizeStr(
          `${input.deliveryStatus === 'ENTREGUE' ? 'Venda entregue' : 'Venda reservada'} ${documentNumber} — ${input.client.fullName}`,
          300
        ),
        createdAt: serverTimestamp(),
      });
    }
  }

  // Create Sale
  batch.set(doc(db, 'sales', saleId), {
    ownerId,
    documentNumber,
    clientId: input.client.id,
    clientName: sanitizeStr(input.client.fullName, 140),
    saleDate: input.saleDate,
    items: saleItems,
    originalSaleAmount: round2(input.originalSaleAmount),
    totalProductCost,
    totalBaseCost,
    totalFinancialCost,
    hasOwnCredit,
    ownCreditAmount: ownCreditSplitAmount,
    ownCreditInterestPercent: hasOwnCredit ? Number(input.ownCreditInterestPercent) : 0,
    ownCreditInterestAmount,
    ownCreditTotalDue,
    ownCreditInstallmentsCount: ownCreditPlan ? ownCreditPlan.installments.length : 0,
    totalWithInterest,
    grossProfitOnProducts: round2(input.originalSaleAmount - totalProductCost),
    paymentSplits: input.paymentSplits.map((s) => ({
      method: s.method,
      amount: round2(s.amount),
      ...(s.cardInstallments ? { cardInstallments: s.cardInstallments } : {}),
    })),
    paidAmount: immediatePaid,
    pendingAmount,
    paymentStatus,
    deliveryStatus: input.deliveryStatus,
    deliveryDate: input.deliveryStatus === 'ENTREGUE' ? input.saleDate : '',
    notes: sanitizeStr(input.notes, 500),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Immediate Payments & CardSettlements
  immediateSplits.forEach((split, idx) => {
    const payId = generateId('pay');
    batch.set(doc(db, 'payments', payId), {
      ownerId,
      receiptNumber: `REC-${year}-${seq}-${idx + 1}`,
      saleId,
      receivableId: '',
      clientId: input.client.id,
      clientName: sanitizeStr(input.client.fullName, 140),
      paymentDate: input.saleDate,
      method: split.method,
      amount: round2(split.amount),
      principalPortion: round2(split.amount),
      interestPortion: 0,
      installmentNumber: 0,
      totalInstallments: 0,
      notes: sanitizeStr(`Pagamento na venda ${documentNumber}`, 300),
      createdAt: serverTimestamp(),
    });

    if (split.method === 'DEBITO' || split.method === 'CREDITO') {
      const settlementId = generateId('card');
      batch.set(doc(db, 'cardSettlements', settlementId), {
        ownerId,
        saleId,
        saleDocumentNumber: documentNumber,
        clientName: sanitizeStr(input.client.fullName, 140),
        saleDate: input.saleDate,
        cardMethod: split.method,
        installments: split.cardInstallments || 1,
        grossCardAmount: round2(split.amount),
        status: 'AGUARDANDO',
        settlementDate: '',
        netDepositedAmount: 0,
        feeAmount: 0,
        operatorName: '',
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  // Own credit receivables
  if (ownCreditPlan) {
    ownCreditPlan.installments.forEach((inst, idx) => {
      const dueDate =
        input.customDueDates && input.customDueDates[idx]
          ? input.customDueDates[idx]
          : inst.dueDate;
      batch.set(doc(db, 'receivables', generateId('rec')), {
        ownerId,
        saleId,
        documentNumber,
        clientId: input.client.id,
        clientName: sanitizeStr(input.client.fullName, 140),
        type: 'CREDITO_PROPRIO',
        installmentNumber: inst.installmentNumber,
        totalInstallments: ownCreditPlan.installments.length,
        dueDate,
        principalAmount: inst.principalAmount,
        interestAmount: inst.interestAmount,
        totalAmount: inst.totalAmount,
        paidAmount: 0,
        status: 'PENDENTE',
        dueDateHistory: [],
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  // Remaining unallocated balance (when partial payment without Crédito Próprio)
  const unallocatedRemainder = round2(input.originalSaleAmount - splitsTotal);
  if (unallocatedRemainder > 0.01) {
    batch.set(doc(db, 'receivables', generateId('rec')), {
      ownerId,
      saleId,
      documentNumber,
      clientId: input.client.id,
      clientName: sanitizeStr(input.client.fullName, 140),
      type: 'SALDO_VENDA',
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate: input.ownCreditFirstDueDate || input.saleDate,
      principalAmount: unallocatedRemainder,
      interestAmount: 0,
      totalAmount: unallocatedRemainder,
      paidAmount: 0,
      status: 'PENDENTE',
      dueDateHistory: [],
      notes: 'Saldo em aberto da venda',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return saleId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `sales/${saleId}`);
  }
}

export async function markSaleAsDelivered(
  ownerId: string,
  sale: Sale,
  products: Product[],
  lots: StockLot[],
  deliveryDate: string
): Promise<void> {
  if (sale.deliveryStatus === 'ENTREGUE') return;

  const batch = writeBatch(db);
  const workingLots = lots.map((l) => ({ ...l }));

  for (const item of sale.items) {
    const product = products.find((p) => p.id === item.productId);
    if (product) {
      batch.update(doc(db, 'products', product.id), {
        reservedQty: Math.max(0, product.reservedQty - item.quantity),
        deliveredQty: product.deliveredQty + item.quantity,
        updatedAt: serverTimestamp(),
      });
    }

    for (const alloc of item.lotAllocations) {
      if (alloc.lotId) {
        const lot = workingLots.find((l) => l.id === alloc.lotId);
        if (lot) {
          lot.reservedQty = Math.max(0, lot.reservedQty - alloc.quantity);
          lot.deliveredQty += alloc.quantity;
        }
      }

      batch.set(doc(db, 'stockMovements', generateId('mov')), {
        ownerId,
        productId: item.productId,
        productName: item.productName,
        brand: item.brand,
        lotId: alloc.lotId,
        type: 'SAIDA_VENDA',
        quantity: alloc.quantity,
        unitBaseCost: alloc.unitBaseCost,
        unitFinancialCost: alloc.unitFinancialCost,
        unitEffectiveCost: alloc.unitEffectiveCost,
        totalEffectiveCost: round2(alloc.quantity * alloc.unitEffectiveCost),
        referenceType: 'sale',
        referenceId: sale.id,
        date: deliveryDate,
        notes: sanitizeStr(`Entrega confirmada — ${sale.documentNumber} (${sale.clientName})`, 300),
        createdAt: serverTimestamp(),
      });
    }
  }

  for (const wLot of workingLots) {
    const orig = lots.find((l) => l.id === wLot.id);
    if (orig && (orig.reservedQty !== wLot.reservedQty || orig.deliveredQty !== wLot.deliveredQty)) {
      batch.update(doc(db, 'stockLots', wLot.id), {
        reservedQty: wLot.reservedQty,
        deliveredQty: wLot.deliveredQty,
        updatedAt: serverTimestamp(),
      });
    }
  }

  batch.update(doc(db, 'sales', sale.id), {
    deliveryStatus: 'ENTREGUE',
    deliveryDate,
    notes: sale.notes,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sales/${sale.id}`);
  }
}

export async function registerReceivablePayment(
  ownerId: string,
  sale: Sale,
  receivable: Receivable,
  amount: number,
  paymentDate: string,
  method: SalePaymentMethod,
  notes: string,
  existingPaymentsCount: number
): Promise<string> {
  const remainingOnRec = round2(receivable.totalAmount - receivable.paidAmount);
  if (amount <= 0) throw new Error('O valor do pagamento deve ser maior que zero.');
  if (amount > round2(remainingOnRec + 0.01)) {
    throw new Error(`Valor excede o saldo da parcela (${remainingOnRec.toFixed(2)}).`);
  }

  const effectivePay = round2(Math.min(amount, remainingOnRec));
  const newRecPaid = round2(receivable.paidAmount + effectivePay);
  const newRecStatus: PaymentStatus =
    newRecPaid >= round2(receivable.totalAmount - 0.01) ? 'PAGO' : 'PARCIAL';

  // Proportional principal vs interest split
  const interestRatio =
    receivable.totalAmount > 0 ? receivable.interestAmount / receivable.totalAmount : 0;
  const interestPortion = round2(effectivePay * interestRatio);
  const principalPortion = round2(effectivePay - interestPortion);

  const newSalePaid = round2(Math.min(sale.totalWithInterest, sale.paidAmount + effectivePay));
  const newSalePending = round2(Math.max(0, sale.totalWithInterest - newSalePaid));
  const newSaleStatus: PaymentStatus =
    newSalePending <= 0.01 ? 'PAGO' : newSalePaid > 0 ? 'PARCIAL' : 'PENDENTE';

  const year = paymentDate.slice(0, 4) || String(new Date().getFullYear());
  const receiptNumber = `REC-${year}-${String(existingPaymentsCount + 1).padStart(4, '0')}`;
  const payId = generateId('pay');

  const batch = writeBatch(db);

  batch.set(doc(db, 'payments', payId), {
    ownerId,
    receiptNumber,
    saleId: sale.id,
    receivableId: receivable.id,
    clientId: sale.clientId,
    clientName: sale.clientName,
    paymentDate,
    method,
    amount: effectivePay,
    principalPortion,
    interestPortion,
    installmentNumber: receivable.installmentNumber,
    totalInstallments: receivable.totalInstallments,
    notes: sanitizeStr(notes || `Baixa parcela ${receivable.installmentNumber}/${receivable.totalInstallments}`, 300),
    createdAt: serverTimestamp(),
  });

  if (method === 'DEBITO' || method === 'CREDITO') {
    batch.set(doc(db, 'cardSettlements', generateId('card')), {
      ownerId,
      saleId: sale.id,
      saleDocumentNumber: sale.documentNumber,
      clientName: sale.clientName,
      saleDate: paymentDate,
      cardMethod: method,
      installments: 1,
      grossCardAmount: effectivePay,
      status: 'AGUARDANDO',
      settlementDate: '',
      netDepositedAmount: 0,
      feeAmount: 0,
      operatorName: '',
      notes: sanitizeStr(`Recebimento de parcela ${receivable.installmentNumber}/${receivable.totalInstallments}`, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'receivables', receivable.id), {
    paidAmount: newRecPaid,
    status: newRecStatus,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'sales', sale.id), {
    paidAmount: newSalePaid,
    pendingAmount: newSalePending,
    paymentStatus: newSaleStatus,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return payId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `payments/${payId}`);
  }
}

export async function registerAdvanceFullPayment(
  ownerId: string,
  sale: Sale,
  openReceivables: Receivable[],
  paymentDate: string,
  method: SalePaymentMethod,
  notes: string,
  existingPaymentsCount: number
): Promise<void> {
  if (openReceivables.length === 0) throw new Error('Não há parcelas em aberto para quitar.');

  const totalToPay = round2(
    openReceivables.reduce((acc, r) => acc + Math.max(0, r.totalAmount - r.paidAmount), 0)
  );
  if (totalToPay <= 0) throw new Error('Saldo já quitado.');

  const batch = writeBatch(db);
  const year = paymentDate.slice(0, 4) || String(new Date().getFullYear());
  let seq = existingPaymentsCount + 1;

  for (const rec of openReceivables) {
    const rem = round2(rec.totalAmount - rec.paidAmount);
    if (rem <= 0) continue;

    const interestRatio = rec.totalAmount > 0 ? rec.interestAmount / rec.totalAmount : 0;
    const interestPortion = round2(rem * interestRatio);
    const principalPortion = round2(rem - interestPortion);

    batch.set(doc(db, 'payments', generateId('pay')), {
      ownerId,
      receiptNumber: `REC-${year}-${String(seq++).padStart(4, '0')}`,
      saleId: sale.id,
      receivableId: rec.id,
      clientId: sale.clientId,
      clientName: sale.clientName,
      paymentDate,
      method,
      amount: rem,
      principalPortion,
      interestPortion,
      installmentNumber: rec.installmentNumber,
      totalInstallments: rec.totalInstallments,
      notes: sanitizeStr(notes || `Quitação antecipada integral — ${sale.documentNumber}`, 300),
      createdAt: serverTimestamp(),
    });

    batch.update(doc(db, 'receivables', rec.id), {
      paidAmount: rec.totalAmount,
      status: 'PAGO',
      updatedAt: serverTimestamp(),
    });
  }

  if (method === 'DEBITO' || method === 'CREDITO') {
    batch.set(doc(db, 'cardSettlements', generateId('card')), {
      ownerId,
      saleId: sale.id,
      saleDocumentNumber: sale.documentNumber,
      clientName: sale.clientName,
      saleDate: paymentDate,
      cardMethod: method,
      installments: 1,
      grossCardAmount: totalToPay,
      status: 'AGUARDANDO',
      settlementDate: '',
      netDepositedAmount: 0,
      feeAmount: 0,
      operatorName: '',
      notes: sanitizeStr(`Quitação antecipada ${sale.documentNumber}`, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'sales', sale.id), {
    paidAmount: sale.totalWithInterest,
    pendingAmount: 0,
    paymentStatus: 'PAGO',
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sales/${sale.id}`);
  }
}

export async function updateReceivableDueDate(
  receivable: Receivable,
  newDueDate: string,
  reason: string
): Promise<void> {
  if (!newDueDate) throw new Error('Informe a nova data de vencimento.');
  const updatedHistory = [
    ...receivable.dueDateHistory,
    {
      oldDate: receivable.dueDate,
      newDate: newDueDate,
      changedAt: new Date().toISOString(),
      reason: sanitizeStr(reason || 'Renegociação de vencimento', 150),
    },
  ].slice(-30);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'receivables', receivable.id), {
      dueDate: newDueDate,
      dueDateHistory: updatedHistory,
      notes: receivable.notes,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `receivables/${receivable.id}`);
  }
}

export async function settleCardOperator(
  settlement: CardSettlement,
  settlementDate: string,
  netDepositedAmount: number,
  operatorName: string,
  notes: string
): Promise<void> {
  if (netDepositedAmount < 0 || netDepositedAmount > settlement.grossCardAmount) {
    throw new Error('O valor depositado não pode ser negativo nem maior que o valor bruto da venda no cartão.');
  }
  const feeAmount = round2(settlement.grossCardAmount - netDepositedAmount);
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'cardSettlements', settlement.id), {
      status: 'RECEBIDO',
      settlementDate,
      netDepositedAmount: round2(netDepositedAmount),
      feeAmount,
      operatorName: sanitizeStr(operatorName, 80),
      notes: sanitizeStr(notes, 300),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `cardSettlements/${settlement.id}`);
  }
}

export async function registerPayablePayment(
  payable: Payable,
  payAmount: number,
  paidDate: string,
  notes: string
): Promise<void> {
  const remaining = round2(payable.totalAmount - payable.paidAmount);
  if (payAmount <= 0 || payAmount > round2(remaining + 0.01)) {
    throw new Error('Valor inválido para pagamento.');
  }
  const newPaid = round2(payable.paidAmount + Math.min(payAmount, remaining));
  const newStatus: PaymentStatus =
    newPaid >= round2(payable.totalAmount - 0.01) ? 'PAGO' : 'PARCIAL';

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'payables', payable.id), {
      paidAmount: newPaid,
      status: newStatus,
      paidDate,
      dueDate: payable.dueDate,
      notes: sanitizeStr(notes || payable.notes, 300),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payables/${payable.id}`);
  }
}

export async function createManualExpense(
  ownerId: string,
  data: {
    description: string;
    category: string;
    dueDate: string;
    amount: number;
    paidNow: boolean;
    paidDate: string;
    notes: string;
  }
): Promise<void> {
  if (!data.description.trim() || data.amount <= 0) {
    throw new Error('Informe descrição e valor válido para a despesa.');
  }
  const payableId = generateId('exp');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'payables', payableId), {
      ownerId,
      type: 'DESPESA',
      purchaseId: '',
      orderNumber: '',
      description: sanitizeStr(data.description, 200),
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate: data.dueDate,
      originalAmount: round2(data.amount),
      interestAmount: 0,
      totalAmount: round2(data.amount),
      paidAmount: data.paidNow ? round2(data.amount) : 0,
      status: data.paidNow ? 'PAGO' : 'PENDENTE',
      paidDate: data.paidNow ? data.paidDate || data.dueDate : '',
      category: sanitizeStr(data.category || 'Despesa Operacional', 80),
      notes: sanitizeStr(data.notes, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `payables/${payableId}`);
  }
}

export async function registerPersonalConsumption(
  ownerId: string,
  product: Product,
  lots: StockLot[],
  quantity: number,
  date: string,
  notes: string,
  allowNegativeStock: boolean
): Promise<void> {
  if (quantity <= 0) throw new Error('Informe uma quantidade maior que zero.');

  const fifo = allocateFifoFromLots(
    lots,
    product.id,
    product.name,
    quantity,
    allowNegativeStock
  );

  const consumptionId = generateId('cons');
  const batch = writeBatch(db);

  for (const alloc of fifo.allocations) {
    if (alloc.lotId) {
      const lot = lots.find((l) => l.id === alloc.lotId);
      if (lot) {
        batch.update(doc(db, 'stockLots', lot.id), {
          availableQty: lot.availableQty - alloc.quantity,
          consumedQty: lot.consumedQty + alloc.quantity,
          updatedAt: serverTimestamp(),
        });
      }
    }

    batch.set(doc(db, 'stockMovements', generateId('mov')), {
      ownerId,
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      lotId: alloc.lotId,
      type: 'CONSUMO_PROPRIO',
      quantity: alloc.quantity,
      unitBaseCost: alloc.unitBaseCost,
      unitFinancialCost: alloc.unitFinancialCost,
      unitEffectiveCost: alloc.unitEffectiveCost,
      totalEffectiveCost: round2(alloc.quantity * alloc.unitEffectiveCost),
      referenceType: 'consumption',
      referenceId: consumptionId,
      date,
      notes: sanitizeStr(notes || 'Retirada para consumo próprio do administrador', 300),
      createdAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'products', product.id), {
    availableQty: product.availableQty - quantity,
    personalConsumedQty: product.personalConsumedQty + quantity,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'personalConsumptions', consumptionId), {
    ownerId,
    date,
    productId: product.id,
    productName: product.name,
    productCode: product.code,
    brand: product.brand,
    quantity,
    unitEffectiveCost: fifo.unitEffectiveCostAvg,
    totalCost: fifo.totalEffectiveCost,
    lotAllocations: fifo.allocations,
    notes: sanitizeStr(notes, 300),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `personalConsumptions/${consumptionId}`);
  }
}
