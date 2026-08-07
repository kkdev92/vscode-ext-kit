# capabilities/

This directory contains the framework's VS Code-independent feature layer:
typed storage and secrets, editor helpers, UI models, tree and webview models,
file watching, localization, schema/result primitives, and timing utilities.

The dependency direction is an architectural contract:

```text
consumer code -> capabilities -> foundation ports <- vscode adapters / test fakes
```

- A capability exposes the API extension authors use and manages feature state
  such as batching, validation, caching, or cancellation.
- A `foundation/platform` port is the smallest host surface that capability
  needs. It contains no `vscode` value.
- `src/vscode/` implements those ports with the real API.
- `src/testing/` implements the same ports with observable fakes and the Test
  Host. Tests should exercise capability behavior through these fakes.

Nothing in this directory may import `vscode` or `src/vscode/`, even through a
relative re-export. `tests/import-graph.test.ts` enforces that boundary. Helpers
that need host state therefore take a capability/port explicitly; the
application host injects the corresponding services for ordinary consumer
code.

Ownership follows one rule throughout the directory: a runtime resource
created from a module declaration is owned by the application/module scope; a
resource returned by an ad-hoc factory is owned by its caller unless its JSDoc
explicitly says a service also tracks it for shutdown. Cancellation is
cooperative and is passed as `AbortSignal`; user dismissal is normally
represented by `undefined` or a cancelled `Result`, not by an exception.

`webview-client/` is a special browser-side entry point published as
`./webview-client`. It shares only the serializable RPC protocol with the host
side and must remain free of both `vscode` and Node-only APIs.
