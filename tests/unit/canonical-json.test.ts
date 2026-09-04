import { describe, expect, test } from "bun:test";
import { canonicalJson, sha256 } from "../../packages/core/src/canonical-json.ts";

describe("canonicalJson", () => {
  test("orders object keys recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: null } })).toBe(
      '{"a":{"b":null,"y":true},"z":1}',
    );
  });

  test("normalizes negative zero", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  test("rejects values outside the JSON domain", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ nested: undefined })).toThrow();
    expect(() => canonicalJson(new Array(1))).toThrow("sparse arrays");
  });

  test("produces equal digests for different insertion order", () => {
    expect(sha256({ second: 2, first: 1 })).toBe(sha256({ first: 1, second: 2 }));
  });
});
