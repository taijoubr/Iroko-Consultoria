import type { Timestamp } from 'firebase/firestore';

export type Brand = 'Avon' | 'Natura';
export type PurchaseBrand = 'Avon' | 'Natura' | 'Mista';
export type PurchasePaymentMethod = 'A_VISTA' | 'BOLETO_2X';
export type SalePaymentMethod = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'CREDITO_PROPRIO';
export type PaymentStatus = 'PAGO' | 'PARCIAL' | 'PENDENTE';
export type DeliveryStatus = 'ENTREGUE' | 'PENDENTE' | 'RESERVADO';
export type StockMovementType =
  | 'ENTRADA_COMPRA'
  | 'RESERVA_CLIENTE'
  | 'LIBERACAO_RESERVA'
  | 'SAIDA_VENDA'
  | 'CONSUMO_PROPRIO'
  | 'AJUSTE';

export interface AppSettings {
  id: string;
  ownerId: string;
  boletoSurchargePercent: number;
  boletoInstallment1Days: number;
  boletoInstallment2Days: number;
  refMonthlyInterestRate: number;
  refAnnualInterestRate: number;
  refMonthlyCet: number;
  refAnnualCet: number;
  refIofAmount: number;
  sellerName: string;
  sellerDocument: string;
  sellerPhone: string;
  sellerEmail: string;
  sellerAddress: string;
  receiptHeader: string;
  receiptFooter: string;
  allowNegativeStock: boolean;
  categories: string[];
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface SettingsHistory {
  id: string;
  ownerId: string;
  changedAt: string;
  summary: string;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  createdAt?: Timestamp | unknown;
}

export interface Product {
  id: string;
  ownerId: string;
  name: string;
  code: string;
  brand: Brand;
  category: string;
  availableQty: number;
  reservedQty: number;
  deliveredQty: number;
  personalConsumedQty: number;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface StockLot {
  id: string;
  ownerId: string;
  productId: string;
  productName: string;
  productCode: string;
  brand: Brand;
  purchaseId: string;
  purchaseOrderNumber: string;
  purchaseDate: string;
  initialQty: number;
  availableQty: number;
  reservedQty: number;
  deliveredQty: number;
  consumedQty: number;
  unitBaseCost: number;
  unitFinancialCost: number;
  unitEffectiveCost: number;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface StockMovement {
  id: string;
  ownerId: string;
  productId: string;
  productName: string;
  brand: Brand;
  lotId: string;
  type: StockMovementType;
  quantity: number;
  unitBaseCost: number;
  unitFinancialCost: number;
  unitEffectiveCost: number;
  totalEffectiveCost: number;
  referenceType: 'purchase' | 'sale' | 'consumption' | 'manual';
  referenceId: string;
  date: string;
  notes: string;
  createdAt?: Timestamp | unknown;
}

export interface PurchaseItem {
  productId: string;
  name: string;
  code: string;
  brand: Brand;
  category: string;
  quantity: number;
  unitOriginalCost: number;
  totalOriginalCost: number;
  allocatedFinancialCost: number;
  unitFinancialCost: number;
  unitEffectiveCost: number;
  totalEffectiveCost: number;
  qtyForClients: number;
  qtyForStock: number;
}

export interface PurchaseFinancialSnapshot {
  refMonthlyInterestRate: number;
  refAnnualInterestRate: number;
  refMonthlyCet: number;
  refAnnualCet: number;
  refIofAmount: number;
  boletoInstallment1Days: number;
  boletoInstallment2Days: number;
}

export interface Purchase {
  id: string;
  ownerId: string;
  brand: PurchaseBrand;
  orderNumber: string;
  purchaseDate: string;
  billingDate: string;
  referenceDate: string;
  paymentMethod: PurchasePaymentMethod;
  originalTotal: number;
  surchargePercentApplied: number;
  surchargeAmount: number;
  effectiveTotal: number;
  financialParamsSnapshot: PurchaseFinancialSnapshot;
  itemsCount: number;
  items: PurchaseItem[];
  notes: string;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface Payable {
  id: string;
  ownerId: string;
  type: 'BOLETO_AVON' | 'BOLETO_NATURA' | 'BOLETO_MISTO' | 'DESPESA';
  purchaseId: string;
  orderNumber: string;
  description: string;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  originalAmount: number;
  interestAmount: number;
  totalAmount: number;
  paidAmount: number;
  status: PaymentStatus;
  paidDate: string;
  category: string;
  notes: string;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface Client {
  id: string;
  ownerId: string;
  fullName: string;
  phone: string;
  whatsapp: string;
  address: string;
  registeredAt: string;
  notes: string;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface LotAllocation {
  lotId: string;
  quantity: number;
  unitBaseCost: number;
  unitFinancialCost: number;
  unitEffectiveCost: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  productCode: string;
  brand: Brand;
  quantity: number;
  unitBaseCost: number;
  unitFinancialCost: number;
  unitEffectiveCost: number;
  totalCost: number;
  lotAllocations: LotAllocation[];
}

export interface PaymentSplit {
  method: SalePaymentMethod;
  amount: number;
  cardInstallments?: number;
}

export interface Sale {
  id: string;
  ownerId: string;
  documentNumber: string;
  clientId: string;
  clientName: string;
  saleDate: string;
  items: SaleItem[];
  originalSaleAmount: number;
  totalProductCost: number;
  totalBaseCost: number;
  totalFinancialCost: number;
  hasOwnCredit: boolean;
  ownCreditAmount: number;
  ownCreditInterestPercent: number;
  ownCreditInterestAmount: number;
  ownCreditTotalDue: number;
  ownCreditInstallmentsCount: number;
  totalWithInterest: number;
  grossProfitOnProducts: number;
  paymentSplits: PaymentSplit[];
  paidAmount: number;
  pendingAmount: number;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  deliveryDate: string;
  notes: string;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface DueDateChange {
  oldDate: string;
  newDate: string;
  changedAt: string;
  reason: string;
}

export interface Receivable {
  id: string;
  ownerId: string;
  saleId: string;
  documentNumber: string;
  clientId: string;
  clientName: string;
  type: 'CREDITO_PROPRIO' | 'SALDO_VENDA';
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  paidAmount: number;
  status: PaymentStatus;
  dueDateHistory: DueDateChange[];
  notes: string;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface Payment {
  id: string;
  ownerId: string;
  receiptNumber: string;
  saleId: string;
  receivableId: string;
  clientId: string;
  clientName: string;
  paymentDate: string;
  method: SalePaymentMethod;
  amount: number;
  principalPortion: number;
  interestPortion: number;
  installmentNumber: number;
  totalInstallments: number;
  notes: string;
  createdAt?: Timestamp | unknown;
}

export interface CardSettlement {
  id: string;
  ownerId: string;
  saleId: string;
  saleDocumentNumber: string;
  clientName: string;
  saleDate: string;
  cardMethod: 'DEBITO' | 'CREDITO';
  installments: number;
  grossCardAmount: number;
  status: 'AGUARDANDO' | 'RECEBIDO';
  settlementDate: string;
  netDepositedAmount: number;
  feeAmount: number;
  operatorName: string;
  notes: string;
  createdAt?: Timestamp | unknown;
  updatedAt?: Timestamp | unknown;
}

export interface PersonalConsumption {
  id: string;
  ownerId: string;
  date: string;
  productId: string;
  productName: string;
  productCode: string;
  brand: Brand;
  quantity: number;
  unitEffectiveCost: number;
  totalCost: number;
  lotAllocations: LotAllocation[];
  notes: string;
  createdAt?: Timestamp | unknown;
}

export type AppModule =
  | 'dashboard'
  | 'purchases'
  | 'inventory'
  | 'clients'
  | 'sales'
  | 'finance'
  | 'consumption'
  | 'reports'
  | 'settings';

export type PeriodPreset =
  | 'today'
  | '7d'
  | '30d'
  | 'current_month'
  | 'prev_month'
  | 'current_year'
  | 'all'
  | 'custom';
