import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { PeriodFilterBar } from '../components/ui/PeriodFilterBar';
import { useAppData } from '../context/AppDataContext';
import type { PeriodPreset } from '../types';
import { exportSheetsToExcel } from '../utils/excelExport';
import {
  formatCurrency,
  formatDateBR,
  formatPercent,
  getDateRangeFromPreset,
  getTodayISO,
  isDateInRange,
  round2,
} from '../utils/formatters';
import { generateFinancialReportPDF } from '../utils/pdfGenerator';

type ReportTab = 'GERAL' | 'VENDAS' | 'FINANCEIRO' | 'CLIENTES' | 'ESTOQUE' | 'LUCRATIVIDADE';

export function ReportsPage() {
  const {
    settings,
    products,
    stockLots,
    purchases,
    payables,
    clients,
    sales,
    receivables,
    payments,
    cardSettlements,
    personalConsumptions,
  } = useAppData();

  const [tab, setTab] = useState<ReportTab>('GERAL');
  const [preset, setPreset] = useState<PeriodPreset>('current_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const today = getTodayISO();
  const range = useMemo(
    () => getDateRangeFromPreset(preset, customStart, customEnd),
    [preset, customStart, customEnd]
  );

  const report = useMemo(() => {
    const pSales = sales.filter((s) => isDateInRange(s.saleDate, range.start, range.end));
    const pPurchases = purchases.filter((p) =>
      isDateInRange(p.purchaseDate, range.start, range.end)
    );
    const pPayments = payments.filter((p) => isDateInRange(p.paymentDate, range.start, range.end));
    const pCards = cardSettlements.filter(
      (c) => c.status === 'RECEBIDO' && isDateInRange(c.settlementDate, range.start, range.end)
    );
    const pPayablesPaid = payables.filter(
      (p) => p.paidAmount > 0 && isDateInRange(p.paidDate || p.dueDate, range.start, range.end)
    );
    const pExpenses = payables.filter(
      (p) => p.type === 'DESPESA' && isDateInRange(p.dueDate, range.start, range.end)
    );
    const pConsumptions = personalConsumptions.filter((c) =>
      isDateInRange(c.date, range.start, range.end)
    );

    const faturamento = round2(pSales.reduce((acc, s) => acc + s.originalSaleAmount, 0));
    const cpv = round2(pSales.reduce((acc, s) => acc + s.totalProductCost, 0));
    const lucroBruto = round2(faturamento - cpv);
    const jurosRecebidos = round2(pPayments.reduce((acc, p) => acc + p.interestPortion, 0));
    const taxasCartao = round2(pCards.reduce((acc, c) => acc + c.feeAmount, 0));
    const despesasOperacionais = round2(pExpenses.reduce((acc, e) => acc + e.totalAmount, 0));
    const lucroLiquido = round2(lucroBruto + jurosRecebidos - taxasCartao - despesasOperacionais);
    const comprasTotal = round2(pPurchases.reduce((acc, p) => acc + p.effectiveTotal, 0));
    const consumoProprioCusto = round2(pConsumptions.reduce((acc, c) => acc + c.totalCost, 0));
    const ticketMedio = pSales.length > 0 ? round2(faturamento / pSales.length) : 0;

    // Monthly Evolution
    const monthMap = new Map<
      string,
      { month: string; faturamento: number; cpv: number; lucroBruto: number; compras: number }
    >();
    for (const s of pSales) {
      const mKey = s.saleDate.slice(0, 7);
      const cur = monthMap.get(mKey) || {
        month: mKey,
        faturamento: 0,
        cpv: 0,
        lucroBruto: 0,
        compras: 0,
      };
      cur.faturamento = round2(cur.faturamento + s.originalSaleAmount);
      cur.cpv = round2(cur.cpv + s.totalProductCost);
      cur.lucroBruto = round2(cur.lucroBruto + s.grossProfitOnProducts);
      monthMap.set(mKey, cur);
    }
    for (const p of pPurchases) {
      const mKey = p.purchaseDate.slice(0, 7);
      const cur = monthMap.get(mKey) || {
        month: mKey,
        faturamento: 0,
        cpv: 0,
        lucroBruto: 0,
        compras: 0,
      };
      cur.compras = round2(cur.compras + p.effectiveTotal);
      monthMap.set(mKey, cur);
    }
    const monthlyEvolution = Array.from(monthMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    // By Brand (allocated proportionally by item cost/value inside each sale)
    const brandStats = {
      Avon: { qty: 0, revenue: 0, cost: 0, profit: 0 },
      Natura: { qty: 0, revenue: 0, cost: 0, profit: 0 },
    };
    const productStatsMap = new Map<
      string,
      { name: string; brand: string; qty: number; revenue: number; cost: number; profit: number }
    >();

    for (const s of pSales) {
      const saleCostDenominator = s.totalProductCost > 0 ? s.totalProductCost : 1;
      const saleQtyTotal = s.items.reduce((acc, i) => acc + i.quantity, 0) || 1;
      for (const it of s.items) {
        const share =
          s.totalProductCost > 0 ? it.totalCost / saleCostDenominator : it.quantity / saleQtyTotal;
        const allocatedRevenue = round2(s.originalSaleAmount * share);
        const allocatedProfit = round2(allocatedRevenue - it.totalCost);

        brandStats[it.brand].qty += it.quantity;
        brandStats[it.brand].revenue = round2(brandStats[it.brand].revenue + allocatedRevenue);
        brandStats[it.brand].cost = round2(brandStats[it.brand].cost + it.totalCost);
        brandStats[it.brand].profit = round2(brandStats[it.brand].profit + allocatedProfit);

        const curProd = productStatsMap.get(it.productId) || {
          name: it.productName,
          brand: it.brand,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
        curProd.qty += it.quantity;
        curProd.revenue = round2(curProd.revenue + allocatedRevenue);
        curProd.cost = round2(curProd.cost + it.totalCost);
        curProd.profit = round2(curProd.profit + allocatedProfit);
        productStatsMap.set(it.productId, curProd);
      }
    }

    const topProducts = Array.from(productStatsMap.values()).sort((a, b) => b.qty - a.qty);

    // Financial summary
    const recebidoDireto = round2(
      pPayments
        .filter((p) => p.method !== 'DEBITO' && p.method !== 'CREDITO')
        .reduce((acc, p) => acc + p.amount, 0)
    );
    const recebidoCartao = round2(pCards.reduce((acc, c) => acc + c.netDepositedAmount, 0));
    const totalRecebido = round2(recebidoDireto + recebidoCartao);
    const totalAReceber = round2(
      receivables
        .filter((r) => r.status !== 'PAGO')
        .reduce((acc, r) => acc + Math.max(0, r.totalAmount - r.paidAmount), 0)
    );
    const totalPago = round2(pPayablesPaid.reduce((acc, p) => acc + p.paidAmount, 0));
    const totalAPagar = round2(
      payables
        .filter((p) => p.status !== 'PAGO')
        .reduce((acc, p) => acc + Math.max(0, p.totalAmount - p.paidAmount), 0)
    );
    const inadimplenciaValor = round2(
      receivables
        .filter((r) => r.status !== 'PAGO' && r.dueDate < today)
        .reduce((acc, r) => acc + Math.max(0, r.totalAmount - r.paidAmount), 0)
    );
    const jurosPagos = round2(
      pPayablesPaid.reduce((acc, p) => {
        if (p.totalAmount <= 0) return acc;
        return acc + round2(p.interestAmount * (p.paidAmount / p.totalAmount));
      }, 0)
    );

    // Clients ranking & delinquency
    const clientRanking = clients
      .map((c) => {
        const cSales = pSales.filter((s) => s.clientId === c.id);
        const totalBought = round2(cSales.reduce((acc, s) => acc + s.originalSaleAmount, 0));
        const overdue = receivables
          .filter((r) => r.clientId === c.id && r.status !== 'PAGO' && r.dueDate < today)
          .reduce((acc, r) => acc + Math.max(0, r.totalAmount - r.paidAmount), 0);
        return {
          client: c,
          salesCount: cSales.length,
          totalBought,
          overdueAmount: round2(overdue),
        };
      })
      .sort((a, b) => b.totalBought - a.totalBought);

    // Inventory snapshot
    const valorEstoqueDisponivel = round2(
      stockLots.reduce((acc, l) => acc + Math.max(0, l.availableQty) * l.unitEffectiveCost, 0)
    );
    const valorEstoqueReservado = round2(
      stockLots.reduce((acc, l) => acc + Math.max(0, l.reservedQty) * l.unitEffectiveCost, 0)
    );

    return {
      pSales,
      faturamento,
      cpv,
      lucroBruto,
      lucroLiquido,
      jurosRecebidos,
      jurosPagos,
      taxasCartao,
      despesasOperacionais,
      comprasTotal,
      consumoProprioCusto,
      ticketMedio,
      monthlyEvolution,
      brandStats,
      topProducts,
      totalRecebido,
      totalAReceber,
      totalPago,
      totalAPagar,
      inadimplenciaValor,
      clientRanking,
      valorEstoqueDisponivel,
      valorEstoqueReservado,
    };
  }, [
    sales,
    purchases,
    payments,
    cardSettlements,
    payables,
    personalConsumptions,
    receivables,
    clients,
    stockLots,
    range,
    today,
  ]);

  const handleExportPDF = () => {
    generateFinancialReportPDF(
      'Relatório Gerencial Avon & Natura',
      range.label,
      [
        {
          title: '1. Desempenho Geral',
          headers: ['Indicador', 'Valor'],
          rows: [
            ['Faturamento Comercial', formatCurrency(report.faturamento)],
            ['Custo dos Produtos Vendidos (FIFO)', formatCurrency(report.cpv)],
            ['Lucro Bruto sobre Produtos', formatCurrency(report.lucroBruto)],
            ['Juros Recebidos (Crédito Próprio)', formatCurrency(report.jurosRecebidos)],
            ['Taxas de Cartão', formatCurrency(report.taxasCartao)],
            ['Despesas Operacionais', formatCurrency(report.despesasOperacionais)],
            ['Lucro Líquido Operacional', formatCurrency(report.lucroLiquido)],
            ['Compras Realizadas (Efetivo)', formatCurrency(report.comprasTotal)],
            ['Consumo Próprio (Custo)', formatCurrency(report.consumoProprioCusto)],
          ],
        },
        {
          title: '2. Vendas por Marca',
          headers: ['Marca', 'Qtd.', 'Faturamento Estimado', 'Custo FIFO', 'Lucro Estimado'],
          rows: (['Avon', 'Natura'] as const).map((b) => [
            b,
            report.brandStats[b].qty,
            formatCurrency(report.brandStats[b].revenue),
            formatCurrency(report.brandStats[b].cost),
            formatCurrency(report.brandStats[b].profit),
          ]),
        },
        {
          title: '3. Produtos Mais Vendidos',
          headers: ['Produto', 'Marca', 'Qtd.', 'Faturamento', 'Lucro'],
          rows: report.topProducts.slice(0, 20).map((p) => [
            p.name,
            p.brand,
            p.qty,
            formatCurrency(p.revenue),
            formatCurrency(p.profit),
          ]),
        },
        {
          title: '4. Financeiro e Carteira',
          headers: ['Indicador', 'Valor'],
          rows: [
            ['Total Recebido (Caixa no Período)', formatCurrency(report.totalRecebido)],
            ['Total a Receber (Em Aberto)', formatCurrency(report.totalAReceber)],
            ['Inadimplência Atual', formatCurrency(report.inadimplenciaValor)],
            ['Total Pago (Boletos/Despesas)', formatCurrency(report.totalPago)],
            ['Total a Pagar (Em Aberto)', formatCurrency(report.totalAPagar)],
            ['Juros Pagos (Boletos)', formatCurrency(report.jurosPagos)],
          ],
        },
      ],
      settings
    );
  };

  const handleExportExcel = () => {
    exportSheetsToExcel(`Relatorio_Iroko_Consultoria_${getTodayISO()}.xlsx`, [
      {
        name: 'Resumo_Geral',
        rows: [
          { Indicador: 'Período', Valor: range.label },
          { Indicador: 'Faturamento', Valor: report.faturamento },
          { Indicador: 'CPV FIFO', Valor: report.cpv },
          { Indicador: 'Lucro Bruto Produtos', Valor: report.lucroBruto },
          { Indicador: 'Juros Recebidos', Valor: report.jurosRecebidos },
          { Indicador: 'Taxas de Cartão', Valor: report.taxasCartao },
          { Indicador: 'Despesas Operacionais', Valor: report.despesasOperacionais },
          { Indicador: 'Lucro Líquido Operacional', Valor: report.lucroLiquido },
          { Indicador: 'Total Recebido (Caixa)', Valor: report.totalRecebido },
          { Indicador: 'Total a Receber', Valor: report.totalAReceber },
          { Indicador: 'Total Pago', Valor: report.totalPago },
          { Indicador: 'Total a Pagar', Valor: report.totalAPagar },
          { Indicador: 'Inadimplência', Valor: report.inadimplenciaValor },
        ],
      },
      {
        name: 'Vendas_Periodo',
        rows: report.pSales.map((s) => ({
          Documento: s.documentNumber,
          Data: formatDateBR(s.saleDate),
          Cliente: s.clientName,
          ValorVenda: s.originalSaleAmount,
          CustoFIFO: s.totalProductCost,
          LucroProdutos: s.grossProfitOnProducts,
          JurosCreditoProprio: s.ownCreditInterestAmount,
          TotalComJuros: s.totalWithInterest,
          Pago: s.paidAmount,
          Pendente: s.pendingAmount,
        })),
      },
      {
        name: 'Produtos_Vendidos',
        rows: report.topProducts.map((p) => ({
          Produto: p.name,
          Marca: p.brand,
          Quantidade: p.qty,
          Faturamento: p.revenue,
          CustoFIFO: p.cost,
          Lucro: p.profit,
        })),
      },
      {
        name: 'Estoque_Atual',
        rows: products.map((p) => ({
          Produto: p.name,
          Marca: p.brand,
          Codigo: p.code,
          Disponivel: p.availableQty,
          Reservado: p.reservedQty,
          Entregue: p.deliveredQty,
          ConsumoProprio: p.personalConsumedQty,
        })),
      },
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Header Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PeriodFilterBar
          preset={preset}
          onPresetChange={setPreset}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            Exportar Excel
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <Download className="h-4 w-4" />
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="inline-flex flex-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-1">
        {(
          [
            { id: 'GERAL', label: 'Desempenho Geral' },
            { id: 'VENDAS', label: 'Vendas' },
            { id: 'FINANCEIRO', label: 'Financeiro' },
            { id: 'CLIENTES', label: 'Clientes' },
            { id: 'ESTOQUE', label: 'Estoque' },
            { id: 'LUCRATIVIDADE', label: 'Lucratividade' },
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

      {tab === 'GERAL' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <ReportCard label="Faturamento" value={formatCurrency(report.faturamento)} />
            <ReportCard
              label="Lucro Líquido"
              value={formatCurrency(report.lucroLiquido)}
              highlight={report.lucroLiquido >= 0 ? 'emerald' : 'red'}
            />
            <ReportCard label="Compras (Efetivo)" value={formatCurrency(report.comprasTotal)} />
            <ReportCard
              label="Despesas + Taxas"
              value={formatCurrency(round2(report.despesasOperacionais + report.taxasCartao))}
              highlight="red"
            />
            <ReportCard label="Consumo Próprio" value={formatCurrency(report.consumoProprioCusto)} />
            <ReportCard label="Margem Líquida" value={
              report.faturamento > 0
                ? formatPercent((report.lucroLiquido / report.faturamento) * 100)
                : '0,00%'
            } />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="font-display text-xs font-semibold text-zinc-100">
                Evolução Mensal ({range.label})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Mês</th>
                    <th className="px-4 py-2.5 text-right font-medium">Faturamento</th>
                    <th className="px-4 py-2.5 text-right font-medium">CPV FIFO</th>
                    <th className="px-4 py-2.5 text-right font-medium">Lucro Produtos</th>
                    <th className="px-4 py-2.5 text-right font-medium">Compras</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {report.monthlyEvolution.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                        Sem dados mensais no período.
                      </td>
                    </tr>
                  ) : (
                    report.monthlyEvolution.map((m) => (
                      <tr key={m.month} className="hover:bg-zinc-800/40">
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 font-medium text-zinc-200">
                          {m.month.slice(5, 7)}/{m.month.slice(0, 4)}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-200">
                          {formatCurrency(m.faturamento)}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-400">
                          {formatCurrency(m.cpv)}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right font-semibold text-emerald-400">
                          {formatCurrency(m.lucroBruto)}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-200">
                          {formatCurrency(m.compras)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'VENDAS' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ReportCard label="Qtd. de Vendas" value={String(report.pSales.length)} />
            <ReportCard label="Valor Médio (Ticket)" value={formatCurrency(report.ticketMedio)} />
            <ReportCard label="Faturamento Total" value={formatCurrency(report.faturamento)} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="border-b border-zinc-800 px-4 py-3">
                <h3 className="font-display text-xs font-semibold text-zinc-100">
                  Vendas por Marca
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Marca</th>
                      <th className="px-4 py-2.5 text-right font-medium">Unidades</th>
                      <th className="px-4 py-2.5 text-right font-medium">Faturamento Est.</th>
                      <th className="px-4 py-2.5 text-right font-medium">Custo FIFO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {(['Avon', 'Natura'] as const).map((b) => (
                      <tr key={b} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-2.5 font-semibold text-zinc-100">{b}</td>
                        <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">
                          {report.brandStats[b].qty}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-200">
                          {formatCurrency(report.brandStats[b].revenue)}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-400">
                          {formatCurrency(report.brandStats[b].cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="border-b border-zinc-800 px-4 py-3">
                <h3 className="font-display text-xs font-semibold text-zinc-100">
                  Produtos Mais Vendidos
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Produto</th>
                      <th className="px-4 py-2.5 text-right font-medium">Qtd.</th>
                      <th className="px-4 py-2.5 text-right font-medium">Faturamento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {report.topProducts.slice(0, 10).map((p, i) => (
                      <tr key={i} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-zinc-100">{p.name}</span>
                          <span className="ml-1.5 text-zinc-500">· {p.brand}</span>
                        </td>
                        <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-zinc-200">
                          {p.qty}
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-200">
                          {formatCurrency(p.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'FINANCEIRO' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ReportCard
            label="Total Recebido (Caixa)"
            value={formatCurrency(report.totalRecebido)}
            highlight="emerald"
          />
          <ReportCard label="Total a Receber (Aberto)" value={formatCurrency(report.totalAReceber)} />
          <ReportCard label="Total Pago (Saídas)" value={formatCurrency(report.totalPago)} />
          <ReportCard label="Total a Pagar (Aberto)" value={formatCurrency(report.totalAPagar)} />
          <ReportCard
            label="Inadimplência Atual"
            value={formatCurrency(report.inadimplenciaValor)}
            highlight="red"
          />
          <ReportCard
            label="Juros Recebidos"
            value={formatCurrency(report.jurosRecebidos)}
            highlight="emerald"
          />
          <ReportCard label="Juros Pagos (Boletos)" value={formatCurrency(report.jurosPagos)} />
          <ReportCard
            label="Taxas de Cartão"
            value={formatCurrency(report.taxasCartao)}
            highlight="red"
          />
        </div>
      )}

      {tab === 'CLIENTES' && (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 text-right font-medium">Compras no Período</th>
                  <th className="px-4 py-3 text-right font-medium">Total Comprado</th>
                  <th className="px-4 py-3 text-right font-medium">Parcelas Vencidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {report.clientRanking.map((row) => (
                  <tr key={row.client.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-2.5 font-medium text-zinc-100">
                      {row.client.fullName}
                      {row.salesCount >= 2 && (
                        <span className="ml-2 text-[11px] text-emerald-400">· Recorrente</span>
                      )}
                    </td>
                    <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">{row.salesCount}</td>
                    <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right font-semibold text-zinc-100">
                      {formatCurrency(row.totalBought)}
                    </td>
                    <td
                      className={`font-mono-num whitespace-nowrap px-4 py-2.5 text-right ${
                        row.overdueAmount > 0 ? 'font-semibold text-red-400' : 'text-zinc-500'
                      }`}
                    >
                      {formatCurrency(row.overdueAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ESTOQUE' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ReportCard
              label="Disponível em Estoque"
              value={formatCurrency(report.valorEstoqueDisponivel)}
              highlight="emerald"
            />
            <ReportCard
              label="Reservado (Custo)"
              value={formatCurrency(report.valorEstoqueReservado)}
            />
            <ReportCard
              label="Unidades Disponíveis"
              value={`${products.reduce((a, p) => a + Math.max(0, p.availableQty), 0)} un.`}
            />
            <ReportCard
              label="Unidades Consumidas"
              value={`${products.reduce((a, p) => a + p.personalConsumedQty, 0)} un.`}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 font-medium">Marca</th>
                    <th className="px-4 py-3 text-right font-medium">Disponível</th>
                    <th className="px-4 py-3 text-right font-medium">Reservado</th>
                    <th className="px-4 py-3 text-right font-medium">Entregue</th>
                    <th className="px-4 py-3 text-right font-medium">Consumido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-2.5 font-medium text-zinc-100">{p.name}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{p.brand}</td>
                      <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">{p.availableQty}</td>
                      <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">{p.reservedQty}</td>
                      <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">{p.deliveredQty}</td>
                      <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">
                        {p.personalConsumedQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'LUCRATIVIDADE' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ReportCard
              label="Lucro Avon (Est.)"
              value={formatCurrency(report.brandStats.Avon.profit)}
              highlight="emerald"
            />
            <ReportCard
              label="Lucro Natura (Est.)"
              value={formatCurrency(report.brandStats.Natura.profit)}
              highlight="emerald"
            />
            <ReportCard
              label="Margem Bruta Geral"
              value={
                report.faturamento > 0
                  ? formatPercent((report.lucroBruto / report.faturamento) * 100)
                  : '0,00%'
              }
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="font-display text-xs font-semibold text-zinc-100">
                Lucratividade por Produto
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Produto</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qtd.</th>
                    <th className="px-4 py-2.5 text-right font-medium">Faturamento</th>
                    <th className="px-4 py-2.5 text-right font-medium">Custo FIFO</th>
                    <th className="px-4 py-2.5 text-right font-medium">Lucro</th>
                    <th className="px-4 py-2.5 text-right font-medium">Margem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {report.topProducts.map((p, idx) => (
                    <tr key={idx} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-2.5 font-medium text-zinc-100">
                        {p.name} · <span className="text-zinc-500">{p.brand}</span>
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-right text-zinc-200">{p.qty}</td>
                      <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-200">
                        {formatCurrency(p.revenue)}
                      </td>
                      <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-400">
                        {formatCurrency(p.cost)}
                      </td>
                      <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right font-semibold text-emerald-400">
                        {formatCurrency(p.profit)}
                      </td>
                      <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-right text-zinc-200">
                        {p.revenue > 0 ? formatPercent((p.profit / p.revenue) * 100) : '0,00%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'emerald' | 'red';
}) {
  const color =
    highlight === 'emerald'
      ? 'text-emerald-400'
      : highlight === 'red'
        ? 'text-red-400'
        : 'text-zinc-100';

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <span className="text-[11px] font-medium text-zinc-400">{label}</span>
      <p className={`font-mono-num mt-1 text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
