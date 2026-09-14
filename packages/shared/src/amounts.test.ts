import { describe, expect, it } from "vitest";
import {
  AmountError,
  formatXlm,
  fromStroops,
  hasSufficientBalance,
  STROOPS_PER_XLM,
  toStroops,
} from "./amounts.js";

describe("toStroops", () => {
  it("converts the UI presets", () => {
    expect(toStroops(1)).toBe(10_000_000n);
    expect(toStroops(5)).toBe(50_000_000n);
    expect(toStroops(10)).toBe(100_000_000n);
  });

  it("accepts strings without going through a float", () => {
    expect(toStroops("5")).toBe(50_000_000n);
    expect(toStroops("5.0000000")).toBe(50_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
  });

  it("handles the float amounts that a naive Math.round would get wrong", () => {
    // 0.1 + 0.2 === 0.30000000000000004; the string path must not inherit that.
    expect(toStroops("0.3")).toBe(3_000_000n);
    expect(toStroops(0.1)).toBe(1_000_000n);
    expect(toStroops(2.675)).toBe(26_750_000n);
  });

  it("rejects amounts finer than 7 decimals instead of truncating", () => {
    expect(() => toStroops("0.00000001")).toThrow(AmountError);
  });

  it("rejects junk", () => {
    expect(() => toStroops("")).toThrow(AmountError);
    expect(() => toStroops("abc")).toThrow(AmountError);
    expect(() => toStroops("-5")).toThrow(AmountError);
    expect(() => toStroops(-5)).toThrow(AmountError);
    expect(() => toStroops(Number.NaN)).toThrow(AmountError);
    expect(() => toStroops(Number.POSITIVE_INFINITY)).toThrow(AmountError);
  });

  it("survives amounts beyond Number.MAX_SAFE_INTEGER stroops", () => {
    // ~1 billion XLM is more than 2^53-1 stroops; the bigint path must stay exact.
    expect(toStroops("1000000000")).toBe(10_000_000_000_000_000n);
  });
});

describe("fromStroops / formatXlm", () => {
  it("round-trips", () => {
    for (const v of ["1.0000000", "5.0000000", "0.0000001", "123.4567890"]) {
      expect(fromStroops(toStroops(v))).toBe(v);
    }
  });

  it("emits the 7-decimal form classic operations require", () => {
    expect(fromStroops(50_000_000n)).toBe("5.0000000");
    expect(fromStroops(0n)).toBe("0.0000000");
  });

  it("formats for humans without trailing zeros", () => {
    expect(formatXlm(50_000_000n)).toBe("5");
    expect(formatXlm(51_000_000n)).toBe("5.1");
    expect(formatXlm(0n)).toBe("0");
    expect(formatXlm(1n)).toBe("0.0000001");
  });
});

describe("hasSufficientBalance", () => {
  it("allows spending the exact balance", () => {
    expect(hasSufficientBalance(50_000_000n, 50_000_000n)).toBe(true);
  });

  it("rejects overspending and zero amounts", () => {
    expect(hasSufficientBalance(10_000_000n, 50_000_000n)).toBe(false);
    expect(hasSufficientBalance(50_000_000n, 0n)).toBe(false);
  });
});

describe("constants", () => {
  it("matches the protocol's 7 decimals", () => {
    expect(STROOPS_PER_XLM).toBe(10n ** 7n);
  });
});
