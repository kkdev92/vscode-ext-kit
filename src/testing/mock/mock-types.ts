/**
 * @packageDocumentation
 * Framework-agnostic structural types for the `./testing` mock kit.
 *
 * Every mock factory in this package accepts a {@link MockFrameworkLike}
 * instead of importing `vitest` (or any other test runner) directly. This
 * keeps the runner-neutral testing entry point free of a runtime dependency on
 * Vitest or Jest: nothing here imports either runner.
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
 * type import is ever required here. This interface is a portability boundary,
 * not an attempt to expose every runner-specific spy assertion/helper.
 */
export interface MockFn<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  (...args: TArgs): TReturn;
  /** Sets the value returned on every future call. */
  mockReturnValue(value: TReturn): this;
  /** Sets the value returned by the next call only. */
  mockReturnValueOnce(value: TReturn): this;
  /** Sets the value resolved (via `Promise.resolve`) on every future call. */
  mockResolvedValue(value: Awaited<TReturn>): this;
  /** Sets the value resolved by the next call only. */
  mockResolvedValueOnce(value: Awaited<TReturn>): this;
  /** Makes every future call return a promise rejected with `reason`. */
  mockRejectedValue(reason: unknown): this;
  /** Makes the next call only return a promise rejected with `reason`. */
  mockRejectedValueOnce(reason: unknown): this;
  /** Replaces the mock's implementation. */
  mockImplementation(fn: (...args: TArgs) => TReturn): this;
  /** Replaces the implementation for the next call only. */
  mockImplementationOnce(fn: (...args: TArgs) => TReturn): this;
  /** Clears recorded calls/results/instances without touching the implementation. */
  mockClear(): this;
  /**
   * Recorded invocations and their outcomes, matching `vi.fn()`/`jest.fn()`'s
   * own `.mock` object.
   *
   * Arguments and returned values are kept as `unknown` rather than
   * `TArgs`/`TReturn` on purpose: a test overriding one of this kit's mock
   * fields with a fresh, more loosely typed `vi.fn()`/`jest.fn()` (a common
   * per-test override) must stay assignable, and callers reading these almost
   * always either `toEqual(...)` the result or cast it explicitly anyway.
   *
   * `results` is what makes a factory-shaped mock testable: it's the only way
   * to reach the object a call *returned* — e.g. the channel handed back by
   * `window.createOutputChannel` — so assertions can be made against it.
   * `'incomplete'` is part of the union because both runners use it for a call
   * that is still in flight; narrow on `type === 'return'` before trusting
   * `value`.
   */
  mock: {
    calls: unknown[][];
    results: { type: 'return' | 'throw' | 'incomplete'; value: unknown }[];
  };
}
