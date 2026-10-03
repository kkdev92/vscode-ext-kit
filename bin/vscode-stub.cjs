// A `vscode` that answers every property with another of itself and does
// nothing, loaded in place of the real module when a plan is read outside the
// extension host — where `vscode` does not exist.
//
// This is enough because nothing in the package touches VS Code before
// `activate`: `defineExtension` compiles the plan and stops. An extension's own
// module-scope code is held to the same rule by the framework's design, so a
// well-formed entry module evaluates to a plan without ever reaching a real
// VS Code value. One that does gets a proxy back rather than a crash, and the
// failure lands where it belongs — in `activate`, in a real host.
//
// That holds for a bundled extension, which is how extensions ship. It does not
// hold for an unbundled ES module entry: Node finds the named exports of a
// CommonJS module by reading its source, a proxy has none to find, so such an
// entry gets none of the members of `vscode` as named exports, and a member
// read at module scope still fails.
'use strict';

// What any property read answers with. Not thenable, so `await` on a proxied
// value resolves to it instead of waiting on a `then` that would never settle.
const answer = (key) => {
  if (key === 'then') {
    return undefined;
  }
  if (key === Symbol.toPrimitive) {
    return () => '[vscode stub]';
  }
  return make();
};

// A bundle does not keep the object `require('vscode')` returns. For
// `import * as vscode`, bundlers such as esbuild copy the module's own
// properties onto a new object whose prototype is the module's prototype, and a
// proxy has no own properties to copy. Answering through the prototype is what
// keeps `vscode.ViewColumn` on that copy a proxy rather than `undefined`.
const prototype = new Proxy({}, { get: (_target, key) => answer(key) });

const make = () =>
  new Proxy(function vscodeStub() {}, {
    get: (_target, key) => answer(key),
    getPrototypeOf: () => prototype,
    apply: () => make(),
    construct: () => make(),
  });

module.exports = make();
