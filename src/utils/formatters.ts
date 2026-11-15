import type { PeriodPreset } from '../types';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(value: number | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0);
}

export function formatPercent(value: number | undefined | null): string {
  const num = Number(value ?? 0);
  return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateBR(isoOrDate: string | undefined | null): string {
  if (!isoOrDate) return '—';
  const str = String(isoOrDate).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [year, month, day] = str.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return str;
  const d = String(parsed.getDate()).padStart(2, '0');
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const y = parsed.getFullYear();
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(iso: string | undefined | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return formatDateBR(iso);
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function addMonthsISO(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function diffDaysISO(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = toIso.slice(0, 10).split('-').map(Number);
  const dt1 = new Date(y1, m1 - 1, d1).getTime();
  const dt2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((dt2 - dt1) / (1000 * 60 * 60 * 24));
}

export function getDateRangeFromPreset(
  preset: PeriodPreset,
  customStart?: string,
  customEnd?: string
): { start: string; end: string; label: string } {
  const today = getTodayISO();
  const [y, m] = today.split('-').map(Number);

  switch (preset) {
    case 'today':
      return { start: today, end: today, label: `Hoje (${formatDateBR(today)})` };
    case '7d':
      return {
        start: addDaysISO(today, -6),
        end: today,
        label: 'Últimos 7 dias',
      };
    case '30d':
      return {
        start: addDaysISO(today, -29),
        end: today,
        label: 'Últimos 30 dias',
      };
    case 'current_month': {
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end, label: 'Mês atual' };
    }
    case 'prev_month': {
      const prevDate = new Date(y, m - 2, 1);
      const py = prevDate.getFullYear();
      const pm = prevDate.getMonth() + 1;
      const start = `${py}-${String(pm).padStart(2, '0')}-01`;
      const lastDay = new Date(py, pm, 0).getDate();
      const end = `${py}-${String(pm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end, label: 'Mês anterior' };
    }
    case 'current_year':
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Ano ${y}` };
    case 'custom':
      return {
        start: customStart || '2000-01-01',
        end: customEnd || today,
        label: `${formatDateBR(customStart || '2000-01-01')} até ${formatDateBR(customEnd || today)}`,
      };
    case 'all':
    default:
      return { start: '2000-01-01', end: '2099-12-31', label: 'Todo o período' };
  }
}

export function isDateInRange(dateIso: string | undefined, start: string, end: string): boolean {
  if (!dateIso) return false;
  const d = dateIso.slice(0, 10);
  return d >= start && d <= end;
}

export function generateId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 14);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

export function sanitizeStr(val: string | undefined | null, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export function translatePaymentMethod(method: string): string {
  switch (method) {
    case 'DINHEIRO':
      return 'Dinheiro';
    case 'PIX':
      return 'PIX';
    case 'DEBITO':
      return 'Cartão de Débito';
    case 'CREDITO':
      return 'Cartão de Crédito';
    case 'CREDITO_PROPRIO':
      return 'Crédito Próprio';
    case 'A_VISTA':
      return 'À vista';
    case 'BOLETO_2X':
      return 'Boleto 2x';
    default:
      return method;
  }
}

export function translateStatus(status: string): string {
  switch (status) {
    case 'PAGO':
      return 'Pago';
    case 'PARCIAL':
      return 'Parcial';
    case 'PENDENTE':
      return 'Pendente';
    case 'ENTREGUE':
      return 'Entregue';
    case 'RESERVADO':
      return 'Reservado';
    case 'AGUARDANDO':
      return 'Aguardando';
    case 'RECEBIDO':
      return 'Recebido';
    default:
      return status;
  }
}
