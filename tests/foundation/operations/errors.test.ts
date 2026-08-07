/**
 * Pure error-classification contract tests. These cases define which thrown
 * values are normal cancellation versus reportable failures; presentation and
 * logging policy are tested at the Operation/Application layer.
 */
import { describe, expect, it } from 'vitest';

import {
  CancellationReason,
  OperationCancelledError,
} from '../../../src/foundation/operations/cancellation.js';
import {
  ErrorKind,
  FrameworkError,
  classifyError,
  isCancellation,
  userError,
  validationError,
} from '../../../src/foundation/operations/errors.js';

/**
 * How a thrown value is classified.
 *
 * The framework decides whether to log an error, surface it or treat it as the
 * user having changed their mind, so the classification is the difference
 * between a silent cancel and a scary dialog.
 */
describe('classifyError', () => {
  it('recognises the framework cancellation', () => {
    expect(classifyError(new OperationCancelledError(CancellationReason.Caller))).toBe(
      ErrorKind.Cancelled
    );
  });

  it('reads the kind off a framework error', () => {
    expect(classifyError(userError({ code: 'bad.input', message: 'Bad input' }))).toBe(
      ErrorKind.User
    );
    expect(classifyError(validationError({ code: 'bad.args', message: 'Nope' }))).toBe(
      ErrorKind.Validation
    );
    expect(
      classifyError(new FrameworkError({ code: 'x', message: 'x', kind: ErrorKind.Unexpected }))
    ).toBe(ErrorKind.Unexpected);
  });

  it('recognises the cancellation names other runtimes throw', () => {
    // Platform and web APIs use several cancellation error names. None is our
    // class, but all represent cooperative cancellation rather than a bug.
    for (const name of ['AbortError', 'Canceled', 'CanceledError', 'CancellationError']) {
      const error = new Error('stopped');
      error.name = name;

      expect(classifyError(error)).toBe(ErrorKind.Cancelled);
      expect(isCancellation(error)).toBe(true);
    }
  });

  it('calls anything else unexpected', () => {
    expect(classifyError(new Error('boom'))).toBe(ErrorKind.Unexpected);
    expect(classifyError('a string')).toBe(ErrorKind.Unexpected);
    expect(classifyError(undefined)).toBe(ErrorKind.Unexpected);
  });

  it('does not mistake a similar name for cancellation', () => {
    const error = new Error('nope');
    error.name = 'CancellationErrorish';

    expect(isCancellation(error)).toBe(false);
  });
});
