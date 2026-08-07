/**
 * Unit contract for the managed language-status item over its fake handle. It
 * protects default state, partial patch semantics, and post-disposal inertness.
 * Failures point to managed-state projection; selector/registration wiring is
 * covered by the UI Test Host integration suite.
 */
import { describe, expect, it } from 'vitest';

import { createManagedLanguageStatusItem } from '../../../src/capabilities/ui/language-status.js';
import { createFakeLanguageStatus } from '../../../src/testing/fakes/fake-ui.js';

describe('createManagedLanguageStatusItem', () => {
  it('applies the initial options with info/idle defaults', () => {
    const languageStatus = createFakeLanguageStatus();
    createManagedLanguageStatusItem(
      languageStatus.createItem('sample.eslint', { language: 'typescript' }),
      { name: 'ESLint', text: '$(check) No issues' }
    );

    expect(languageStatus.items[0]).toMatchObject({
      id: 'sample.eslint',
      selector: { language: 'typescript' },
      name: 'ESLint',
      text: '$(check) No issues',
      severity: 'info',
      busy: false,
    });
  });

  it('carries detail, command, severity, busy and accessibility through', () => {
    const languageStatus = createFakeLanguageStatus();
    const managed = createManagedLanguageStatusItem(
      languageStatus.createItem('sample.tool', 'typescript'),
      {
        name: 'Tool',
        text: 'Ready',
        detail: 'v1.2.3',
        severity: 'warn',
        busy: true,
        command: { command: 'sample.showLog', title: 'Show Log' },
        accessibilityInformation: { label: 'Tool ready' },
      }
    );
    const item = languageStatus.items[0];

    expect(item).toMatchObject({
      detail: 'v1.2.3',
      severity: 'warn',
      busy: true,
      command: { command: 'sample.showLog', title: 'Show Log' },
    });

    managed.update('$(warning) 3 problems', { severity: 'error', busy: false, detail: 'run 4' });
    expect(item).toMatchObject({
      text: '$(warning) 3 problems',
      severity: 'error',
      busy: false,
      detail: 'run 4',
      // Untouched fields survive a partial update.
      name: 'Tool',
    });
  });

  it('is inert after dispose, and dispose is idempotent', () => {
    const languageStatus = createFakeLanguageStatus();
    const managed = createManagedLanguageStatusItem(languageStatus.createItem('x', 'plaintext'), {
      name: 'X',
      text: 'a',
    });
    const item = languageStatus.items[0];

    managed.dispose();
    expect(item?.disposed).toBe(true);
    managed.update('late');
    managed.dispose();
    expect(item?.text).toBe('a');
  });
});
