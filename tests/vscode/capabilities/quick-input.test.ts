import { describe, expect, it, vi } from 'vitest';

/**
 * What the quick-input adapter touches, and when.
 *
 * Every capability adapter is constructed during activation whether the
 * extension declares that capability or not. This one used to read
 * `vscode.QuickInputButtons.Back` while being built, which made it the only
 * adapter that required a `vscode` value at construction — and therefore
 * something every test double had to supply, including for extensions that
 * never open a quick pick. A migration hit exactly that.
 */
const vscodeMock = vi.hoisted(() => {
  const reads: string[] = [];
  const back = { iconPath: undefined, tooltip: 'Back' };
  return {
    reads,
    back,
    module: {
      window: {
        createQuickPick: () => ({ id: 'quickPick' }),
        createInputBox: () => ({ id: 'inputBox' }),
      },
      get QuickInputButtons() {
        reads.push('QuickInputButtons');
        return { Back: back };
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeQuickInputCapability } =
  await import('../../../src/vscode/capabilities/quick-input.js');

describe('the quick-input adapter', () => {
  it('reads no vscode value while it is being constructed', () => {
    vscodeMock.reads.length = 0;

    createVSCodeQuickInputCapability();

    expect(vscodeMock.reads).toEqual([]);
  });

  it('still yields the platform Back button when something asks for it', () => {
    const capability = createVSCodeQuickInputCapability();

    expect(capability.backButton).toBe(vscodeMock.back);
    expect(vscodeMock.reads).toContain('QuickInputButtons');
  });

  it('yields the same sentinel every time, because steps compare by identity', () => {
    const capability = createVSCodeQuickInputCapability();

    expect(capability.backButton).toBe(capability.backButton);
  });
});
