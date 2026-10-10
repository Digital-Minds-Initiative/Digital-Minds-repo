/**
 * Node.js-runtime startup checks (imported only by instrumentation.ts in the Node runtime).
 * Importing the env module validates every server environment variable; on an invalid value the
 * process exits — Next.js would otherwise log the error and keep a half-started server running.
 */
export async function validateServerEnvironment(): Promise<void> {
  try {
    await import('./server/env');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
