import React, { useMemo, useState } from 'react';
import { Coffee, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import {
  deletePersonalConsumption,
  registerPersonalConsumptionBatch,
} from '../services/firestoreOperations';
import type { PersonalConsumption } from '../types';
import { allocateFifoFromLots } from '../utils/finance';
import { formatCurrency, formatDateBR, getTodayISO, round2 } from '../utils/formatters';

interface DraftConsumptionItem {
  productId: string;
  quantity: number;
}

export function PersonalConsumptionPage() {
  const { user, settings, products, stockLots, stockMovements, personalConsumptions } =
    useAppData();

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState(getTodayISO());
  const [notes, setNotes] = useState('');
  const [draftList, setDraftList] = useState<DraftConsumptionItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonalConsumption | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId]
  );

  // Compute remaining stock & sequential FIFO cost for every item currently in the draft list
  const listEvaluation = useMemo(() => {
    const workingLots = stockLots.map((l) => ({ ...l }));
    const queuedQtyByProduct = new Map<string, number>();

    const evaluatedItems = draftList.map((entry) => {
      const prod = products.find((p) => p.id === entry.productId);
      queuedQtyByProduct.set(
        entry.productId,
        (queuedQtyByProduct.get(entry.productId) || 0) + entry.quantity
      );

      if (!prod || !settings) {
        return {
          ...entry,
          product: prod || null,
          unitCost: 0,
          totalCost: 0,
          error: !prod ? 'Produto não encontrado' : null,
        };
      }

      try {
        const fifo = allocateFifoFromLots(
          workingLots,
          prod.id,
          prod.name,
          entry.quantity,
          settings.allowNegativeStock
        );
        for (const alloc of fifo.allocations) {
          if (alloc.lotId) {
            const wLot = workingLots.find((l) => l.id === alloc.lotId);
            if (wLot) {
              wLot.availableQty -= alloc.quantity;
            }
          }
        }
        return {
          ...entry,
          product: prod,
          unitCost: fifo.unitEffectiveCostAvg,
          totalCost: fifo.totalEffectiveCost,
          error: null as string | null,
        };
      } catch (err) {
        return {
          ...entry,
          product: prod,
          unitCost: 0,
          totalCost: 0,
          error: err instanceof Error ? err.message : 'Estoque insuficiente',
        };
      }
    });

    const totalCost = round2(evaluatedItems.reduce((acc, it) => acc + it.totalCost, 0));
    const totalQty = evaluatedItems.reduce((acc, it) => acc + it.quantity, 0);
    const firstError = evaluatedItems.find((it) => it.error)?.error || null;

    return {
      workingLots,
      queuedQtyByProduct,
      evaluatedItems,
      totalCost,
      totalQty,
      firstError,
    };
  }, [draftList, products, stockLots, settings]);

  // Preview FIFO cost for the product currently selected in the picker (after deducting queued list items)
  const pickerPreview = useMemo(() => {
    if (!selectedProduct || !settings || quantity <= 0) {
      return { unitCost: 0, totalCost: 0, error: null as string | null };
    }
    try {
      const fifo = allocateFifoFromLots(
        listEvaluation.workingLots,
        selectedProduct.id,
        selectedProduct.name,
        quantity,
        settings.allowNegativeStock
      );
      return {
        unitCost: fifo.unitEffectiveCostAvg,
        totalCost: fifo.totalEffectiveCost,
        error: null as string | null,
      };
    } catch (err) {
      return {
        unitCost: 0,
        totalCost: 0,
        error: err instanceof Error ? err.message : 'Estoque insuficiente',
      };
    }
  }, [selectedProduct, settings, quantity, listEvaluation.workingLots]);

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

  const handleAddToList = () => {
    if (!selectedProduct || quantity <= 0) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (pickerPreview.error) {
      setErrorMsg(pickerPreview.error);
      return;
    }

    setDraftList((prev) => {
      const idx = prev.findIndex((i) => i.productId === selectedProduct.id);
      if (idx >= 0) {
        return prev.map((it, i) =>
          i === idx ? { ...it, quantity: it.quantity + quantity } : it
        );
      }
      return [...prev, { productId: selectedProduct.id, quantity }];
    });

    setProductId('');
    setQuantity(1);
  };

  const handleUpdateDraftQty = (targetProductId: string, nextQty: number) => {
    const safeQty = Math.max(1, Math.floor(nextQty || 1));
    setDraftList((prev) =>
      prev.map((it) => (it.productId === targetProductId ? { ...it, quantity: safeQty } : it))
    );
  };

  const handleRemoveDraftItem = (targetProductId: string) => {
    setDraftList((prev) => prev.filter((it) => it.productId !== targetProductId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !settings) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const itemsToSubmit: DraftConsumptionItem[] =
      draftList.length > 0
        ? draftList
        : selectedProduct
          ? [{ productId: selectedProduct.id, quantity }]
          : [];

    if (itemsToSubmit.length === 0) {
      setErrorMsg('Adicione pelo menos um produto à lista de retirada.');
      return;
    }

    if (draftList.length > 0 && listEvaluation.firstError) {
      setErrorMsg(listEvaluation.firstError);
      return;
    }

    if (draftList.length === 0 && pickerPreview.error) {
      setErrorMsg(pickerPreview.error);
      return;
    }

    setSubmitting(true);
    try {
      const count = await registerPersonalConsumptionBatch(
        user.uid,
        itemsToSubmit,
        products,
        stockLots,
        date,
        notes,
        settings.allowNegativeStock
      );
      const totalUnits = itemsToSubmit.reduce((acc, it) => acc + it.quantity, 0);
      setSuccessMsg(
        count === 1
          ? `Retirada de ${totalUnits} un. registrada como consumo próprio sem gerar faturamento.`
          : `Lista com ${count} produtos (${totalUnits} un.) retirada de uma só vez para consumo próprio.`
      );
      setDraftList([]);
      setProductId('');
      setQuantity(1);
      setNotes('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar consumo próprio.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting &&
    (draftList.length > 0 ? !listEvaluation.firstError : Boolean(selectedProduct && !pickerPreview.error));

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deletePersonalConsumption(deleteTarget, products, stockLots, stockMovements);
      setSuccessMsg(
        `Retirada de ${deleteTarget.quantity}x "${deleteTarget.productName}" estornada para o estoque.`
      );
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir retirada.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form & Batch List Card */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 lg:col-span-5"
        >
          <div className="flex items-start gap-2.5">
            <Coffee className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300" />
            <div>
              <h2 className="font-display text-sm font-semibold text-zinc-100">
                Retirada para Consumo Próprio
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Monte uma lista com vários produtos e retire todos de uma única vez pelo custo FIFO, sem gerar faturamento.
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

          {/* Shared date & notes */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div>
              <label className="block text-xs font-medium text-zinc-300">Observações Gerais</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: Uso pessoal / demonstração"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Product Picker + Add to List */}
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
            <h3 className="text-xs font-semibold text-zinc-200">Adicionar Produto à Lista</h3>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400">
                Produto do Estoque
              </label>
              <select
                required={draftList.length === 0}
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setErrorMsg(null);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Selecione um produto...</option>
                {products.map((p) => {
                  const queued = listEvaluation.queuedQtyByProduct.get(p.id) || 0;
                  const remaining = p.availableQty - queued;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.brand} · {p.name} (Disp.: {remaining} un.{queued > 0 ? `, ${queued} na lista` : ''})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="w-full sm:w-28">
                <label className="block text-[11px] font-medium text-zinc-400">Quantidade</label>
                <input
                  type="number"
                  min={1}
                  required={draftList.length === 0}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleAddToList}
                disabled={!selectedProduct || Boolean(pickerPreview.error)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar à Lista
              </button>
            </div>

            {selectedProduct && !pickerPreview.error && (
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>
                  Custo unit.:{' '}
                  <strong className="font-mono-num text-zinc-200">
                    {formatCurrency(pickerPreview.unitCost)}
                  </strong>
                </span>
                <span>
                  Subtotal:{' '}
                  <strong className="font-mono-num text-zinc-100">
                    {formatCurrency(pickerPreview.totalCost)}
                  </strong>
                </span>
              </div>
            )}

            {selectedProduct && pickerPreview.error && (
              <p className="text-[11px] font-medium text-red-400">{pickerPreview.error}</p>
            )}
          </div>

          {/* Queued List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <ShoppingBasket className="h-4 w-4 text-emerald-400" />
                <span>
                  Lista para Retirada ({draftList.length}{' '}
                  {draftList.length === 1 ? 'item' : 'itens'})
                </span>
              </div>
              {draftList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraftList([])}
                  className="text-[11px] text-zinc-400 hover:text-red-400"
                >
                  Limpar lista
                </button>
              )}
            </div>

            {draftList.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-4 text-center text-[11px] text-zinc-500">
                Adicione produtos acima para montar sua lista e retirar tudo de uma vez (ou selecione 1 produto e confirme diretamente).
              </div>
            ) : (
              <div className="space-y-2">
                {listEvaluation.evaluatedItems.map((item) => (
                  <div
                    key={item.productId}
                    className={`rounded-lg border p-2.5 text-xs ${
                      item.error
                        ? 'border-red-900/70 bg-red-950/25'
                        : 'border-zinc-800 bg-zinc-950/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-100">
                          {item.product?.name || 'Produto removido'}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {item.product?.brand} · Unit. {formatCurrency(item.unitCost)} · Subtotal:{' '}
                          <strong className="font-mono-num text-zinc-200">
                            {formatCurrency(item.totalCost)}
                          </strong>
                        </p>
                        {item.error && (
                          <p className="mt-0.5 text-[11px] text-red-400">{item.error}</p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateDraftQty(item.productId, Math.max(1, item.quantity - 1))
                          }
                          disabled={item.quantity <= 1}
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
                            handleUpdateDraftQty(item.productId, Number(e.target.value))
                          }
                          aria-label="Quantidade na lista"
                          className="font-mono-num w-12 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-center text-xs text-zinc-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateDraftQty(item.productId, item.quantity + 1)}
                          aria-label="Aumentar quantidade"
                          className="rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:bg-zinc-800"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveDraftItem(item.productId)}
                          aria-label="Remover item da lista"
                          className="ml-1 rounded p-1 text-zinc-500 hover:bg-red-950/60 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs">
                  <span className="text-zinc-400">
                    Total da Lista ({listEvaluation.totalQty} un.):
                  </span>
                  <span className="font-mono-num text-sm font-semibold text-emerald-400">
                    {formatCurrency(listEvaluation.totalCost)}
                  </span>
                </div>
              </div>
            )}

            {draftList.length > 0 && selectedProduct && (
              <p className="text-[11px] text-amber-400">
                Você selecionou &ldquo;{selectedProduct.name}&rdquo; acima. Clique em{' '}
                <strong>Adicionar à Lista</strong> para incluí-lo nesta retirada.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting
              ? 'Registrando retirada...'
              : draftList.length > 0
                ? `Retirar Lista Completa (${draftList.length} ${draftList.length === 1 ? 'item' : 'itens'} · ${listEvaluation.totalQty} un.)`
                : 'Confirmar Retirada'}
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
              <>
                {/* Mobile Cards */}
                <div className="divide-y divide-zinc-800 md:hidden">
                  {sortedConsumptions.map((c) => (
                    <div key={c.id} className="space-y-1.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-100">{c.productName}</p>
                          <p className="text-[11px] text-zinc-400">
                            {formatDateBR(c.date)} · {c.brand}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="font-mono-num text-xs font-semibold text-zinc-100">
                              {formatCurrency(c.totalCost)}
                            </p>
                            <p className="font-mono-num text-[11px] text-zinc-400">{c.quantity} un.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(c);
                            }}
                            aria-label="Excluir retirada"
                            title="Estornar retirada"
                            className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-1.5 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {c.notes && <p className="text-[11px] text-zinc-400">{c.notes}</p>}
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Data</th>
                        <th className="px-4 py-3 font-medium">Produto</th>
                        <th className="px-4 py-3 text-right font-medium">Qtd.</th>
                        <th className="px-4 py-3 text-right font-medium">Custo Total</th>
                        <th className="px-4 py-3 font-medium">Observações</th>
                        <th className="px-4 py-3 text-right font-medium">Ações</th>
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
                          <td className="font-mono-num px-4 py-3 text-right text-zinc-300">
                            {c.quantity}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-semibold text-zinc-100">
                            {formatCurrency(c.totalCost)}
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            {c.notes || 'Consumo próprio'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(c);
                              }}
                              aria-label="Excluir retirada"
                              title="Estornar retirada para o estoque"
                              className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-950/60 p-1 text-zinc-400 hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title="Estornar Retirada de Consumo Próprio"
        subtitle={
          deleteTarget
            ? `${deleteTarget.quantity}x ${deleteTarget.productName} · ${formatDateBR(deleteTarget.date)}`
            : undefined
        }
        maxWidth="md"
      >
        {deleteTarget && (
          <div className="space-y-4">
            {deleteError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                {deleteError}
              </div>
            )}

            <p className="text-xs text-zinc-300">
              Tem certeza que deseja excluir este registro de consumo próprio? As unidades retiradas retornarão automaticamente para os lotes FIFO disponíveis em estoque.
            </p>

            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deleting ? 'Estornando...' : 'Confirmar Estorno'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

