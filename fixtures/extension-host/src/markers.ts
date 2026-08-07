import { appendFileSync } from 'node:fs';

/**
 * Appends a marker to the file the driver passes in.
 *
 * Ordering during shutdown cannot be observed from inside a single test run: the
 * assertions have to happen after the host has exited. So the extension records
 * markers to a file and the driver checks the sequence afterwards.
 */
export function mark(line: string): void {
  const target = process.env['VSCODE_EXT_KIT_MARKERS'];
  if (target === undefined) {
    return;
  }
  appendFileSync(target, `${line}\n`, 'utf8');
}
