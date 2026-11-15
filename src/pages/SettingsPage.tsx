import React, { useEffect, useState } from 'react';
import { Download, Plus, Save, Trash2 } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { updateSettingsWithHistory } from '../services/firestoreOperations';
import { exportJSONBackup, exportSheetsToExcel } from '../utils/excelExport';
import { formatDateTimeBR, getTodayISO } from '../utils/formatters';

export function SettingsPage() {
  const {
    user,
    settings,
    settingsHistory,
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

  const [boletoSurchargePercent, setBoletoSurchargePercent] = useState(5);
  const [boletoInstallment1Days, setBoletoInstallment1Days] = useState(24);
  const [boletoInstallment2Days, setBoletoInstallment2Days] = useState(45);
  const [refMonthlyInterestRate, setRefMonthlyInterestRate] = useState(3);
  const [refAnnualInterestRate, setRefAnnualInterestRate] = useState(42.58);
  const [refMonthlyCet, setRefMonthlyCet] = useState(5.33);
  const [refAnnualCet, setRefAnnualCet] = useState(88.25);
  const [refIofAmount, setRefIofAmount] = useState(2.98);

  const [sellerName, setSellerName] = useState('');
  const [sellerDocument, setSellerDocument] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');
  const [sellerEmail, setSellerEmail] = useState('');
  const [sellerAddress, setSellerAddress] = useState('');
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setBoletoSurchargePercent(settings.boletoSurchargePercent);
    setBoletoInstallment1Days(settings.boletoInstallment1Days);
    setBoletoInstallment2Days(settings.boletoInstallment2Days);
    setRefMonthlyInterestRate(settings.refMonthlyInterestRate);
    setRefAnnualInterestRate(settings.refAnnualInterestRate);
    setRefMonthlyCet(settings.refMonthlyCet);
    setRefAnnualCet(settings.refAnnualCet);
    setRefIofAmount(settings.refIofAmount);
    setSellerName(settings.sellerName);
    setSellerDocument(settings.sellerDocument);
    setSellerPhone(settings.sellerPhone);
    setSellerEmail(settings.sellerEmail);
    setSellerAddress(settings.sellerAddress);
    setReceiptHeader(settings.receiptHeader);
    setReceiptFooter(settings.receiptFooter);
    setAllowNegativeStock(settings.allowNegativeStock);
    setCategories(settings.categories || []);
  }, [settings]);

  const sortedHistory = React.useMemo(
    () => [...settingsHistory].sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    [settingsHistory]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !settings) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await updateSettingsWithHistory(
        user.uid,
        settings,
        {
          boletoSurchargePercent,
          boletoInstallment1Days,
          boletoInstallment2Days,
          refMonthlyInterestRate,
          refAnnualInterestRate,
          refMonthlyCet,
          refAnnualCet,
          refIofAmount,
          sellerName,
          sellerDocument,
          sellerPhone,
          sellerEmail,
          sellerAddress,
          receiptHeader,
          receiptFooter,
          allowNegativeStock,
          categories,
        },
        `Atualização administrativa (Boleto ${boletoSurchargePercent}%, Prazos ${boletoInstallment1Days}/${boletoInstallment2Days}d, Estoque Negativo: ${allowNegativeStock ? 'Sim' : 'Não'})`
      );
      setSavedMsg('Configurações salvas e registradas no histórico. Operações antigas permanecem inalteradas.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCategory = () => {
    const clean = newCategory.trim();
    if (!clean || categories.includes(clean)) return;
    setCategories((prev) => [...prev, clean]);
    setNewCategory('');
  };

  const handleBackupJSON = () => {
    exportJSONBackup(`Backup_Iroko_Consultoria_${getTodayISO()}.json`, {
      exportedAt: new Date().toISOString(),
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
    });
  };

  const handleBackupExcel = () => {
    exportSheetsToExcel(`Backup_Iroko_Consultoria_${getTodayISO()}.xlsx`, [
      { name: 'Produtos', rows: products.map((p) => ({ ID: p.id, Nome: p.name, Marca: p.brand, Codigo: p.code, Disponivel: p.availableQty, Reservado: p.reservedQty })) },
      { name: 'Compras', rows: purchases.map((p) => ({ Pedido: p.orderNumber, Data: p.purchaseDate, Marca: p.brand, Pagamento: p.paymentMethod, Original: p.originalTotal, Efetivo: p.effectiveTotal })) },
      { name: 'Clientes', rows: clients.map((c) => ({ Nome: c.fullName, WhatsApp: c.whatsapp, Telefone: c.phone, Endereco: c.address })) },
      { name: 'Vendas', rows: sales.map((s) => ({ Doc: s.documentNumber, Data: s.saleDate, Cliente: s.clientName, Valor: s.originalSaleAmount, CustoFIFO: s.totalProductCost, Lucro: s.grossProfitOnProducts, Pago: s.paidAmount, Pendente: s.pendingAmount })) },
      { name: 'Contas_Receber', rows: receivables.map((r) => ({ Doc: r.documentNumber, Cliente: r.clientName, Parcela: `${r.installmentNumber}/${r.totalInstallments}`, Vencimento: r.dueDate, Total: r.totalAmount, Pago: r.paidAmount, Status: r.status })) },
      { name: 'Contas_Pagar', rows: payables.map((p) => ({ Descricao: p.description, Vencimento: p.dueDate, Total: p.totalAmount, Pago: p.paidAmount, Status: p.status })) },
    ]);
  };

  return (
    <div className="space-y-6">
      {savedMsg && (
        <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/50 px-4 py-3 text-xs font-medium text-emerald-300">
          {savedMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Financial Parameters */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-zinc-100">
              Taxas de Compras e Prazos de Boleto (Avon &amp; Natura)
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Alterações aqui aplicadas valem apenas para compras futuras. Compras anteriores preservam o histórico gravado.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Acréscimo Estimado Boleto 2x (%)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={boletoSurchargePercent}
                onChange={(e) => setBoletoSurchargePercent(Number(e.target.value))}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Prazo 1ª Parcela (dias)
              </label>
              <input
                type="number"
                min={1}
                value={boletoInstallment1Days}
                onChange={(e) => setBoletoInstallment1Days(Number(e.target.value))}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Prazo 2ª Parcela (dias)
              </label>
              <input
                type="number"
                min={1}
                value={boletoInstallment2Days}
                onChange={(e) => setBoletoInstallment2Days(Number(e.target.value))}
                className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-3">
            <p className="mb-2 text-xs font-medium text-zinc-300">
              Parâmetros Informativos de Referência (registrados nas compras, sem soma duplicada aos {boletoSurchargePercent}%)
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div>
                <label className="block text-[11px] text-zinc-400">Juros Mensais (%)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refMonthlyInterestRate}
                  onChange={(e) => setRefMonthlyInterestRate(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400">Juros Anuais (%)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refAnnualInterestRate}
                  onChange={(e) => setRefAnnualInterestRate(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400">CET Mensal (%)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refMonthlyCet}
                  onChange={(e) => setRefMonthlyCet(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400">CET Anual (%)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refAnnualCet}
                  onChange={(e) => setRefAnnualCet(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400">IOF Informado (R$)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refIofAmount}
                  onChange={(e) => setRefIofAmount(Number(e.target.value))}
                  className="font-mono-num mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Seller & Receipt Info */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-zinc-100">
            Dados do Vendedor e Recibos em PDF
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Nome / Razão Social do Vendedor
              </label>
              <input
                type="text"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">CPF / CNPJ</label>
              <input
                type="text"
                value={sellerDocument}
                onChange={(e) => setSellerDocument(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">Telefone / WhatsApp</label>
              <input
                type="text"
                value={sellerPhone}
                onChange={(e) => setSellerPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">E-mail</label>
              <input
                type="email"
                value={sellerEmail}
                onChange={(e) => setSellerEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300">Endereço</label>
              <input
                type="text"
                value={sellerAddress}
                onChange={(e) => setSellerAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Texto de Cabeçalho do Recibo
              </label>
              <input
                type="text"
                value={receiptHeader}
                onChange={(e) => setReceiptHeader(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300">
                Texto de Rodapé do Recibo
              </label>
              <input
                type="text"
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Categories & Operational Preferences */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-zinc-100">
            Preferências de Estoque e Categorias
          </h2>

          <label className="flex items-center gap-2.5 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={allowNegativeStock}
              onChange={(e) => setAllowNegativeStock(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>
              Permitir saída com estoque negativo (por padrão bloqueado para evitar inconsistência FIFO)
            </span>
          </label>

          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <label className="block text-xs font-medium text-zinc-300">
              Categorias de Produtos
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Nova categoria..."
                className="w-64 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar
              </button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {categories.map((cat) => (
                <div
                  key={cat}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200"
                >
                  <span>{cat}</span>
                  <button
                    type="button"
                    onClick={() => setCategories((prev) => prev.filter((c) => c !== cat))}
                    aria-label={`Remover ${cat}`}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Salvar Configurações'}
            </button>
          </div>
        </section>
      </form>

      {/* Backups & Export */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <h2 className="font-display text-sm font-semibold text-zinc-100">
          Backup e Exportação de Dados
        </h2>
        <p className="text-xs text-zinc-400">
          Exporte todos os registros persistidos no Firestore para cópia de segurança local.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleBackupJSON}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
          >
            <Download className="h-4 w-4" />
            Baixar Backup Completo (JSON)
          </button>
          <button
            type="button"
            onClick={handleBackupExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
          >
            <Download className="h-4 w-4 text-emerald-400" />
            Baixar Planilha Completa (Excel)
          </button>
        </div>
      </section>

      {/* Change History */}
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-5 py-3.5">
          <h2 className="font-display text-sm font-semibold text-zinc-100">
            Histórico de Alterações nas Configurações
          </h2>
        </div>
        {sortedHistory.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-zinc-500">
            Nenhuma alteração registrada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Data / Hora</th>
                  <th className="px-4 py-2.5 font-medium">Resumo da Alteração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {sortedHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="font-mono-num whitespace-nowrap px-4 py-2.5 text-zinc-400">
                      {formatDateTimeBR(h.changedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-200">{h.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
