/**
 * Rules for the password that will open a protected PDF. Pure functions, no
 * DOM, used by both the form (to explain problems) and the worker (which
 * never trusts the form).
 *
 * The rules come from testing the qpdf build this app ships (11.0.0) together
 * with two independent readers, PDFium (Chrome) and pdf.js (Firefox), on
 * files encrypted with AES-256 (PDF 2.0, revision 6). See each rule.
 */

/**
 * The longest password, in UTF-8 bytes, that every tested reader accepts.
 *
 * PDF 2.0 says a reader truncates the UTF-8 password to 127 bytes before
 * hashing it. qpdf 11.0.0 does NOT truncate when it writes a file, so for a
 * longer password it hashes all the bytes. Tested result for a 200-byte
 * password: PDFium (no truncation) opens the file, but qpdf and pdf.js
 * (which truncate) refuse both the full password and its 127-byte prefix.
 * Up to 127 bytes all three agree, so longer passwords are refused here
 * rather than producing a file that most readers cannot open.
 */
export const MAX_PASSWORD_BYTES = 127;

/** Why a password cannot be used. */
export type PasswordProblem =
  "empty" | "too-long" | "unsupported-character" | "mismatch";

/**
 * Count a string's bytes in UTF-8 (the encoding AES-256 PDF passwords use).
 *
 * @param text Any string. Lone surrogates count as 3 bytes, like the U+FFFD
 *   that `TextEncoder` writes for them.
 * @returns The byte length.
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Find a character that cannot be part of a password.
 *
 * Refused, by UTF-16 code unit:
 * - C0 control characters (U+0000 to U+001F) and DEL (U+007F), and C1
 *   control characters (U+0080 to U+009F). The PDF 2.0 password profile
 *   (SASLprep, RFC 4013) prohibits control characters, so a reader that
 *   follows it would refuse the password. Also, U+0000 ends a string in C
 *   APIs such as PDFium's `FPDF_LoadMemDocument`, which would silently
 *   shorten the password.
 * - Lone surrogates: half of a UTF-16 pair with no partner. They have no
 *   UTF-8 form, so the bytes written to the file could never be typed again.
 * A high surrogate followed by a low one is a valid pair (for example an
 * emoji) and is skipped over as one character.
 *
 * Nobody types these characters; they arrive by pasting. A plain loop is used
 * instead of a regular expression with lookbehind, which older Safari
 * versions cannot parse at all.
 *
 * @param password The password.
 * @returns `true` if any such character is present.
 */
export function hasUnsupportedCharacter(password: string): boolean {
  for (let i = 0; i < password.length; i++) {
    const unit = password.charCodeAt(i);
    if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)) return true;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = password.charCodeAt(i + 1); // NaN past the end
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++; // a valid pair: skip its second half
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

/**
 * Check one password against every rule except "the two fields match".
 *
 * The checks run in this order, and the first failure wins:
 * 1. empty;
 * 2. unsupported characters (checked before the length, because a lone
 *    surrogate's UTF-8 length is not meaningful);
 * 3. longer than {@link MAX_PASSWORD_BYTES}.
 *
 * @param password The password.
 * @returns The problem, or `null` when the password can be used.
 */
export function findPasswordProblem(
  password: string,
): Exclude<PasswordProblem, "mismatch"> | null {
  if (password.length === 0) return "empty";
  if (hasUnsupportedCharacter(password)) return "unsupported-character";
  if (utf8ByteLength(password) > MAX_PASSWORD_BYTES) return "too-long";
  return null;
}

/**
 * Check a password and its confirmation, as typed in the form.
 *
 * The password's own problems come first: telling someone the two fields
 * differ is pointless while the first one cannot be used anyway.
 *
 * @param password The password.
 * @param confirmation The same password, typed a second time.
 * @returns The problem, or `null` when the pair can be used.
 */
export function findPasswordPairProblem(
  password: string,
  confirmation: string,
): PasswordProblem | null {
  return (
    findPasswordProblem(password) ??
    (password === confirmation ? null : "mismatch")
  );
}

/**
 * SASLprep's "commonly mapped to nothing" characters (RFC 3454 table B.1),
 * plus U+1680 OGHAM SPACE MARK, the one non-ASCII space (table C.1.2) that
 * NFKC leaves alone. Taken from Python's `stringprep` module, which is
 * generated from the RFC's tables.
 */
const SASLPREP_MAPPED_NOT_BY_NFKC = new Set([
  0x00ad, 0x034f, 0x1680, 0x1806, 0x180b, 0x180c, 0x180d, 0x200b, 0x200c,
  0x200d, 0x2060, 0xfe00, 0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06,
  0xfe07, 0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c, 0xfe0d, 0xfe0e, 0xfe0f,
  0xfeff,
]);

/**
 * Decide whether some PDF readers may compute a different key from this
 * password than the one used to write the file.
 *
 * PDF 2.0 tells readers to prepare passwords with SASLprep (RFC 4013) before
 * hashing them. SASLprep maps non-ASCII spaces to a plain space, deletes
 * invisible characters such as soft hyphens, zero-width joiners and emoji
 * variation selectors (U+FE0F, as in "❤️"), and applies Unicode NFKC
 * normalisation (so "²" becomes "2" and "Ａ" becomes "A"). qpdf's manual
 * states that qpdf does not do this, and testing showed that qpdf, PDFium
 * and pdf.js all hash the raw UTF-8 bytes. So such a password works in those
 * readers, but a reader that applies SASLprep would hash different bytes and
 * refuse it.
 *
 * This only returns `true` when that could happen. It is a warning, not a
 * rule: the password still works in the tested readers.
 *
 * How it works: SASLprep changes a password only if (a) NFKC changes it,
 * which covers every mapped space except U+1680, or (b) it contains a
 * character from {@link SASLPREP_MAPPED_NOT_BY_NFKC}. Both are checked.
 *
 * @param password The password.
 * @returns `true` when a SASLprep-following reader could reject it.
 */
export function mayBeAlteredByReaders(password: string): boolean {
  if (password.normalize("NFKC") !== password) return true;
  for (const char of password) {
    if (SASLPREP_MAPPED_NOT_BY_NFKC.has(char.codePointAt(0)!)) return true;
  }
  return false;
}

/**
 * Explain a {@link PasswordProblem} to the person typing the password.
 *
 * @param problem The problem.
 * @returns One sentence, ready to show under the field.
 */
export function describePasswordProblem(problem: PasswordProblem): string {
  switch (problem) {
    case "empty":
      return "Enter a password.";
    case "unsupported-character":
      return "The password contains a control character or an invalid character. Type it instead of pasting it.";
    case "too-long":
      return `The password is too long. Use at most ${MAX_PASSWORD_BYTES} bytes: ${MAX_PASSWORD_BYTES} English letters, digits or symbols, or fewer characters in other scripts and emoji.`;
    case "mismatch":
      return "The passwords do not match.";
  }
}
