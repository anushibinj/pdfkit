import type { PresetId, RedactionSource } from "./model";

/** One substring match returned by a {@link PatternMatcher}. */
export interface PatternMatch {
  /** Inclusive UTF-16 start offset in the searched string. */
  start: number;
  /** Exclusive UTF-16 end offset in the searched string. */
  end: number;
  /** Exact matched substring. */
  value: string;
}

/**
 * Strategy contract for finding redaction candidates in extracted page text.
 *
 * Designed for the Open/Closed Principle: new presets or custom matchers can be
 * registered without modifying search orchestration or UI components.
 */
export interface PatternMatcher {
  /** Source identifier stored on generated {@link RedactionMark} items. */
  readonly source: RedactionSource;
  /** Human-readable category label shown in the review list. */
  readonly label: string;
  /** Short description or example shown in the preset selector. */
  readonly description: string;
  /** Find all non-overlapping matches inside `text`. */
  findMatches(text: string): PatternMatch[];
}

/** Descriptor for a built-in sensitive-data preset. */
export interface PresetMatcher extends PatternMatcher {
  readonly source: PresetId;
}

/**
 * Validate a payment card digit sequence with the ISO/IEC 7812 Luhn checksum.
 *
 * @param digits Digits-only string (13 to 19 ASCII digits).
 * @returns `true` if the Luhn check digit is valid and digits are not all identical.
 */
export function isValidLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  // Reject trivial all-zero or repeated single-digit placeholders such as 0000...
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

/**
 * Check whether an email candidate has clean local-part and domain dot/hyphen rules
 * beyond what a compact regex captures.
 */
function isCleanEmail(candidate: string): boolean {
  const atIndex = candidate.indexOf("@");
  if (atIndex <= 0) return false;
  const local = candidate.slice(0, atIndex);
  const domain = candidate.slice(atIndex + 1);
  if (
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length > 0 && !label.startsWith("-") && !label.endsWith("-"),
  );
}

/**
 * Validate a calendar date `(year, month, day)` against real month lengths
 * (including leap-year February).
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDays = [
    31,
    isLeap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return day <= maxDays;
}

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Run a global regex over `text` and filter matches through an optional predicate.
 * Advances safely on zero-length matches so malformed patterns can never loop forever.
 */
function collectRegexMatches(
  text: string,
  regex: RegExp,
  accept: (match: RegExpExecArray) => boolean = () => true,
): PatternMatch[] {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const scanner = new RegExp(regex.source, flags);
  const matches: PatternMatch[] = [];
  let result: RegExpExecArray | null;
  while ((result = scanner.exec(text)) !== null) {
    const value = result[0];
    if (value.length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    if (accept(result)) {
      matches.push({
        start: result.index,
        end: result.index + value.length,
        value,
      });
    }
  }
  return matches;
}

/** Built-in email address preset. */
export const EMAIL_PRESET: PresetMatcher = {
  source: "email",
  label: "Email",
  description: "e.g. alice@example.com",
  findMatches(text) {
    return collectRegexMatches(
      text,
      /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}(?![A-Za-z0-9-]|\.[A-Za-z0-9])/g,
      (m) => isCleanEmail(m[0]),
    );
  },
};

/**
 * Built-in phone number preset.
 *
 * Accepts international (`+91 98765 43210`, `+1 (415) 555-0199`), parenthesized
 * area-code, and 10-digit mobile formats while rejecting dates, IPv4 addresses,
 * and plain numeric decimals.
 */
export const PHONE_PRESET: PresetMatcher = {
  source: "phone",
  label: "Phone",
  description: "e.g. +91 98765 43210 or (415) 555-0199",
  findMatches(text) {
    return collectRegexMatches(
      text,
      /(?<![A-Za-z0-9+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?|\d{2,5}[\s.-])?\d{3,5}[\s.-]?\d{4,6}(?![A-Za-z0-9])/g,
      (m) => {
        const raw = m[0];
        // Reject IPv4 dotted quads (4 dot-separated segments) and ISO/DMY dates.
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return false;
        if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(raw)) return false;
        if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(raw)) return false;
        if (/^\d+\.\d+$/.test(raw)) return false;
        // Require at least one separator or '+'/'(' when there are more than 10 digits,
        // or exactly 10 digits for bare Indian/US local numbers.
        const digits = raw.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) return false;
        if (digits.length > 10 && !/[+\s()-]/.test(raw)) return false;
        // Require at least 2 distinct digits so "0000000000" is ignored.
        if (/^(\d)\1+$/.test(digits)) return false;
        return true;
      },
    );
  },
};

/**
 * Built-in Indian PAN (Permanent Account Number) preset.
 *
 * Format: 3 alphabetic letters + 4th-character holder status (`A,B,C,F,G,H,J,L,P,T`)
 * + 1 letter + 4 digits + 1 alphabetic check letter.
 */
export const PAN_PRESET: PresetMatcher = {
  source: "pan",
  label: "PAN",
  description: "e.g. ABCPE1234F",
  findMatches(text) {
    return collectRegexMatches(
      text,
      /(?<![A-Z0-9])[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z](?![A-Z0-9])/g,
    );
  },
};

/**
 * Built-in Indian 12-digit Aadhaar number preset.
 *
 * Begins with `2`–`9` (per UIDAI specification) and accepts either contiguous
 * 12 digits or 4-4-4 groups with a consistent separator (` ` or `-`).
 */
export const AADHAAR_PRESET: PresetMatcher = {
  source: "aadhaar",
  label: "Aadhaar",
  description: "e.g. 2345 6789 0123",
  findMatches(text) {
    return collectRegexMatches(
      text,
      /(?<![A-Za-z0-9])[2-9]\d{3}(?:\s\d{4}\s\d{4}|-\d{4}-\d{4}|\d{8})(?![A-Za-z0-9])/g,
    );
  },
};

/**
 * Built-in Indian IFSC (Indian Financial System Code) preset.
 *
 * Format: 4 uppercase bank letters + literal `0` + 6 alphanumeric branch characters.
 */
export const IFSC_PRESET: PresetMatcher = {
  source: "ifsc",
  label: "IFSC",
  description: "e.g. SBIN0001234",
  findMatches(text) {
    return collectRegexMatches(
      text,
      /(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])/g,
    );
  },
};

/**
 * Built-in payment card preset (13–19 digits, optional consistent spacing or
 * dashes, validated with the Luhn checksum).
 */
export const CARD_PRESET: PresetMatcher = {
  source: "card",
  label: "Card number",
  description: "13-19 digit Luhn-valid card",
  findMatches(text) {
    return collectRegexMatches(
      text,
      /(?<![A-Za-z0-9])\d(?:[ -]?\d){12,18}(?![A-Za-z0-9])/g,
      (m) => {
        const raw = m[0];
        // Reject mixed space + hyphen separators inside a single candidate.
        if (raw.includes(" ") && raw.includes("-")) return false;
        const digits = raw.replace(/\D/g, "");
        return isValidLuhn(digits);
      },
    );
  },
};

/**
 * Built-in date preset supporting ISO (`YYYY-MM-DD`), numeric (`DD/MM/YYYY`,
 * `MM/DD/YYYY`, `DD-MM-YYYY`), and named-month (`15 Jan 2026`, `Jan 15, 2026`)
 * formats with calendar range validation.
 */
export const DATE_PRESET: PresetMatcher = {
  source: "date",
  label: "Date",
  description: "e.g. 2026-01-15 or 15 Jan 2026",
  findMatches(text) {
    const monthNames =
      "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
    const pattern = new RegExp(
      `(?<![A-Za-z0-9])(?:(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})|(\\d{1,2})[-/](\\d{1,2})[-/](\\d{4})|(\\d{1,2})\\s+(${monthNames})\\s+(\\d{4})|(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{4}))(?![A-Za-z0-9])`,
      "gi",
    );
    return collectRegexMatches(text, pattern, (m) => {
      if (m[1] && m[2] && m[3]) {
        return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
      }
      if (m[4] && m[5] && m[6]) {
        const a = Number(m[4]);
        const b = Number(m[5]);
        const year = Number(m[6]);
        // Accept either DD/MM/YYYY or MM/DD/YYYY as long as at least one is valid.
        return (
          isValidCalendarDate(year, b, a) || isValidCalendarDate(year, a, b)
        );
      }
      if (m[7] && m[8] && m[9]) {
        const month = MONTH_INDEX[m[8].toLowerCase()] ?? 0;
        return isValidCalendarDate(Number(m[9]), month, Number(m[7]));
      }
      if (m[10] && m[11] && m[12]) {
        const month = MONTH_INDEX[m[10].toLowerCase()] ?? 0;
        return isValidCalendarDate(Number(m[12]), month, Number(m[11]));
      }
      return false;
    });
  },
};

/** Ordered list of all built-in redaction presets. */
export const PRESET_MATCHERS: readonly PresetMatcher[] = [
  EMAIL_PRESET,
  PHONE_PRESET,
  PAN_PRESET,
  AADHAAR_PRESET,
  IFSC_PRESET,
  CARD_PRESET,
  DATE_PRESET,
];

/**
 * Look up a built-in preset matcher by its {@link PresetId}.
 *
 * @param id Preset identifier.
 * @returns The matching preset strategy.
 */
export function getPresetMatcher(id: PresetId): PresetMatcher {
  const found = PRESET_MATCHERS.find((p) => p.source === id);
  if (!found) {
    throw new Error(`Unknown preset id: ${String(id)}`);
  }
  return found;
}

/**
 * Create a plain-text {@link PatternMatcher} escaping regex metacharacters.
 *
 * @param query Literal search string.
 * @param caseSensitive Whether case must match exactly (default `false`).
 * @returns A matcher for literal substring search.
 */
export function createPlainTextMatcher(
  query: string,
  caseSensitive = false,
): PatternMatcher {
  const trimmed = query;
  if (trimmed.length === 0) {
    return {
      source: "text",
      label: "Text",
      description: "Plain text search",
      findMatches: () => [],
    };
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, caseSensitive ? "g" : "gi");
  return {
    source: "text",
    label: "Text",
    description: `Plain text "${trimmed}"`,
    findMatches(text) {
      return collectRegexMatches(text, regex);
    },
  };
}

/**
 * Create a custom regular-expression {@link PatternMatcher}.
 *
 * @param pattern JavaScript regular expression pattern.
 * @param caseSensitive Whether matching is case-sensitive (default `false`).
 * @returns A compiled matcher.
 * @throws {SyntaxError} When `pattern` is not a valid regular expression.
 */
export function createRegexMatcher(
  pattern: string,
  caseSensitive = false,
): PatternMatcher {
  if (pattern.length === 0) {
    throw new SyntaxError("Regular expression cannot be empty.");
  }
  const regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
  return {
    source: "regex",
    label: "Regex",
    description: `/${pattern}/`,
    findMatches(text) {
      return collectRegexMatches(text, regex);
    },
  };
}
