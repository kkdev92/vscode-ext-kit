// Module resolution hooks for `import 'vscode'`, registered by the CLI before
// it loads an extension's entry module.
//
// Runs on Node's hooks thread, so it can share nothing with the CLI except
// files; the stand-in it points at lives beside it. CommonJS `require('vscode')`
// — what a bundled extension does — is not seen by these hooks and is handled
// on the main thread by the CLI, which patches CommonJS resolution the same way.

const STUB = new URL('./vscode-stub.cjs', import.meta.url).href;

/**
 * @param {string} specifier
 * @param {object} context
 * @param {(specifier: string, context: object) => Promise<object>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vscode') {
    return { url: STUB, format: 'commonjs', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
