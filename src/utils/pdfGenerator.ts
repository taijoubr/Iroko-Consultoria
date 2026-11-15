import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AppSettings, Client, Payment, Receivable, Sale } from '../types';
import {
  formatCurrency,
  formatDateBR,
  formatPercent,
  translatePaymentMethod,
} from './formatters';

function addHeaderBlock(
  doc: jsPDF,
  title: string,
  subtitle: string,
  settings: AppSettings | null
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 30, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 13);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, 14, 21);

  const sellerName = settings?.sellerName || 'Iroko Consultoria';
  doc.setFontSize(9);
  doc.text(sellerName, pageWidth - 14, 13, { align: 'right' });
  if (settings?.sellerPhone) {
    doc.text(settings.sellerPhone, pageWidth - 14, 21, { align: 'right' });
  }

  doc.setTextColor(15, 23, 42);
  let y = 38;

  if (settings?.receiptHeader) {
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(settings.receiptHeader, 14, y);
    y += 7;
    doc.setTextColor(15, 23, 42);
  }

  return y;
}

function addSellerAndBuyerBoxes(
  doc: jsPDF,
  startY: number,
  settings: AppSettings | null,
  client: Client | null,
  fallbackClientName: string
): number {
  const sellerLines = [
    `Nome: ${settings?.sellerName || 'Administrador'}`,
    settings?.sellerDocument ? `CPF/CNPJ: ${settings.sellerDocument}` : null,
    settings?.sellerPhone ? `Telefone: ${settings.sellerPhone}` : null,
    settings?.sellerAddress ? `Endereço: ${settings.sellerAddress}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const buyerLines = [
    `Nome: ${client?.fullName || fallbackClientName}`,
    client?.phone ? `Telefone: ${client.phone}` : null,
    client?.whatsapp ? `WhatsApp: ${client.whatsapp}` : null,
    client?.address ? `Endereço: ${client.address}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  autoTable(doc, {
    startY,
    head: [['IDENTIFICAÇÃO DO VENDEDOR', 'IDENTIFICAÇÃO DO COMPRADOR']],
    body: [[sellerLines, buyerLines]],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4, textColor: [15, 23, 42] },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

function addSignatures(doc: jsPDF, y: number, settings: AppSettings | null): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  let sigY = y + 14;
  if (sigY > pageHeight - 34) {
    doc.addPage();
    sigY = 30;
  }

  doc.setDrawColor(148, 163, 184);
  doc.line(18, sigY, 92, sigY);
  doc.line(pageWidth - 92, sigY, pageWidth - 18, sigY);

  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Assinatura do Vendedor', 55, sigY + 5, { align: 'center' });
  doc.text('Assinatura do Comprador', pageWidth - 55, sigY + 5, { align: 'center' });

  if (settings?.receiptFooter) {
    doc.setFontSize(8);
    doc.text(settings.receiptFooter, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }
}

export function generateSaleReceiptPDF(
  sale: Sale,
  client: Client | null,
  receivables: Receivable[],
  settings: AppSettings | null
): void {
  const doc = new jsPDF();
  let y = addHeaderBlock(
    doc,
    'COMPROVANTE DE VENDA',
    `Documento Nº ${sale.documentNumber} · Emissão: ${formatDateBR(sale.saleDate)}`,
    settings
  );

  y = addSellerAndBuyerBoxes(doc, y, settings, client, sale.clientName);

  // Items table
  autoTable(doc, {
    startY: y,
    head: [['Produto', 'Marca', 'Cód.', 'Qtd.']],
    body: sale.items.map((item) => [
      item.productName,
      item.brand,
      item.productCode || '—',
      `${item.quantity} un.`,
    ]),
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Financial summary
  const summaryRows: [string, string][] = [
    ['Valor Original da Venda', formatCurrency(sale.originalSaleAmount)],
    [
      'Formas de Pagamento',
      sale.paymentSplits
        .map((s) => `${translatePaymentMethod(s.method)}: ${formatCurrency(s.amount)}`)
        .join(' | '),
    ],
  ];

  if (sale.hasOwnCredit) {
    summaryRows.push(
      ['Valor Financiado (Crédito Próprio)', formatCurrency(sale.ownCreditAmount)],
      ['Percentual de Juros Aplicado', formatPercent(sale.ownCreditInterestPercent)],
      ['Valor dos Juros', formatCurrency(sale.ownCreditInterestAmount)],
      ['Valor Total Devido (com Juros)', formatCurrency(sale.totalWithInterest)],
      ['Quantidade de Parcelas', `${sale.ownCreditInstallmentsCount}x`]
    );
  } else {
    summaryRows.push(['Valor Total da Venda', formatCurrency(sale.totalWithInterest)]);
  }

  summaryRows.push(
    ['Valor Já Pago', formatCurrency(sale.paidAmount)],
    ['Saldo Restante', formatCurrency(sale.pendingAmount)]
  );

  autoTable(doc, {
    startY: y,
    head: [['RESUMO FINANCEIRO DA VENDA', 'VALOR / DETALHE']],
    body: summaryRows,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 3.5 },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const saleReceivables = receivables
    .filter((r) => r.saleId === sale.id)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  if (saleReceivables.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Parcela', 'Vencimento', 'Valor da Parcela', 'Pago', 'Situação']],
      body: saleReceivables.map((r) => [
        `${r.installmentNumber}/${r.totalInstallments}`,
        formatDateBR(r.dueDate),
        formatCurrency(r.totalAmount),
        formatCurrency(r.paidAmount),
        r.status === 'PAGO' ? 'Quitada' : r.status === 'PARCIAL' ? 'Parcial' : 'Em aberto',
      ]),
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Este documento é um COMPROVANTE DE VENDA e não substitui o recibo de quitação das parcelas futuras.',
    14,
    y
  );

  addSignatures(doc, y + 4, settings);
  doc.save(`Comprovante_Venda_${sale.documentNumber}.pdf`);
}

export function generatePaymentReceiptPDF(
  payment: Payment,
  sale: Sale | null,
  client: Client | null,
  settings: AppSettings | null
): void {
  const doc = new jsPDF();
  let y = addHeaderBlock(
    doc,
    'RECIBO DE PAGAMENTO',
    `Recibo Nº ${payment.receiptNumber} · Data do Pagamento: ${formatDateBR(payment.paymentDate)}`,
    settings
  );

  y = addSellerAndBuyerBoxes(doc, y, settings, client, payment.clientName);

  const installmentLabel =
    payment.installmentNumber > 0
      ? `Parcela ${payment.installmentNumber} de ${payment.totalInstallments}`
      : 'Pagamento de Venda';

  const rows: [string, string][] = [
    ['Tipo de Documento', 'Comprovante de Pagamento Recebido'],
    ['Venda Relacionada', sale?.documentNumber || payment.saleId],
    ['Referência', installmentLabel],
    ['Forma de Pagamento', translatePaymentMethod(payment.method)],
    ['Data do Recebimento', formatDateBR(payment.paymentDate)],
    ['Valor Pago nesta Operação', formatCurrency(payment.amount)],
  ];

  if (payment.interestPortion > 0) {
    rows.push(
      ['Parcela referente ao Principal', formatCurrency(payment.principalPortion)],
      ['Parcela referente a Juros', formatCurrency(payment.interestPortion)]
    );
  }

  if (sale) {
    rows.push(
      ['Total da Venda (com Juros)', formatCurrency(sale.totalWithInterest)],
      ['Total Acumulado Pago', formatCurrency(sale.paidAmount)],
      ['Saldo Devedor Atualizado', formatCurrency(sale.pendingAmount)]
    );
  }

  autoTable(doc, {
    startY: y,
    head: [['DETALHAMENTO DO RECEBIMENTO', 'INFORMAÇÃO']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [4, 120, 87], textColor: [255, 255, 255] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Declaramos ter recebido a importância de ${formatCurrency(payment.amount)} referente à operação acima discriminada.`,
    14,
    y
  );

  addSignatures(doc, y + 6, settings);
  doc.save(`Recibo_Pagamento_${payment.receiptNumber}.pdf`);
}

export interface PdfReportSection {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

export function generateFinancialReportPDF(
  reportTitle: string,
  periodLabel: string,
  sections: PdfReportSection[],
  settings: AppSettings | null
): void {
  const doc = new jsPDF();
  let y = addHeaderBlock(
    doc,
    reportTitle,
    `Período: ${periodLabel} · Gerado em ${formatDateBR(new Date().toISOString().slice(0, 10))}`,
    settings
  );

  for (const section of sections) {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y > pageHeight - 45) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(section.title, 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [section.headers],
      body: section.rows.map((r) => r.map((c) => String(c))),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2.8 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      margin: { left: 14, right: 14 },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  doc.save(`Relatorio_${reportTitle.replace(/\s+/g, '_')}.pdf`);
}
