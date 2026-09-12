import { z } from "zod";
import { type Diagnostic, DiagnosticSchema } from "./diagnostics.ts";
import { HostFactsSchema } from "./facts.ts";
import { GSettingsResourceIdSchema } from "./operations.ts";
import { PlanSchema } from "./plan.ts";
import { ProfileSchema } from "./profile.ts";
import { OwnershipIndexSchema, TransactionRecordSchema } from "./transaction.ts";

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
      command: z.literal("apply"),
      data: TransactionRecordSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("revert"),
      data: TransactionRecordSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("recover"),
      data: TransactionRecordSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("history"),
      data: z
        .object({
          transactions: z.array(TransactionRecordSchema),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...EnvelopeShape,
      command: z.literal("status"),
      data: z
        .object({
          ownership: OwnershipIndexSchema,
          transactions: z.array(TransactionRecordSchema),
          resources: z
            .array(
              z
                .object({
                  resourceId: GSettingsResourceIdSchema,
                  baselineDigest: z.string().regex(/^[a-f0-9]{64}$/),
                  appliedDigest: z.string().regex(/^[a-f0-9]{64}$/),
                  currentDigest: z
                    .string()
                    .regex(/^[a-f0-9]{64}$/)
                    .optional(),
                  state: z.enum(["aligned", "drifted", "unavailable"]),
                })
                .strict(),
            )
            .default([]),
        })
        .strict(),
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
