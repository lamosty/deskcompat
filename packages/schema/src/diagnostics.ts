import { z } from "zod";

export const DiagnosticSeveritySchema = z.enum(["info", "warning", "error", "blocker"]);

export const DiagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    severity: DiagnosticSeveritySchema,
    subject: z
      .string()
      .regex(/^[a-zA-Z0-9:._-]+$/)
      .max(256)
      .optional(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    relatedSubjects: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z0-9:._-]+$/)
          .max(256),
      )
      .optional(),
    message: z.string().min(1),
    remediation: z.string().min(1).optional(),
  })
  .strict();

export type Diagnostic = z.infer<typeof DiagnosticSchema>;
