/**
 * Mixed unit/Test Host/contract suite for managed file watching. It protects
 * batching, dedupe, filtering, bounds, listener isolation, transactional
 * construction, fake pattern fidelity, operation execution, and module
 * teardown. A failure in fake-routing cases means tests may be observing a
 * different contract from production even if handler assertions still pass.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createFakeFileWatchers, fakeUri } from '../../../src/testing/fakes/fake-filewatcher.js';
import { createTestHost } from '../../../src/testing/test-host.js';
import { createManagedFileWatcher } from '../../../src/capabilities/workspace/filewatcher.js';
import type { FileWatcherEvent } from '../../../src/capabilities/workspace/filewatcher.js';

afterEach(() => {
  vi.useRealTimers();
});

const collect = (): {
  batches: FileWatcherEvent[][];
  push: (events: FileWatcherEvent[]) => void;
} => {
  const batches: FileWatcherEvent[][] = [];
  return { batches, push: (events) => batches.push(events) };
};

describe('createManagedFileWatcher', () => {
  it('debounces events into one batch', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*.ts',
      debounceDelay: 100,
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('create', '/src/a.ts');
    capability._emit('change', '/src/b.ts');
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(100);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    watcher.dispose();
  });

  it('dedupes per file, keeping the latest event type', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, { patterns: '**/*.ts' });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('create', '/src/a.ts');
    capability._emit('change', '/src/a.ts');
    vi.advanceTimersByTime(100);

    expect(batches[0]).toHaveLength(1);
    expect(batches[0]?.[0]?.type).toBe('change');
    watcher.dispose();
  });

  it('anchors ignore globs to a whole trailing segment', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*',
      ignorePatterns: ['*.log'],
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('change', '/logs/app.log'); // ignored
    capability._emit('change', '/x.log.txt'); // NOT ignored: .log is not the end
    capability._emit('change', '/foo.logs'); // NOT ignored: segment differs
    vi.advanceTimersByTime(100);

    expect(batches[0]?.map((event) => event.uri.fsPath)).toEqual(['/x.log.txt', '/foo.logs']);
    watcher.dispose();
  });

  it('supports ** ignore patterns and substring patterns without wildcards', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*',
      ignorePatterns: ['**/node_modules/**', 'dist'],
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('change', '/project/node_modules/lib/index.js'); // ignored
    capability._emit('change', '/project/dist/out.js'); // ignored (substring)
    capability._emit('change', '/project/src/a.ts');
    vi.advanceTimersByTime(100);

    expect(batches[0]?.map((event) => event.uri.fsPath)).toEqual(['/project/src/a.ts']);
    watcher.dispose();
  });

  it('delivers to a listener snapshot even when one unsubscribes mid-delivery', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, { patterns: '**/*' });

    const order: string[] = [];
    // A one-shot listener disposing itself must not make delivery skip the next.
    const first = watcher.onDidChange(() => {
      order.push('first');
      first.dispose();
    });
    watcher.onDidChange(() => order.push('second'));

    capability._emit('change', '/a.ts');
    vi.advanceTimersByTime(100);

    expect(order).toEqual(['first', 'second']);
    watcher.dispose();
  });

  it('isolates a throwing listener', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, { patterns: '**/*' });
    const { batches, push } = collect();

    watcher.onDidChange(() => {
      throw new Error('bad listener');
    });
    watcher.onDidChange(push);

    capability._emit('change', '/a.ts');
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(batches).toHaveLength(1);
    watcher.dispose();
  });

  it('flushes immediately at maxBatchSize', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*',
      debounceDelay: 10_000,
      maxBatchSize: 2,
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('create', '/a.ts');
    expect(batches).toHaveLength(0);
    capability._emit('create', '/b.ts');

    // No timer wait: the burst bound triggered the flush.
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    watcher.dispose();
  });

  it('pause discards the pending batch and resume does not replay it', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, { patterns: '**/*' });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('change', '/a.ts');
    watcher.pause();
    expect(watcher.isWatching).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(batches).toHaveLength(0);

    // Events during pause are dropped too.
    capability._emit('change', '/b.ts');
    watcher.resume();
    expect(watcher.isWatching).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(batches).toHaveLength(0);

    // New events after resume flow again.
    capability._emit('change', '/c.ts');
    vi.advanceTimersByTime(100);
    expect(batches[0]?.[0]?.uri.fsPath).toBe('/c.ts');
    watcher.dispose();
  });

  it('dispose cancels pending timers and native watchers', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, { patterns: '**/*' });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('change', '/a.ts');
    watcher.dispose();

    expect(watcher.isWatching).toBe(false);
    expect(capability._watchedPatterns()).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    expect(batches).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes native ignore flags so unwanted event kinds never arrive', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*',
      events: ['change'],
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('create', '/a.ts');
    capability._emit('delete', '/b.ts');
    capability._emit('change', '/c.ts');
    vi.advanceTimersByTime(100);

    expect(batches[0]?.map((event) => event.type)).toEqual(['change']);
    watcher.dispose();
  });

  it('wraps string patterns with the workspace folder and keeps relative patterns as-is', () => {
    const capability = createFakeFileWatchers();
    const folder = { uri: fakeUri('/workspace/a') };
    const watcher = createManagedFileWatcher(capability, {
      patterns: ['**/*.ts', { baseUri: fakeUri('/workspace/b'), pattern: '**/*.md' }],
      workspaceFolder: folder,
    });

    expect(capability._watchedPatterns()).toEqual([
      'file:///workspace/a/**/*.ts',
      'file:///workspace/b/**/*.md',
    ]);
    watcher.dispose();
  });
});

describe('file watchers through the Test Host', () => {
  const Index = serviceToken<{ applied: string[][] }>('demo.index');

  it('runs each batch as an operation with injected dependencies', async () => {
    vi.useFakeTimers();
    const module = defineModule('watching', (builder): undefined => {
      builder.services.singleton(Index, () => ({ applied: [] }));
      builder.fileWatchers.add({
        id: 'project-files',
        patterns: ['**/*.project.json'],
        debounceDelay: 50,
        inject: { index: Index },
        handle: (_context, events, { index }) => {
          index.applied.push(events.map((event) => event.uri.fsPath));
        },
      });
      return undefined;
    });
    const ReadIndex = defineCommandContract<readonly [], string[][]>({ id: 'demo.readIndex' });
    const readerModule = defineModule('reader', (builder): undefined => {
      builder.commands.handle(ReadIndex, {
        inject: { index: Index },
        execute: (_context, _args, { index }) => index.applied,
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module, readerModule] }),
    });
    await host.start();

    host.fileWatchers._emit('change', '/a.project.json');
    await vi.advanceTimersByTimeAsync(50);

    await expect(host.application.commands.execute(ReadIndex)).resolves.toEqual([
      ['/a.project.json'],
    ]);
    expect(host.events).toContain('operation.completed');

    // Stop unwinds the native watchers with the module.
    await host.stop();
    expect(host.fileWatchers._watchedPatterns()).toHaveLength(0);
  });

  it('logs a failing handler instead of surfacing an unhandled rejection', async () => {
    vi.useFakeTimers();
    const module = defineModule('watching', (builder): undefined => {
      builder.fileWatchers.add({
        id: 'exploding',
        patterns: ['**/*'],
        debounceDelay: 10,
        handle: () => {
          throw new Error('handler failed');
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    host.fileWatchers._emit('change', '/a.ts');
    await vi.advanceTimersByTimeAsync(10);

    expect(host.logs.at('error')).toHaveLength(1);
    expect(host.events).toContain('operation.failed');
    await host.stop();
  });

  it('rejects a duplicate watcher id at preflight', () => {
    const module = defineModule('watching', (builder): undefined => {
      builder.fileWatchers.add({ id: 'same', patterns: ['**/*'], handle: () => undefined });
      builder.fileWatchers.add({ id: 'same', patterns: ['**/*'], handle: () => undefined });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /registered more than once/
    );
  });
});

describe('construction is a transaction', () => {
  /** A capability whose Nth `watch()` (or the handle's subscribe) throws. */
  function brittleCapability(options: {
    readonly failWatchAt?: number;
    readonly failSubscribeAt?: number;
  }) {
    const created: { disposed: boolean }[] = [];
    let watchCount = 0;
    const capability = {
      watch(): never | ReturnType<typeof makeHandle> {
        watchCount += 1;
        if (watchCount === options.failWatchAt) {
          throw new Error(`watch #${String(watchCount)} failed`);
        }
        return makeHandle(watchCount);
      },
    };
    function makeHandle(index: number) {
      const handle = {
        disposed: false,
        onDidCreate: () => ({ dispose: () => undefined }),
        onDidChange: (): { dispose(): void } => {
          if (index === options.failSubscribeAt) {
            throw new Error(`subscribe #${String(index)} failed`);
          }
          return { dispose: () => undefined };
        },
        onDidDelete: () => ({ dispose: () => undefined }),
        dispose(): void {
          handle.disposed = true;
        },
      };
      created.push(handle);
      return handle;
    }
    return { capability, created };
  }

  it('disposes the watchers already created when a later watch() throws', () => {
    const { capability, created } = brittleCapability({ failWatchAt: 3 });

    expect(() =>
      createManagedFileWatcher(capability as never, {
        patterns: ['**/*.ts', '**/*.md', '**/*.json'],
      })
    ).toThrow(/watch #3 failed/);

    // The factory never returns, so the caller has nothing to own: anything
    // created before the failure had to be cleaned up here.
    expect(created).toHaveLength(2);
    expect(created.every((handle) => handle.disposed)).toBe(true);
  });

  it('disposes the handle whose own subscription throws', () => {
    const { capability, created } = brittleCapability({ failSubscribeAt: 2 });

    expect(() =>
      createManagedFileWatcher(capability as never, { patterns: ['**/*.ts', '**/*.md'] })
    ).toThrow(/subscribe #2 failed/);

    expect(created).toHaveLength(2);
    expect(created.every((handle) => handle.disposed)).toBe(true);
  });

  it('leaves no debounce timer behind when construction fails', () => {
    vi.useFakeTimers();
    try {
      const { capability } = brittleCapability({ failWatchAt: 2 });
      expect(() =>
        createManagedFileWatcher(capability as never, {
          patterns: ['**/*.ts', '**/*.md'],
          debounceDelay: 500,
        })
      ).toThrow();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FakeFileWatchers pattern routing', () => {
  // The fake is part of the test contract: it must route by the registered
  // pattern, or a handler assertion proves nothing about that pattern.
  it('delivers only to the watchers whose pattern matches', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const typescript = createManagedFileWatcher(capability, { patterns: '**/*.ts' });
    const json = createManagedFileWatcher(capability, { patterns: '**/*.json' });
    const tsBatches = collect();
    const jsonBatches = collect();
    typescript.onDidChange(tsBatches.push);
    json.onDidChange(jsonBatches.push);

    capability._emit('change', '/src/a.ts');
    vi.advanceTimersByTime(100);

    expect(tsBatches.batches).toHaveLength(1);
    expect(jsonBatches.batches).toHaveLength(0);
    typescript.dispose();
    json.dispose();
  });

  it('honours a single star stopping at the separator', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: { baseUri: fakeUri('/workspace'), pattern: '*.ts' },
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('change', '/workspace/nested/deep.ts');
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(0);

    capability._emit('change', '/workspace/shallow.ts');
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(1);
    watcher.dispose();
  });

  it('scopes a relative pattern to its base folder', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*.ts',
      workspaceFolder: { uri: fakeUri('/workspace/a') },
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    // Same glob, different folder: the native watcher would never see it.
    capability._emit('change', '/workspace/b/src/x.ts');
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(0);

    capability._emit('change', '/workspace/a/src/x.ts');
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(1);
    watcher.dispose();
  });

  it('still respects the native ignore flags on a matching path', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*.ts',
      events: ['change'],
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    capability._emit('create', '/src/a.ts');
    capability._emit('delete', '/src/a.ts');
    vi.advanceTimersByTime(100);

    expect(batches).toHaveLength(0);
    watcher.dispose();
  });
});

describe('batch bounds', () => {
  it('delivers on maxWait even while the stream never goes quiet', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*.ts',
      debounceDelay: 100,
      maxWait: 250,
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    // Every 50ms, so the trailing debounce is pushed back before it ever fires.
    for (let index = 0; index < 10; index += 1) {
      capability._emit('change', `/src/file${String(index)}.ts`);
      vi.advanceTimersByTime(50);
    }

    // Without maxWait this is still zero, with the whole burst held in memory.
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.flat().length).toBeGreaterThan(0);
    watcher.dispose();
  });

  it('keeps waiting for quiet when neither bound is set', () => {
    vi.useFakeTimers();
    const capability = createFakeFileWatchers();
    const watcher = createManagedFileWatcher(capability, {
      patterns: '**/*.ts',
      debounceDelay: 100,
    });
    const { batches, push } = collect();
    watcher.onDidChange(push);

    for (let index = 0; index < 10; index += 1) {
      capability._emit('change', `/src/file${String(index)}.ts`);
      vi.advanceTimersByTime(50);
    }
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
    watcher.dispose();
  });
});
