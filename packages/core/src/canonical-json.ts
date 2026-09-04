import { createHash } from "node:crypto";

type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * @decision Plan identifiers hash a deterministic JSON subset rather than ordinary
 * JSON.stringify output. Domain schemas reject non-JSON values before this boundary.
 * This implements the ordering and number rules needed by DeskCompat's schemas; it
 * must not silently coerce undefined, non-finite numbers, or custom object types.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot encode a non-finite number");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError("Canonical JSON cannot encode sparse arrays");
      entries.push(canonicalJson(value[index]));
    }
    return `[${entries.join(",")}]`;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left === right ? 0 : left < right ? -1 : 1,
    );

    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }

  throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
