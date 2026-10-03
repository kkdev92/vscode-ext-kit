/**
 * Why a configured path would not stay inside the folder it is resolved
 * against: it is `empty`, it is `absolute` — rooted, or naming a drive or a
 * network share — or it climbs out through a `parent` segment.
 */
export type RelativePathProblem = 'empty' | 'absolute' | 'parent';

/**
 * Checks a path that will be resolved against a folder — a setting such as
 * "save images in this directory of the workspace" — and says why it would end
 * up outside that folder, or returns `undefined` when it stays inside.
 *
 * The text is judged the same way on every platform, because Settings Sync
 * carries one value to all of them:
 *
 * - `\` counts as a separator as well as `/`, so `..\x` is a `parent` and a
 *   leading `\` is `absolute`.
 * - A drive letter is `absolute` even with no separator after it. `C:images`
 *   is relative to that drive's current directory, not to the folder.
 * - Only a segment that is exactly `..` is a `parent`. A name such as `.. ` or
 *   `...` is an ordinary file name, which Node on Windows creates as written.
 *
 * It reads nothing from disk, so a symbolic link inside the folder can still
 * lead out of it. Characters a file system forbids, and anything else an
 * extension wants to refuse, remain the extension's to check.
 *
 * @example
 * ```ts
 * const problem = checkRelativePath(settings.read().values.saveDirectory);
 * if (problem !== undefined) {
 *   await notify.warn(l10n.t('The save directory must be a folder inside the workspace.'));
 * }
 * ```
 */
export function checkRelativePath(value: string): RelativePathProblem | undefined {
  if (value.trim() === '') {
    return 'empty';
  }
  if (/^[/\\]/u.test(value) || /^[A-Za-z]:/u.test(value)) {
    return 'absolute';
  }
  if (value.split(/[/\\]/u).includes('..')) {
    return 'parent';
  }
  return undefined;
}
