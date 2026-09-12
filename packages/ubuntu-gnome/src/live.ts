import type { SettingInspector } from "@deskcompat/core";
import type { HostFacts } from "@deskcompat/schema";
import { GSettingsInspector } from "./drivers/gsettings-inspector.ts";
import { GSettingsTransactionDriver } from "./drivers/gsettings-mutator.ts";
import { inspectHost } from "./platform/inspect.ts";
import { LivePlatformRuntime } from "./platform/runtime.ts";

export interface LiveInspection {
  readonly facts: HostFacts;
  readonly settings: SettingInspector;
}

/**
 * @decision Keep the generic command runner private to the Ubuntu adapter. CLI and
 * agent callers receive a typed inspection/transaction surface instead of gaining a
 * path to execute arbitrary host commands.
 */
export interface LiveMutationEnvironment {
  readonly facts: HostFacts;
  readonly driver: GSettingsTransactionDriver;
}

export async function inspectLiveEnvironment(): Promise<LiveInspection> {
  const runtime = new LivePlatformRuntime();
  return {
    facts: await inspectHost(runtime),
    settings: new GSettingsInspector(runtime.commandRunner),
  };
}

/** Inspect the active GNOME session and construct its allowlisted mutation driver. */
export async function inspectLiveMutationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LiveMutationEnvironment> {
  const runtime = new LivePlatformRuntime(environment);
  return {
    facts: await inspectHost(runtime),
    driver: new GSettingsTransactionDriver(runtime.commandRunner),
  };
}

/** Construct a driver without performing any live inspection (useful for status/revert). */
export function createLiveTransactionDriver(
  environment: NodeJS.ProcessEnv = process.env,
): GSettingsTransactionDriver {
  return new GSettingsTransactionDriver(new LivePlatformRuntime(environment).commandRunner);
}
