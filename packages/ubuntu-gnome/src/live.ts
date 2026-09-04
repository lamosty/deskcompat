import type { SettingInspector } from "@deskcompat/core";
import type { HostFacts } from "@deskcompat/schema";
import { GSettingsInspector } from "./drivers/gsettings-inspector.ts";
import { inspectHost } from "./platform/inspect.ts";
import { LivePlatformRuntime } from "./platform/runtime.ts";

export interface LiveInspection {
  readonly facts: HostFacts;
  readonly settings: SettingInspector;
}

export async function inspectLiveEnvironment(): Promise<LiveInspection> {
  const runtime = new LivePlatformRuntime();
  return {
    facts: await inspectHost(runtime),
    settings: new GSettingsInspector(runtime.commandRunner),
  };
}
