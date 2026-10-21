import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';

/*
 * Opens an exported .xlsx the way a reader would, with a library other than the one that wrote
 * it: `read-excel-file` for the cell values and their types, and the sheet XML itself for what
 * that library does not report (right-to-left, frozen rows, bold, text format).
 */

export interface OpenedWorkbook {
  /** Sheet name → rows of cell values (strings, numbers, Dates, null). */
  sheets: Map<string, unknown[][]>;
  /** The XML of `xl/worksheets/sheet<n>.xml`, 1-based in the file's order. */
  sheetXml: (index: number) => string;
  /** `xl/styles.xml`. */
  stylesXml: string;
}

export async function openWorkbook(bytes: Uint8Array): Promise<OpenedWorkbook> {
  const sheets = await readXlsxFile(Buffer.from(bytes));
  const files = unzipSync(bytes);
  const read = (path: string): string => {
    const file = files[path];
    if (!file) throw new Error(`${path} is not in the workbook`);
    return strFromU8(file);
  };
  return {
    sheets: new Map(sheets.map((sheet) => [sheet.sheet, sheet.data as unknown[][]])),
    sheetXml: (index) => read(`xl/worksheets/sheet${String(index)}.xml`),
    stylesXml: read('xl/styles.xml'),
  };
}

/**
 * The sheet as Excel's "CSV UTF-8" writes it: a BOM, commas, CRLF, fields quoted when they hold a
 * comma, a quote or a line break, dates as `yyyy-mm-dd` — what an officer gets by re-saving the
 * export, and what the CSV import then reads.
 */
export function sheetToCsv(rows: readonly unknown[][]): string {
  const field = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${String.fromCodePoint(0xfeff)}${rows.map((row) => row.map(field).join(',')).join('\r\n')}\r\n`;
}
