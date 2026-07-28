/**
 * @packageDocumentation
 * Framework-agnostic structural types for the `./testing` mock kit.
 *
 * Every mock factory in this package accepts a {@link MockFrameworkLike}
 * instead of importing `vitest` (or any other test runner) directly. This
 * keeps `@kkdev92/vscode-ext-kit` — and its `/testing` subpath — at zero
 * runtime and zero type dependencies: nothing here ever does
 * `import { vi } from 'vitest'`.
 *
 * The pattern mirrors `jest-mock-vscode`'s `TestFramework` abstraction: any
 * object exposing a Jest/Vitest-shaped `fn()` — `vi`, `jest`, or a
 * hand-rolled compatible object — can be passed in.
 */

/**
 * Minimal structural shape this kit requires from a "mock function
 * factory". Vitest's `vi`, Jest's `jest`, or any compatible object
 * satisfies this — only a `.fn(...)` method is required.
 *
 * @example
 * ```ts
 * import { vi } from 'vitest';
 * import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';
 *
 * vi.mock('vscode', () => createVSCodeMock(vi));
 * ```
 *
 * @example
 * ```ts
 * // Jest works identically — no code in this package ever imports vitest.
 * import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';
 *
 * jest.mock('vscode', () => createVSCodeMock(jest));
 * ```
 */
export interface MockFrameworkLike {
  fn: MockFnCreator;
}

/**
 * Shape of `vi.fn` / `jest.fn`: creates a {@link MockFn}, optionally seeded
 * with an implementation. Argument and return types are inferred from the
 * given `implementation` when one is provided.
 */
export type MockFnCreator = <TArgs extends unknown[] = unknown[], TReturn = unknown>(
  implementation?: (...args: TArgs) => TReturn
) => MockFn<TArgs, TReturn>;

/**
 * The subset of `vi.fn()` / `jest.fn()`'s returned mock function that this
 * kit relies on: callable, and chainable with the handful of `mock*`
 * helpers actually used to build the `vscode` mock. Both Vitest's `Mock<T>`
 * and Jest's `jest.Mock<T>` satisfy this structurally, so no `vitest`/`jest`
 * type import is ever required here.
 */
export interface MockFn<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  (...args: TArgs): TReturn;
  /** Sets the value returned on every future call. */
  mockReturnValue(value: TReturn): this;
  /** Sets the value resolved (via `Promise.resolve`) on every future call. */
  mockResolvedValue(value: Awaited<TReturn>): this;
  /** Replaces the mock's implementation. */
  mockImplementation(fn: (...args: TArgs) => TReturn): this;
  /** Clears recorded calls/results/instances without touching the implementation. */
  mockClear(): this;
  /**
   * Recorded invocations, matching `vi.fn()`/`jest.fn()`'s own `.mock.calls`.
   * Each call's arguments are kept as `unknown[]` rather than `TArgs` on
   * purpose: a test overriding one of this kit's mock fields with a fresh,
   * more loosely typed `vi.fn()`/`jest.fn()` (a common per-test override)
   * must stay assignable, and callers reading `.mock.calls` almost always
   * either `toEqual(...)` the result or cast it explicitly anyway.
   */
  mock: { calls: unknown[][] };
}
