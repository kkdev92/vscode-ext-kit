/**
 * Pure cancellation primitive tests with native AbortControllers. No Host or
 * adapter is involved; change this suite when cancellation reasons, first-abort
 * propagation or listener-detachment ownership changes.
 */
import { describe, expect, it } from 'vitest';

import {
  CancellationReason,
  OperationCancelledError,
  combineAbortSignals,
} from '../../../src/foundation/operations/cancellation.js';

describe('OperationCancelledError', () => {
  it('carries the reason and a default message', () => {
    const error = new OperationCancelledError(CancellationReason.Timeout);

    expect(error.reason).toBe('timeout');
    expect(error.name).toBe('OperationCancelledError');
    expect(error.message).toContain('timeout');
  });

  it('accepts an explicit message', () => {
    const error = new OperationCancelledError(CancellationReason.Caller, 'caller gave up');
    expect(error.message).toBe('caller gave up');
  });
});

describe('combineAbortSignals', () => {
  it('aborts when any source aborts', () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineAbortSignals([first.signal, second.signal]);

    expect(combined.signal.aborted).toBe(false);

    second.abort(new OperationCancelledError(CancellationReason.VSCodeRequest));

    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBeInstanceOf(OperationCancelledError);
    combined.dispose();
  });

  it('is already aborted when a source was aborted up front', () => {
    const aborted = new AbortController();
    aborted.abort(new OperationCancelledError(CancellationReason.ApplicationStopping));
    const live = new AbortController();

    const combined = combineAbortSignals([live.signal, aborted.signal]);

    expect(combined.signal.aborted).toBe(true);
    const reason = combined.signal.reason as OperationCancelledError;
    expect(reason.reason).toBe('application-stopping');
    // dispose stays safe even though nothing was attached.
    expect(() => combined.dispose()).not.toThrow();
  });

  it('detaches listeners on dispose so long-lived sources do not accumulate them', () => {
    const root = new AbortController();
    const combined = combineAbortSignals([root.signal]);

    combined.dispose();
    root.abort();

    // The combined signal was released before the source aborted.
    expect(combined.signal.aborted).toBe(false);
  });

  it('detaches listeners after firing once', () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineAbortSignals([first.signal, second.signal]);

    first.abort(new OperationCancelledError(CancellationReason.Superseded));
    const firstReason = combined.signal.reason as OperationCancelledError;

    // A later abort on another source cannot overwrite the recorded reason.
    second.abort(new OperationCancelledError(CancellationReason.Timeout));
    const stillFirst = combined.signal.reason as OperationCancelledError;

    expect(firstReason.reason).toBe('superseded');
    expect(stillFirst.reason).toBe('superseded');
    combined.dispose();
  });

  it('handles an empty source list', () => {
    const combined = combineAbortSignals([]);

    expect(combined.signal.aborted).toBe(false);
    combined.dispose();
  });
});
