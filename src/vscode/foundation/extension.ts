/**
 * @packageDocumentation
 * Production composition root for a framework application.
 *
 * This is the only step that couples an {@link ApplicationPlan} to VS Code:
 * `defineExtension` compiles declarations without touching the editor, while
 * `activate` creates every real adapter and hands ownership to the application
 * host. Unit tests run the exposed plan through `createTestHost`; code that uses
 * the raw `vscode` API bypasses those fakes and still needs an Extension Host
 * test.
 *
 * Keep lifecycle ownership here singular. Adding another activation path,
 * putting application-owned registrations directly on
 * `ExtensionContext.subscriptions`, or constructing capabilities during module
 * evaluation would bypass preflight/rollback/shutdown guarantees.
 */
import * as vscode from 'vscode';

import { createApplication } from '../../foundation/application/application.js';
import type { Application } from '../../foundation/application/application.js';
import { compileApplication } from '../../foundation/application/plan.js';
import type { ApplicationPlan } from '../../foundation/application/plan.js';
import { createCommandExecutor } from '../../foundation/commands/binder.js';
import type { CommandExecutor } from '../../foundation/commands/binder.js';
import type { HostDiagnostic } from '../../foundation/hosting/application-host.js';
import type { ModuleDefinition } from '../../foundation/modules/definition.js';
import { createVSCodeCommandCapability } from './commands.js';
import { createVSCodeEnvironmentCapability } from './environment.js';
import { createVSCodeEditorCapability } from '../capabilities/editor.js';
import { createVSCodeFileWatcherCapability } from '../capabilities/filewatcher.js';
import { createVSCodeLanguageStatusCapability } from '../capabilities/language-status.js';
import { createVSCodeLocalizationCapability } from '../capabilities/l10n.js';
import { createVSCodeNotificationCapability } from '../capabilities/notifications.js';
import { createVSCodeProgressCapability } from '../capabilities/progress.js';
import { createVSCodeQuickInputCapability } from '../capabilities/quick-input.js';
import { createVSCodeStatusBarCapability } from '../capabilities/statusbar.js';
import { createVSCodeTreeViewCapability } from '../capabilities/treeview.js';
import { createVSCodeWebviewCapability } from '../capabilities/webview.js';
import {
  createVSCodeSecretsCapability,
  createVSCodeStorageCapability,
} from '../capabilities/storage.js';
import { createVSCodeSettingsCapability } from './settings.js';
import { createLogChannelSink } from './logging.js';

/** Options for {@link defineExtension}. */
export interface DefineExtensionOptions {
  /** Human-readable application name; also used for the framework log channel. */
  readonly name: string;
  /**
   * Immutable modules in binding order.
   *
   * The order is observable during activation and reverse-order teardown, so
   * treat a reorder as a lifecycle change rather than cosmetic sorting.
   */
  readonly modules: readonly ModuleDefinition[];
  /** Shutdown policy. Omit it to use the host's conservative default budget. */
  readonly shutdown?: { readonly timeoutMs?: number } | undefined;
  /**
   * Receives lifecycle diagnostics synchronously as the host emits them.
   * Observer exceptions are ignored. Keep the callback lightweight because it
   * is not awaited and runs on lifecycle/operation paths.
   */
  readonly onDiagnostic?: ((diagnostic: HostDiagnostic) => void) | undefined;
}

/**
 * An extension, ready to be re-exported from `extension.ts`.
 *
 * `deactivate` is the single cleanup path; `activate` registers only a
 * synchronous failsafe on `context.subscriptions`.
 */
export interface ExtensionApplication {
  /**
   * Declared as a property, not a method, so `export const activate = app.activate`
   * is safe: an extracted method would lose its receiver.
   */
  readonly activate: (context: vscode.ExtensionContext) => Promise<void>;
  /** Idempotent entry to the application's single asynchronous stop path. */
  readonly deactivate: () => Promise<void>;
  /** Typed command invocation, usable from anywhere in the extension. */
  readonly commands: CommandExecutor;
  /** The compiled plan. Exposed so tests can run it on fakes. */
  readonly plan: ApplicationPlan;
}

/**
 * Defines an extension.
 *
 * Static preflight runs synchronously when this function is called (normally
 * while the extension entry module is evaluated), so an id clash or a broken
 * service graph fails before VS Code is touched. Environment-dependent
 * preflight still runs during activation, when trust/workspace/host facts exist.
 * No VS Code API is called until `activate`.
 *
 * @example
 * ```ts
 * // extension.ts
 * const app = defineExtension({ name: 'Sample', modules: [projectsModule] });
 *
 * export const activate = app.activate;
 * export const deactivate = app.deactivate;
 * ```
 */
export function defineExtension(options: DefineExtensionOptions): ExtensionApplication {
  const plan = compileApplication({
    name: options.name,
    modules: options.modules,
    ...(options.shutdown === undefined ? {} : { shutdown: options.shutdown }),
  });

  const capability = createVSCodeCommandCapability();
  let application: Application | undefined;
  let channel: vscode.LogOutputChannel | undefined;

  return {
    plan,
    commands: createCommandExecutor(capability),

    activate: async (context: vscode.ExtensionContext): Promise<void> => {
      // Created here, not at import time: creating a channel is a VS Code call.
      //
      // Deliberately NOT pushed onto context.subscriptions: VS Code may dispose
      // subscriptions before an asynchronous deactivate() has settled. That
      // would kill the log sink in the middle of the stop pipeline. The
      // application's deactivate() below disposes it after stop completes. The
      // framework therefore adds only the host's synchronous failsafe to the
      // caller's existing context subscriptions.
      channel = vscode.window.createOutputChannel(options.name, { log: true });

      application = createApplication({
        plan,
        capabilities: {
          commands: capability,
          settings: createVSCodeSettingsCapability(),
          environment: createVSCodeEnvironmentCapability(),
          storage: createVSCodeStorageCapability(context),
          secrets: createVSCodeSecretsCapability(context),
          fileWatchers: createVSCodeFileWatcherCapability(),
          notifications: createVSCodeNotificationCapability(),
          progress: createVSCodeProgressCapability(),
          statusBar: createVSCodeStatusBarCapability(),
          languageStatus: createVSCodeLanguageStatusCapability(),
          quickInput: createVSCodeQuickInputCapability(),
          treeViews: createVSCodeTreeViewCapability(),
          localization: createVSCodeLocalizationCapability(),
          editors: createVSCodeEditorCapability(),
          webviews: createVSCodeWebviewCapability(context.extensionUri),
        },
        logSink: createLogChannelSink(channel),
        ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
      });

      try {
        await application.activate(context);
      } catch (error) {
        // Activation rolled back; nothing will log through this channel again.
        channel.dispose();
        channel = undefined;
        throw error;
      }
    },

    deactivate: async (): Promise<void> => {
      try {
        await application?.deactivate();
      } finally {
        // Disposed only after the stop pipeline settles, so the log sink stays
        // alive for every shutdown log line.
        channel?.dispose();
        channel = undefined;
      }
    },
  };
}
