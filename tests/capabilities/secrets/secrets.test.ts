/**
 * Unit and adversarial-security suite for secret stores/accessors over the fake
 * secrets port. It protects key scoping, structured JSON validation, ownership,
 * preservation of invalid credentials, and value redaction even with hostile
 * schemas. Any leaked sentinel is a security regression, not a snapshot change.
 */
import { describe, expect, it } from 'vitest';

import { s } from '../../../src/capabilities/core/schema.js';
import { FrameworkError } from '../../../src/foundation/operations/errors.js';
import {
  createSecretAccessor,
  createSecretStorage,
  createSecretStore,
} from '../../../src/capabilities/secrets/secrets.js';
import { createFakeSecrets } from '../../../src/testing/fakes/fake-storage.js';

describe('createSecretStore', () => {
  it('round-trips values and lists keys', async () => {
    const store = createSecretStore(createFakeSecrets());

    await store.set('apiKey', 'sk-1');
    await store.set('other', 'sk-2');

    expect(await store.get('apiKey')).toBe('sk-1');
    expect([...(await store.keys())].sort()).toEqual(['apiKey', 'other']);

    await store.delete('apiKey');
    expect(await store.get('apiKey')).toBeUndefined();
    store.dispose();
  });

  it('notifies with the affected key on store and delete', async () => {
    const store = createSecretStore(createFakeSecrets());
    const seen: string[] = [];
    store.onDidChange((key) => seen.push(key));

    await store.set('a', '1');
    await store.delete('a');

    expect(seen).toEqual(['a', 'a']);
    store.dispose();
  });

  it('stops notifying after dispose', async () => {
    const capability = createFakeSecrets();
    const store = createSecretStore(capability);
    const seen: string[] = [];
    store.onDidChange((key) => seen.push(key));

    store.dispose();
    await capability.store('a', '1');

    expect(seen).toEqual([]);
  });
});

describe('createSecretStorage', () => {
  it('scopes to one key and only notifies for it', async () => {
    const capability = createFakeSecrets();
    const storage = createSecretStorage(capability, 'apiKey');
    let notified = 0;
    storage.onDidChange(() => {
      notified += 1;
    });

    await storage.set('sk-1');
    expect(await storage.get()).toBe('sk-1');
    expect(notified).toBe(1);

    // A different key must not notify this wrapper.
    await capability.store('other', 'x');
    expect(notified).toBe(1);

    await storage.delete();
    expect(await storage.get()).toBeUndefined();
    expect(notified).toBe(2);
    storage.dispose();
  });
});

describe('createSecretAccessor', () => {
  it('is a plain string secret without a schema', async () => {
    const accessor = createSecretAccessor(createFakeSecrets(), { key: 'token' });

    expect(await accessor.read()).toBeUndefined();
    await accessor.write('sk-raw');
    expect(await accessor.read()).toBe('sk-raw');
    accessor.dispose();
  });

  it('serializes structured secrets as JSON and validates on read', async () => {
    const capability = createFakeSecrets();
    const accessor = createSecretAccessor(capability, {
      key: 'credentials',
      schema: s.object({ token: s.string(), endpoint: s.string() }),
    });

    await accessor.write({ token: 'sk-1', endpoint: 'https://api' });

    expect(capability._entries().get('credentials')).toBe(
      JSON.stringify({ token: 'sk-1', endpoint: 'https://api' })
    );
    expect(await accessor.read()).toEqual({ token: 'sk-1', endpoint: 'https://api' });
    accessor.dispose();
  });

  it('throws on malformed JSON without leaking the value, and never auto-deletes', async () => {
    const capability = createFakeSecrets();
    await capability.store('credentials', 'not json{');
    const accessor = createSecretAccessor(capability, {
      key: 'credentials',
      schema: s.object({ token: s.string() }),
    });

    let caught: unknown;
    try {
      await accessor.read();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FrameworkError);
    const message = (caught as FrameworkError).message;
    expect(message).toContain('credentials');
    // The secret value itself must never appear in the error.
    expect(JSON.stringify(caught)).not.toContain('not json{');
    // A failed read must not destroy the credential.
    expect(capability._entries().has('credentials')).toBe(true);
    accessor.dispose();
  });

  it('throws on schema failure with issue messages only', async () => {
    const capability = createFakeSecrets();
    await capability.store('credentials', JSON.stringify({ token: 123 }));
    const accessor = createSecretAccessor(capability, {
      key: 'credentials',
      schema: s.object({ token: s.string() }),
    });

    await expect(accessor.read()).rejects.toThrow(/failed validation/);
    accessor.dispose();
  });

  /**
   * Without this, a write succeeds and every read of it throws for the life of
   * the stored value — a failure surfacing at a point that has nothing to do
   * with what caused it, in a store the user cannot inspect.
   */
  describe('writing a value the schema rejects', () => {
    it('rejects, and the keychain never sees it', async () => {
      const capability = createFakeSecrets();
      const accessor = createSecretAccessor(capability, {
        key: 'credentials',
        schema: s.object({ token: s.string() }),
      });

      await expect(accessor.write({ token: 123 } as unknown as { token: string })).rejects.toThrow(
        /failed validation on write/u
      );
      expect(capability._entries().has('credentials')).toBe(false);
      accessor.dispose();
    });

    it('keeps the rejected value out of the error, exactly as a read does', async () => {
      const SENTINEL = 'sk-live-REJECTED-ON-WRITE';
      const quoting = {
        '~standard': {
          version: 1 as const,
          vendor: 'quoting',
          validate: (value: unknown) => ({
            issues: [{ message: `invalid value ${JSON.stringify(value)}` }],
          }),
        },
      };
      const accessor = createSecretAccessor<{ token: string }>(createFakeSecrets(), {
        key: 'api',
        schema: quoting,
      });

      const error = await accessor.write({ token: SENTINEL }).then(
        () => undefined,
        (failure: unknown) => failure
      );

      const framework = error as FrameworkError & { cause?: unknown };
      expect(
        JSON.stringify({
          message: framework.message,
          details: framework.details,
          cause: framework.cause,
          stack: framework.stack,
        })
      ).not.toContain(SENTINEL);
      expect(framework.details).toMatchObject({ key: 'api', direction: 'write', issueCount: 1 });
      accessor.dispose();
    });

    it('reports an unserializable value without naming what is in it', async () => {
      const accessor = createSecretAccessor(createFakeSecrets(), {
        key: 'api',
        // Passes anything through, so serialization is what fails.
        schema: {
          '~standard': {
            version: 1 as const,
            vendor: 'permissive',
            validate: (value: unknown) => ({ value }),
          },
        },
      });

      const circular: Record<string, unknown> = { apiKeyFieldName: 'x' };
      circular['self'] = circular;

      const error = await accessor.write(circular).then(
        () => undefined,
        (failure: unknown) => failure
      );

      const framework = error as FrameworkError;
      expect(framework.code).toBe('SECRET_UNSERIALIZABLE');
      // `JSON.stringify` names properties in its own message; that message must
      // not be what the caller sees.
      expect(JSON.stringify({ m: framework.message, d: framework.details })).not.toContain(
        'apiKeyFieldName'
      );
      accessor.dispose();
    });
  });
});

describe('secret redaction against a hostile schema', () => {
  const SENTINEL = 'sk-live-TOP-SECRET';

  /** A secrets capability holding one structured secret containing the sentinel. */
  function secretsHolding(): Parameters<typeof createSecretAccessor>[0] {
    const secrets = createFakeSecrets();
    void secrets.store('api', JSON.stringify({ token: SENTINEL }));
    return secrets;
  }

  /** Everything an error could carry the value in. */
  function surfaceOf(error: unknown): string {
    const framework = error as FrameworkError & { cause?: unknown };
    return JSON.stringify({
      message: framework.message,
      details: framework.details,
      code: framework.code,
      cause: framework.cause instanceof Error ? framework.cause.message : framework.cause,
      stack: framework.stack,
    });
  }

  it('keeps the value out of the error when the schema quotes it in an issue', async () => {
    // Third-party validators may include the received value in issue text;
    // framework errors must treat all such text as secret-bearing.
    const quoting = {
      '~standard': {
        version: 1 as const,
        vendor: 'quoting',
        validate: (value: unknown) => ({
          issues: [{ message: `invalid value ${JSON.stringify(value)}` }],
        }),
      },
    };
    const accessor = createSecretAccessor(secretsHolding(), { key: 'api', schema: quoting });

    const error = await accessor.read().then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(error).toBeInstanceOf(FrameworkError);
    expect(surfaceOf(error)).not.toContain(SENTINEL);
    // Still useful: which key, whose schema, and how many problems.
    expect((error as FrameworkError).details).toMatchObject({
      key: 'api',
      vendor: 'quoting',
      issueCount: 1,
    });
    accessor.dispose();
  });

  it('keeps the value out of the error when the schema throws with it', async () => {
    const throwing = {
      '~standard': {
        version: 1 as const,
        vendor: 'throwing',
        validate: (value: unknown): never => {
          throw new RangeError(`cannot accept ${JSON.stringify(value)}`);
        },
      },
    };
    const accessor = createSecretAccessor(secretsHolding(), { key: 'api', schema: throwing });

    const error = await accessor.read().then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(surfaceOf(error)).not.toContain(SENTINEL);
    expect((error as FrameworkError).code).toBe('SECRET_SCHEMA_FAILED');
    // The error's type survives; its message (which quoted the secret) does not.
    expect((error as FrameworkError).details).toMatchObject({ errorName: 'RangeError' });
    accessor.dispose();
  });

  it('keeps the value out of the error when a path names keys inside it', async () => {
    const pathing = {
      '~standard': {
        version: 1 as const,
        vendor: 'pathing',
        validate: () => ({ issues: [{ message: 'bad', path: [SENTINEL] }] }),
      },
    };
    const accessor = createSecretAccessor(secretsHolding(), { key: 'api', schema: pathing });

    const error = await accessor.read().then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(surfaceOf(error)).not.toContain(SENTINEL);
    accessor.dispose();
  });

  it('never auto-deletes a secret it could not validate', async () => {
    const secrets = secretsHolding();
    const rejecting = {
      '~standard': {
        version: 1 as const,
        vendor: 'rejecting',
        validate: () => ({ issues: [{ message: 'nope' }] }),
      },
    };
    const accessor = createSecretAccessor(secrets, { key: 'api', schema: rejecting });

    await expect(accessor.read()).rejects.toThrow(/failed validation/);
    // Destroying a credential because one read failed to parse would be worse
    // than surfacing the problem.
    expect(await secrets.get('api')).toContain(SENTINEL);
    accessor.dispose();
  });
});
