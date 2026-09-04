import type { DesiredSetting } from "@deskcompat/core";
import type { Diagnostic, ModuleId, Profile } from "@deskcompat/schema";

export interface ResolvedProfile {
  readonly desiredSettings: readonly DesiredSetting[];
  readonly diagnostics: readonly Diagnostic[];
}

const targets = {
  dynamicWorkspaces: {
    resourceId: "gsettings:org.gnome.mutter:dynamic-workspaces",
    schema: "org.gnome.mutter",
    key: "dynamic-workspaces",
    dconfPath: "/org/gnome/mutter/dynamic-workspaces",
    valueType: "boolean",
  },
  workspaceCount: {
    resourceId: "gsettings:org.gnome.desktop.wm.preferences:num-workspaces",
    schema: "org.gnome.desktop.wm.preferences",
    key: "num-workspaces",
    dconfPath: "/org/gnome/desktop/wm/preferences/num-workspaces",
    valueType: "int32",
  },
  workspacesOnlyOnPrimary: {
    resourceId: "gsettings:org.gnome.mutter:workspaces-only-on-primary",
    schema: "org.gnome.mutter",
    key: "workspaces-only-on-primary",
    dconfPath: "/org/gnome/mutter/workspaces-only-on-primary",
    valueType: "boolean",
  },
  buttonLayout: {
    resourceId: "gsettings:org.gnome.desktop.wm.preferences:button-layout",
    schema: "org.gnome.desktop.wm.preferences",
    key: "button-layout",
    dconfPath: "/org/gnome/desktop/wm/preferences/button-layout",
    valueType: "string",
  },
} as const;

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
          target: targets.dynamicWorkspaces,
          desired: { type: "boolean", value: false },
          risk: "desktop-session",
        },
        {
          moduleId: "workspaces",
          target: targets.workspaceCount,
          desired: { type: "int32", value: workspaces.count },
          risk: "desktop-session",
        },
      );
      if (workspaces.allMonitors !== undefined) {
        desiredSettings.push({
          moduleId: "workspaces",
          target: targets.workspacesOnlyOnPrimary,
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
        target: targets.buttonLayout,
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
