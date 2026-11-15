import * as XLSX from 'xlsx';

export interface ExcelSheetData {
  name: string;
  rows: Record<string, string | number | boolean>[];
}

export function exportSheetsToExcel(filename: string, sheets: ExcelSheetData[]): void {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const safeName = sheet.name.slice(0, 31).replace(/[\\/?*[\]]/g, '_');
    const ws =
      sheet.rows.length > 0
        ? XLSX.utils.json_to_sheet(sheet.rows)
        : XLSX.utils.aoa_to_sheet([['Sem registros no período']]);
    XLSX.utils.book_append_sheet(workbook, ws, safeName);
  }

  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function exportJSONBackup(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
