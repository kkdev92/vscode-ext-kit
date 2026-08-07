import type { ServiceMap, ServiceToken } from './token.js';

/**
 * How long a service instance lives. These are the lifetimes the container
 * currently supports; ownership details are part of each value's contract.
 */
export const ServiceLifetime = {
  /**
   * At most one instance per Application, created lazily and owned by the
   * container. A promise returned by its `dispose` method is awaited at stop.
   */
  Singleton: 'singleton',
  /**
   * A new instance per resolution. If disposable, it is owned by the
   * ResourceScope associated with that resolver. Its `dispose` method must be
   * synchronous; `ResourceScope.own` does not await a returned promise.
   */
  Transient: 'transient',
} as const;

/** Union of {@link ServiceLifetime} values. */
export type ServiceLifetime = (typeof ServiceLifetime)[keyof typeof ServiceLifetime];

/**
 * A registration, normalised so the graph can be validated before anything is
 * instantiated.
 *
 * Dependencies are declared on the descriptor rather than pulled from an ambient
 * provider inside the factory, which is what makes the graph checkable.
 */
export interface ServiceDescriptor {
  /** The token this descriptor satisfies. */
  readonly token: ServiceToken<unknown>;
  /** How long instances live. */
  readonly lifetime: ServiceLifetime;
  /** Declared dependencies, keyed by the name the factory receives. */
  readonly dependencies: ServiceMap;
  /**
   * Synchronous factory. Returning a thenable is rejected at runtime; async
   * initialisation belongs in a hosted service.
   */
  readonly create: (injected: Readonly<Record<string, unknown>>) => unknown;
  /** Module that registered this descriptor, for diagnostics. */
  readonly moduleId: string;
}
