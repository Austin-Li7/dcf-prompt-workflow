"use client";
/**
 * Thin exceljs wrappers used by client-side components and the chunker.
 *
 * Reading: replaces XLSX.read + sheet_to_json
 * Writing: replaces XLSX.utils.book_new + json_to_sheet + XLSX.writeFile
 */

import ExcelJS from "exceljs";

export type SheetData = { name: string; rows: Array<Record<string, unknown>> };

/** Coerce an ExcelJS cell value to a plain JSON-safe value. */
function cellToValue(raw: ExcelJS.CellValue): unknown {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object") {
    if (raw instanceof Date) return raw.toISOString();
    if ("result" in raw) return raw.result ?? ""; // formula — use cached result
    if ("richText" in raw) {
      return (raw as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    }
    return ""; // error / hyperlink
  }
  return raw;
}

/** Minimal RFC 4180-compliant CSV parser (handles quoted fields with embedded commas). */
export function parseCsvToRecords(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const fields: string[] = [];
    const re = /(?:^|,)("(?:[^"]|"")*"|[^,]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      let v = m[1];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
      fields.push(v.trim());
    }
    return fields;
  };

  const headers = splitLine(nonEmpty[0]);
  return nonEmpty.slice(1).flatMap((line) => {
    const values = splitLine(line);
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => { if (h) record[h] = values[i] ?? ""; });
    return Object.keys(record).length > 0 ? [record] : [];
  });
}

/**
 * Read an xlsx or xlsm File into a flat array of row-objects.
 * Equivalent to the old XLSX.read + sheet_to_json pattern.
 */
export async function readXlsxToRecords(file: File): Promise<Array<Record<string, unknown>>> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const records: Array<Record<string, unknown>> = [];
  workbook.eachSheet((worksheet) => {
    const headers: string[] = [];
    let isFirstRow = true;
    worksheet.eachRow((row) => {
      if (isFirstRow) {
        isFirstRow = false;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          headers[colNumber - 1] = String(cellToValue(cell.value) || `col${colNumber}`);
        });
      } else {
        const record: Record<string, unknown> = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber - 1] ?? `col${colNumber}`;
          record[header] = cellToValue(cell.value);
        });
        if (Object.keys(record).length > 0) records.push(record);
      }
    });
  });
  return records;
}

/**
 * Build an xlsx workbook from sheet data and trigger a browser download.
 * Equivalent to the old XLSX.utils.book_new + json_to_sheet + XLSX.writeFile pattern.
 */
export async function downloadXlsx(sheets: SheetData[], filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  for (const { name, rows } of sheets) {
    const worksheet = workbook.addWorksheet(name.slice(0, 31));
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    worksheet.addRow(headers);
    for (const row of rows) {
      worksheet.addRow(headers.map((h) => row[h] ?? ""));
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
