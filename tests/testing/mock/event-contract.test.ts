import { describe, expect, it, vi } from 'vitest';

import {
  EventEmitter,
  createMockFileSystemWatcher,
  createMockInputBox,
  createMockQuickPick,
  createMockTreeView,
  createMockWebview,
  createMockWebviewPanel,
  createMockWebviewView,
} from '../../../src/testing/index.js';

/**
 * The Event/Disposable contract, run against every event the mock kit exposes.
 *
 * A mock's whole value is that code behaves the same against it as against the
 * real API, and the two ways that quietly breaks are both about *removal*:
 *
 * - A `dispose()` that does nothing. The kit had two of those on QuickPick, so
 *   an extension that unsubscribed still got called and no test could notice.
 * - A `dispose()` that removes the wrong listener. `splice(indexOf(listener), 1)`
 *   splices at `-1` once the listener is already gone, which deletes the *last*
 *   registered listener instead — so a harmless double dispose silently
 *   unsubscribes somebody else. Real VS Code disposables are idempotent.
 *
 * One table, three properties, every event. A new event added without proper
 * removal fails here rather than in a consumer's extension.
 *
 * Maintenance rule: every fireable event exported by the low-level mock belongs
 * in `CASES`. Events that are spy-only and intentionally cannot fire must say so
 * in their builder JSDoc rather than being silently omitted from this table.
 */
interface Harness {
  subscribe(listener: () => void): { dispose(): void };
  fire(): void;
}

interface EventCase {
  readonly name: string;
  readonly make: () => Harness;
}

const CASES: readonly EventCase[] = [
  {
    name: 'EventEmitter.event',
    make: () => {
      const emitter = new EventEmitter<number>();
      return { subscribe: (listener) => emitter.event(listener), fire: () => emitter.fire(1) };
    },
  },
  {
    name: 'QuickPick.onDidAccept',
    make: () => {
      const target = createMockQuickPick(vi);
      return {
        subscribe: (listener) => target.onDidAccept(listener),
        fire: () => target._accept(),
      };
    },
  },
  {
    name: 'QuickPick.onDidTriggerButton',
    make: () => {
      const target = createMockQuickPick(vi);
      return {
        subscribe: (listener) => target.onDidTriggerButton(listener),
        fire: () => target._triggerButton({}),
      };
    },
  },
  {
    name: 'QuickPick.onDidTriggerItemButton',
    make: () => {
      const target = createMockQuickPick(vi);
      return {
        subscribe: (listener) => target.onDidTriggerItemButton(listener),
        fire: () => target._triggerItemButton({}),
      };
    },
  },
  {
    name: 'QuickPick.onDidChangeValue',
    make: () => {
      const target = createMockQuickPick(vi);
      return {
        subscribe: (listener) => target.onDidChangeValue(listener),
        fire: () => target._setValue('x'),
      };
    },
  },
  {
    name: 'QuickPick.onDidHide',
    make: () => {
      const target = createMockQuickPick(vi);
      return { subscribe: (listener) => target.onDidHide(listener), fire: () => target._hide() };
    },
  },
  {
    name: 'InputBox.onDidAccept',
    make: () => {
      const target = createMockInputBox(vi);
      return {
        subscribe: (listener) => target.onDidAccept(listener),
        fire: () => target._accept(),
      };
    },
  },
  {
    name: 'InputBox.onDidTriggerButton',
    make: () => {
      const target = createMockInputBox(vi);
      return {
        subscribe: (listener) => target.onDidTriggerButton(listener),
        fire: () => target._triggerButton({}),
      };
    },
  },
  {
    name: 'InputBox.onDidChangeValue',
    make: () => {
      const target = createMockInputBox(vi);
      return {
        subscribe: (listener) => target.onDidChangeValue(listener),
        fire: () => target._setValue('x'),
      };
    },
  },
  {
    name: 'InputBox.onDidHide',
    make: () => {
      const target = createMockInputBox(vi);
      return { subscribe: (listener) => target.onDidHide(listener), fire: () => target._hide() };
    },
  },
  {
    name: 'FileSystemWatcher.onDidCreate',
    make: () => {
      const target = createMockFileSystemWatcher(vi);
      return {
        subscribe: (listener) => target.onDidCreate(listener),
        fire: () => target._fireCreate({}),
      };
    },
  },
  {
    name: 'FileSystemWatcher.onDidChange',
    make: () => {
      const target = createMockFileSystemWatcher(vi);
      return {
        subscribe: (listener) => target.onDidChange(listener),
        fire: () => target._fireChange({}),
      };
    },
  },
  {
    name: 'FileSystemWatcher.onDidDelete',
    make: () => {
      const target = createMockFileSystemWatcher(vi);
      return {
        subscribe: (listener) => target.onDidDelete(listener),
        fire: () => target._fireDelete({}),
      };
    },
  },
  {
    name: 'TreeView.onDidExpandElement',
    make: () => {
      const target = createMockTreeView<string>(vi);
      return {
        subscribe: (listener) => target.onDidExpandElement(listener),
        fire: () => target._fireExpandElement('node'),
      };
    },
  },
  {
    name: 'TreeView.onDidCollapseElement',
    make: () => {
      const target = createMockTreeView<string>(vi);
      return {
        subscribe: (listener) => target.onDidCollapseElement(listener),
        fire: () => target._fireCollapseElement('node'),
      };
    },
  },
  {
    name: 'TreeView.onDidChangeSelection',
    make: () => {
      const target = createMockTreeView<string>(vi);
      return {
        subscribe: (listener) => target.onDidChangeSelection(listener),
        fire: () => target._fireSelectionChange(['node']),
      };
    },
  },
  {
    name: 'TreeView.onDidChangeVisibility',
    make: () => {
      const target = createMockTreeView<string>(vi);
      return {
        subscribe: (listener) => target.onDidChangeVisibility(listener),
        fire: () => target._fireVisibilityChange(false),
      };
    },
  },
  {
    name: 'TreeView.onDidChangeCheckboxState',
    make: () => {
      const target = createMockTreeView<string>(vi);
      return {
        subscribe: (listener) => target.onDidChangeCheckboxState(listener),
        fire: () => target._fireCheckboxState([['node', 1]]),
      };
    },
  },
  {
    name: 'Webview.onDidReceiveMessage',
    make: () => {
      const target = createMockWebview(vi);
      return {
        subscribe: (listener) => target.onDidReceiveMessage(listener),
        fire: () => target._fireMessage({}),
      };
    },
  },
  {
    name: 'WebviewPanel.onDidChangeViewState',
    make: () => {
      const target = createMockWebviewPanel(vi);
      return {
        subscribe: (listener) => target.onDidChangeViewState(listener),
        fire: () => target._fireViewStateChange(false),
      };
    },
  },
  {
    name: 'WebviewPanel.onDidDispose',
    make: () => {
      const target = createMockWebviewPanel(vi);
      return {
        subscribe: (listener) => target.onDidDispose(listener),
        fire: () => target._fireDispose(),
      };
    },
  },
  {
    name: 'WebviewView.onDidChangeVisibility',
    make: () => {
      const target = createMockWebviewView(vi);
      return {
        subscribe: (listener) => target.onDidChangeVisibility(listener),
        fire: () => target._fireVisibilityChange(),
      };
    },
  },
  {
    name: 'WebviewView.onDidDispose',
    make: () => {
      const target = createMockWebviewView(vi);
      return {
        subscribe: (listener) => target.onDidDispose(listener),
        fire: () => target._fireDispose(),
      };
    },
  },
];

describe('mock kit Event/Disposable contract', () => {
  for (const { name, make } of CASES) {
    describe(name, () => {
      it('delivers to a subscribed listener', () => {
        const harness = make();
        const listener = vi.fn();
        harness.subscribe(listener);

        harness.fire();

        expect(listener).toHaveBeenCalledTimes(1);
      });

      it('dispose removes exactly the listener it belongs to', () => {
        const harness = make();
        const first = vi.fn();
        const second = vi.fn();
        const subscription = harness.subscribe(first);
        harness.subscribe(second);

        subscription.dispose();
        harness.fire();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
      });

      it('survives a second dispose without unsubscribing anyone else', () => {
        const harness = make();
        const first = vi.fn();
        const second = vi.fn();
        const subscription = harness.subscribe(first);
        harness.subscribe(second);

        subscription.dispose();
        expect(() => {
          subscription.dispose();
        }).not.toThrow();
        harness.fire();

        // `splice(indexOf(listener), 1)` splices at -1 the second time, which
        // deletes the last listener registered — `second`, here.
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
      });
    });
  }

  it('leaves a stale subscription harmless after the emitter itself is disposed', () => {
    const emitter = new EventEmitter<number>();
    const stale = vi.fn();
    const subscription = emitter.event(stale);

    emitter.dispose();
    const survivor = vi.fn();
    emitter.event(survivor);
    subscription.dispose();
    emitter.fire(1);

    expect(stale).not.toHaveBeenCalled();
    expect(survivor).toHaveBeenCalledTimes(1);
  });
});
