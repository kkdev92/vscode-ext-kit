/**
 * Foundation-only tests spanning service graph validation, container lifetime
 * ownership, Module declaration and ApplicationPlan compilation. Keep cases here
 * when an invariant crosses those definition-time layers; runtime Host binding
 * and adapter behavior have separate suites.
 */
import { describe, expect, it, vi } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import {
  AsyncCallbackError,
  PreflightError,
  ServiceResolutionError,
} from '../../../src/foundation/internal/errors.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { createResourceScope } from '../../../src/foundation/resources/resource-scope.js';
import { createServiceContainer } from '../../../src/foundation/services/container.js';
import { ServiceLifetime } from '../../../src/foundation/services/descriptors.js';
import type { ServiceDescriptor } from '../../../src/foundation/services/descriptors.js';
import {
  ServiceGraphIssueCode,
  validateServiceGraph,
} from '../../../src/foundation/services/graph.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { Editors } from '../../../src/capabilities/editor/editor.js';
import { Log } from '../../../src/foundation/logging/token.js';
import { Notifications } from '../../../src/capabilities/ui/notifications.js';
import { defineSecret, defineStorage } from '../../../src/capabilities/storage/definition.js';
import { defineSettings, setting } from '../../../src/foundation/settings/definition.js';
import type { ServiceMap, ServiceToken } from '../../../src/foundation/services/token.js';

interface Clock {
  now(): number;
}
interface Repository {
  readonly clock: Clock;
}

const Clock = serviceToken<Clock>('core.clock');
const Repository = serviceToken<Repository>('projects.repository');

const scope = (): ReturnType<typeof createResourceScope> =>
  createResourceScope('test', { signal: new AbortController().signal });

describe('validateServiceGraph', () => {
  const descriptor = (
    token: ServiceToken<unknown>,
    lifetime: ServiceLifetime,
    dependencies: ServiceMap = {}
  ): ServiceDescriptor => ({
    token,
    lifetime,
    dependencies,
    create: () => ({ now: () => 0 }),
    moduleId: 'test',
  });

  it('accepts a valid graph', () => {
    expect(validateServiceGraph([descriptor(Clock, ServiceLifetime.Singleton)])).toEqual([]);
  });

  it('reports a duplicate token with both owning modules', () => {
    const issues = validateServiceGraph([
      { ...descriptor(Clock, ServiceLifetime.Singleton), moduleId: 'a' },
      { ...descriptor(Clock, ServiceLifetime.Singleton), moduleId: 'b' },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ServiceGraphIssueCode.DuplicateToken);
    expect(issues[0]?.message).toContain('"a"');
    expect(issues[0]?.message).toContain('"b"');
  });

  it('reports a missing dependency by its injected name', () => {
    const issues = validateServiceGraph([
      { ...descriptor(Repository, ServiceLifetime.Singleton, { clock: Clock }) },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ServiceGraphIssueCode.MissingDependency);
    expect(issues[0]?.message).toContain('"clock"');
    expect(issues[0]?.message).toContain('core.clock');
  });

  it('reports a captive dependency when a singleton depends on a transient', () => {
    const issues = validateServiceGraph([
      descriptor(Clock, ServiceLifetime.Transient),
      descriptor(Repository, ServiceLifetime.Singleton, { clock: Clock }),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ServiceGraphIssueCode.CaptiveDependency);
    expect(issues[0]?.path).toEqual(['projects.repository', 'core.clock']);
  });

  it('reports a cycle once, with the path it walked', () => {
    const issues = validateServiceGraph([
      descriptor(Clock, ServiceLifetime.Singleton, { repository: Repository }),
      descriptor(Repository, ServiceLifetime.Singleton, { clock: Clock }),
    ]);

    const cycles = issues.filter(
      (issue) => issue.code === ServiceGraphIssueCode.CircularDependency
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path?.length).toBe(3);
  });
});

describe('createServiceContainer', () => {
  it('creates a singleton lazily and caches it', () => {
    const create = vi.fn(() => ({ now: () => 1 }));
    const container = createServiceContainer({
      descriptors: [
        {
          token: Clock,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create,
          moduleId: 'm',
        },
      ],
      resources: scope(),
    });

    expect(create).not.toHaveBeenCalled();
    expect(container.get(Clock)).toBe(container.get(Clock));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('creates a new transient per resolution', () => {
    const container = createServiceContainer({
      descriptors: [
        {
          token: Clock,
          lifetime: ServiceLifetime.Transient,
          dependencies: {},
          create: () => ({ now: () => 1 }),
          moduleId: 'm',
        },
      ],
      resources: scope(),
    });

    expect(container.get(Clock)).not.toBe(container.get(Clock));
  });

  it('injects declared dependencies by name', () => {
    const container = createServiceContainer({
      descriptors: [
        {
          token: Clock,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () => ({ now: () => 7 }),
          moduleId: 'm',
        },
        {
          token: Repository,
          lifetime: ServiceLifetime.Singleton,
          dependencies: { clock: Clock },
          create: (injected) => ({ clock: injected['clock'] as Clock }),
          moduleId: 'm',
        },
      ],
      resources: scope(),
    });

    expect(container.get(Repository).clock.now()).toBe(7);
  });

  it('rejects an unregistered token', () => {
    const container = createServiceContainer({ descriptors: [], resources: scope() });
    expect(() => container.get(Clock)).toThrow(ServiceResolutionError);
  });

  it('rejects an async factory', () => {
    const container = createServiceContainer({
      descriptors: [
        {
          token: Clock,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () => Promise.resolve({ now: () => 0 }),
          moduleId: 'm',
        },
      ],
      resources: scope(),
    });

    expect(() => container.get(Clock)).toThrow(AsyncCallbackError);
  });

  it('disposes singletons in reverse creation order', async () => {
    const order: string[] = [];
    const container = createServiceContainer({
      descriptors: [
        {
          token: Clock,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () => ({ now: () => 0, dispose: () => order.push('clock') }),
          moduleId: 'm',
        },
        {
          token: Repository,
          lifetime: ServiceLifetime.Singleton,
          dependencies: { clock: Clock },
          create: (injected) => ({
            clock: injected['clock'] as Clock,
            dispose: () => order.push('repository'),
          }),
          moduleId: 'm',
        },
      ],
      resources: scope(),
    });

    container.get(Repository);
    await container.dispose();

    // Clock was created first (as a dependency), so it is disposed last.
    expect(order).toEqual(['repository', 'clock']);
  });

  it('owns a disposable transient in the resolving scope', async () => {
    const disposed = vi.fn();
    const resources = scope();
    const container = createServiceContainer({
      descriptors: [
        {
          token: Clock,
          lifetime: ServiceLifetime.Transient,
          dependencies: {},
          create: () => ({ now: () => 0, dispose: disposed }),
          moduleId: 'm',
        },
      ],
      resources,
    });

    const operationScope = resources.detachedChild('operation');
    container.createResolver(operationScope).get(Clock);
    expect(disposed).not.toHaveBeenCalled();

    await operationScope.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});

describe('defineModule', () => {
  it('collects services, commands and hosted services', () => {
    const Refresh = defineCommandContract({ id: 'sample.refresh' });

    const module = defineModule('projects', (builder): undefined => {
      builder.services.singleton(Clock, () => ({ now: () => 0 }));
      builder.services.singleton(Repository, {
        inject: { clock: Clock },
        create: ({ clock }) => ({ clock }),
      });
      builder.commands.handle(Refresh, () => undefined);
      builder.hostedServices.add({ id: 'projects.warmup', start: () => undefined });
      return undefined;
    });

    expect(module.id).toBe('projects');
    expect(module.services).toHaveLength(2);
    expect(module.commands).toHaveLength(1);
    expect(module.hostedServices).toHaveLength(1);
    expect(module.services[1]?.dependencies).toEqual({ clock: Clock });
  });

  it('rejects an async configure callback', () => {
    expect(() =>
      // A stray `async` is exactly what the runtime check exists to catch.
      defineModule('bad', (() => Promise.resolve(undefined)) as unknown as () => undefined)
    ).toThrow(AsyncCallbackError);
  });

  it('produces frozen definition arrays', () => {
    const module = defineModule('projects', (): undefined => undefined);
    expect(Object.isFrozen(module.services)).toBe(true);
  });
});

describe('compileApplication', () => {
  it('flattens modules into an immutable plan', () => {
    const Refresh = defineCommandContract({ id: 'sample.refresh' });
    const module = defineModule('projects', (builder): undefined => {
      builder.services.singleton(Clock, () => ({ now: () => 0 }));
      builder.commands.handle(Refresh, () => undefined);
      return undefined;
    });

    const plan = compileApplication({ name: 'sample', modules: [module] });

    expect(plan.services).toHaveLength(1);
    expect(plan.commands).toHaveLength(1);
    expect(plan.shutdown.timeoutMs).toBe(3_000);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('reports every problem at once rather than the first', () => {
    const Refresh = defineCommandContract({ id: 'sample.refresh' });
    const first = defineModule('a', (builder): undefined => {
      builder.commands.handle(Refresh, () => undefined);
      return undefined;
    });
    const second = defineModule('b', (builder): undefined => {
      builder.commands.handle(Refresh, {
        inject: { clock: Clock },
        execute: () => undefined,
      });
      return undefined;
    });

    let caught: unknown;
    try {
      compileApplication({ name: 'sample', modules: [first, second] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const issues = (caught as PreflightError).issues;
    // Duplicate command id AND the command's missing dependency.
    expect(issues).toHaveLength(2);
    expect(issues.join('\n')).toContain('only one handler per command id');
    expect(issues.join('\n')).toContain('core.clock');
  });

  it('rejects a duplicate module id', () => {
    const module = defineModule('projects', (): undefined => undefined);
    expect(() => compileApplication({ name: 'sample', modules: [module, module] })).toThrow(
      /registered more than once/
    );
  });

  it('rejects a hosted service that declares no lifecycle', () => {
    const module = defineModule('projects', (builder): undefined => {
      builder.hostedServices.add({ id: 'projects.empty' });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /declares no start, run or stop/
    );
  });

  it('honours an explicit shutdown budget', () => {
    const plan = compileApplication({
      name: 'sample',
      modules: [],
      shutdown: { timeoutMs: 500 },
    });
    expect(plan.shutdown.timeoutMs).toBe(500);
  });

  /**
   * The Application synthesises framework service descriptors at runtime, so
   * definition-time graph validation must treat their tokens as provided even
   * though they are absent from `plan.services`.
   */
  it('lets a module service inject a framework token', () => {
    const Store = serviceToken<object>('projects.store');
    const module = defineModule('projects', (builder): undefined => {
      builder.services.singleton(Store, {
        inject: { notify: Notifications, editors: Editors, log: Log },
        create: (injected) => injected,
      });
      builder.hostedServices.add({
        id: 'projects.worker',
        inject: { store: Store },
        start: () => undefined,
      });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).not.toThrow();
  });

  it('lets a module service inject a declared setting, storage and secret', () => {
    const Recent = defineStorage<readonly string[]>({
      key: 'projects.recent',
      scope: 'workspace',
      defaultValue: [],
    });
    const Token = defineSecret({ key: 'projects.token' });
    const Options = defineSettings({
      section: 'projects',
      values: { limit: setting.number({ default: 10 }) },
    });
    const Store = serviceToken<object>('projects.store');

    const module = defineModule('projects', (builder): undefined => {
      builder.storage.add(Recent);
      builder.secrets.add(Token);
      builder.settings.add(Options);
      builder.services.singleton(Store, {
        // The framework builds a descriptor for each of these, so all three
        // resolve at runtime — but none of them is in `plan.services`.
        inject: { recent: Recent.token, token: Token.token, options: Options.token },
        create: (injected) => injected,
      });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).not.toThrow();
  });

  it('still rejects a service depending on a token nobody provides', () => {
    const Store = serviceToken<object>('projects.store');
    const Missing = serviceToken<object>('projects.missing');
    const module = defineModule('projects', (builder): undefined => {
      builder.services.singleton(Store, {
        inject: { missing: Missing },
        create: (injected) => injected,
      });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /projects\.missing/
    );
  });
});
