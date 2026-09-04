import { z } from "zod";
import { DiagnosticSchema } from "./diagnostics.ts";

export const CapabilityIdSchema = z.enum([
  "gsettings",
  "dconf",
  "gnome-shell",
  "keyd",
  "xremap",
  "input-remapper",
  "session-bus",
]);

export const CapabilitySchema = z
  .object({
    id: CapabilityIdSchema,
    available: z.boolean(),
  })
  .strict();

export const PlatformFactsSchema = z
  .object({
    osId: z.enum(["ubuntu", "other", "unknown"]),
    osVersion: z.enum(["24.04", "other", "unknown"]),
    desktop: z.enum(["gnome", "other", "unknown"]),
    desktopVersion: z.union([z.literal("unknown"), z.string().regex(/^\d+(?:\.\d+)*$/)]),
    sessionType: z.enum(["wayland", "x11", "other", "unknown"]),
  })
  .strict();

export const HostFactsSchema = z
  .object({
    platform: PlatformFactsSchema,
    capabilities: z.array(CapabilitySchema),
    conflicts: z.array(DiagnosticSchema),
  })
  .strict();

export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type PlatformFacts = z.infer<typeof PlatformFactsSchema>;
export type HostFacts = z.infer<typeof HostFactsSchema>;
