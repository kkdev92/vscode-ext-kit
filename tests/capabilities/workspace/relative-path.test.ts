/**
 * `checkRelativePath`, for a setting that names a folder inside the workspace.
 *
 * The cases are the ones extensions had each decided differently: a drive
 * letter with no separator after it, a backslash as the separator, and names
 * made of dots that are not a parent reference.
 */
import { describe, expect, it } from 'vitest';

import {
  checkRelativePath,
  type RelativePathProblem,
} from '../../../src/capabilities/workspace/relative-path.js';

function verdicts(values: readonly string[]): Record<string, RelativePathProblem | undefined> {
  return Object.fromEntries(values.map((value) => [value, checkRelativePath(value)]));
}

describe('checkRelativePath', () => {
  it('passes a path that stays inside the folder', () => {
    const inside = [
      'images',
      'docs/images',
      'docs\\images',
      './images',
      '.',
      'images/',
      'a/./b',
      '~/images',
      '.. ',
      '...',
      'x..',
      '..x/y',
    ];

    expect(verdicts(inside)).toEqual(Object.fromEntries(inside.map((value) => [value, undefined])));
  });

  it('names an empty value, including one of only whitespace', () => {
    expect(verdicts(['', ' ', '\t'])).toEqual({ '': 'empty', ' ': 'empty', '\t': 'empty' });
  });

  it('names a rooted path, a drive and a network share as absolute', () => {
    expect(
      verdicts([
        '/etc',
        '\\images',
        'C:\\images',
        'C:/images',
        'c:images',
        '\\\\server\\share',
        '//server/share',
      ])
    ).toEqual({
      '/etc': 'absolute',
      '\\images': 'absolute',
      'C:\\images': 'absolute',
      'C:/images': 'absolute',
      // Relative to the drive's current directory, not to the folder.
      'c:images': 'absolute',
      '\\\\server\\share': 'absolute',
      '//server/share': 'absolute',
    });
  });

  it('names a parent segment, whichever separator reaches it', () => {
    expect(verdicts(['..', '../images', 'images/../..', 'images\\..\\..', 'a/b\\..'])).toEqual({
      '..': 'parent',
      '../images': 'parent',
      'images/../..': 'parent',
      'images\\..\\..': 'parent',
      'a/b\\..': 'parent',
    });
  });
});
