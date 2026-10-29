/**
 * The spellings a CSV import accepts for the gender cell (ADR 0021), compared after trimming and
 * lower-casing. Deliberately a short list: guessing at «ذكور» or `m` would store a value nobody
 * typed on purpose, and the row's problem tells the officer what to write instead.
 */
const GENDER_SPELLINGS: Record<string, 'MALE' | 'FEMALE'> = {
  ذكر: 'MALE',
  male: 'MALE',
  أنثى: 'FEMALE',
  انثى: 'FEMALE',
  إنثى: 'FEMALE',
  female: 'FEMALE',
};

/** `MALE` / `FEMALE` for an accepted spelling, null for anything else (an empty cell included). */
export function parseGender(input: string): 'MALE' | 'FEMALE' | null {
  return GENDER_SPELLINGS[input.trim().toLowerCase()] ?? null;
}
