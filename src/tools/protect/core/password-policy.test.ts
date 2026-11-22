import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_BYTES,
  describePasswordProblem,
  findPasswordPairProblem,
  findPasswordProblem,
  hasUnsupportedCharacter,
  mayBeAlteredByReaders,
  utf8ByteLength,
  type PasswordProblem,
} from "./password-policy";

describe("utf8ByteLength", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("अ")).toBe(3);
    expect(utf8ByteLength("🔐")).toBe(4);
  });
});

describe("hasUnsupportedCharacter", () => {
  it("accepts ordinary text in any script, emoji included", () => {
    for (const ok of [
      "hunter2",
      "P@ss w0rd!",
      "पासवर्ड",
      "密码",
      "🔐🔑",
      "café",
    ]) {
      expect(hasUnsupportedCharacter(ok)).toBe(false);
    }
  });

  it.each([
    ["NUL", "a\u0000b"],
    ["tab", "a\tb"],
    ["unit separator", "a\u001fb"],
    ["DEL", "a\u007fb"],
    ["C1 control", "a\u0085b"],
    ["lone high surrogate at the end", "a\ud83d"],
    ["lone high surrogate in the middle", "\ud83dab"],
    ["lone low surrogate", "a\udd10b"],
    ["two high surrogates", "\ud83d\ud83d"],
  ])("refuses a %s", (_label, password) => {
    expect(hasUnsupportedCharacter(password)).toBe(true);
  });

  it("accepts the boundaries just outside the refused ranges", () => {
    expect(hasUnsupportedCharacter(" ~")).toBe(false); // U+0020, U+007E
    expect(hasUnsupportedCharacter(" ")).toBe(false); // U+00A0
  });
});

describe("findPasswordProblem", () => {
  it("accepts a normal password", () => {
    expect(findPasswordProblem("correct horse")).toBeNull();
  });

  it("refuses an empty password", () => {
    expect(findPasswordProblem("")).toBe("empty");
  });

  it("accepts exactly the byte limit and refuses one byte more", () => {
    expect(findPasswordProblem("x".repeat(MAX_PASSWORD_BYTES))).toBeNull();
    expect(findPasswordProblem("x".repeat(MAX_PASSWORD_BYTES + 1))).toBe(
      "too-long",
    );
  });

  it("measures the limit in bytes, so 43 Devanagari letters are too long", () => {
    expect(findPasswordProblem("अ".repeat(42))).toBeNull(); // 126 bytes
    expect(findPasswordProblem("अ".repeat(43))).toBe("too-long"); // 129 bytes
  });

  it("reports unsupported characters before the length", () => {
    expect(findPasswordProblem(`\u0000${"x".repeat(200)}`)).toBe(
      "unsupported-character",
    );
  });
});

describe("findPasswordPairProblem", () => {
  it("accepts matching, valid passwords", () => {
    expect(findPasswordPairProblem("same", "same")).toBeNull();
  });

  it("reports a mismatch", () => {
    expect(findPasswordPairProblem("same", "Same")).toBe("mismatch");
    expect(findPasswordPairProblem("same", "")).toBe("mismatch");
  });

  it("reports the password's own problem before a mismatch", () => {
    expect(findPasswordPairProblem("", "x")).toBe("empty");
    expect(findPasswordPairProblem("x".repeat(200), "y")).toBe("too-long");
  });
});

describe("mayBeAlteredByReaders", () => {
  it("is false for text SASLprep leaves unchanged", () => {
    for (const ok of [
      "hunter2",
      "P@ss w0rd!",
      "पासवर्ड",
      "密码",
      "café",
      "🔐",
    ]) {
      expect(mayBeAlteredByReaders(ok)).toBe(false);
    }
  });

  it.each([
    ["a superscript (NFKC)", "pass²"],
    ["full-width letters (NFKC)", "ＡＢＣ"],
    ["a no-break space (NFKC)", "pass word"],
    ["a decomposed accent (NFKC composes it)", "café"],
    ["an emoji variation selector", "❤️"],
    ["a zero-width joiner", "\u{1f468}‍\u{1f469}"],
    ["a soft hyphen", "pass­word"],
    ["an Ogham space mark", "a b"],
  ])("is true for %s", (_label, password) => {
    expect(mayBeAlteredByReaders(password)).toBe(true);
  });
});

describe("describePasswordProblem", () => {
  it.each<PasswordProblem>([
    "empty",
    "unsupported-character",
    "too-long",
    "mismatch",
  ])("explains %s in a sentence", (problem) => {
    const text = describePasswordProblem(problem);
    expect(text).toMatch(/^[A-Z].*\.$/);
  });

  it("states the byte limit", () => {
    expect(describePasswordProblem("too-long")).toContain("127 bytes");
  });
});
