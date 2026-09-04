import { describe, expect, test } from "bun:test";
import {
  parseGVariant,
  rangeMatchesType,
} from "../../packages/ubuntu-gnome/src/drivers/gvariant.ts";
import { renderGVariant } from "../../packages/core/src/planner/render-gvariant.ts";

describe("parseGVariant", () => {
  test("parses the allowlisted scalar types", () => {
    expect(parseGVariant("true", "boolean")).toEqual({ type: "boolean", value: true });
    expect(parseGVariant("-12", "int32")).toEqual({ type: "int32", value: -12 });
    expect(parseGVariant("'close,minimize:'", "string")).toEqual({
      type: "string",
      value: "close,minimize:",
    });
  });

  test("rejects malformed and mismatched values", () => {
    expect(parseGVariant("TRUE", "boolean")).toBeUndefined();
    expect(parseGVariant("2147483648", "int32")).toBeUndefined();
    expect(parseGVariant("'unterminated", "string")).toBeUndefined();
    expect(parseGVariant("'bad'quote'", "string")).toBeUndefined();
    expect(parseGVariant("'bad\\q'", "string")).toBeUndefined();
  });

  test("round-trips escaped strings emitted by the planner", () => {
    const value = { type: "string" as const, value: "quote' slash\\ line\n" };
    expect(parseGVariant(renderGVariant(value), "string")).toEqual(value);
  });
});

describe("rangeMatchesType", () => {
  test("recognizes GNOME scalar range output", () => {
    expect(rangeMatchesType("type b", "boolean")).toBe(true);
    expect(rangeMatchesType("range i 1 36", "int32")).toBe(true);
    expect(rangeMatchesType("type s", "string")).toBe(true);
    expect(rangeMatchesType("type s", "boolean")).toBe(false);
  });
});
