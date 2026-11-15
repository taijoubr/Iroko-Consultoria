import type {
  Brand,
  LotAllocation,
  PurchaseItem,
  PurchasePaymentMethod,
  StockLot,
} from '../types';
import { addDaysISO, addMonthsISO, round2 } from './formatters';

export interface PurchaseDraftItem {
  productId?: string;
  name: string;
  code: string;
  brand: Brand;
  category: string;
  quantity: number;
  unitOriginalCost: number;
  qtyForClients: number;
  qtyForStock: number;
}

export interface CalculatedPurchase {
  originalTotal: number;
  surchargePercentApplied: number;
  surchargeAmount: number;
  effectiveTotal: number;
  items: PurchaseItem[];
  installments: {
    installmentNumber: number;
    dueDate: string;
    originalAmount: number;
    interestAmount: number;
    totalAmount: number;
  }[];
}

export function calculatePurchaseFinancials(
  draftItems: PurchaseDraftItem[],
  paymentMethod: PurchasePaymentMethod,
  surchargePercent: number,
  referenceDate: string,
  installment1Days: number,
  installment2Days: number,
  overrideOriginalTotal?: number
): CalculatedPurchase {
  const sumItemsOriginal = round2(
    draftItems.reduce((acc, item) => acc + item.quantity * item.unitOriginalCost, 0)
  );
  const originalTotal =
    overrideOriginalTotal !== undefined && overrideOriginalTotal > 0
      ? round2(overrideOriginalTotal)
      : sumItemsOriginal;

  const appliedPercent = paymentMethod === 'BOLETO_2X' ? surchargePercent : 0;
  const surchargeAmount =
    paymentMethod === 'BOLETO_2X' ? round2(originalTotal * (appliedPercent / 100)) : 0;
  const effectiveTotal = round2(originalTotal + surchargeAmount);

  // Prorate financial surcharge across items proportionally by item subtotal
  let remainingSurcharge = surchargeAmount;
  const denominator = sumItemsOriginal > 0 ? sumItemsOriginal : 1;

  const items: PurchaseItem[] = draftItems.map((item, idx) => {
    const itemOriginalTotal = round2(item.quantity * item.unitOriginalCost);
    let allocatedFinancialCost = 0;
    if (surchargeAmount > 0) {
      if (idx === draftItems.length - 1) {
        allocatedFinancialCost = round2(remainingSurcharge);
      } else {
        allocatedFinancialCost = round2(surchargeAmount * (itemOriginalTotal / denominator));
        remainingSurcharge = round2(remainingSurcharge - allocatedFinancialCost);
      }
    }

    const totalEffectiveCost = round2(itemOriginalTotal + allocatedFinancialCost);
    const unitFinancialCost =
      item.quantity > 0 ? round2(allocatedFinancialCost / item.quantity) : 0;
    const unitEffectiveCost =
      item.quantity > 0 ? round2(totalEffectiveCost / item.quantity) : 0;

    return {
      productId: item.productId || '',
      name: item.name.trim(),
      code: item.code.trim(),
      brand: item.brand,
      category: item.category || 'Outros',
      quantity: item.quantity,
      unitOriginalCost: round2(item.unitOriginalCost),
      totalOriginalCost: itemOriginalTotal,
      allocatedFinancialCost,
      unitFinancialCost,
      unitEffectiveCost,
      totalEffectiveCost,
      qtyForClients: item.qtyForClients,
      qtyForStock: item.qtyForStock,
    };
  });

  if (paymentMethod === 'A_VISTA') {
    return {
      originalTotal,
      surchargePercentApplied: 0,
      surchargeAmount: 0,
      effectiveTotal: originalTotal,
      items,
      installments: [
        {
          installmentNumber: 1,
          dueDate: referenceDate,
          originalAmount: originalTotal,
          interestAmount: 0,
          totalAmount: originalTotal,
        },
      ],
    };
  }

  // Boleto 2x: divide total into 2 equal installments with exact cent reconciliation
  const p1Total = round2(effectiveTotal / 2);
  const p2Total = round2(effectiveTotal - p1Total);
  const p1Principal = round2(originalTotal / 2);
  const p2Principal = round2(originalTotal - p1Principal);
  const p1Interest = round2(p1Total - p1Principal);
  const p2Interest = round2(p2Total - p2Principal);

  return {
    originalTotal,
    surchargePercentApplied: appliedPercent,
    surchargeAmount,
    effectiveTotal,
    items,
    installments: [
      {
        installmentNumber: 1,
        dueDate: addDaysISO(referenceDate, installment1Days),
        originalAmount: p1Principal,
        interestAmount: p1Interest,
        totalAmount: p1Total,
      },
      {
        installmentNumber: 2,
        dueDate: addDaysISO(referenceDate, installment2Days),
        originalAmount: p2Principal,
        interestAmount: p2Interest,
        totalAmount: p2Total,
      },
    ],
  };
}

export interface OwnCreditPlanItem {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
}

export interface OwnCreditPlan {
  financedAmount: number;
  interestPercent: number;
  interestAmount: number;
  totalDue: number;
  installments: OwnCreditPlanItem[];
}

export type OwnCreditIntervalType = 'MONTHLY' | 'DAYS';

export function calculateOwnCreditPlan(
  financedAmount: number,
  interestPercent: number,
  installmentsCount: number,
  firstDueDate: string,
  intervalType: OwnCreditIntervalType = 'MONTHLY',
  intervalDays: number = 30
): OwnCreditPlan {
  const safeFinanced = round2(Math.max(0, financedAmount));
  const safePct = Math.max(0, interestPercent);
  const count = Math.max(1, Math.floor(installmentsCount));
  const safeIntervalDays = Math.max(1, Math.floor(intervalDays || 1));

  // Simple interest applied once on original financed amount
  const interestAmount = round2(safeFinanced * (safePct / 100));
  const totalDue = round2(safeFinanced + interestAmount);

  const installments: OwnCreditPlanItem[] = [];
  let remainingPrincipal = safeFinanced;
  let remainingInterest = interestAmount;
  let remainingTotal = totalDue;

  const basePrincipal = round2(safeFinanced / count);
  const baseInterest = round2(interestAmount / count);
  const baseTotal = round2(totalDue / count);

  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    const total = isLast ? round2(remainingTotal) : baseTotal;
    const principal = isLast ? round2(remainingPrincipal) : basePrincipal;
    const interest = isLast ? round2(total - principal) : round2(baseInterest);

    remainingPrincipal = round2(remainingPrincipal - principal);
    remainingInterest = round2(remainingInterest - interest);
    remainingTotal = round2(remainingTotal - total);

    const dueDate =
      intervalType === 'DAYS'
        ? addDaysISO(firstDueDate, (i - 1) * safeIntervalDays)
        : addMonthsISO(firstDueDate, i - 1);

    installments.push({
      installmentNumber: i,
      dueDate,
      principalAmount: principal,
      interestAmount: interest,
      totalAmount: total,
    });
  }

  return {
    financedAmount: safeFinanced,
    interestPercent: safePct,
    interestAmount,
    totalDue,
    installments,
  };
}

export interface FifoAllocationResult {
  allocations: LotAllocation[];
  totalBaseCost: number;
  totalFinancialCost: number;
  totalEffectiveCost: number;
  unitBaseCostAvg: number;
  unitFinancialCostAvg: number;
  unitEffectiveCostAvg: number;
}

export function allocateFifoFromLots(
  allLots: StockLot[],
  productId: string,
  productName: string,
  requestedQty: number,
  allowNegativeStock: boolean
): FifoAllocationResult {
  if (requestedQty <= 0) {
    throw new Error(`Quantidade inválida para o produto ${productName}.`);
  }

  const productLots = allLots
    .filter((l) => l.productId === productId)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));

  const totalAvailable = productLots.reduce((acc, l) => acc + Math.max(0, l.availableQty), 0);

  if (totalAvailable < requestedQty && !allowNegativeStock) {
    throw new Error(
      `Estoque insuficiente para "${productName}". Disponível: ${totalAvailable} un., Solicitado: ${requestedQty} un. Habilite estoque negativo nas Configurações ou registre uma compra.`
    );
  }

  let remaining = requestedQty;
  const allocations: LotAllocation[] = [];

  for (const lot of productLots) {
    if (remaining <= 0) break;
    if (lot.availableQty <= 0) continue;

    const take = Math.min(remaining, lot.availableQty);
    allocations.push({
      lotId: lot.id,
      quantity: take,
      unitBaseCost: lot.unitBaseCost,
      unitFinancialCost: lot.unitFinancialCost,
      unitEffectiveCost: lot.unitEffectiveCost,
    });
    remaining -= take;
  }

  if (remaining > 0 && allowNegativeStock) {
    const fallbackLot = productLots[productLots.length - 1];
    allocations.push({
      lotId: fallbackLot ? fallbackLot.id : '',
      quantity: remaining,
      unitBaseCost: fallbackLot ? fallbackLot.unitBaseCost : 0,
      unitFinancialCost: fallbackLot ? fallbackLot.unitFinancialCost : 0,
      unitEffectiveCost: fallbackLot ? fallbackLot.unitEffectiveCost : 0,
    });
  }

  const totalBaseCost = round2(
    allocations.reduce((acc, a) => acc + a.quantity * a.unitBaseCost, 0)
  );
  const totalFinancialCost = round2(
    allocations.reduce((acc, a) => acc + a.quantity * a.unitFinancialCost, 0)
  );
  const totalEffectiveCost = round2(
    allocations.reduce((acc, a) => acc + a.quantity * a.unitEffectiveCost, 0)
  );

  return {
    allocations,
    totalBaseCost,
    totalFinancialCost,
    totalEffectiveCost,
    unitBaseCostAvg: round2(totalBaseCost / requestedQty),
    unitFinancialCostAvg: round2(totalFinancialCost / requestedQty),
    unitEffectiveCostAvg: round2(totalEffectiveCost / requestedQty),
  };
}
