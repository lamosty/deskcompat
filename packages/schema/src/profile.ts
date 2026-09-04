import { z } from "zod";

export const PROFILE_API_VERSION = "deskcompat.dev/v1alpha1" as const;
export const ManagementStateSchema = z.enum(["unmanaged", "managed", "disabled"]);
export const ModuleIdSchema = z.enum(["workspaces", "windowControls", "keyboard"]);

const WorkspaceCountSchema = z.number().int().min(1).max(36);
const WorkspacesModuleSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("managed"),
      count: WorkspaceCountSchema,
      allMonitors: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      state: z.enum(["unmanaged", "disabled"]),
      count: WorkspaceCountSchema.optional(),
      allMonitors: z.boolean().optional(),
    })
    .strict(),
]);

const WindowControlsModuleSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("managed"),
      preset: z.literal("macos-standard"),
    })
    .strict(),
  z
    .object({
      state: z.enum(["unmanaged", "disabled"]),
      preset: z.literal("macos-standard").optional(),
    })
    .strict(),
]);

const KeyboardModuleSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("managed"),
      preset: z.literal("macos-pc"),
      preserveRightAltGr: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      state: z.enum(["unmanaged", "disabled"]),
      preset: z.literal("macos-pc").optional(),
      preserveRightAltGr: z.boolean().optional(),
    })
    .strict(),
]);

export const ProfileSchema = z
  .object({
    apiVersion: z.literal(PROFILE_API_VERSION),
    kind: z.literal("Profile"),
    metadata: z
      .object({
        name: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
      })
      .strict(),
    spec: z
      .object({
        modules: z
          .object({
            workspaces: WorkspacesModuleSchema.optional(),
            windowControls: WindowControlsModuleSchema.optional(),
            keyboard: KeyboardModuleSchema.optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ManagementState = z.infer<typeof ManagementStateSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ModuleId = z.infer<typeof ModuleIdSchema>;
