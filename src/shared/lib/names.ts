/**
 * The one way to write the name of something that must be unique among its siblings: a club, a
 * committee inside a club, a membership type inside a club.
 *
 * Names are typed by hand and pasted from documents, so the same name arrives with a trailing
 * space, a double space or a tab in it. Both the `entityNameSchema` contract field and the
 * services normalise with this function before they compare a name or store it, so
 * "نادي  الحاسبات" and "نادي الحاسبات" are one name — and a service called directly (a script,
 * an import) cannot slip a differently spaced duplicate past the uniqueness check.
 *
 * Nothing else is normalised: Postgres unique constraints are case-sensitive, and two names that
 * differ by a letter are two names.
 */
export function normalizeEntityName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * A person's full name. Names are not unique, so this is only about how the same name is written:
 * pasted from a spreadsheet or typed on a phone it arrives as "أحمد  علي " or with a tab in it,
 * and it is then displayed, searched and — at the `confirm_name` sign-in step — compared.
 *
 * Both `personNameSchema` and the services that store a name apply it, so a service called
 * directly (a script, the CSV import) cannot store a differently spaced spelling either.
 */
export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
