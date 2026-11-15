import React, { useMemo, useState } from 'react';
import { Coffee } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { registerPersonalConsumption } from '../services/firestoreOperations';
import { allocateFifoFromLots } from '../utils/finance';
import { formatCurrency, formatDateBR, getTodayISO, round2 } from '../utils/formatters';

export function PersonalConsumptionPage() {
  const { user, settings, products, stockLots, personalConsumptions } = useAppData();

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState(getTodayISO());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId]
  );

  const costPreview = useMemo(() => {
    if (!selectedProduct || !settings || quantity <= 0) return null;
    try {
      return allocateFifoFromLots(
        stockLots,
        selectedProduct.id,
        selectedProduct.name,
        quantity,
        settings.allowNegativeStock
      );
    } catch {
      return null;
    }
  }, [selectedProduct, stockLots, quantity, settings]);

  const sortedConsumptions = useMemo(
    () => [...personalConsumptions].sort((a, b) => b.date.localeCompare(a.date)),
    [personalConsumptions]
  );

  const totalWithdrawnCost = useMemo(
    () => round2(personalConsumptions.reduce((acc, c) => acc + c.totalCost, 0)),
    [personalConsumptions]
  );

  const totalWithdrawnQty = useMemo(
    () => personalConsumptions.reduce((acc, c) => acc + c.quantity, 0),
    [personalConsumptions]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !settings || !selectedProduct) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);

    try {
      await registerPersonalConsumption(
        user.uid,
        selectedProduct,
        stockLots,
        quantity,
        date,
        notes,
        settings.allowNegativeStock
      );
      setSuccessMsg(
        `Retirada de ${quantity}x "${selectedProduct.name}" registrada como consumo próprio sem gerar faturamento.`
      );
      setQuantity(1);
      setNotes('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar consumo próprio.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 lg:col-span-5"
        >
          <div className="flex items-start gap-2.5">
            <Coffee className="mt-0.5 h-5 w-5 text-zinc-300" />
            <div>
              <h2 className="font-display text-sm font-semibold text-zinc-100">
                Registrar Retirada para Consumo Próprio
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Dá baixa automática no estoque FIFO pelo custo efetivo, sem gerar faturamento nem venda comercial.
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/50 px-3 py-2 text-xs text-emerald-300">
              {successMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300">Produto do Estoque *</label>
            <select
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Selecione um produto...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} · {p.name} (Disp.: {p.availableQty} un.)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Quantidade *</label>
              <input
                type="number"
                min={1}
                required
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Data da Retirada *</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {costPreview && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Custo Unitário FIFO:</span>
                <span className="font-mono-num font-medium text-zinc-200">
                  {formatCurrency(costPreview.unitEffectiveCostAvg)}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-zinc-400">Custo Total da Retirada:</span>
                <span className="font-mono-num font-semibold text-zinc-100">
                  {formatCurrency(costPreview.totalEffectiveCost)}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300">Observações</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Uso pessoal / demonstração"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !selectedProduct}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? 'Registrando...' : 'Confirmar Consumo Próprio'}
          </button>
        </form>

        {/* History Table */}
        <div className="space-y-4 lg:col-span-7">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <span className="text-xs text-zinc-400">Unidades Consumidas</span>
              <p className="font-mono-num mt-1 text-xl font-semibold text-zinc-100">
                {totalWithdrawnQty} un.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <span className="text-xs text-zinc-400">Custo Total Retirado</span>
              <p className="font-mono-num mt-1 text-xl font-semibold text-zinc-100">
                {formatCurrency(totalWithdrawnCost)}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            {sortedConsumptions.length === 0 ? (
              <div className="px-6 py-12 text-center text-xs text-zinc-500">
                Nenhuma retirada para consumo próprio registrada.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Data</th>
                      <th className="px-4 py-3 font-medium">Produto</th>
                      <th className="px-4 py-3 text-right font-medium">Qtd.</th>
                      <th className="px-4 py-3 text-right font-medium">Custo Total</th>
                      <th className="px-4 py-3 font-medium">Observações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {sortedConsumptions.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-800/40">
                        <td className="font-mono-num px-4 py-3 text-zinc-400">
                          {formatDateBR(c.date)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-100">{c.productName}</p>
                          <p className="text-[11px] text-zinc-400">{c.brand}</p>
                        </td>
                        <td className="font-mono-num px-4 py-3 text-right text-zinc-300">{c.quantity}</td>
                        <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                          {formatCurrency(c.totalCost)}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.notes || 'Consumo próprio'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
