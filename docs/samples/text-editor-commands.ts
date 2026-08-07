import {
  defineCommandContract,
  defineModule,
  type ActiveEditor,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

export const UpperCase = defineCommandContract<readonly [], void>({ id: 'sample.upperCase' });
export const Normalize = defineCommandContract<readonly [], void>({ id: 'sample.normalize' });

export const editorModule = defineModule('editor', (module): undefined => {
  // `handleTextEditor` hands the handler an `ActiveEditor` -- the same object
  // `Editors.active` returns -- so VS Code has already answered "is there an
  // editor?" before the body runs.
  module.commands.handleTextEditor(UpperCase, async (_context, editor) => {
    await editor.transformSelections((text) => text.toUpperCase());
  });

  module.commands.handleTextEditor(
    Normalize,
    async (context: OperationContext, editor: ActiveEditor) => {
      // Several edits, one undo step. The stages run in order, each seeing the
      // document the previous one left behind, and the whole run collapses into
      // a single Ctrl+Z -- which is why this is not a loop over `edit`.
      const applied = await editor.editStages([
        (current) =>
          current.selections.map((range) => ({ range, text: current.text(range).trimEnd() })),
        (current) =>
          current.selections.map((range) => ({
            range,
            text: current.text(range).split('\r\n').join('\n'),
          })),
      ]);
      context.logger.info('normalized', { applied });
    }
  );

  return undefined;
});
