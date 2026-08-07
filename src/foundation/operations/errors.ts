import { OperationCancelledError } from './cancellation.js';

/**
 * Semantic classification attached to an error. The Operation executor uses it
 * for failure versus cancellation diagnostics; presentation policy belongs to
 * the ingress layer that receives the rejection.
 */
export const ErrorKind = {
  /** Cooperative cancellation. Diagnosed at debug level; the rejection still reaches callers. */
  Cancelled: 'cancelled',
  /** Caused by user input or state; safe to show verbatim. */
  User: 'user',
  /** Anticipated failure with a safe message. */
  Expected: 'expected',
  /** Input failed validation at a trust boundary. */
  Validation: 'validation',
  /** Ran out of time. */
  Timeout: 'timeout',
  /** A bug. Log the full cause; any user-facing presentation should hide internals. */
  Unexpected: 'unexpected',
  /** Failure while activating. */
  Activation: 'activation',
  /** Failure while shutting down. */
  Shutdown: 'shutdown',
} as const;

/** Union of {@link ErrorKind} values. */
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

/** Options for {@link FrameworkError} and its helper factories. */
export interface FrameworkErrorOptions {
  /** Stable, machine-readable code. */
  readonly code: string;
  /** How to treat this error. */
  readonly kind: ErrorKind;
  /** Message safe to show to a user. Internal detail belongs in `cause`. */
  readonly message: string;
  /** Underlying cause, logged but never shown. */
  readonly cause?: unknown;
  /** Extra structured context for logs. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * An error with an explicit kind, a stable code, and a user-safe message kept
 * separate from its internal cause.
 *
 * @example
 * ```ts
 * throw userError({
 *   code: 'PROJECT_LOAD_FAILED',
 *   message: 'Project could not be loaded.',
 *   cause: error,
 * });
 * ```
 */
export class FrameworkError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: FrameworkErrorOptions) {
    // `cause` is only set when provided: with exactOptionalPropertyTypes an
    // explicit `undefined` is not the same as an absent property.
    super(options.message, ...(options.cause === undefined ? [] : [{ cause: options.cause }]));
    this.name = 'FrameworkError';
    this.code = options.code;
    this.kind = options.kind;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

/**
 * Creates a user-facing error whose message is safe to display.
 *
 * @example
 * ```ts
 * throw userError({ code: 'NO_WORKSPACE', message: 'Open a folder first.' });
 * ```
 */
export function userError(options: Omit<FrameworkErrorOptions, 'kind'>): FrameworkError {
  return new FrameworkError({ ...options, kind: ErrorKind.User });
}

/**
 * Creates a validation error for input that crossed a trust boundary.
 *
 * @example
 * ```ts
 * throw validationError({ code: 'BAD_ARGS', message: 'force must be a boolean.' });
 * ```
 */
export function validationError(options: Omit<FrameworkErrorOptions, 'kind'>): FrameworkError {
  return new FrameworkError({ ...options, kind: ErrorKind.Validation });
}

/** Compatibility names commonly used by platform and web cancellation errors. */
const CANCELLATION_NAMES = new Set([
  'AbortError',
  'Canceled',
  'CanceledError',
  'CancellationError',
]);

/**
 * Classifies an unknown thrown value.
 *
 * Cancellation must never be mistaken for a bug: it is normal control flow and
 * gets a debug log instead of an error report.
 *
 * @example
 * ```ts
 * if (classifyError(error) === ErrorKind.Cancelled) return;
 * ```
 */
export function classifyError(error: unknown): ErrorKind {
  if (error instanceof OperationCancelledError) {
    return ErrorKind.Cancelled;
  }
  if (error instanceof FrameworkError) {
    return error.kind;
  }
  if (error instanceof Error && CANCELLATION_NAMES.has(error.name)) {
    return ErrorKind.Cancelled;
  }
  return ErrorKind.Unexpected;
}

/**
 * Whether a thrown value represents cancellation.
 *
 * @example
 * ```ts
 * catch (error) {
 *   if (isCancellation(error)) return undefined;
 *   throw error;
 * }
 * ```
 */
export function isCancellation(error: unknown): boolean {
  return classifyError(error) === ErrorKind.Cancelled;
}
