// Drives VS Code for the Web in a real browser via @vscode/test-web.
//
// Answers S-2: the framework core is meant to run in a Web Worker extension host,
// where the JS engine is the user's browser rather than a version VS Code pins.
// This lane checks that it actually loads there, that a command's result crosses
// the worker boundary, and that settings resolve through the real configuration
// service -- then records which modern runtime features the browser offered.
//
// Driven directly rather than through @vscode/test-cli: its web configuration is
// marked incomplete in its own source, and this path is the more mature one.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { runTests } from '@vscode/test-web';

const here = import.meta.dirname;
const scratch = mkdtempSync(join(tmpdir(), 'ext-kit-web-'));

try {
  await runTests({
    browserType: 'chromium',
    headless: true,
    extensionDevelopmentPath: resolve(here),
    extensionTestsPath: resolve(here, 'out/test/index.js'),
    folderPath: join(scratch, 'workspace'),
    quality: 'stable',
    printServerLog: false,
  });

  // The fixture's assertions run inside the worker and throw on failure, which
  // makes runTests reject. So reaching here is the pass condition. The worker's
  // console is forwarded straight to this process's stdout, so the
  // `EXT_KIT_WEB_PROBE` line with the runtime feature report is already above.
  process.stdout.write('web extension host contract OK (see EXT_KIT_WEB_PROBE above)\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
