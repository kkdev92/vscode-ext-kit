# tests/

Mirrors `src/`: a test lives at the path of the code it exercises
(`tests/foundation/...`, `tests/capabilities/...`, `tests/vscode/...`,
`tests/testing/...`). Contract suites sit next to the port they pin, and
Test-Host-driven integration suites sit with the capability they integrate.

Every test file starts by naming its lane and boundary: pure unit, shared port
contract, TestHost integration, VS Code adapter, low-level raw mock, or real
Extension Host. When behavior moves between layers, move/update that overview so
a maintainer—or an AI agent—does not strengthen a fake where only VS Code can be
authoritative.
