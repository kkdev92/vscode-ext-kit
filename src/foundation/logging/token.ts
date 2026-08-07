import { serviceToken } from '../services/token.js';
import type { ServiceToken } from '../services/token.js';
import type { Logger } from './logger.js';

/**
 * Injects the application's root logger.
 *
 * A handler already has one: `context.logger`, derived from this and tagged
 * with the operation's identity, which is the better choice wherever it exists.
 * A *service* has no operation — a store that reports corrupt data at
 * construction, a worker client that logs a crash from its own event handler —
 * and this is how it gets one.
 *
 * Not a second logging path: it is the same logger `context.logger` descends
 * from, and the same sink `defineExtension` configured. Tag it with
 * `withFields` so entries say where they came from.
 *
 * @example
 * ```ts
 * module.services.singleton(Store, {
 *   inject: { log: Log, storage: HistoryStorage.token },
 *   create: ({ log, storage }) => new Store(storage, log.withFields({ service: 'history' })),
 * });
 * ```
 */
export const Log: ServiceToken<Logger> = serviceToken<Logger>('framework.log');
