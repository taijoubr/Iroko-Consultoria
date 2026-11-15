import React, { useMemo, useState } from 'react';
import { Edit2, FileText, Plus, UserCheck } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { useAppData } from '../context/AppDataContext';
import { saveClient } from '../services/firestoreOperations';
import type { Client } from '../types';
import {
  formatCurrency,
  formatDateBR,
  getTodayISO,
  round2,
  translatePaymentMethod,
  translateStatus,
} from '../utils/formatters';
import { generatePaymentReceiptPDF } from '../utils/pdfGenerator';

export function ClientsPage({
  externalOpenNew,
  onClearExternalNew,
}: {
  externalOpenNew?: boolean;
  onClearExternalNew?: () => void;
}) {
  const { user, settings, clients, sales, receivables, payments } = useAppData();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'TODOS' | 'DEVEDOR' | 'VENCIDO' | 'QUITADO'>('TODOS');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [profileTab, setProfileTab] = useState<'COMPRAS' | 'PARCELAS' | 'PAGAMENTOS' | 'ENTREGAS'>('COMPRAS');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const today = getTodayISO();

  React.useEffect(() => {
    if (externalOpenNew) {
      openCreateModal();
      onClearExternalNew?.();
    }
  }, [externalOpenNew, onClearExternalNew]);

  const openCreateModal = () => {
    setEditingClient(null);
    setFullName('');
    setPhone('');
    setWhatsapp('');
    setAddress('');
    setNotes('');
    setErrorMsg(null);
    setShowFormModal(true);
  };

  const openEditModal = (c: Client) => {
    setEditingClient(c);
    setFullName(c.fullName);
    setPhone(c.phone);
    setWhatsapp(c.whatsapp);
    setAddress(c.address);
    setNotes(c.notes);
    setErrorMsg(null);
    setShowFormModal(true);
  };

  const clientSummaries = useMemo(() => {
    return clients
      .map((c) => {
        const cSales = sales.filter((s) => s.clientId === c.id);
        const cPayments = payments.filter((p) => p.clientId === c.id);
        const cReceivables = receivables.filter((r) => r.clientId === c.id);
        const openReceivables = cReceivables.filter((r) => r.status !== 'PAGO');
        const overdueCount = openReceivables.filter((r) => r.dueDate < today).length;

        const totalBought = round2(cSales.reduce((acc, s) => acc + s.totalWithInterest, 0));
        const totalPaid = round2(cSales.reduce((acc, s) => acc + s.paidAmount, 0));
        const totalOwed = round2(cSales.reduce((acc, s) => acc + s.pendingAmount, 0));

        return {
          client: c,
          salesCount: cSales.length,
          totalBought,
          totalPaid,
          totalOwed,
          openInstallmentsCount: openReceivables.length,
          overdueCount,
          cSales,
          cPayments,
          openReceivables,
        };
      })
      .filter((row) => {
        if (filter === 'DEVEDOR' && row.totalOwed <= 0.01) return false;
        if (filter === 'VENCIDO' && row.overdueCount === 0) return false;
        if (filter === 'QUITADO' && row.totalOwed > 0.01) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            row.client.fullName.toLowerCase().includes(q) ||
            row.client.phone.toLowerCase().includes(q) ||
            row.client.whatsapp.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => a.client.fullName.localeCompare(b.client.fullName));
  }, [clients, sales, payments, receivables, filter, search, today]);

  const selectedSummary = useMemo(() => {
    if (!selectedClient) return null;
    const cSales = sales
      .filter((s) => s.clientId === selectedClient.id)
      .sort((a, b) => b.saleDate.localeCompare(a.saleDate));
    const cPayments = payments
      .filter((p) => p.clientId === selectedClient.id)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
    const openReceivables = receivables
      .filter((r) => r.clientId === selectedClient.id && r.status !== 'PAGO')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const totalBought = round2(cSales.reduce((acc, s) => acc + s.totalWithInterest, 0));
    const totalPaid = round2(cSales.reduce((acc, s) => acc + s.paidAmount, 0));
    const totalOwed = round2(cSales.reduce((acc, s) => acc + s.pendingAmount, 0));

    return {
      client: selectedClient,
      cSales,
      cPayments,
      openReceivables,
      totalBought,
      totalPaid,
      totalOwed,
    };
  }, [selectedClient, sales, payments, receivables]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      await saveClient(
        user.uid,
        { fullName, phone, whatsapp, address, notes },
        editingClient?.id
      );
      setShowFormModal(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar cliente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {(
              [
                { id: 'TODOS', label: 'Todos' },
                { id: 'DEVEDOR', label: 'Com Saldo Devedor' },
                { id: 'VENCIDO', label: 'Com Parcelas Vencidas' },
                { id: 'QUITADO', label: 'Quitados' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  filter === f.id
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
            placeholder="Buscar cliente, telefone ou WhatsApp..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none sm:w-64"
          />
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </button>
      </div>

      {/* Clients Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {clientSummaries.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-zinc-200">Nenhum cliente encontrado.</p>
            <p className="mt-1 text-xs text-zinc-400">
              Cadastre seus clientes para acompanhar histórico de compras Avon e Natura, parcelas e entregas.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="divide-y divide-zinc-800 md:hidden">
              {clientSummaries.map((row) => (
                <div key={row.client.id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-100">{row.client.fullName}</p>
                      <p className="text-xs text-zinc-400">
                        {[row.client.whatsapp, row.client.phone].filter(Boolean).join(' · ') || 'Sem contato'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Desde {formatDateBR(row.client.registeredAt)} · {row.salesCount} compra(s)
                        {row.overdueCount > 0 && (
                          <span className="text-red-400"> · {row.overdueCount} vencida(s)</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEditModal(row.client)}
                      aria-label="Editar cliente"
                      className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-950/60 p-2 text-zinc-300 hover:bg-zinc-800"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                    <div>
                      <span className="text-zinc-500">Comprado</span>
                      <p className="font-mono-num font-medium text-zinc-200">
                        {formatCurrency(row.totalBought)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Pago</span>
                      <p className="font-mono-num font-medium text-emerald-400">
                        {formatCurrency(row.totalPaid)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Em Aberto</span>
                      <p
                        className={`font-mono-num font-semibold ${
                          row.overdueCount > 0
                            ? 'text-red-400'
                            : row.totalOwed > 0
                              ? 'text-amber-400'
                              : 'text-zinc-400'
                        }`}
                      >
                        {formatCurrency(row.totalOwed)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClient(row.client);
                      setProfileTab('COMPRAS');
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Abrir Ficha Completa
                  </button>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Contato</th>
                    <th className="px-4 py-3 text-right font-medium">Compras</th>
                    <th className="px-4 py-3 text-right font-medium">Total Comprado</th>
                    <th className="px-4 py-3 text-right font-medium">Total Pago</th>
                    <th className="px-4 py-3 text-right font-medium">Saldo Devido</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {clientSummaries.map((row) => (
                    <tr key={row.client.id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-100">{row.client.fullName}</p>
                        <p className="text-[11px] text-zinc-400">
                          Desde {formatDateBR(row.client.registeredAt)}
                          {row.overdueCount > 0 && ` · ${row.overdueCount} vencida(s)`}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {[row.client.whatsapp, row.client.phone].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-zinc-300">
                        {row.salesCount}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-zinc-200">
                        {formatCurrency(row.totalBought)}
                      </td>
                      <td className="font-mono-num px-4 py-3 text-right text-emerald-400">
                        {formatCurrency(row.totalPaid)}
                      </td>
                      <td
                        className={`font-mono-num px-4 py-3 text-right font-semibold ${
                          row.overdueCount > 0
                            ? 'text-red-400'
                            : row.totalOwed > 0
                              ? 'text-amber-400'
                              : 'text-zinc-400'
                        }`}
                      >
                        {formatCurrency(row.totalOwed)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedClient(row.client);
                              setProfileTab('COMPRAS');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            Ficha
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(row.client)}
                            aria-label="Editar cliente"
                            className="rounded-md border border-zinc-700 bg-zinc-950/60 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
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

      {/* Create / Edit Client Modal */}
      <Modal
        open={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingClient ? 'Editar Cliente' : 'Cadastrar Novo Cliente'}
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {errorMsg && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300">Nome Completo *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">WhatsApp</label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(11) 99999-9999"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Telefone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Opcional"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300">Endereço (opcional)</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300">Observações</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => setShowFormModal(false)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar Cliente'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Client Individual File (Ficha do Cliente) */}
      <Modal
        open={Boolean(selectedSummary)}
        onClose={() => setSelectedClient(null)}
        title={`Ficha do Cliente — ${selectedSummary?.client.fullName ?? ''}`}
        subtitle={
          selectedSummary
            ? `Cadastro: ${formatDateBR(selectedSummary.client.registeredAt)}${
                selectedSummary.client.whatsapp ? ` · WhatsApp: ${selectedSummary.client.whatsapp}` : ''
              }${selectedSummary.client.address ? ` · ${selectedSummary.client.address}` : ''}`
            : undefined
        }
        maxWidth="4xl"
      >
        {selectedSummary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 sm:grid-cols-4">
              <div>
                <span className="text-[11px] text-zinc-400">Total Comprado</span>
                <p className="font-mono-num text-sm font-semibold text-zinc-100">
                  {formatCurrency(selectedSummary.totalBought)}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-zinc-400">Total Pago</span>
                <p className="font-mono-num text-sm font-semibold text-emerald-400">
                  {formatCurrency(selectedSummary.totalPaid)}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-zinc-400">Total Ainda Devido</span>
                <p className="font-mono-num text-sm font-semibold text-red-400">
                  {formatCurrency(selectedSummary.totalOwed)}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-zinc-400">Parcelas em Aberto</span>
                <p className="font-mono-num text-sm font-semibold text-zinc-100">
                  {selectedSummary.openReceivables.length}
                </p>
              </div>
            </div>

            {selectedSummary.client.notes && (
              <p className="text-xs text-zinc-400">
                <strong className="text-zinc-200">Observações:</strong> {selectedSummary.client.notes}
              </p>
            )}

            <div className="inline-flex flex-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {(
                [
                  { id: 'COMPRAS', label: `Compras (${selectedSummary.cSales.length})` },
                  { id: 'PARCELAS', label: `Parcelas em Aberto (${selectedSummary.openReceivables.length})` },
                  { id: 'PAGAMENTOS', label: `Pagamentos (${selectedSummary.cPayments.length})` },
                  { id: 'ENTREGAS', label: 'Entregas' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setProfileTab(t.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    profileTab === t.id
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {profileTab === 'COMPRAS' && (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data · Doc.</th>
                      <th className="px-3 py-2 font-medium">Produtos Adquiridos (Avon/Natura)</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 text-right font-medium">Pago</th>
                      <th className="px-3 py-2 text-right font-medium">Pendente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedSummary.cSales.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                          Nenhuma compra registrada para este cliente.
                        </td>
                      </tr>
                    ) : (
                      selectedSummary.cSales.map((s) => (
                        <tr key={s.id}>
                          <td className="px-3 py-2">
                            <p className="font-mono-num font-medium text-zinc-100">
                              {formatDateBR(s.saleDate)}
                            </p>
                            <p className="text-[11px] text-zinc-400">{s.documentNumber}</p>
                          </td>
                          <td className="px-3 py-2 text-zinc-300">
                            {s.items
                              .map((i) => `${i.quantity}x ${i.productName} (${i.brand})`)
                              .join(', ')}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-right font-medium text-zinc-100">
                            {formatCurrency(s.totalWithInterest)}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-right text-emerald-400">
                            {formatCurrency(s.paidAmount)}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-right text-amber-400">
                            {formatCurrency(s.pendingAmount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {profileTab === 'PARCELAS' && (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Documento</th>
                      <th className="px-3 py-2 font-medium">Parcela</th>
                      <th className="px-3 py-2 font-medium">Vencimento</th>
                      <th className="px-3 py-2 text-right font-medium">Valor</th>
                      <th className="px-3 py-2 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedSummary.openReceivables.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                          Nenhuma parcela em aberto.
                        </td>
                      </tr>
                    ) : (
                      selectedSummary.openReceivables.map((r) => (
                        <tr key={r.id}>
                          <td className="font-mono-num px-3 py-2 font-medium text-zinc-100">{r.documentNumber}</td>
                          <td className="px-3 py-2 text-zinc-300">
                            {r.installmentNumber}/{r.totalInstallments}
                          </td>
                          <td
                            className={`font-mono-num px-3 py-2 ${
                              r.dueDate < today ? 'font-semibold text-red-400' : 'text-zinc-300'
                            }`}
                          >
                            {formatDateBR(r.dueDate)}
                            {r.dueDate < today && ' (Vencida)'}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-right text-zinc-300">
                            {formatCurrency(r.totalAmount)}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-right font-semibold text-zinc-100">
                            {formatCurrency(r.totalAmount - r.paidAmount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {profileTab === 'PAGAMENTOS' && (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Recibo</th>
                      <th className="px-3 py-2 font-medium">Forma</th>
                      <th className="px-3 py-2 text-right font-medium">Valor Pago</th>
                      <th className="px-3 py-2 text-right font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedSummary.cPayments.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                          Nenhum pagamento registrado.
                        </td>
                      </tr>
                    ) : (
                      selectedSummary.cPayments.map((p) => {
                        const relSale = sales.find((s) => s.id === p.saleId) || null;
                        return (
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
                                  generatePaymentReceiptPDF(p, relSale, selectedSummary.client, settings)
                                }
                                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                              >
                                <FileText className="h-3 w-3" />
                                Recibo
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {profileTab === 'ENTREGAS' && (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Venda</th>
                      <th className="px-3 py-2 font-medium">Data Venda</th>
                      <th className="px-3 py-2 font-medium">Situação Entrega</th>
                      <th className="px-3 py-2 font-medium">Data Entrega</th>
                      <th className="px-3 py-2 font-medium">Itens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {selectedSummary.cSales.map((s) => (
                      <tr key={s.id}>
                        <td className="font-mono-num px-3 py-2 font-medium text-zinc-100">{s.documentNumber}</td>
                        <td className="font-mono-num px-3 py-2 text-zinc-300">{formatDateBR(s.saleDate)}</td>
                        <td className="px-3 py-2 font-medium text-zinc-200">{translateStatus(s.deliveryStatus)}</td>
                        <td className="font-mono-num px-3 py-2 text-zinc-300">
                          {s.deliveryDate ? formatDateBR(s.deliveryDate) : 'Aguardando'}
                        </td>
                        <td className="px-3 py-2 text-zinc-400">
                          {s.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
