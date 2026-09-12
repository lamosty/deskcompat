import type { HostFacts, ModuleId, Profile } from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * @decision Plan application recomputes the same privacy-bounded host fingerprint
 * used during planning. Keep this projection public to the core rather than letting
 * apply trust a caller-supplied digest or duplicate an eventually divergent subset.
 */
export function planFactsDigest(facts: HostFacts, includeInputCapabilities: boolean): string {
  const relevantCapabilityIds = includeInputCapabilities
    ? new Set([
        "dconf",
        "gnome-shell",
        "gsettings",
        "session-bus",
        "keyd",
        "xremap",
        "input-remapper",
      ])
    : new Set(["dconf", "gnome-shell", "gsettings", "session-bus"]);
  return sha256({
    platform: facts.platform,
    capabilities: facts.capabilities
      .filter(({ id }) => relevantCapabilityIds.has(id))
      .map(({ id, available }) => ({ id, available }))
      .sort((left, right) => compareText(left.id, right.id)),
    conflictCodes: includeInputCapabilities
      ? facts.conflicts.map(({ code }) => code).sort(compareText)
      : [],
  });
}

export function planIncludesInputCapabilities(
  profile: Profile,
  scope: readonly ModuleId[],
): boolean {
  const keyboard = profile.spec.modules.keyboard;
  return scope.includes("keyboard") && keyboard !== undefined && keyboard.state !== "unmanaged";
}

export function selectedProfileDigest(profile: Profile, scope: readonly ModuleId[]): string {
  return sha256({
    apiVersion: profile.apiVersion,
    kind: profile.kind,
    modules: Object.fromEntries(
      scope.map((moduleId) => [moduleId, profile.spec.modules[moduleId] ?? null]),
    ),
  });
}
