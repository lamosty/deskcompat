import type { GSettingsValue } from "@deskcompat/schema";

function quoteString(value: string): string {
  return `'${value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")}'`;
}

export function renderGVariant(value: GSettingsValue): string {
  switch (value.type) {
    case "boolean":
      return value.value ? "true" : "false";
    case "int32":
      return String(value.value);
    case "string":
      return quoteString(value.value);
    case "string-array":
      return `[${value.value.map(quoteString).join(", ")}]`;
  }
}
