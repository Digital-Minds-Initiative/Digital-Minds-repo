import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The CSV import takes the file base64-encoded in the JSON body, so tests send the fixture's
 * bytes exactly as a browser would — encoding, BOM and line endings included.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/members-import');

/** A fixture's bytes, base64-encoded: what goes in the request body. */
export function importFixture(name: string): string {
  return readFileSync(join(FIXTURES, name)).toString('base64');
}

/** A CSV written in the test itself. */
export function importFile(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** A file of `count` data rows, for the row-limit tests. */
export function importRows(count: number, firstLine = 1): string {
  const rows = Array.from(
    { length: count },
    (_, index) =>
      `طالب رقم ${String(firstLine + index)},s4420${String(firstLine + index).padStart(5, '0')}@uqu.edu.sa`,
  );
  return importFile(['الاسم الكامل,البريد الجامعي', ...rows].join('\n'));
}
