import type { GSettingsValue } from "@deskcompat/schema";

function parseQuotedString(raw: string): string | undefined {
  if (raw.length < 2 || raw[0] !== "'" || raw.at(-1) !== "'") return undefined;
  let result = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character === undefined) return undefined;
    if (character !== "\\") {
      if (character === "'" || character.charCodeAt(0) < 0x20) return undefined;
      result += character;
      continue;
    }

    const escaped = raw[index + 1];
    if (escaped === undefined || index + 1 >= raw.length - 1) return undefined;
    const replacements: Readonly<Record<string, string>> = {
      "'": "'",
      '"': '"',
      "\\": "\\",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
    };
    const replacement = replacements[escaped];
    if (replacement === undefined) return undefined;
    result += replacement;
    index += 1;
  }
  return result;
}

export function parseGVariant(
  raw: string,
  expectedType: GSettingsValue["type"],
): GSettingsValue | undefined {
  switch (expectedType) {
    case "boolean":
      if (raw === "true" || raw === "false") {
        return { type: "boolean", value: raw === "true" };
      }
      return undefined;
    case "int32": {
      if (!/^-?(?:0|[1-9]\d*)$/.test(raw)) return undefined;
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
        return undefined;
      }
      return { type: "int32", value };
    }
    case "string": {
      const value = parseQuotedString(raw);
      return value === undefined ? undefined : { type: "string", value };
    }
    case "string-array":
      return undefined;
  }
}

export function rangeMatchesType(raw: string, expectedType: GSettingsValue["type"]): boolean {
  switch (expectedType) {
    case "boolean":
      return raw === "type b";
    case "int32":
      return raw === "type i" || raw.startsWith("range i ");
    case "string":
      return raw === "type s";
    case "string-array":
      return raw === "type as";
  }
}
