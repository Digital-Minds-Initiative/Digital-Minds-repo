/**
 * Runs once when a server instance starts. The Node-only checks live in a separate file so the
 * Edge build never sees Node APIs (NEXT_RUNTIME is inlined per runtime, so the import is dropped).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateServerEnvironment } = await import('./instrumentation-node');
    await validateServerEnvironment();
  }
}
