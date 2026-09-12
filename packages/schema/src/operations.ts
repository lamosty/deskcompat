import { z } from "zod";

export const BooleanGSettingsValueSchema = z
  .object({ type: z.literal("boolean"), value: z.boolean() })
  .strict();
export const Int32GSettingsValueSchema = z
  .object({
    type: z.literal("int32"),
    value: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  })
  .strict();
export const StringGSettingsValueSchema = z
  .object({ type: z.literal("string"), value: z.string() })
  .strict();
export const StringArrayGSettingsValueSchema = z
  .object({ type: z.literal("string-array"), value: z.array(z.string()) })
  .strict();
export const DynamicWorkspacesValueSchema = z
  .object({ type: z.literal("boolean"), value: z.literal(false) })
  .strict();
export const WorkspaceCountValueSchema = z
  .object({ type: z.literal("int32"), value: z.number().int().min(1).max(36) })
  .strict();
export const MacosButtonLayoutValueSchema = z
  .object({ type: z.literal("string"), value: z.literal("close,minimize,maximize:") })
  .strict();

export const GSettingsValueSchema = z.discriminatedUnion("type", [
  BooleanGSettingsValueSchema,
  Int32GSettingsValueSchema,
  StringGSettingsValueSchema,
  StringArrayGSettingsValueSchema,
]);

export const GSettingsResourceIdSchema = z.enum([
  "gsettings:org.gnome.mutter:dynamic-workspaces",
  "gsettings:org.gnome.desktop.wm.preferences:num-workspaces",
  "gsettings:org.gnome.mutter:workspaces-only-on-primary",
  "gsettings:org.gnome.desktop.wm.preferences:button-layout",
]);

export type GSettingsResourceId = z.infer<typeof GSettingsResourceIdSchema>;

export const GSETTINGS_OPERATION_POLICIES = {
  "gsettings:org.gnome.mutter:dynamic-workspaces": {
    moduleId: "workspaces",
    risk: "desktop-session",
    rollbackQuality: "exact-if-unchanged",
  },
  "gsettings:org.gnome.desktop.wm.preferences:num-workspaces": {
    moduleId: "workspaces",
    risk: "desktop-session",
    rollbackQuality: "exact-if-unchanged",
  },
  "gsettings:org.gnome.mutter:workspaces-only-on-primary": {
    moduleId: "workspaces",
    risk: "desktop-session",
    rollbackQuality: "exact-if-unchanged",
  },
  "gsettings:org.gnome.desktop.wm.preferences:button-layout": {
    moduleId: "windowControls",
    risk: "low",
    rollbackQuality: "exact-if-unchanged",
  },
} as const satisfies Readonly<
  Record<
    GSettingsResourceId,
    {
      readonly moduleId: "workspaces" | "windowControls";
      readonly risk: "low" | "desktop-session";
      readonly rollbackQuality: "exact-if-unchanged";
    }
  >
>;

const OperationBaseShape = {
  id: z.string().regex(/^op_[a-f0-9]{64}$/),
  privilege: z.literal("user"),
  dependsOn: z.array(z.string().regex(/^op_[a-f0-9]{64}$/)),
  expectedBeforeDigest: z.string().regex(/^[a-f0-9]{64}$/),
} as const;

const policies = GSETTINGS_OPERATION_POLICIES;

/**
 * @constraint Persisted operations contain only closed resource identifiers. The
 * apply driver resolves schema, key, and dconf path from its compiled registry and
 * must never trust caller-supplied paths or renderings.
 */
export const GSettingsOperationSchema = z.discriminatedUnion("resourceId", [
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("gsettings.set"),
      moduleId: z.literal(policies["gsettings:org.gnome.mutter:dynamic-workspaces"].moduleId),
      resourceId: z.literal("gsettings:org.gnome.mutter:dynamic-workspaces"),
      desired: DynamicWorkspacesValueSchema,
      risk: z.literal(policies["gsettings:org.gnome.mutter:dynamic-workspaces"].risk),
      rollbackQuality: z.literal(
        policies["gsettings:org.gnome.mutter:dynamic-workspaces"].rollbackQuality,
      ),
    })
    .strict(),
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("gsettings.set"),
      moduleId: z.literal(
        policies["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:num-workspaces"),
      desired: WorkspaceCountValueSchema,
      risk: z.literal(policies["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"].risk),
      rollbackQuality: z.literal(
        policies["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"].rollbackQuality,
      ),
    })
    .strict(),
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("gsettings.set"),
      moduleId: z.literal(
        policies["gsettings:org.gnome.mutter:workspaces-only-on-primary"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.mutter:workspaces-only-on-primary"),
      desired: BooleanGSettingsValueSchema,
      risk: z.literal(policies["gsettings:org.gnome.mutter:workspaces-only-on-primary"].risk),
      rollbackQuality: z.literal(
        policies["gsettings:org.gnome.mutter:workspaces-only-on-primary"].rollbackQuality,
      ),
    })
    .strict(),
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("gsettings.set"),
      moduleId: z.literal(
        policies["gsettings:org.gnome.desktop.wm.preferences:button-layout"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:button-layout"),
      desired: MacosButtonLayoutValueSchema,
      risk: z.literal(policies["gsettings:org.gnome.desktop.wm.preferences:button-layout"].risk),
      rollbackQuality: z.literal(
        policies["gsettings:org.gnome.desktop.wm.preferences:button-layout"].rollbackQuality,
      ),
    })
    .strict(),
]);

export const RESOURCE_ADOPT_OPERATION_POLICIES = {
  "gsettings:org.gnome.mutter:dynamic-workspaces": {
    moduleId: "workspaces",
    risk: "none",
    rollbackQuality: "exact-if-unchanged",
  },
  "gsettings:org.gnome.desktop.wm.preferences:num-workspaces": {
    moduleId: "workspaces",
    risk: "none",
    rollbackQuality: "exact-if-unchanged",
  },
  "gsettings:org.gnome.mutter:workspaces-only-on-primary": {
    moduleId: "workspaces",
    risk: "none",
    rollbackQuality: "exact-if-unchanged",
  },
  "gsettings:org.gnome.desktop.wm.preferences:button-layout": {
    moduleId: "windowControls",
    risk: "none",
    rollbackQuality: "exact-if-unchanged",
  },
} as const satisfies Readonly<
  Record<
    GSettingsResourceId,
    {
      readonly moduleId: "workspaces" | "windowControls";
      readonly risk: "none";
      readonly rollbackQuality: "exact-if-unchanged";
    }
  >
>;

const adoptionPolicies = RESOURCE_ADOPT_OPERATION_POLICIES;

/**
 * @decision Adoption is an explicit operation even though it does not mutate the
 * desktop value. This prevents an apply client from silently turning every matching
 * unowned resource into DeskCompat-owned state.
 * @constraint The resource-specific union keeps adoption targets, modules, and
 * value types closed in exactly the same way as mutating operations.
 */
export const ResourceAdoptOperationSchema = z.discriminatedUnion("resourceId", [
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("resource.adopt"),
      moduleId: z.literal(
        adoptionPolicies["gsettings:org.gnome.mutter:dynamic-workspaces"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.mutter:dynamic-workspaces"),
      desired: DynamicWorkspacesValueSchema,
      risk: z.literal(adoptionPolicies["gsettings:org.gnome.mutter:dynamic-workspaces"].risk),
      rollbackQuality: z.literal(
        adoptionPolicies["gsettings:org.gnome.mutter:dynamic-workspaces"].rollbackQuality,
      ),
    })
    .strict(),
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("resource.adopt"),
      moduleId: z.literal(
        adoptionPolicies["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:num-workspaces"),
      desired: WorkspaceCountValueSchema,
      risk: z.literal(
        adoptionPolicies["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"].risk,
      ),
      rollbackQuality: z.literal(
        adoptionPolicies["gsettings:org.gnome.desktop.wm.preferences:num-workspaces"]
          .rollbackQuality,
      ),
    })
    .strict(),
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("resource.adopt"),
      moduleId: z.literal(
        adoptionPolicies["gsettings:org.gnome.mutter:workspaces-only-on-primary"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.mutter:workspaces-only-on-primary"),
      desired: BooleanGSettingsValueSchema,
      risk: z.literal(
        adoptionPolicies["gsettings:org.gnome.mutter:workspaces-only-on-primary"].risk,
      ),
      rollbackQuality: z.literal(
        adoptionPolicies["gsettings:org.gnome.mutter:workspaces-only-on-primary"].rollbackQuality,
      ),
    })
    .strict(),
  z
    .object({
      ...OperationBaseShape,
      kind: z.literal("resource.adopt"),
      moduleId: z.literal(
        adoptionPolicies["gsettings:org.gnome.desktop.wm.preferences:button-layout"].moduleId,
      ),
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:button-layout"),
      desired: MacosButtonLayoutValueSchema,
      risk: z.literal(
        adoptionPolicies["gsettings:org.gnome.desktop.wm.preferences:button-layout"].risk,
      ),
      rollbackQuality: z.literal(
        adoptionPolicies["gsettings:org.gnome.desktop.wm.preferences:button-layout"]
          .rollbackQuality,
      ),
    })
    .strict(),
]);

export const OperationSchema = z.union([GSettingsOperationSchema, ResourceAdoptOperationSchema]);

export type GSettingsValue = z.infer<typeof GSettingsValueSchema>;
export type GSettingsOperation = z.infer<typeof GSettingsOperationSchema>;
export type ResourceAdoptOperation = z.infer<typeof ResourceAdoptOperationSchema>;
export type Operation = z.infer<typeof OperationSchema>;
