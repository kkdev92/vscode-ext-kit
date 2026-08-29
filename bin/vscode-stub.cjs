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
'use strict';

const make = () =>
  new Proxy(function vscodeStub() {}, {
    get: (_target, key) => {
      // Not thenable, so `await` on a proxied value resolves to it instead of
      // waiting on a `then` that would never settle.
      if (key === 'then') {
        return undefined;
      }
      if (key === Symbol.toPrimitive) {
        return () => '[vscode stub]';
      }
      return make();
    },
    apply: () => make(),
    construct: () => make(),
  });

module.exports = make();
