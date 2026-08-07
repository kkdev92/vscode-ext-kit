/**
 * Pure-data unit suite for pick items, separators, and buttons. It protects the
 * VS Code-independent structural shapes, value/display separation, optional
 * field omission, and toggle presence semantics. Any need to mock `vscode` in
 * this file would indicate an architectural boundary regression.
 */
import { describe, expect, it } from 'vitest';

import {
  toPickButton,
  toPickItem,
  toPickSeparator,
} from '../../../src/capabilities/ui/quick-input.js';

describe('pick helpers', () => {
  it('builds an item with an icon, with no platform call', () => {
    const item = toPickItem('case.upper', { label: 'Upper Case', icon: 'symbol-string' });

    expect(item).toEqual({
      value: 'case.upper',
      label: 'Upper Case',
      iconPath: { id: 'symbol-string' },
    });
  });

  it('passes an already-built icon through untouched', () => {
    const icon = { id: 'file', color: 'charts.blue' };
    expect(toPickItem(1, { label: 'x', icon }).iconPath).toBe(icon);
  });

  it('keeps the value separate from everything displayed', () => {
    const value = { id: 42 };
    const item = toPickItem(value, {
      label: 'Answer',
      description: 'the',
      detail: 'to everything',
      picked: true,
      alwaysShow: true,
    });

    expect(item.value).toBe(value);
    expect(item).toMatchObject({
      label: 'Answer',
      description: 'the',
      detail: 'to everything',
      picked: true,
      alwaysShow: true,
    });
  });

  it('omits what was not asked for, rather than setting it undefined', () => {
    expect(Object.keys(toPickItem('v', { label: 'L' })).sort()).toEqual(['label', 'value']);
  });

  it('builds a button from a codicon name', () => {
    expect(toPickButton('refresh', { tooltip: 'Reload' })).toEqual({
      iconPath: { id: 'refresh' },
      tooltip: 'Reload',
    });
  });

  it('makes a toggle only when one was asked for', () => {
    // `toggled: false` still has to produce a toggle — its presence is what
    // makes the button one.
    expect(toPickButton('pin', { toggled: false })).toMatchObject({ toggle: { checked: false } });
    expect(toPickButton('pin')).not.toHaveProperty('toggle');
  });

  it('still builds a separator', () => {
    expect(toPickSeparator('Group')).toMatchObject({ label: 'Group', kind: -1 });
  });
});
