/**
 * Port-level command fake used by TestHost.
 *
 * It models registration identity, disposal and dispatch—the behavior the
 * framework binder relies on. It does not model contribution visibility,
 * keybindings, activation events or the Command Palette; those are workbench
 * and manifest concerns for an Extension Host test.
 */
import type {
  ActiveTextEditor,
  CommandCapability,
  PlatformRegistration,
} from '../../foundation/platform/ports.js';

/**
 * In-memory command capability for tests.
 *
 * Mirrors the command port's observable behavior rather than being lenient:
 * a duplicate id throws, an unknown id rejects, and both return values and
 * rejections propagate. Shared contract tests pin the real adapter behavior
 * represented here; VS Code behavior outside the port is not implied.
 */
export interface FakeCommands extends CommandCapability {
  /** Ids currently registered, in registration order. */
  readonly registeredIds: readonly string[];
  /** Number of times each command was invoked. */
  invocationCount(id: string): number;
  /**
   * Invokes a text editor command with a scripted editor, standing in for VS
   * Code invoking it against the focused one.
   *
   * Returns the fake-only `{ settled }` hook after the handler returns. The
   * text-editor command port exposes no command result; `settled` separately
   * tracks the handler value or promise so a test can await framework work. A
   * synchronous handler throw escapes before this hook can be returned.
   *
   * Takes the editor port rather than a whole fake editor: a test that only
   * cares that the command ran can pass
   * `createFakeEditor().active as ActiveTextEditor`.
   */
  executeTextEditor(
    id: string,
    editor: ActiveTextEditor,
    ...args: readonly unknown[]
  ): Promise<{ readonly settled: Promise<unknown> }>;
}

/**
 * Creates a fake command capability.
 *
 * @example
 * ```ts
 * const commands = createFakeCommands();
 * const registration = commands.register('sample.refresh', () => 3);
 * await expect(commands.execute('sample.refresh')).resolves.toBe(3);
 * registration.dispose();
 * expect(commands.registeredIds).toEqual([]);
 * ```
 */
export function createFakeCommands(): FakeCommands {
  const handlers = new Map<string, (...args: readonly unknown[]) => unknown>();
  const textEditorHandlers = new Map<
    string,
    (editor: ActiveTextEditor, args: readonly unknown[]) => unknown
  >();
  const order: string[] = [];
  const invocations = new Map<string, number>();
  const has = (id: string): boolean => handlers.has(id) || textEditorHandlers.has(id);

  return {
    get registeredIds(): readonly string[] {
      return order.filter((id) => has(id));
    },

    invocationCount(id: string): number {
      return invocations.get(id) ?? 0;
    },

    register(id: string, handler: (...args: readonly unknown[]) => unknown): PlatformRegistration {
      if (has(id)) {
        // VS Code rejects a second registration of the same id.
        throw new Error(`command '${id}' already exists`);
      }
      handlers.set(id, handler);
      order.push(id);

      return {
        dispose(): void {
          handlers.delete(id);
        },
      };
    },

    registerTextEditor(
      id: string,
      handler: (editor: ActiveTextEditor, args: readonly unknown[]) => unknown
    ): PlatformRegistration {
      if (has(id)) {
        // One command-id namespace: a text-editor registration and a plain
        // registration cannot own the same id at the same time.
        throw new Error(`command '${id}' already exists`);
      }
      textEditorHandlers.set(id, handler);
      order.push(id);

      return {
        dispose(): void {
          textEditorHandlers.delete(id);
        },
      };
    },

    executeTextEditor(
      id: string,
      editor: ActiveTextEditor,
      ...args: readonly unknown[]
    ): Promise<{ readonly settled: Promise<unknown> }> {
      const handler = textEditorHandlers.get(id);
      if (handler === undefined) {
        return Promise.reject(new Error(`command '${id}' not found`));
      }
      invocations.set(id, (invocations.get(id) ?? 0) + 1);

      // Text-editor registration deliberately does not expose a command result
      // through this port. Preserve the handler promise separately as a test
      // hook so tests can await framework work without changing dispatch
      // semantics. A synchronous throw still occurs before that hook exists.
      const settled = Promise.resolve(handler(editor, args));
      settled.catch(() => undefined);
      return Promise.resolve({ settled });
    },

    async execute<T>(id: string, ...args: readonly unknown[]): Promise<T> {
      const handler = handlers.get(id);
      if (handler === undefined) {
        // VS Code rejects for an unregistered id. The exact message is not part
        // of its public contract, so only the rejection itself is contract-tested.
        throw new Error(`command '${id}' not found`);
      }
      invocations.set(id, (invocations.get(id) ?? 0) + 1);
      // Awaited so a thrown error and a rejected promise behave alike.
      return (await handler(...args)) as T;
    },
  };
}
