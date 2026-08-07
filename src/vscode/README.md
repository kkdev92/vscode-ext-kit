# vscode/

This is the production adapter layer and the only `src/` subtree allowed to
import `vscode` at runtime (enforced by lint and the import-graph tests).

- `foundation/extension.ts` is the composition root. It turns an immutable
  application plan into the real extension-host application and owns its output
  channel and activation/deactivation boundary.
- `foundation/` translates the framework ports for commands, settings, host
  environment and logging.
- `capabilities/` translates the remaining ports, such as editor, tree view,
  webview and quick input.

Keep policy and business logic below this layer. An adapter should explain the
VS Code-specific reason for every conversion, cast, omitted argument and
lifetime decision, then expose only the plain port shape. When a platform quirk
is represented by a fake, pin the shared behavior in a contract test; when it
cannot be represented faithfully without VS Code, pin it in an Extension Host
test and state that limitation beside the fake.
