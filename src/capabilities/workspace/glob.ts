/**
 * The one glob translator in the codebase.
 *
 * Shared by the managed watcher's ignore list and by the fake watcher's event
 * routing, so a test cannot pass against different matching rules than the
 * engine applies. It covers the subset VS Code's `GlobPattern` shares with
 * every other glob dialect — a globstar, a globstar segment, a single star, and
 * a literal substring — and nothing more: brace expansion, `?` and character
 * classes are out of scope, and the real `GlobPattern` semantics are pinned by
 * the Extension Host lane rather than approximated here.
 *
 * This translator is not a general replacement for `vscode.GlobPattern`.
 * Consumer-facing features that promise the full host grammar must delegate to
 * the host rather than silently applying this subset.
 *
 * Two anchorings, because the two call sites mean different things by a match:
 * an ignore entry means "this path ends this way" while a watch pattern means
 * "this whole path looks like this".
 */

/**
 * Translates a glob into a regex body.
 *
 * A globstar *segment* is one token, not a globstar followed by a separator: it
 * has to match **zero** or more segments, so `'**\/*.ts'` covers `a.ts` as well
 * as `src/a.ts`. A single star expands to a class holding no separator, which is
 * what keeps `*.ts` from reaching across directories.
 */
function toRegexBody(pattern: string): string {
  // Placeholders keep the globstar forms intact while the surrounding
  // separators and single stars expand. Order matters throughout.
  const GLOBSTAR_SLASH = '<<<GLOBSTAR_SLASH>>>';
  const GLOBSTAR = '<<<GLOBSTAR>>>';
  return pattern
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*\*\//g, GLOBSTAR_SLASH)
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/\//g, '[/\\\\]')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(new RegExp(GLOBSTAR_SLASH, 'g'), '(?:.*[/\\\\])?')
    .replace(new RegExp(GLOBSTAR, 'g'), '.*');
}

/**
 * Compiles one glob into a matcher over the **tail** of a path — the semantics
 * an ignore list wants, where `*.log` means "any file whose path ends in a
 * `.log` segment" no matter how deep it sits.
 *
 * Anchored on purpose: an unanchored
 * `[^/\\]*\.log` would also match inside `x.log.txt` and `foo.logs`, silently
 * swallowing their events. Glob semantics say `*.log` means "a path segment
 * ending the path", not "this substring appears somewhere".
 *
 * A pattern with no star is treated as a substring, which is what an ignore
 * list like `['dist']` means in practice.
 *
 * @example
 * ```ts
 * const isLog = compileGlobMatcher('*.log');
 * isLog('/logs/app.log'); // true
 * isLog('/x.log.txt');    // false — `.log` is not the end of the path
 * ```
 */
export function compileGlobMatcher(pattern: string): (filePath: string) => boolean {
  if (!pattern.includes('*')) {
    return (filePath) => filePath.includes(pattern);
  }
  const regex = new RegExp(`(^|[/\\\\])${toRegexBody(pattern)}$`);
  return (filePath) => regex.test(filePath);
}

/**
 * Compiles one glob into a matcher over a **whole** path — the semantics a
 * watch pattern wants, where `*.ts` means "a `.ts` file directly here" and only
 * a leading globstar segment reaches into subdirectories.
 *
 * @example
 * ```ts
 * const shallow = compileFullPathGlobMatcher('*.ts');
 * shallow('a.ts');     // true
 * shallow('src/a.ts'); // false — a single star stops at the separator
 * ```
 */
export function compileFullPathGlobMatcher(pattern: string): (filePath: string) => boolean {
  const regex = new RegExp(`^${toRegexBody(pattern)}$`);
  return (filePath) => regex.test(filePath);
}
