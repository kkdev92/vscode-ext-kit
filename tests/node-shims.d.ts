/**
 * The sliver of Node's API the test suite reaches for.
 *
 * `tsconfig.build.json` sets `types: ["vscode"]` deliberately — the framework
 * runs in the web extension host too, so nothing in `src/` may reach for Node,
 * and leaving `@types/node` out of the global scope is what enforces that. A few
 * tests legitimately need it: the import-graph test reads the source tree to
 * check layering. Declaring exactly what they use keeps the guard intact instead
 * of relaxing `types` for everything.
 *
 * Add a declaration only when a test starts using that exact Node member. Do
 * not mirror all of `@types/node`: an accidentally imported Node API in
 * production should continue to fail type-checking for the web extension host.
 */

declare module 'node:fs' {
  export interface Dirent {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export const posix: { normalize(path: string): string; join(...segments: string[]): string };
}

declare module 'node:child_process' {
  /** The one call the CLI test makes: run, capture, and throw on a non-zero exit. */
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: { encoding: 'utf8'; stdio: readonly ['ignore', 'pipe', 'pipe'] }
  ): string;
}
