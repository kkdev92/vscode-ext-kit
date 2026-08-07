/**
 * Table-driven unit contract for the kit's deliberately limited glob
 * translator. It separately protects tail-anchored ignore semantics and
 * whole-path watcher semantics across POSIX/Windows separators. Failures here
 * can invalidate both managed filtering and fake watcher routing.
 */
import { describe, expect, it } from 'vitest';

import {
  compileFullPathGlobMatcher,
  compileGlobMatcher,
} from '../../../src/capabilities/workspace/glob.js';

describe('compileGlobMatcher (tail-anchored: ignore semantics)', () => {
  const CASES: readonly {
    readonly pattern: string;
    readonly path: string;
    readonly hit: boolean;
  }[] = [
    { pattern: '*.log', path: '/logs/app.log', hit: true },
    { pattern: '*.log', path: 'app.log', hit: true },
    // These two are what an unanchored pattern swallows: it matches the
    // segment anywhere in the path rather than as a whole name.
    { pattern: '*.log', path: '/logs/app.log.txt', hit: false },
    { pattern: '*.log', path: '/logs/app.logs', hit: false },
    { pattern: '**/node_modules/**', path: '/repo/node_modules/x/index.js', hit: true },
    { pattern: '**/node_modules/**', path: 'node_modules/x/index.js', hit: true },
    { pattern: '**/node_modules/**', path: '/repo/src/index.js', hit: false },
    { pattern: 'src/*.ts', path: '/repo/src/a.ts', hit: true },
    { pattern: 'src/*.ts', path: '/repo/src/deep/a.ts', hit: false },
    // No star at all is a substring test, which is what `['dist']` means.
    { pattern: 'dist', path: '/repo/dist/main.js', hit: true },
    { pattern: 'dist', path: '/repo/src/main.js', hit: false },
    // A dot is a literal, not "any character".
    { pattern: '*.ts', path: '/repo/axts', hit: false },
    { pattern: '**/*.ts', path: 'a.ts', hit: true },
    { pattern: '**/*.ts', path: '/deep/nested/a.ts', hit: true },
  ];

  for (const { pattern, path, hit } of CASES) {
    it(`${hit ? 'matches' : 'rejects'} "${path}" for "${pattern}"`, () => {
      expect(compileGlobMatcher(pattern)(path)).toBe(hit);
    });
  }

  it('accepts a Windows separator too', () => {
    expect(compileGlobMatcher('**/node_modules/**')('C:\\repo\\node_modules\\x\\i.js')).toBe(true);
    expect(compileGlobMatcher('*.log')('C:\\logs\\app.log')).toBe(true);
  });
});

describe('compileFullPathGlobMatcher (whole path: watch semantics)', () => {
  const CASES: readonly {
    readonly pattern: string;
    readonly path: string;
    readonly hit: boolean;
  }[] = [
    // A leading globstar segment matches zero segments as well as many.
    { pattern: '**/*.ts', path: 'a.ts', hit: true },
    { pattern: '**/*.ts', path: 'src/a.ts', hit: true },
    { pattern: '**/*.ts', path: 'src/deep/a.ts', hit: true },
    { pattern: '**/*.ts', path: 'src/a.md', hit: false },
    // A single star does not cross a separator, so this is "here only".
    { pattern: '*.ts', path: 'a.ts', hit: true },
    { pattern: '*.ts', path: 'src/a.ts', hit: false },
    { pattern: 'src/**/*.ts', path: 'src/deep/a.ts', hit: true },
    { pattern: 'src/**/*.ts', path: 'src/a.ts', hit: true },
    { pattern: 'src/**/*.ts', path: 'lib/a.ts', hit: false },
    // Whole-path anchoring: no tail match.
    { pattern: 'src/*.ts', path: 'repo/src/a.ts', hit: false },
    { pattern: '**/*.project.json', path: 'a.project.json', hit: true },
    { pattern: '**/*.project.json', path: 'a.project.jsonx', hit: false },
  ];

  for (const { pattern, path, hit } of CASES) {
    it(`${hit ? 'matches' : 'rejects'} "${path}" for "${pattern}"`, () => {
      expect(compileFullPathGlobMatcher(pattern)(path)).toBe(hit);
    });
  }
});
