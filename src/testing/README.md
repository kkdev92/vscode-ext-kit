# testing/

The published test surface (`./testing`) has three deliberately different
levels:

1. `createTestHost` runs the production-compiled `ApplicationPlan` against port
   fakes, with optional singleton overrides on an isolated plan copy. Prefer
   this for modules built on the framework: it preserves runtime preflight,
   dependency injection, operations, rollback and shutdown. Static preflight
   already ran when the plan was compiled and is not rerun by the Test Host.
2. `fakes/` are focused, scriptable implementations of individual ports. They
   model the documented, contract-tested subset each managed capability depends
   on, not VS Code's complete UI or implementation.
3. `mock/` is a partial low-level stand-in for the `vscode` module, intended for
   raw adapter code and legacy direct imports. It implements only documented
   members in this package and must not be treated as proof of complete VS Code
   compatibility.

Use real desktop/web Extension Host tests for rendering, host scheduling,
platform APIs absent from the mock, and any behavior where VS Code itself is the
system under test.
