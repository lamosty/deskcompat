import { buildPlan, TransactionStore } from "@deskcompat/core";
import type { CliResult, ModuleId, Plan } from "@deskcompat/schema";
import { evaluateSupport, inspectLiveEnvironment, resolveProfile } from "@deskcompat/ubuntu-gnome";
import { result } from "../output/render.ts";
import { DESKCOMPAT_VERSION } from "../version.ts";
import { selectedProfile } from "./profile.ts";

export async function plan(
  profilePath?: string,
  only?: ReadonlySet<ModuleId>,
): Promise<CliResult<Plan>> {
  const profile = await selectedProfile(profilePath);
  const { facts, settings } = await inspectLiveEnvironment();
  const platformDiagnostics = evaluateSupport(facts);
  const resolved = resolveProfile(profile, only);
  // @decision Planning reads existing ownership but never initializes the state
  // directory. A first plan is therefore target- and application-state read-only.
  const ownership = await new TransactionStore().readOwnership();
  const supportDiagnostics = [...platformDiagnostics, ...resolved.diagnostics];
  const hostSupported = !platformDiagnostics.some(({ severity }) => severity === "blocker");
  const selectedModules = [...(only ?? new Set(Object.keys(profile.spec.modules) as ModuleId[]))];
  const generated = await buildPlan({
    profile,
    facts,
    desiredSettings: resolved.desiredSettings,
    selectedModules,
    inspector: settings,
    ownership: ownership.resources,
    supportDiagnostics,
    allowInspection: hostSupported,
    toolVersion: DESKCOMPAT_VERSION,
  });
  return result("plan", generated, [...generated.blockers, ...generated.warnings]);
}
