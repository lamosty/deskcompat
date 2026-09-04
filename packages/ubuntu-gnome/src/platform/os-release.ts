const MAX_OS_RELEASE_BYTES = 64 * 1024;

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll("\\\\", "\\").replaceAll('\\"', '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseOsRelease(contents: string): Readonly<Record<string, string>> {
  if (new TextEncoder().encode(contents).byteLength > MAX_OS_RELEASE_BYTES) return {};

  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    values[key] = unquote(trimmed.slice(separator + 1));
  }
  return values;
}
