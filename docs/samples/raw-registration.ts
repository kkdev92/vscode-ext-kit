import * as vscode from 'vscode';

import { Localization, defineModule } from '@kkdev92/vscode-ext-kit';

// The escape hatch, for a VS Code API this package has no model for. A hover
// provider is the case that earns one: there is no declaration for it, and
// inventing a general-purpose model to register a single provider would be the
// worse trade.
//
// What `raw.register` buys over calling `vscode` from anywhere is that the
// registration stays owned -- it goes into the module's scope, unwinds through
// the same `deactivate`, rolls back if activation fails later, and shows up in
// the compiled plan instead of hiding in a feature file.
export const hoverModule = defineModule('hover', (module): undefined => {
  module.raw.register({
    id: 'sample.wordCountHover',
    inject: { l10n: Localization },
    bind: ({ registrations, logger }, { l10n }): undefined => {
      // `own` takes the platform's disposable. Nothing else has to remember it.
      registrations.own(
        vscode.languages.registerHoverProvider(
          { scheme: 'file' },
          {
            provideHover(document, position) {
              const range = document.getWordRangeAtPosition(position);
              if (range === undefined) {
                return undefined;
              }
              const word = document.getText(range);
              logger.trace('hover', { length: word.length });
              return new vscode.Hover(l10n.t('{0} characters', String(word.length)), range);
            },
          }
        )
      );
      // Synchronous by contract: activation binds modules transactionally, so a
      // bind that returned a promise could still be mutating a scope after that
      // transaction committed. A thenable return is rejected at runtime too.
      return undefined;
    },
  });

  return undefined;
});
