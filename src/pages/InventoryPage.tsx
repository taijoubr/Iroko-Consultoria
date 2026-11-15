import React, { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import { releaseLotReservationToAvailable } from '../services/firestoreOperations';
import type { Brand, Product } from '../types';
import { formatCurrency, formatDateBR, round2 } from '../utils/formatters';

export function InventoryPage() {
  const { user, products, stockLots, stockMovements } = useAppData();

  const [brandFilter, setBrandFilter] = useState<'TODAS' | Brand>('TODAS');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'DISPONIVEL' | 'RESERVADO' | 'ZERADO'>('TODOS');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [releasingLotId, setReleasingLotId] = useState<string | null>(null);

  const enrichedProducts = useMemo(() => {
    return products
      .map((p) => {
        const lots = stockLots
          .filter((l) => l.productId === p.id)
          .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
        const availableStockValue = round2(
          lots.reduce((acc, l) => acc + Math.max(0, l.availableQty) * l.unitEffectiveCost, 0)
        );
        const reservedStockValue = round2(
          lots.reduce((acc, l) => acc + Math.max(0, l.reservedQty) * l.unitEffectiveCost, 0)
        );
        const avgEffectiveCost =
          p.availableQty > 0
            ? round2(availableStockValue / p.availableQty)
            : lots.length > 0
              ? lots[lots.length - 1].unitEffectiveCost
              : 0;
        const avgBaseCost =
          lots.length > 0
            ? round2(lots.reduce((acc, l) => acc + l.unitBaseCost, 0) / lots.length)
            : 0;
        const avgFinCost =
          lots.length > 0
            ? round2(lots.reduce((acc, l) => acc + l.unitFinancialCost, 0) / lots.length)
            : 0;

        return {
          product: p,
          lots,
          availableStockValue,
          reservedStockValue,
          avgEffectiveCost,
          avgBaseCost,
          avgFinCost,
        };
      })
      .filter((row) => {
        if (brandFilter !== 'TODAS' && row.product.brand !== brandFilter) return false;
        if (statusFilter === 'DISPONIVEL' && row.product.availableQty <= 0) return false;
        if (statusFilter === 'RESERVADO' && row.product.reservedQty <= 0) return false;
        if (statusFilter === 'ZERADO' && row.product.availableQty > 0) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            row.product.name.toLowerCase().includes(q) ||
            row.product.code.toLowerCase().includes(q) ||
            row.product.category.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [products, stockLots, brandFilter, statusFilter, search]);

  const totals = useMemo(() => {
    return enrichedProducts.reduce(
      (acc, r) => ({
        availQty: acc.availQty + Math.max(0, r.product.availableQty),
        resQty: acc.resQty + Math.max(0, r.product.reservedQty),
        delivQty: acc.delivQty + r.product.deliveredQty,
        consQty: acc.consQty + r.product.personalConsumedQty,
        stockVal: round2(acc.stockVal + r.availableStockValue),
      }),
      { availQty: 0, resQty: 0, delivQty: 0, consQty: 0, stockVal: 0 }
    );
  }, [enrichedProducts]);

  const selectedProductLots = useMemo(() => {
    if (!selectedProduct) return [];
    return stockLots
      .filter((l) => l.productId === selectedProduct.id)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
  }, [selectedProduct, stockLots]);

  const selectedProductMovements = useMemo(() => {
    if (!selectedProduct) return [];
    return stockMovements
      .filter((m) => m.productId === selectedProduct.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedProduct, stockMovements]);

  const handleReleaseReservation = async (lotId: string) => {
    if (!user || !selectedProduct) return;
    const lot = stockLots.find((l) => l.id === lotId);
    if (!lot || lot.reservedQty <= 0) return;
    setReleasingLotId(lotId);
    try {
      await releaseLotReservationToAvailable(user.uid, selectedProduct, lot, lot.reservedQty);
    } finally {
      setReleasingLotId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
          <span className="text-[11px] font-medium text-zinc-400">Disponível</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-zinc-100">
            {totals.availQty} un.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
          <span className="text-[11px] font-medium text-zinc-400">Reservado</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-amber-400">
            {totals.resQty} un.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
          <span className="text-[11px] font-medium text-zinc-400">Entregue</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-zinc-300">
            {totals.delivQty} un.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
          <span className="text-[11px] font-medium text-zinc-400">Consumo Próprio</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-zinc-300">
            {totals.consQty} un.
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 sm:col-span-1">
          <span className="text-[11px] font-medium text-zinc-400">Valor Disponível (FIFO)</span>
          <p className="font-mono-num mt-1 text-lg font-semibold text-emerald-400">
            {formatCurrency(totals.stockVal)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {(['TODAS', 'Avon', 'Natura'] as const).map((b) => (
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
              {b === 'TODAS' ? 'Todas as Marcas' : b}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {(
            [
              { id: 'TODOS', label: 'Todos' },
              { id: 'DISPONIVEL', label: 'Disponíveis' },
              { id: 'RESERVADO', label: 'Reservados' },
              { id: 'ZERADO', label: 'Sem Estoque' },
            ] as const
          ).map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStatusFilter(st.id)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === st.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, código ou categoria..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none sm:w-64"
        />
      </div>

      {/* Inventory Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {enrichedProducts.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-zinc-500">
            Nenhum produto encontrado no estoque com os filtros selecionados.
          </div>
        ) : (
          <>
            <div className="divide-y divide-zinc-800 md:hidden">
              {enrichedProducts.map((row) => {
                const p = row.product;
                return (
                  <div key={p.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-100">{p.name}</p>
                        <p className="text-[11px] text-zinc-400">
                          {p.brand} {p.code ? `· ${p.code}` : ''} · {p.category}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(p)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {row.lots.length} lote(s)
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5 text-center text-[11px]">
                      <div>
                        <p className="text-zinc-500">Disp.</p>
                        <p
                          className={`font-mono-num font-semibold ${
                            p.availableQty <= 0 ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {p.availableQty}
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Res.</p>
                        <p className="font-mono-num font-medium text-amber-400">{p.reservedQty}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Entr.</p>
                        <p className="font-mono-num text-zinc-300">{p.deliveredQty}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Cons.</p>
                        <p className="font-mono-num text-zinc-300">{p.personalConsumedQty}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Custo: {formatCurrency(row.avgBaseCost)} + {formatCurrency(row.avgFinCost)}
                      </span>
                      <span className="font-mono-num font-semibold text-zinc-100">
                        {formatCurrency(row.availableStockValue)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 font-medium">Marca · Cód.</th>
                    <th className="px-4 py-3 text-right font-medium">Disponível</th>
                    <th className="px-4 py-3 text-right font-medium">Reservado</th>
                    <th className="px-4 py-3 text-right font-medium">Entregue</th>
                    <th className="px-4 py-3 text-right font-medium">Consumo</th>
                    <th className="px-4 py-3 text-right font-medium">Custo Aqui. / Fin.</th>
                    <th className="px-4 py-3 text-right font-medium">Valor Estoque</th>
                    <th className="px-4 py-3 text-right font-medium">Lotes FIFO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {enrichedProducts.map((row) => {
                    const p = row.product;
                    return (
                      <tr key={p.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-100">{p.name}</p>
                          <p className="text-[11px] text-zinc-400">{p.category}</p>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {p.brand} {p.code ? `· ${p.code}` : ''}
                        </td>
                        <td
                          className={`font-mono-num px-4 py-3 text-right font-semibold ${
                            p.availableQty <= 0 ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {p.availableQty}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-amber-400">
                          {p.reservedQty}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                          {p.deliveredQty}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                          {p.personalConsumedQty}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-zinc-400">
                          {formatCurrency(row.avgBaseCost)} + {formatCurrency(row.avgFinCost)}
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                          {formatCurrency(row.availableStockValue)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedProduct(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            <Layers className="h-3.5 w-3.5" />
                            {row.lots.length} lote(s)
                          </button>
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

      {/* Product Lots & Movements Modal */}
      <Modal
        open={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        title={selectedProduct?.name ?? ''}
        subtitle={
          selectedProduct
            ? `${selectedProduct.brand} ${selectedProduct.code ? `· Cód. ${selectedProduct.code}` : ''} · Controle FIFO por lotes`
            : undefined
        }
        maxWidth="4xl"
      >
        {selectedProduct && (
          <div className="space-y-5">
            <div>
              <h3 className="font-display mb-2 text-xs font-semibold text-zinc-200">
                Lotes de Compra (Ordem FIFO — Mais Antigos Primeiro)
              </h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Pedido</th>
                      <th className="px-3 py-2 text-right font-medium">Inicial</th>
                      <th className="px-3 py-2 text-right font-medium">Disp.</th>
                      <th className="px-3 py-2 text-right font-medium">Res.</th>
                      <th className="px-3 py-2 text-right font-medium">Entr.</th>
                      <th className="px-3 py-2 text-right font-medium">Cons.</th>
                      <th className="px-3 py-2 text-right font-medium">Custo Base</th>
                      <th className="px-3 py-2 text-right font-medium">Custo Fin.</th>
                      <th className="px-3 py-2 text-right font-medium">Custo Efetivo</th>
                      <th className="px-3 py-2 text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedProductLots.map((lot) => (
                      <tr key={lot.id}>
                        <td className="font-mono-num px-3 py-2 text-zinc-400">
                          {formatDateBR(lot.purchaseDate)}
                        </td>
                        <td className="font-mono-num px-3 py-2 font-medium text-zinc-100">
                          {lot.purchaseOrderNumber}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-300">{lot.initialQty}</td>
                        <td className="font-mono-num px-3 py-2 text-right font-semibold text-emerald-400">
                          {lot.availableQty}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-amber-400">
                          {lot.reservedQty}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-300">{lot.deliveredQty}</td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-300">{lot.consumedQty}</td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-300">
                          {formatCurrency(lot.unitBaseCost)}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-400">
                          {formatCurrency(lot.unitFinancialCost)}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right font-semibold text-zinc-100">
                          {formatCurrency(lot.unitEffectiveCost)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {lot.reservedQty > 0 ? (
                            <button
                              type="button"
                              disabled={releasingLotId === lot.id}
                              onClick={() => handleReleaseReservation(lot.id)}
                              className="whitespace-nowrap rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                              Liberar Reserva
                            </button>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-display mb-2 text-xs font-semibold text-zinc-200">
                Histórico de Movimentações
              </h3>
              <div className="max-h-60 overflow-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                      <th className="px-3 py-2 text-right font-medium">Custo Total</th>
                      <th className="px-3 py-2 font-medium">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedProductMovements.map((m) => (
                      <tr key={m.id}>
                        <td className="font-mono-num px-3 py-2 text-zinc-400">
                          {formatDateBR(m.date)}
                        </td>
                        <td className="px-3 py-2 font-medium text-zinc-200">
                          {m.type.replace(/_/g, ' ')}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-300">{m.quantity}</td>
                        <td className="font-mono-num px-3 py-2 text-right text-zinc-200">
                          {formatCurrency(m.totalEffectiveCost)}
                        </td>
                        <td className="px-3 py-2 text-zinc-400">{m.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
