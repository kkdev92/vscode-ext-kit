/**
 * The Workspace service, over the fake capability and through the test host.
 *
 * The real adapter forwards to `vscode.workspace` and is checked against VS
 * Code in the Extension Host lane. These pin the fake's rules, the service's
 * ownership of the subscriptions it hands out, and the wiring.
 */
import { describe, expect, it } from 'vitest';

import { createApplication } from '../../../src/foundation/application/application.js';
import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import {
  Workspace,
  createWorkspaceService,
} from '../../../src/capabilities/workspace/workspace.js';
import { createFakeCommands } from '../../../src/testing/fakes/fake-commands.js';
import { createFakeEnvironment } from '../../../src/testing/fakes/fake-environment.js';
import { fakeUri } from '../../../src/testing/fakes/fake-filewatcher.js';
import { createFakeWorkspace } from '../../../src/testing/fakes/fake-workspace.js';
import { createTestHost } from '../../../src/testing/test-host.js';

describe('createFakeWorkspace', () => {
  it('opens one folder at /workspace unless told otherwise', () => {
    const workspace = createFakeWorkspace();

    expect(
      workspace.folders().map((folder) => [folder.name, folder.index, folder.uri.path])
    ).toEqual([['workspace', 0, '/workspace']]);
  });

  it('finds the innermost folder a resource is in', () => {
    const workspace = createFakeWorkspace(['/repo', '/repo/packages/app', '/other']);

    expect(workspace.folderOf(fakeUri('/repo/packages/app/src/a.ts'))?.name).toBe('app');
    expect(workspace.folderOf(fakeUri('/repo/README.md'))?.name).toBe('repo');
    expect(workspace.folderOf(fakeUri('/repository/x.ts'))).toBeUndefined();
    expect(workspace.folderOf(fakeUri('/elsewhere/x.ts'))).toBeUndefined();
  });

  it('writes a path relative to its folder, naming the folder when several are open', () => {
    const single = createFakeWorkspace(['/repo']);
    const multi = createFakeWorkspace(['/repo', '/docs']);

    expect(single.relativePath(fakeUri('/repo/src/a.ts'))).toBe('src/a.ts');
    expect(multi.relativePath(fakeUri('/docs/guide.md'))).toBe('docs/guide.md');
    expect(multi.relativePath(fakeUri('/docs/guide.md'), false)).toBe('guide.md');
    expect(single.relativePath(fakeUri('/repo/src/a.ts'), true)).toBe('repo/src/a.ts');
  });

  it('gives back the file system path of a resource in no folder', () => {
    const workspace = createFakeWorkspace(['/repo']);

    expect(workspace.relativePath(fakeUri('/elsewhere/a.ts'))).toBe('/elsewhere/a.ts');
  });

  it('looks a folder up from its parent, as VS Code does', () => {
    const workspace = createFakeWorkspace(['/repo', '/repo/packages/app']);

    // Nested: named relative to the folder around it.
    expect(workspace.relativePath(fakeUri('/repo/packages/app'), false)).toBe('packages/app');
    // Not nested: in no folder but itself, so it comes back whole.
    expect(workspace.relativePath(fakeUri('/repo'))).toBe('/repo');
  });

  it('names a folder mounted at the root relative to itself, as the web host does', () => {
    // The browser host opens its folder at the root of a virtual file system.
    // The directory that folder sits in is the root, which is the folder, so
    // VS Code answers '' rather than a file system path.
    const mount = {
      scheme: 'vscode-test-web',
      path: '/',
      fsPath: '/',
      toString: () => 'vscode-test-web://mount/',
    };
    const workspace = createFakeWorkspace([{ uri: mount, name: 'mount' }]);

    expect(workspace.relativePath(mount)).toBe('');
    expect(
      workspace.relativePath({ ...mount, path: '/sub/file.txt', fsPath: '/sub/file.txt' }, true)
    ).toBe('mount/sub/file.txt');
  });

  it('takes a name for a folder given as a URI', () => {
    const workspace = createFakeWorkspace([
      { uri: fakeUri('/home/me/src'), name: 'Sources' },
      '/b',
    ]);

    expect(workspace.relativePath(fakeUri('/home/me/src/a.ts'))).toBe('Sources/a.ts');
  });

  it('fires each subscription when the folders change, until it is disposed', () => {
    const workspace = createFakeWorkspace();
    const calls: string[] = [];
    const listener = (): void => {
      calls.push(
        workspace
          .folders()
          .map((folder) => folder.name)
          .join(',')
      );
    };
    const first = workspace.onDidChangeFolders(listener);
    workspace.onDidChangeFolders(listener);

    workspace._setFolders(['/a', '/b']);
    first.dispose();
    workspace._setFolders([]);

    // The same function subscribed twice is two subscriptions; disposing one
    // leaves the other.
    expect(calls).toEqual(['a,b', 'a,b', '']);
  });
});

describe('createWorkspaceService', () => {
  it('reads the folders when asked, not when built', () => {
    const capability = createFakeWorkspace(['/a']);
    const workspace = createWorkspaceService(capability);

    capability._setFolders(['/b', '/c']);

    expect(workspace.folders.map((folder) => folder.name)).toEqual(['b', 'c']);
    expect(workspace.relativePath(fakeUri('/c/x.ts'), { includeFolderName: false })).toBe('x.ts');
    expect(workspace.folderOf(fakeUri('/b/y.ts'))?.index).toBe(0);
  });

  it('releases the subscriptions still open when it is disposed', () => {
    const capability = createFakeWorkspace();
    const workspace = createWorkspaceService(capability);
    const calls: string[] = [];
    const kept = workspace.onDidChangeFolders(() => calls.push('kept'));
    workspace.onDidChangeFolders(() => calls.push('forgotten'));

    capability._setFolders(['/a']);
    workspace.dispose();
    capability._setFolders(['/b']);
    kept.dispose();
    workspace.onDidChangeFolders(() => calls.push('after dispose'));
    capability._setFolders(['/c']);

    expect(calls).toEqual(['kept', 'forgotten']);
  });
});

describe('the Workspace service in an application', () => {
  const Where = defineCommandContract<readonly [string], string>({ id: 'sample.where' });

  const module = defineModule('sample', (builder): undefined => {
    builder.commands.handle(Where, {
      inject: { workspace: Workspace },
      execute: (_context, [path], { workspace }) =>
        `${workspace.folderOf(fakeUri(path))?.name ?? 'none'}:${workspace.relativePath(fakeUri(path))}`,
    });
    builder.hostedServices.add({
      id: 'sample.folders',
      inject: { workspace: Workspace },
      start: (_context, { workspace }) => {
        // Never disposed by the service itself: the application releases it.
        workspace.onDidChangeFolders(() => undefined);
      },
    });
    return undefined;
  });

  it('answers from the fake the test host provides', async () => {
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    host.workspace._setFolders(['/repo', '/docs']);
    await host.start();

    await expect(host.application.commands.execute(Where, '/docs/a.md')).resolves.toBe(
      'docs:docs/a.md'
    );
    await expect(host.application.commands.execute(Where, '/tmp/b.md')).resolves.toBe(
      'none:/tmp/b.md'
    );

    await host.stop();
  });

  it('says which capability is missing when none was supplied', async () => {
    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
    });

    await expect(app.activate({ subscriptions: [] })).rejects.toThrow(
      /Workspace service needs a workspace capability/u
    );
  });
});
