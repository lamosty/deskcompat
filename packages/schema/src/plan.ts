import { z } from "zod";
import { DiagnosticSchema } from "./diagnostics.ts";
import {
  BooleanGSettingsValueSchema,
  DynamicWorkspacesValueSchema,
  MacosButtonLayoutValueSchema,
  OperationSchema,
  StringGSettingsValueSchema,
  WorkspaceCountValueSchema,
} from "./operations.ts";
import { ModuleIdSchema } from "./profile.ts";

export const PLAN_API_VERSION = "deskcompat.dev/plan/v1alpha1" as const;
export const SUPPORT_TARGET = "ubuntu-24.04-gnome-46-wayland" as const;

const ResourceBaseShape = {
  moduleIds: z.array(ModuleIdSchema).min(1),
  disposition: z.enum(["change", "unchanged", "unavailable", "skipped"]),
} as const;

function observedResourceSchema<Effective extends z.ZodType>(effective: Effective) {
  return z.discriminatedUnion("status", [
    z
      .object({
        status: z.enum(["present", "inherited"]),
        effective,
        writable: z.boolean(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    z
      .object({
        status: z.enum(["unavailable", "skipped"]),
        reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      })
      .strict(),
  ]);
}

/**
 * @constraint Resource assertions use the same closed resource vocabulary as
 * operations. In particular, a plan cannot describe a desired value whose type or
 * range could never be emitted for that resource by a compiled module.
 */
export const ResolvedResourceSchema = z.discriminatedUnion("resourceId", [
  z
    .object({
      ...ResourceBaseShape,
      resourceId: z.literal("gsettings:org.gnome.mutter:dynamic-workspaces"),
      desired: z.array(DynamicWorkspacesValueSchema).min(1),
      observed: observedResourceSchema(BooleanGSettingsValueSchema),
    })
    .strict(),
  z
    .object({
      ...ResourceBaseShape,
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:num-workspaces"),
      desired: z.array(WorkspaceCountValueSchema).min(1),
      observed: observedResourceSchema(WorkspaceCountValueSchema),
    })
    .strict(),
  z
    .object({
      ...ResourceBaseShape,
      resourceId: z.literal("gsettings:org.gnome.mutter:workspaces-only-on-primary"),
      desired: z.array(BooleanGSettingsValueSchema).min(1),
      observed: observedResourceSchema(BooleanGSettingsValueSchema),
    })
    .strict(),
  z
    .object({
      ...ResourceBaseShape,
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:button-layout"),
      desired: z.array(MacosButtonLayoutValueSchema).min(1),
      observed: observedResourceSchema(StringGSettingsValueSchema),
    })
    .strict(),
]);

export const PlanSchema = z
  .object({
    apiVersion: z.literal(PLAN_API_VERSION),
    planId: z.string().regex(/^pln_[a-f0-9]{64}$/),
    semanticDigest: z.string().regex(/^sem_[a-f0-9]{64}$/),
    profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
    factsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    toolVersion: z.string(),
    supportTarget: z.literal(SUPPORT_TARGET),
    scope: z.array(ModuleIdSchema),
    resources: z.array(ResolvedResourceSchema),
    operations: z.array(OperationSchema),
    blockers: z.array(DiagnosticSchema),
    warnings: z.array(DiagnosticSchema),
    summary: z
      .object({
        changes: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      })
      .strict(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;
