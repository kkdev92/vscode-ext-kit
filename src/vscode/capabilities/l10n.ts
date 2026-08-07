/**
 * Localization adapter. Feature code supplies source messages as plain data;
 * only this boundary selects the appropriate `vscode.l10n.t` overload.
 */
import * as vscode from 'vscode';

import type { LocalizationCapability, LocalizedMessage } from '../../foundation/platform/ports.js';

/**
 * The real localization surface, backed by `vscode.env.language` and
 * `vscode.l10n.t`.
 *
 * @example
 * ```ts
 * const capability = createVSCodeLocalizationCapability();
 * capability.translate({ message: 'Hello, {0}!', args: ['world'] });
 * ```
 */
export function createVSCodeLocalizationCapability(): LocalizationCapability {
  return {
    // Read per access rather than captured: the display language can only
    // change with a window reload, but reading it lazily costs nothing and
    // removes the question entirely.
    get language(): string {
      return vscode.env.language;
    },

    translate(message: LocalizedMessage): string {
      const args = message.args ?? [];
      if (message.comment === undefined) {
        // The object overload requires translator comments. A comment-less
        // message must use the positional overload; inventing an empty comment
        // would change the localization lookup key.
        return vscode.l10n.t(message.message, ...args);
      }
      return vscode.l10n.t({
        message: message.message,
        comment: [...(typeof message.comment === 'string' ? [message.comment] : message.comment)],
        ...(args.length === 0 ? {} : { args: [...args] }),
      });
    },
  };
}
