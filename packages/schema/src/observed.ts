import { z } from "zod";
import { GSettingsValueSchema } from "./operations.ts";

export const ObservedSettingSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("present"),
      effectiveRaw: z.string(),
      effective: GSettingsValueSchema,
      storedRaw: z.string(),
      writable: z.boolean(),
      digest: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("inherited"),
      effectiveRaw: z.string(),
      effective: GSettingsValueSchema,
      writable: z.boolean(),
      digest: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reasonCode: z.string(),
    })
    .strict(),
]);

export type ObservedSetting = z.infer<typeof ObservedSettingSchema>;
