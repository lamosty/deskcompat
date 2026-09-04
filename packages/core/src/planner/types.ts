import type {
  Diagnostic,
  GSettingsResourceId,
  GSettingsValue,
  HostFacts,
  ModuleId,
  ObservedSetting,
  Profile,
} from "@deskcompat/schema";

export interface GSettingsTarget {
  readonly resourceId: GSettingsResourceId;
  readonly schema: string;
  readonly key: string;
  readonly dconfPath: string;
  readonly valueType: GSettingsValue["type"];
}

export interface DesiredSetting {
  readonly moduleId: ModuleId;
  readonly target: GSettingsTarget;
  readonly desired: GSettingsValue;
  readonly risk: "low" | "desktop-session";
}

export interface SettingInspector {
  inspect(target: GSettingsTarget): Promise<ObservedSetting>;
}

export interface PlannerInput {
  readonly profile: Profile;
  readonly facts: HostFacts;
  readonly desiredSettings: readonly DesiredSetting[];
  readonly selectedModules: readonly ModuleId[];
  readonly inspector: SettingInspector;
  readonly supportDiagnostics: readonly Diagnostic[];
  readonly allowInspection?: boolean;
  readonly toolVersion: string;
  readonly now?: Date;
  readonly ttlMs?: number;
}
