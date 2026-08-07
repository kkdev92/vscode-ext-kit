/**
 * Pure unit suite for UTF-16 offset/position arithmetic shared by editor
 * helpers. It protects LF/CRLF/lone-CR parsing, clamping, binary search, and
 * astral-character accounting. Failures imply divergence from document
 * position semantics before any editor adapter is involved.
 */
import { describe, expect, it } from 'vitest';

import {
  buildLineStartOffsets,
  findLineForOffset,
  lineCharacterToOffset,
  offsetToLineCharacter,
} from '../../../src/capabilities/workspace/text-math.js';

describe('buildLineStartOffsets', () => {
  it('handles LF documents', () => {
    expect(buildLineStartOffsets('ab\ncd\ne')).toEqual([0, 3, 6]);
  });

  it('handles CRLF documents', () => {
    expect(buildLineStartOffsets('ab\r\ncd\r\ne')).toEqual([0, 4, 8]);
  });

  it('treats a lone carriage return as a line break', () => {
    // Splitting on \n alone would see ONE line here and disagree with
    // TextDocument.positionAt on every position after the \r.
    expect(buildLineStartOffsets('ab\rcd')).toEqual([0, 3]);
  });

  it('handles mixed EOLs, never double-counting CRLF', () => {
    //            0123 45 678 9
    const text = 'ab\ncd\r\nef\rg';
    expect(buildLineStartOffsets(text)).toEqual([0, 3, 7, 10]);
  });

  it('counts a trailing newline as starting one final empty line', () => {
    expect(buildLineStartOffsets('a\n')).toEqual([0, 2]);
    expect(buildLineStartOffsets('')).toEqual([0]);
  });
});

describe('offset/position conversion', () => {
  const text = 'ab\rcd\r\nef\ng';
  const lineStarts = buildLineStartOffsets(text);

  it('maps offsets to line/character across every EOL flavour', () => {
    expect(offsetToLineCharacter(lineStarts, text.length, 0)).toEqual({ line: 0, character: 0 });
    expect(offsetToLineCharacter(lineStarts, text.length, 2)).toEqual({ line: 0, character: 2 });
    // After the CR-only break.
    expect(offsetToLineCharacter(lineStarts, text.length, 3)).toEqual({ line: 1, character: 0 });
    // After the CRLF break.
    expect(offsetToLineCharacter(lineStarts, text.length, 7)).toEqual({ line: 2, character: 0 });
    expect(offsetToLineCharacter(lineStarts, text.length, 10)).toEqual({ line: 3, character: 0 });
  });

  it('clamps out-of-range offsets like TextDocument.positionAt', () => {
    expect(offsetToLineCharacter(lineStarts, text.length, -5)).toEqual({ line: 0, character: 0 });
    expect(offsetToLineCharacter(lineStarts, text.length, 999)).toEqual({
      line: 3,
      character: 1,
    });
  });

  it('round-trips through lineCharacterToOffset', () => {
    for (const offset of [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, text.length]) {
      const position = offsetToLineCharacter(lineStarts, text.length, offset);
      expect(lineCharacterToOffset(lineStarts, position)).toBe(offset);
    }
  });

  it('clamps out-of-range lines but leaves characters as given', () => {
    expect(lineCharacterToOffset(lineStarts, { line: -2, character: 1 })).toBe(1);
    expect(lineCharacterToOffset(lineStarts, { line: 99, character: 0 })).toBe(10);
  });

  it('counts UTF-16 code units, exactly like TextDocument offsets', () => {
    // '💚' is one astral character but two UTF-16 code units.
    const emoji = 'a💚\nb';
    const starts = buildLineStartOffsets(emoji);
    expect(starts).toEqual([0, 4]);
    expect(offsetToLineCharacter(starts, emoji.length, 3)).toEqual({ line: 0, character: 3 });
    expect(offsetToLineCharacter(starts, emoji.length, 4)).toEqual({ line: 1, character: 0 });
  });
});

describe('findLineForOffset', () => {
  it('binary-searches the containing line', () => {
    const starts = [0, 10, 20, 30];
    expect(findLineForOffset(starts, 0)).toBe(0);
    expect(findLineForOffset(starts, 9)).toBe(0);
    expect(findLineForOffset(starts, 10)).toBe(1);
    expect(findLineForOffset(starts, 29)).toBe(2);
    expect(findLineForOffset(starts, 35)).toBe(3);
  });
});
