import type { DesiredSetting, GSettingsTarget } from "@deskcompat/core";
import {
  type Diagnostic,
  type GSettingsResourceId,
  GSettingsResourceIdSchema,
  type ModuleId,
  type Profile,
} from "@deskcompat/schema";

export interface ResolvedProfile {
  readonly desiredSettings: readonly DesiredSetting[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * @constraint This is the only source of GNOME schema/key/path mappings used by
 * mutating code. Resource identifiers are part of the persisted plan, but the
 * executable details stay compiled into this registry so a plan cannot redirect
 * a mutation to an arbitrary dconf path.
 */
export const GSETTINGS_TARGETS = Object.freeze({
  "gsettings:org.gnome.mutter:dynamic-workspaces": Object.freeze({
    resourceId: "gsettings:org.gnome.mutter:dynamic-workspaces",
    schema: "org.gnome.mutter",
    key: "dynamic-workspaces",
    dconfPath: "/org/gnome/mutter/dynamic-workspaces",
    valueType: "boolean",
  }),
  "gsettings:org.gnome.desktop.wm.preferences:num-workspaces": Object.freeze({
    resourceId: "gsettings:org.gnome.desktop.wm.preferences:num-workspaces",
    schema: "org.gnome.desktop.wm.preferences",
    key: "num-workspaces",
    dconfPath: "/org/gnome/desktop/wm/preferences/num-workspaces",
    valueType: "int32",
  }),
  "gsettings:org.gnome.mutter:workspaces-only-on-primary": Object.freeze({
    resourceId: "gsettings:org.gnome.mutter:workspaces-only-on-primary",
    schema: "org.gnome.mutter",
    key: "workspaces-only-on-primary",
    dconfPath: "/org/gnome/mutter/workspaces-only-on-primary",
    valueType: "boolean",
  }),
  "gsettings:org.gnome.desktop.wm.preferences:button-layout": Object.freeze({
    resourceId: "gsettings:org.gnome.desktop.wm.preferences:button-layout",
    schema: "org.gnome.desktop.wm.preferences",
    key: "button-layout",
    dconfPath: "/org/gnome/desktop/wm/preferences/button-layout",
    valueType: "string",
  }),
}) satisfies Readonly<Record<GSettingsResourceId, GSettingsTarget>>;

export type CompiledGSettingsTarget = (typeof GSETTINGS_TARGETS)[GSettingsResourceId];

/** Resolve a persisted resource identifier to an immutable, compiled target. */
export function resolveGSettingsTarget(resourceId: unknown): CompiledGSettingsTarget | undefined {
  const parsed = GSettingsResourceIdSchema.safeParse(resourceId);
  if (!parsed.success) return undefined;
  return GSETTINGS_TARGETS[parsed.data];
}

export function resolveProfile(profile: Profile, only?: ReadonlySet<ModuleId>): ResolvedProfile {
  const desiredSettings: DesiredSetting[] = [];
  const diagnostics: Diagnostic[] = [];
  const isSelected = (moduleId: ModuleId): boolean => only === undefined || only.has(moduleId);

  const workspaces = profile.spec.modules.workspaces;
  if (workspaces && isSelected("workspaces")) {
    if (workspaces.state === "managed") {
      desiredSettings.push(
        {
          moduleId: "workspaces",
          target: GSETTINGS_TARGETS["gsettings:org.gnome.mutter:dynamic-workspaces"],
          desired: { type: "boolean", value: false },
          risk: "desktop-session",
        },
        {
          moduleId: "workspaces",
          target: GSETTINGS_TARGETS["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"],
          desired: { type: "int32", value: workspaces.count },
          risk: "desktop-session",
        },
      );
      if (workspaces.allMonitors !== undefined) {
        desiredSettings.push({
          moduleId: "workspaces",
          target: GSETTINGS_TARGETS["gsettings:org.gnome.mutter:workspaces-only-on-primary"],
          desired: { type: "boolean", value: !workspaces.allMonitors },
          risk: "desktop-session",
        });
      }
    } else if (workspaces.state === "disabled") {
      diagnostics.push({
        code: "DISABLE_REQUIRES_MANAGED_BASELINE",
        severity: "blocker",
        subject: "module.workspaces",
        reasonCode: "OWNERSHIP_STATE_UNAVAILABLE",
        message:
          "Disabling workspaces requires transaction ownership, which is not implemented yet.",
      });
    }
  }

  const windowControls = profile.spec.modules.windowControls;
  if (windowControls && isSelected("windowControls")) {
    if (windowControls.state === "managed") {
      desiredSettings.push({
        moduleId: "windowControls",
        target: GSETTINGS_TARGETS["gsettings:org.gnome.desktop.wm.preferences:button-layout"],
        desired: {
          type: "string",
          value: "close,minimize,maximize:",
        },
        risk: "low",
      });
    } else if (windowControls.state === "disabled") {
      diagnostics.push({
        code: "DISABLE_REQUIRES_MANAGED_BASELINE",
        severity: "blocker",
        subject: "module.windowControls",
        reasonCode: "OWNERSHIP_STATE_UNAVAILABLE",
        message:
          "Disabling window controls requires transaction ownership, which is not implemented yet.",
      });
    }
  }

  const keyboard = profile.spec.modules.keyboard;
  if (keyboard && keyboard.state !== "unmanaged" && isSelected("keyboard")) {
    diagnostics.push({
      code: "KEYBOARD_MODULE_NOT_IMPLEMENTED",
      severity: "blocker",
      subject: "module.keyboard",
      reasonCode: "RECOVERY_NOT_IMPLEMENTED",
      message:
        "The keyboard module remains detection-only until independent recovery is implemented.",
    });
  }

  return { desiredSettings, diagnostics };
}
