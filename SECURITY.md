# Security Policy

## Supported versions

| Version         | Supported | Notes                                           |
| --------------- | --------- | ----------------------------------------------- |
| `3.0.0-alpha.x` | ✅        | this branch; not published to npm yet           |
| `2.1.x`         | ✅        | `latest` on npm, maintained on `v2-maintenance` |
| `2.0.x`         | ❌        | upgrade to `2.1.x`                              |
| `0.x`, `1.x`    | ❌        | unsupported                                     |

The 2.x and 3.x lines are different codebases. A fix for one is not automatically
a fix for the other; a report should say which line it applies to, and "both" is a
valid answer.

## Reporting a vulnerability

1. **Do not open a public issue.**
2. Use GitHub's **Report a vulnerability** button in the repository's Security
   tab.

Please include the version, the extension host (desktop or web), and the smallest
reproduction you have. A failing test against the Test Host is ideal.

## What this package does and does not do

- **No network access.** Nothing here makes a request.
- **No Node built-ins.** The framework core cannot reach the file system or the
  process; the type configuration (`types: ["vscode"]`) is what enforces that, so
  the same code runs in the web extension host. File and workspace access goes
  through VS Code's own APIs in the adapter layer.
- **No runtime dependencies.** Nothing is pulled in at install time, so the
  package contributes no transitive supply chain of its own.
- **Secrets go to VS Code's encrypted storage**, never to a memento.

## Secret values never leave the secret

This is the one property worth stating explicitly, because it is easy to violate
by accident and the kit is deliberately strict about it.

When a secret fails to parse or validate, the report carries the **key name**, the
schema vendor and an issue count — and nothing else. No message, no path, no
cause, no stack. A third-party schema routinely quotes the value it rejected, and
a validation path can name keys inside it, so none of it is propagated.

```ts
// A schema failure surfaces as: { key: 'sample.apiToken', vendor: 'zod', issueCount: 1 }
// It will not contain the token.
```

The same rule applies to logs and lifecycle diagnostics: a secret's value is never
written to either.

## Using the kit safely

**Store credentials as secrets, not state.**

```ts
// Good: declared secret, backed by VS Code's encrypted storage
const ApiToken = defineSecret({ key: 'sample.apiToken' });
module.secrets.add(ApiToken);

// Bad: a memento is plain text on disk
await context.globalState.update('apiToken', token);
```

**Validate anything that arrives from outside your code.** A command invoked from
a keybinding, a menu, or another extension carries runtime input, not typed
arguments. Give the contract an `args` validator:

```ts
const Open = defineCommandContract<readonly [path: string], void>({
  id: 'sample.open',
  args: (raw) =>
    typeof raw[0] === 'string'
      ? { ok: true, value: raw as readonly [string] }
      : { ok: false, issues: [{ message: 'expected a path' }] },
});
```

Webview messages are validated for you: the RPC layer checks the whole envelope
before any of it reaches your handler, and rejects a malformed frame rather than
acting on part of it.

**Do not build webview HTML by hand.** Use the kit's HTML/CSP helpers so the
content security policy and nonce stay consistent with the resource roots.

**Errors reach your caller, not the user.** The framework does not toast
exceptions, so an error message you produce is shown only where you choose to show
it. Keep internal detail in `context.logger` and give users a sentence.
