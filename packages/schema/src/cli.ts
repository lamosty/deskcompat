import { z } from "zod";
import { DiagnosticSchema, type Diagnostic } from "./diagnostics.ts";
import { HostFactsSchema } from "./facts.ts";
import { PlanSchema } from "./plan.ts";
import { ProfileSchema } from "./profile.ts";

export const CLI_API_VERSION = "deskcompat.dev/cli/v1alpha1" as const;

const EnvelopeShape = {
  apiVersion: z.literal(CLI_API_VERSION),
  ok: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
} as const;

export const CliResultSchema = z.union([
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("doctor"),
      data: HostFactsSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("profile validate"),
      data: ProfileSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("plan"),
      data: PlanSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("help"),
      data: z.object({ text: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("version"),
      data: z.object({ version: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("invocation"),
    })
    .strict(),
]);

export type CliCommand = z.infer<typeof CliResultSchema>["command"];

export interface CliResult<T> {
  readonly apiVersion: typeof CLI_API_VERSION;
  readonly ok: boolean;
  readonly command: CliCommand;
  readonly data?: T;
  readonly diagnostics: readonly Diagnostic[];
}
