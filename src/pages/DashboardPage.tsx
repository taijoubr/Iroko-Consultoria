import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, ArrowUpRight, Package, Users } from 'lucide-react';
import { PeriodFilterBar } from '../components/ui/PeriodFilterBar';
import { useAppData } from '../context/AppDataContext';
import type { AppModule, PeriodPreset } from '../types';
import {
  formatCurrency,
  formatDateBR,
  getDateRangeFromPreset,
  getTodayISO,
  isDateInRange,
  round2,
} from '../utils/formatters';

interface DashboardPageProps {
  onNavigate: (mod: AppModule) => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const {
    products,
    stockLots,
    purchases,
    payables,
    clients,
    sales,
    receivables,
    payments,
    cardSettlements,
    dataLoading,
  } = useAppData();

  const [preset, setPreset] = useState<PeriodPreset>('current_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const range = useMemo(
    () => getDateRangeFromPreset(preset, customStart, customEnd),
    [preset, customStart, customEnd]
  );

  const today = getTodayISO();

  const metrics = useMemo(() => {
    const periodSales = sales.filter((s) => isDateInRange(s.saleDate, range.start, range.end));
    const periodPurchases = purchases.filter((p) =>
      isDateInRange(p.purchaseDate, range.start, range.end)
    );

    // 1. Faturamento do período (somente vendas comerciais; consumo próprio excluído)
    const faturamento = round2(periodSales.reduce((acc, s) => acc + s.originalSaleAmount, 0));

    // 2. CPV FIFO efetivo dos produtos vendidos no período
    const cpvPeriodo = round2(periodSales.reduce((acc, s) => acc + s.totalProductCost, 0));
    const lucroBrutoProdutos = round2(faturamento - cpvPeriodo);

    // Juros de crédito próprio efetivamente recebidos no período
    const periodPayments = payments.filter((p) =>
      isDateInRange(p.paymentDate, range.start, range.end)
    );
    const jurosRecebidosPeriodo = round2(
      periodPayments.reduce((acc, p) => acc + p.interestPortion, 0)
    );

    // Taxas de cartão reconhecidas na liquidação da operadora no período
    const periodSettledCards = cardSettlements.filter(
      (c) => c.status === 'RECEBIDO' && isDateInRange(c.settlementDate, range.start, range.end)
    );
    const taxasCartaoPeriodo = round2(
      periodSettledCards.reduce((acc, c) => acc + c.feeAmount, 0)
    );

    // Despesas operacionais e comissões (não estoque) no período
    const despesasOperacionaisPeriodo = round2(
      payables
        .filter(
          (p) =>
            (p.type === 'DESPESA' || p.type === 'COMISSAO') &&
            isDateInRange(p.dueDate, range.start, range.end)
        )
        .reduce((acc, p) => acc + p.totalAmount, 0)
    );

    const lucroLiquidoPeriodo = round2(
      lucroBrutoProdutos + jurosRecebidosPeriodo - taxasCartaoPeriodo - despesasOperacionaisPeriodo
    );

    // 3. Total de compras no período
    const totalComprasPeriodo = round2(
      periodPurchases.reduce((acc, p) => acc + p.effectiveTotal, 0)
    );

    // 4. Valor investido em produtos (custo efetivo histórico total de compras ou no período)
    const valorInvestidoTotal = round2(
      purchases.reduce((acc, p) => acc + p.effectiveTotal, 0)
    );

    // 5. Valor disponível em estoque (lotes ativos * custo efetivo unitário)
    const valorDisponivelEstoque = round2(
      stockLots.reduce(
        (acc, l) => acc + Math.max(0, l.availableQty) * l.unitEffectiveCost,
        0
      )
    );

    // 6. Total Recebido no período (Dinheiro/PIX/Crédito Próprio + Depósito líquido de operadoras)
    // Regra de integridade: pagamentos no cartão não são contados 2x!
    const recebidoDiretoPeriodo = round2(
      periodPayments
        .filter((p) => p.method !== 'DEBITO' && p.method !== 'CREDITO')
        .reduce((acc, p) => acc + p.amount, 0)
    );
    const recebidoCartaoLiquidoPeriodo = round2(
      periodSettledCards.reduce((acc, c) => acc + c.netDepositedAmount, 0)
    );
    const totalRecebidoPeriodo = round2(recebidoDiretoPeriodo + recebidoCartaoLiquidoPeriodo);

    // 7. Total a Receber (carteira aberta total)
    const openReceivables = receivables.filter((r) => r.status !== 'PAGO');
    const totalAReceber = round2(
      openReceivables.reduce((acc, r) => acc + Math.max(0, r.totalAmount - r.paidAmount), 0)
    );

    // 8. Contas a Pagar (saldo aberto de boletos + despesas)
    const openPayables = payables.filter((p) => p.status !== 'PAGO');
    const totalAPagar = round2(
      openPayables.reduce((acc, p) => acc + Math.max(0, p.totalAmount - p.paidAmount), 0)
    );

    // 9. Parcelas Vencidas
    const overdueReceivables = openReceivables.filter((r) => r.dueDate < today);
    const totalVencido = round2(
      overdueReceivables.reduce((acc, r) => acc + Math.max(0, r.totalAmount - r.paidAmount), 0)
    );

    // 10-12. Clientes e unidades em estoque
    const produtosDisponiveisUn = products.reduce((acc, p) => acc + Math.max(0, p.availableQty), 0);
    const produtosReservadosUn = products.reduce((acc, p) => acc + Math.max(0, p.reservedQty), 0);

    return {
      faturamento,
      lucroBrutoProdutos,
      lucroLiquidoPeriodo,
      totalComprasPeriodo,
      comprasCountPeriodo: periodPurchases.length,
      valorInvestidoTotal,
      valorDisponivelEstoque,
      totalRecebidoPeriodo,
      totalAReceber,
      totalAPagar,
      overdueCount: overdueReceivables.length,
      totalVencido,
      clientesCount: clients.length,
      produtosDisponiveisUn,
      produtosReservadosUn,
      overdueReceivables: overdueReceivables.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      upcomingPayables: openPayables.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6),
    };
  }, [
    sales,
    purchases,
    payments,
    cardSettlements,
    payables,
    stockLots,
    receivables,
    products,
    clients,
    range,
    today,
  ]);

  const chartSeries = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; faturamento: number; lucro: number; compras: number }
    >();

    // Last 6 months or range months
    for (const s of sales) {
      if (!isDateInRange(s.saleDate, range.start, range.end)) continue;
      const key = s.saleDate.slice(0, 7); // YYYY-MM
      const [y, m] = key.split('-');
      const label = `${m}/${y}`;
      const cur = map.get(key) || { key, label, faturamento: 0, lucro: 0, compras: 0 };
      cur.faturamento = round2(cur.faturamento + s.originalSaleAmount);
      cur.lucro = round2(cur.lucro + s.grossProfitOnProducts);
      map.set(key, cur);
    }

    for (const p of purchases) {
      if (!isDateInRange(p.purchaseDate, range.start, range.end)) continue;
      const key = p.purchaseDate.slice(0, 7);
      const [y, m] = key.split('-');
      const label = `${m}/${y}`;
      const cur = map.get(key) || { key, label, faturamento: 0, lucro: 0, compras: 0 };
      cur.compras = round2(cur.compras + p.effectiveTotal);
      map.set(key, cur);
    }

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [sales, purchases, range]);

  if (dataLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-80 animate-pulse rounded-lg bg-zinc-800" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-400">Período selecionado: {range.label}</p>
        </div>
        <PeriodFilterBar
          preset={preset}
          onPresetChange={setPreset}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
      </div>

      {/* Primary KPI Grid — 12 Indicators */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Faturamento do Período"
          value={formatCurrency(metrics.faturamento)}
          hint="Vendas comerciais (sem consumo próprio)"
        />
        <KpiCard
          label="Lucro do Período"
          value={formatCurrency(metrics.lucroLiquidoPeriodo)}
          hint={`Bruto produtos: ${formatCurrency(metrics.lucroBrutoProdutos)}`}
          tone={metrics.lucroLiquidoPeriodo >= 0 ? 'positive' : 'danger'}
        />
        <KpiCard
          label="Compras Realizadas"
          value={formatCurrency(metrics.totalComprasPeriodo)}
          hint={`${metrics.comprasCountPeriodo} pedido(s) no período`}
        />
        <KpiCard
          label="Total Recebido (Caixa)"
          value={formatCurrency(metrics.totalRecebidoPeriodo)}
          hint="Dinheiro, PIX, parcelas e líquido cartão"
          tone="positive"
        />

        <KpiCard
          label="Valor Investido (Total)"
          value={formatCurrency(metrics.valorInvestidoTotal)}
          hint="Custo efetivo acumulado em compras"
        />
        <KpiCard
          label="Valor Disponível em Estoque"
          value={formatCurrency(metrics.valorDisponivelEstoque)}
          hint="Custo FIFO dos lotes disponíveis"
        />
        <KpiCard
          label="Total a Receber"
          value={formatCurrency(metrics.totalAReceber)}
          hint="Carteira aberta de clientes"
          onClick={() => onNavigate('finance')}
        />
        <KpiCard
          label="Contas a Pagar"
          value={formatCurrency(metrics.totalAPagar)}
          hint="Boletos Avon/Natura e despesas"
          tone={metrics.totalAPagar > 0 ? 'warning' : 'neutral'}
          onClick={() => onNavigate('finance')}
        />

        <KpiCard
          label="Parcelas Vencidas"
          value={formatCurrency(metrics.totalVencido)}
          hint={`${metrics.overdueCount} parcela(s) em atraso`}
          tone={metrics.overdueCount > 0 ? 'danger' : 'neutral'}
          onClick={() => onNavigate('finance')}
        />
        <KpiCard
          label="Clientes Cadastrados"
          value={String(metrics.clientesCount)}
          hint="Base ativa de compradores"
          onClick={() => onNavigate('clients')}
        />
        <KpiCard
          label="Produtos Disponíveis"
          value={`${metrics.produtosDisponiveisUn} un.`}
          hint="Prontos para venda ou retirada"
          onClick={() => onNavigate('inventory')}
        />
        <KpiCard
          label="Produtos Reservados"
          value={`${metrics.produtosReservadosUn} un.`}
          hint="Aguardando entrega ao cliente"
          onClick={() => onNavigate('inventory')}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-zinc-100">
                Evolução de Vendas e Lucro
              </h2>
              <p className="text-xs text-zinc-400">
                Faturamento bruto versus lucro sobre produtos (custeio FIFO)
              </p>
            </div>
          </div>
          <div className="h-64 w-full">
            {chartSeries.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                Registre vendas no período para visualizar a evolução.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value ?? 0))}
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderRadius: '8px',
                      border: '1px solid #27272a',
                      fontSize: '12px',
                      color: '#f4f4f5',
                    }}
                    itemStyle={{ color: '#f4f4f5' }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="faturamento"
                    name="Faturamento"
                    stroke="#e4e4e7"
                    fill="#71717a"
                    fillOpacity={0.28}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="lucro"
                    name="Lucro Produtos"
                    stroke="#34d399"
                    fill="#10b981"
                    fillOpacity={0.22}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-zinc-100">
                Compras vs. Faturamento Mensal
              </h2>
              <p className="text-xs text-zinc-400">
                Comparativo entre reposição de estoque e vendas realizadas
              </p>
            </div>
          </div>
          <div className="h-64 w-full">
            {chartSeries.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                Sem movimentações mensais no período selecionado.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value ?? 0))}
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderRadius: '8px',
                      border: '1px solid #27272a',
                      fontSize: '12px',
                      color: '#f4f4f5',
                    }}
                    itemStyle={{ color: '#f4f4f5' }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Bar dataKey="compras" name="Compras (Efetivo)" fill="#71717a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="faturamento" name="Faturamento" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Actionable Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <h3 className="font-display text-sm font-semibold text-zinc-100">
                Parcelas Vencidas de Clientes
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('finance')}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Ver financeiro
            </button>
          </div>
          {metrics.overdueReceivables.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-zinc-500">
              Nenhuma parcela vencida no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Cliente</th>
                    <th className="px-4 py-2.5 font-medium">Parcela</th>
                    <th className="px-4 py-2.5 font-medium">Vencimento</th>
                    <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {metrics.overdueReceivables.slice(0, 6).map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-2.5 font-medium text-zinc-100">{r.clientName}</td>
                      <td className="px-4 py-2.5 text-zinc-400">
                        {r.installmentNumber}/{r.totalInstallments} · {r.documentNumber}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-red-400">
                        {formatDateBR(r.dueDate)}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-zinc-100">
                        {formatCurrency(r.totalAmount - r.paidAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-zinc-400" />
              <h3 className="font-display text-sm font-semibold text-zinc-100">
                Próximos Boletos e Contas a Pagar
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('finance')}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Gerenciar contas
            </button>
          </div>
          {metrics.upcomingPayables.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-zinc-500">
              Nenhuma conta a pagar pendente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Descrição</th>
                    <th className="px-4 py-2.5 font-medium">Vencimento</th>
                    <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {metrics.upcomingPayables.map((p) => {
                    const isOverdue = p.dueDate < today;
                    return (
                      <tr key={p.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-2.5 font-medium text-zinc-100">{p.description}</td>
                        <td
                          className={`font-mono-num px-4 py-2.5 ${
                            isOverdue ? 'font-medium text-red-400' : 'text-zinc-400'
                          }`}
                        >
                          {formatDateBR(p.dueDate)}
                        </td>
                        <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-zinc-100">
                          {formatCurrency(p.totalAmount - p.paidAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Quick Start Banner only if completely empty */}
      {purchases.length === 0 && clients.length === 0 && (
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-emerald-400" />
            <div>
              <h3 className="font-display text-sm font-semibold text-zinc-100">
                Comece registrando sua primeira compra Avon ou Natura
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                Ao lançar um pedido em Entrada de Compras, o sistema alimenta automaticamente os lotes de estoque FIFO e gera os boletos no Financeiro.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('purchases')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Lançar Primeira Compra
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
  onClick?: () => void;
}) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-400'
        : tone === 'danger'
          ? 'text-red-400'
          : 'text-zinc-100';

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors ${
        onClick ? 'hover:border-zinc-700 hover:bg-zinc-800/70' : ''
      }`}
    >
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      <span className={`font-mono-num mt-2 text-xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </span>
      <span className="mt-1.5 text-[11px] text-zinc-500">{hint}</span>
    </Tag>
  );
}
