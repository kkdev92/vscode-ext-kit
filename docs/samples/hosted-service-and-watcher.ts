import { defineModule, serviceToken, type OperationContext } from '@kkdev92/vscode-ext-kit';

interface Cache {
  warm(): Promise<void>;
  invalidate(paths: readonly string[]): void;
}
const Cache = serviceToken<Cache>('sample.cache');

export const backgroundModule = defineModule('background', (module): undefined => {
  module.services.singleton(Cache, () => ({
    warm: () => Promise.resolve(),
    invalidate: () => undefined,
  }));

  // Async initialisation belongs in a hosted service, never in a service
  // factory: factories are synchronous so that resolution cannot deadlock.
  // Activation awaits `start`, and a throw here rolls the activation back.
  module.hostedServices.add({
    id: 'cache.warmup',
    inject: { cache: Cache },
    start: async (_context, { cache }) => {
      await cache.warm();
    },
  });

  // A background loop is started but not awaited. The host tracks it, so it is
  // never fire-and-forget, and `context.delay` resolves early on shutdown so a
  // sleeping loop cannot hold the budget hostage.
  module.hostedServices.background({
    id: 'cache.refresh',
    inject: { cache: Cache },
    run: async (context, { cache }) => {
      while (!context.signal.aborted) {
        await context.delay(30_000);
        if (context.signal.aborted) return;
        await cache.warm();
      }
    },
  });

  // Watcher batches arrive debounced and deduped, and each batch runs as an
  // operation: its own id, logger, cancellation signal and resource scope.
  module.fileWatchers.add({
    id: 'projects.files',
    patterns: ['**/*.project.json'],
    ignorePatterns: ['**/node_modules/**'],
    debounceDelay: 200,
    // Without a bound, a burst that never pauses is never delivered; with it,
    // the pending batch goes out at least this often.
    maxWait: 2_000,
    inject: { cache: Cache },
    handle: (context: OperationContext, events, { cache }) => {
      context.logger.debug('files changed', { count: events.length });
      cache.invalidate(events.map((event) => event.uri.fsPath));
    },
  });

  return undefined;
});
