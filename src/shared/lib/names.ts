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
