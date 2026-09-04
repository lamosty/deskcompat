import { describe, expect, test } from "bun:test";
import { parseOsRelease } from "../../packages/ubuntu-gnome/src/platform/os-release.ts";

describe("parseOsRelease", () => {
  test("parses quoted values without evaluating content", () => {
    expect(
      parseOsRelease('ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n'),
    ).toEqual({ ID: "ubuntu", VERSION_ID: "24.04", PRETTY_NAME: "Ubuntu 24.04 LTS" });
  });

  test("ignores malformed keys and comments", () => {
    expect(parseOsRelease("# comment\ninvalid=value\nID=ubuntu\nNO_SEPARATOR\n")).toEqual({
      ID: "ubuntu",
    });
  });

  test("rejects oversized input", () => {
    expect(parseOsRelease(`ID=${"a".repeat(65 * 1024)}`)).toEqual({});
  });
});
