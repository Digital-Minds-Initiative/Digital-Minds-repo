/**
 * The integration-test database is wiped on every run. Refuse anything whose name does not end in
 * `_test`, so a mistyped .env can never wipe development or production data.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy it from .env.example into your .env.');
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to use TEST_DATABASE_URL: database "${name}" does not end with "_test" and would be wiped.`,
    );
  }
  return url;
}
