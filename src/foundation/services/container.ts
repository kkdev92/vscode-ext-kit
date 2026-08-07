import {
  AsyncCallbackError,
  ScopeCleanupError,
  ServiceResolutionError,
} from '../internal/errors.js';
import { defineOwn } from '../internal/record.js';
import { claimRejection, isDisposable, isThenable } from '../internal/thenable.js';
import type { ResourceScope } from '../resources/resource-scope.js';
import type { ServiceDescriptor } from './descriptors.js';
import { ServiceLifetime } from './descriptors.js';
import type { ServiceMap, ServiceToken } from './token.js';

/**
 * Resolves services without transferring ownership to the caller. Singleton
 * ownership stays with the container; disposable transients belong to the
 * ResourceScope associated with this resolver.
 */
export interface ServiceResolver {
  /**
   * Resolves a service synchronously, creating it on first use according to its
   * lifetime.
   *
   * @throws ServiceResolutionError when the token was never registered.
   * @throws ServiceResolutionError after container disposal or on a runtime
   * dependency cycle.
   * @throws AsyncCallbackError when a factory returns a thenable.
   */
  get<T>(token: ServiceToken<T>): T;
}

/**
 * Resolves the validated service graph and owns every created singleton in the
 * Application.
 *
 * Singletons are created lazily and disposed by the container alone, in reverse
 * creation order: a service is never torn down before something that depends on it.
 *
 * @example
 * ```ts
 * const container = createServiceContainer({ descriptors, resources });
 * const repository = container.get(ProjectRepository);
 * await container.dispose();
 * ```
 */
export interface ServiceContainer extends ServiceResolver {
  /**
   * Returns a resolver whose disposable transients are owned by `resources`
   * instead of the container's root scope. Singletons stay shared and owned by
   * this container. Disposing the supplied scope does not dispose singletons.
   */
  createResolver(resources: ResourceScope): ServiceResolver;

  /**
   * Disposes every created singleton in reverse creation order. Failures are
   * collected rather than short-circuited. Calling twice returns the same
   * promise, and no resolver may create services after disposal begins.
   *
   * @throws {@link ScopeCleanupError} after attempting every singleton when one
   * or more disposals fail.
   */
  dispose(): Promise<void>;
}

/**
 * Resolves a declared dependency map into the object a factory or handler receives.
 *
 * @example
 * ```ts
 * const injected = resolveInjected({ repository: ProjectRepository }, resolver);
 * // { repository: <ProjectRepository instance> }
 * ```
 */
export function resolveInjected(
  dependencies: ServiceMap,
  resolver: ServiceResolver
): Readonly<Record<string, unknown>> {
  // `defineOwn` rather than assignment: dependency names come from a
  // declaration the framework does not control, and one of them would reach
  // `Object.prototype`'s `__proto__` setter instead of creating a property.
  const injected: Record<string, unknown> = {};
  for (const [name, token] of Object.entries(dependencies)) {
    defineOwn(injected, name, resolver.get(token));
  }
  return injected;
}

/** Options for {@link createServiceContainer}. */
export interface ServiceContainerOptions {
  /** Validated descriptors, normally taken from a compiled application plan. */
  readonly descriptors: readonly ServiceDescriptor[];
  /** Owns disposable transients resolved through the container itself. */
  readonly resources: ResourceScope;
}

/**
 * Creates a service container over already-validated descriptors.
 *
 * Preflight is expected to have run: the runtime guards here are defence in
 * depth, not the primary check.
 *
 * @example
 * ```ts
 * const container = createServiceContainer({
 *   descriptors: plan.services,
 *   resources: hostResources,
 * });
 * ```
 */
export function createServiceContainer(options: ServiceContainerOptions): ServiceContainer {
  const byToken = new Map<ServiceToken<unknown>, ServiceDescriptor>();
  for (const descriptor of options.descriptors) {
    // Preflight rejects duplicates; last-one-wins here only matters if it was skipped.
    byToken.set(descriptor.token, descriptor);
  }

  const singletons = new Map<ServiceToken<unknown>, unknown>();
  const creationOrder: ServiceToken<unknown>[] = [];
  const resolving = new Set<ServiceToken<unknown>>();
  let disposePromise: Promise<void> | undefined;
  let disposeStarted = false;

  const instantiate = (descriptor: ServiceDescriptor, transientOwner: ResourceScope): unknown => {
    const injected: Record<string, unknown> = {};
    for (const [name, dependency] of Object.entries(descriptor.dependencies)) {
      defineOwn(injected, name, resolve(dependency, transientOwner));
    }

    const instance = descriptor.create(injected);
    if (isThenable(instance)) {
      claimRejection(instance);
      throw new AsyncCallbackError(
        `service factory for "${descriptor.token.id}"`,
        descriptor.moduleId
      );
    }
    return instance;
  };

  function resolve(token: ServiceToken<unknown>, transientOwner: ResourceScope): unknown {
    if (disposeStarted) {
      // A singleton created past this point would never be disposed: the
      // reverse-creation-order sweep has already run (or is running). Shutdown
      // code holding a stale resolver must not mint fresh services.
      throw new ServiceResolutionError(
        token.id,
        `Cannot resolve "${token.id}": the container is disposed.`
      );
    }
    const descriptor = byToken.get(token);
    if (descriptor === undefined) {
      throw new ServiceResolutionError(token.id, `No service is registered for "${token.id}".`);
    }

    if (descriptor.lifetime === ServiceLifetime.Singleton && singletons.has(token)) {
      return singletons.get(token);
    }

    if (resolving.has(token)) {
      throw new ServiceResolutionError(
        token.id,
        `Circular service dependency while resolving "${token.id}".`
      );
    }

    resolving.add(token);
    try {
      const instance = instantiate(descriptor, transientOwner);

      if (descriptor.lifetime === ServiceLifetime.Singleton) {
        singletons.set(token, instance);
        creationOrder.push(token);
        return instance;
      }

      // Transients are owned by whoever asked for them, so an operation's
      // instances go away with the operation.
      if (isDisposable(instance)) {
        transientOwner.own(instance);
      }
      return instance;
    } finally {
      resolving.delete(token);
    }
  }

  const runDispose = async (): Promise<void> => {
    const errors: unknown[] = [];

    for (let index = creationOrder.length - 1; index >= 0; index -= 1) {
      const token = creationOrder[index];
      if (token === undefined) {
        continue;
      }
      const instance = singletons.get(token);
      if (!isDisposable(instance)) {
        continue;
      }
      try {
        await instance.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    singletons.clear();
    creationOrder.length = 0;

    if (errors.length > 0) {
      throw new ScopeCleanupError('services', errors);
    }
  };

  return {
    get<T>(token: ServiceToken<T>): T {
      return resolve(token, options.resources) as T;
    },

    createResolver(resources: ResourceScope): ServiceResolver {
      return {
        get<T>(token: ServiceToken<T>): T {
          return resolve(token, resources) as T;
        },
      };
    },

    dispose(): Promise<void> {
      disposeStarted = true;
      disposePromise ??= runDispose();
      return disposePromise;
    },
  };
}
