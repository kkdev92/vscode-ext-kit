// An extension that reads a `vscode` value while its module is being defined,
// as one that opens a panel "beside" the editor does with `ViewColumn`.
// The CLI test bundles it first, the way an extension ships: a bundler turns
// `import * as vscode` into a copy of what the module exposes, which is a
// different object from the one `require('vscode')` returned.
import * as vscode from 'vscode';

import { defineExtension, defineModule } from '../../../dist/index.js';

const column = vscode.ViewColumn.Active;

const viewer = defineModule('viewer', (module) => {
  void column;
  void module;
  return undefined;
});

export const app = defineExtension({ name: 'namespace-read', modules: [viewer] });
