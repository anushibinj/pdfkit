import { describe, expect, it } from "vitest";
import {
  AADHAAR_PRESET,
  CARD_PRESET,
  DATE_PRESET,
  EMAIL_PRESET,
  IFSC_PRESET,
  PAN_PRESET,
  PHONE_PRESET,
  PRESET_MATCHERS,
  createPlainTextMatcher,
  createRegexMatcher,
  getPresetMatcher,
  isValidLuhn,
} from "./presets";

describe("presets", () => {
  it("lists all 7 required presets and resolves each by id", () => {
    expect(PRESET_MATCHERS.map((p) => p.source)).toEqual([
      "email",
      "phone",
      "pan",
      "aadhaar",
      "ifsc",
      "card",
      "date",
    ]);
    for (const preset of PRESET_MATCHERS) {
      expect(getPresetMatcher(preset.source)).toBe(preset);
    }
    expect(() => getPresetMatcher("unknown" as never)).toThrow();
  });

  describe("EMAIL_PRESET", () => {
    it("matches standard email addresses", () => {
      const hits = EMAIL_PRESET.findMatches(
        "Send to alice.smith+billing@sub.example.co.uk and bob_99@corp.io.",
      );
      expect(hits.map((h) => h.value)).toEqual([
        "alice.smith+billing@sub.example.co.uk",
        "bob_99@corp.io",
      ]);
    });

    it("rejects false-positive malformed email strings", () => {
      const hits = EMAIL_PRESET.findMatches(
        "Bad: alice..bob@example.com, .alice@example.com, bob@-example.com, foo@bar, @missing.com",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("PHONE_PRESET", () => {
    it("matches international, US, and Indian phone numbers", () => {
      const hits = PHONE_PRESET.findMatches(
        "Call +91 98765 43210 or (415) 555-0199 or 9876543210.",
      );
      expect(hits.map((h) => h.value)).toEqual([
        "+91 98765 43210",
        "(415) 555-0199",
        "9876543210",
      ]);
    });

    it("rejects dates, IPv4 addresses, decimals, and short numbers", () => {
      const hits = PHONE_PRESET.findMatches(
        "Date 2026-01-15, IP 192.168.100.12, float 12345.67890, short 12345, zeros 0000000000",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("PAN_PRESET", () => {
    it("matches valid Indian PAN numbers", () => {
      const hits = PAN_PRESET.findMatches(
        "Primary PAN: ABCPK1234F, Company: AABCA9876Z.",
      );
      expect(hits.map((h) => h.value)).toEqual(["ABCPK1234F", "AABCA9876Z"]);
    });

    it("rejects false-positive 10-char tokens and embedded codes", () => {
      const hits = PAN_PRESET.findMatches(
        "Invalid holder: ABCDD1234F, embedded: XABCPK1234F, lowercase: abcpk1234f, wrong len: ABCPK1234FA",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("AADHAAR_PRESET", () => {
    it("matches 12-digit Aadhaar numbers with space, hyphen, or no separator", () => {
      const hits = AADHAAR_PRESET.findMatches(
        "IDs: 2345 6789 0123, 9876-5432-1098, and 345678901234.",
      );
      expect(hits.map((h) => h.value)).toEqual([
        "2345 6789 0123",
        "9876-5432-1098",
        "345678901234",
      ]);
    });

    it("rejects numbers starting with 0 or 1, mixed separators, and 13-digit IDs", () => {
      const hits = AADHAAR_PRESET.findMatches(
        "Bad: 1234 5678 9012, 0123-4567-8901, 2345 6789-0123, 2345678901234",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("IFSC_PRESET", () => {
    it("matches valid 11-character IFSC codes", () => {
      const hits = IFSC_PRESET.findMatches(
        "Branches: SBIN0001234 and HDFC0CAB123.",
      );
      expect(hits.map((h) => h.value)).toEqual([
        "SBIN0001234",
        "HDFC0CAB123",
      ]);
    });

    it("rejects codes where the 5th character is non-zero or length is wrong", () => {
      const hits = IFSC_PRESET.findMatches(
        "Bad: SBIN1001234, sbin0001234, XSBIN0001234, SBIN00012",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("CARD_PRESET", () => {
    it("validates Luhn checksums directly", () => {
      expect(isValidLuhn("4111111111111111")).toBe(true);
      expect(isValidLuhn("4111111111111112")).toBe(false);
      expect(isValidLuhn("0000000000000000")).toBe(false);
    });

    it("matches Luhn-valid Visa, Mastercard, and Amex card numbers", () => {
      const hits = CARD_PRESET.findMatches(
        "Visa 4111-1111-1111-1111, MC 5500 0000 0000 0004, Amex 378282246310005.",
      );
      expect(hits.map((h) => h.value)).toEqual([
        "4111-1111-1111-1111",
        "5500 0000 0000 0004",
        "378282246310005",
      ]);
    });

    it("rejects Luhn-invalid numbers, mixed separators, and overlong account numbers", () => {
      const hits = CARD_PRESET.findMatches(
        "Bad Luhn: 4111-1111-1111-1112, mixed: 4111 1111-1111 1111, short: 411111111111, long: 12345678901234567890",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("DATE_PRESET", () => {
    it("matches ISO, slash, hyphen, and named-month dates", () => {
      const hits = DATE_PRESET.findMatches(
        "Signed 2026-02-28, due 15/08/2026, filed 15 Jan 2026, updated Feb 29, 2024.",
      );
      expect(hits.map((h) => h.value)).toEqual([
        "2026-02-28",
        "15/08/2026",
        "15 Jan 2026",
        "Feb 29, 2024",
      ]);
    });

    it("rejects impossible calendar dates as false positives", () => {
      const hits = DATE_PRESET.findMatches(
        "Invalid: 2025-02-29, 2026-13-01, 32/01/2026, 31 Apr 2026, 99-99-2026",
      );
      expect(hits).toEqual([]);
    });
  });

  describe("plain text and regex matchers", () => {
    it("escapes metacharacters in plain text search and supports case sensitivity", () => {
      const insensitive = createPlainTextMatcher("a.b+c", false);
      expect(
        insensitive.findMatches("x A.B+C y aXb+c z").map((m) => m.value),
      ).toEqual(["A.B+C"]);

      const sensitive = createPlainTextMatcher("Secret", true);
      expect(
        sensitive.findMatches("secret Secret SECRET").map((m) => m.value),
      ).toEqual(["Secret"]);

      expect(createPlainTextMatcher("").findMatches("abc")).toEqual([]);
    });

    it("compiles custom regex matchers and guards against empty or zero-width matches", () => {
      expect(() => createRegexMatcher("")).toThrow();
      expect(() => createRegexMatcher("[unclosed")).toThrow();

      const matcher = createRegexMatcher("ACC-\\d{4}", true);
      expect(
        matcher.findMatches("ACC-1001 acc-1002 ACC-9999").map((m) => m.value),
      ).toEqual(["ACC-1001", "ACC-9999"]);

      const zeroWidth = createRegexMatcher("a*", true);
      expect(zeroWidth.findMatches("aba").map((m) => m.value)).toEqual([
        "a",
        "a",
      ]);
    });
  });
});
