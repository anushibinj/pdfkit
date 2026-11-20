/**
 * Turn the bytes of an opened .html file into text, honouring the character
 * encoding the file declares.
 *
 * Why this exists: `File.text()` always decodes UTF-8. Many HTML files are
 * not UTF-8. Word's "Save as Web Page", for one, writes windows-1252 and
 * declares it with `<meta http-equiv=Content-Type content="text/html;
 * charset=windows-1252">`; decoding such a file as UTF-8 turns every "é" or
 * "€" into "�". Browsers avoid that with the WHATWG "encoding sniffing
 * algorithm", which this module implements:
 *
 * 1. A byte order mark wins.
 * 2. Otherwise the first 1024 bytes are "prescanned" for a `<meta charset>`
 *    or `<meta http-equiv=content-type content="...charset=...">`. The
 *    prescan is a tiny tokenizer that skips comments and other tags, so a
 *    `charset` mentioned in a comment or a `<script>` string is ignored.
 * 3. Otherwise an XML declaration (`<?xml ... encoding="..."?>`) is used.
 * 4. Otherwise we try UTF-8 and fall back to windows-1252 (see
 *    {@link decodeHtml}).
 *
 * The prescan mirrors `html-encoding-sniffer` 7.0.0 (by the HTML standard's
 * editor, used by jsdom) step for step, and a differential test compares the
 * two on thousands of generated inputs. It is reimplemented rather than
 * imported because that package also bundles a TextDecoder polyfill (about
 * 25 KB) that browsers do not need: here the browser's own `TextDecoder`
 * resolves encoding labels, using the Encoding Standard's label table.
 */

/** Bytes the prescan looks at, as in the HTML standard. */
export const PRESCAN_BYTE_LIMIT = 1024;

const LT = 0x3c; // <
const GT = 0x3e; // >
const BANG = 0x21; // !
const DASH = 0x2d; // -
const SLASH = 0x2f; // /
const QUESTION = 0x3f; // ?
const EQUALS = 0x3d; // =
const DOUBLE_QUOTE = 0x22; // "
const SINGLE_QUOTE = 0x27; // '

/** HTML's ASCII whitespace bytes: tab, LF, FF, CR and space. */
function isSpaceByte(byte: number | undefined): boolean {
  return (
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20
  );
}

/** True for A-Z and a-z. */
function isAsciiLetter(byte: number | undefined): boolean {
  return (
    byte !== undefined &&
    ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))
  );
}

/** One byte as a character, with A-Z lowercased (the prescan's rule). */
function lowercaseByte(byte: number): string {
  return String.fromCharCode(byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte);
}

/**
 * Resolve an encoding label ("latin1", " UTF8 ", "shift_jis") to the name of
 * the encoding it stands for ("windows-1252", "utf-8", "shift_jis").
 *
 * `new TextDecoder(label)` performs exactly the Encoding Standard's "get an
 * encoding" (trimming whitespace, ignoring case, mapping every alias), and
 * throws a RangeError for unknown labels. It also throws for the labels of
 * the "replacement" encoding (such as iso-2022-kr), which exists only to stop
 * those encodings being used; we treat them as unknown. "x-user-defined" is
 * a real encoding that Node's TextDecoder lacks, so it is recognised here
 * directly and mapped by the callers as the standard requires.
 *
 * @param label An encoding label from a document.
 * @returns The lowercase encoding name, or `null` when the label is unknown.
 */
export function encodingForLabel(label: string): string | null {
  if (label.trim().toLowerCase() === "x-user-defined") return "x-user-defined";
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return null;
  }
}

/**
 * Read a byte order mark.
 *
 * @param bytes The file's first bytes.
 * @returns "utf-8" for EF BB BF, "utf-16be" for FE FF, "utf-16le" for FF FE,
 *   otherwise `null`.
 */
export function bomEncoding(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

/**
 * The standard's "algorithm for extracting a character encoding from a meta
 * element", applied to a `content` attribute such as
 * `text/html; charset=windows-1252`.
 *
 * Steps:
 * 1. Find the next "charset" (any case). None left: no encoding.
 * 2. Skip whitespace after it. If the next character is not "=", this was
 *    some other word containing "charset"; search again from just after it.
 * 3. Skip "=" and the whitespace after it.
 * 4. A value in double or single quotes runs to the matching quote; an
 *    unmatched quote means no encoding. An unquoted value runs to the next
 *    whitespace or ";" (or the end).
 *
 * @param content The `content` attribute's value.
 * @returns The encoding name, or `null`.
 */
export function charsetFromContent(content: string): string | null {
  let position = 0;
  for (;;) {
    const found = content.slice(position).search(/charset/i);
    if (found === -1) return null;
    let next = position + found + "charset".length;
    while (isSpaceByte(content.charCodeAt(next))) next++;
    if (content[next] !== "=") {
      // Restart the search inside this match's tail, as the reference does.
      position = next - 1;
      continue;
    }
    next++;
    while (isSpaceByte(content.charCodeAt(next))) next++;
    position = next;
    break;
  }
  const first = content[position];
  if (first === '"' || first === "'") {
    const close = content.indexOf(first, position + 1);
    return close === -1
      ? null
      : encodingForLabel(content.slice(position + 1, close));
  }
  if (content.length === position + 1) return null;
  const rest = content.slice(position + 1).search(/[\t\n\f\r ;]/);
  const end = rest === -1 ? content.length : position + 1 + rest;
  return encodingForLabel(content.slice(position, end));
}

/** What {@link getAttribute} found. */
export interface AttributeScan {
  /** The attribute, or `null` when the tag ends (or the input runs out). */
  attribute: { name: string; value: string } | null;
  /** Where scanning continues; `>= end` means the input ran out. */
  position: number;
}

/**
 * The standard's "get an attribute" step of the prescan: read one attribute
 * from inside a tag, lowercasing A-Z in names and values.
 *
 * Steps:
 * 1. Skip whitespace and "/". A ">" ends the tag: no attribute.
 * 2. Name: collect bytes until "=" (only once the name is non-empty),
 *    whitespace, "/" or ">". After whitespace, the attribute has a value only
 *    if the next non-whitespace byte is "=".
 * 3. Value: skip whitespace. A quoted value runs to the matching quote. A ">"
 *    gives an empty value. Otherwise collect bytes until whitespace or ">".
 * Running out of input anywhere means no attribute (the prescan then stops).
 *
 * @param bytes The prescanned bytes.
 * @param start Position just inside the tag, or after the previous attribute.
 * @param end The prescan limit (exclusive).
 * @returns The attribute and the next position.
 */
export function getAttribute(
  bytes: Uint8Array,
  start: number,
  end: number,
): AttributeScan {
  const exhausted: AttributeScan = { attribute: null, position: end };
  let i = start;
  while (i < end && (isSpaceByte(bytes[i]) || bytes[i] === SLASH)) i++;
  if (i >= end) return exhausted;
  if (bytes[i] === GT) return { attribute: null, position: i };

  let name = "";
  for (;;) {
    if (i >= end) return exhausted;
    const byte = bytes[i];
    if (byte === EQUALS && name !== "") {
      i++;
      break;
    }
    if (isSpaceByte(byte)) {
      while (i < end && isSpaceByte(bytes[i])) i++;
      if (i >= end) return exhausted;
      if (bytes[i] !== EQUALS) {
        return { attribute: { name, value: "" }, position: i };
      }
      i++;
      break;
    }
    if (byte === SLASH || byte === GT) {
      return { attribute: { name, value: "" }, position: i };
    }
    name += lowercaseByte(byte);
    i++;
  }

  while (i < end && isSpaceByte(bytes[i])) i++;
  if (i >= end) return exhausted;
  const first = bytes[i];
  if (first === DOUBLE_QUOTE || first === SINGLE_QUOTE) {
    let value = "";
    for (i++; i < end; i++) {
      if (bytes[i] === first) {
        return { attribute: { name, value }, position: i + 1 };
      }
      value += lowercaseByte(bytes[i]);
    }
    return exhausted;
  }
  if (first === GT) return { attribute: { name, value: "" }, position: i };
  let value = lowercaseByte(first);
  for (i++; i < end; i++) {
    if (isSpaceByte(bytes[i]) || bytes[i] === GT) {
      return { attribute: { name, value }, position: i };
    }
    value += lowercaseByte(bytes[i]);
  }
  return exhausted;
}

/**
 * Apply the standard's fix-ups to an encoding found in a document:
 * a UTF-16 label is impossible there (the document was readable as ASCII
 * bytes, so it is not UTF-16) and becomes UTF-8.
 */
function asciiCompatible(encoding: string): string {
  return encoding === "utf-16le" || encoding === "utf-16be"
    ? "utf-8"
    : encoding;
}

/**
 * Process one `<meta` tag for the prescan: read its attributes and decide
 * whether it declares an encoding.
 *
 * Rules (the standard's "attributes" and "processing" steps):
 * - Only the first occurrence of each attribute name counts.
 * - `charset="x"` declares x on its own.
 * - `content="...charset=x"` declares x only together with
 *   `http-equiv="content-type"`, in any order.
 * - An unknown label declares nothing; x-user-defined means windows-1252.
 *
 * @param bytes The prescanned bytes.
 * @param start Position after "<meta" and the space or "/" that follows it.
 * @param end The prescan limit.
 * @returns The encoding (or `null`) and where scanning continues; position
 *   `>= end` means the prescan has to stop.
 */
function readMetaTag(
  bytes: Uint8Array,
  start: number,
  end: number,
): { encoding: string | null; position: number } {
  const seen = new Set<string>();
  let gotPragma = false;
  let needPragma: boolean | null = null;
  let charset: string | null = null;
  let i = start;
  for (;;) {
    const { attribute, position } = getAttribute(bytes, i, end);
    // Hitting the limit inside a <meta> aborts the whole prescan.
    if (position >= end) return { encoding: null, position: end };
    i = position;
    if (!attribute) break;
    if (seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    if (attribute.name === "http-equiv") {
      gotPragma = attribute.value === "content-type";
    } else if (attribute.name === "content" && charset === null) {
      charset = charsetFromContent(attribute.value);
      if (charset !== null) needPragma = true;
    } else if (attribute.name === "charset") {
      charset = encodingForLabel(attribute.value);
      needPragma = false;
    }
  }
  if (needPragma === null || (needPragma && !gotPragma) || charset === null) {
    return { encoding: null, position: i };
  }
  const encoding =
    charset === "x-user-defined" ? "windows-1252" : asciiCompatible(charset);
  return { encoding, position: i };
}

/**
 * The `<meta>` part of the standard's prescan, over the first
 * {@link PRESCAN_BYTE_LIMIT} bytes.
 *
 * At each "<" it decides what kind of markup starts there:
 * - "<!--": a comment, skipped to the first "-->" (a "<meta" inside a comment
 *   is not real).
 * - "<meta" + whitespace or "/": read by `readMetaTag`; the first one that
 *   declares a known encoding wins.
 * - "<" + letter: another start tag. Its name and attributes are skipped with
 *   the same attribute reader, so a ">" inside a quoted attribute value does
 *   not end it early.
 * - "<!", "</" or "<?": a doctype, end tag or processing instruction,
 *   skipped to the next ">".
 * Everything else is text and is passed over.
 *
 * @param input The file's bytes (only the first 1024 are read).
 * @returns The declared encoding, or `null`.
 */
export function prescanMetaCharset(input: Uint8Array): string | null {
  // A view of exactly the first 1024 bytes: every look-ahead such as
  // bytes[i + 5] then reads `undefined` at the limit instead of peeking past
  // it, which keeps "<meta" split across the limit from being recognised.
  const bytes = input.subarray(0, PRESCAN_BYTE_LIMIT);
  const end = bytes.length;
  for (let i = 0; i < end; i++) {
    if (bytes[i] !== LT) continue;
    const next = bytes[i + 1];
    if (next === BANG && bytes[i + 2] === DASH && bytes[i + 3] === DASH) {
      // Comment: stop at a ">" preceded by "--". Starting at i + 4 lets the
      // dashes of "<!--" itself close an empty comment, "<!-->".
      for (i += 4; i < end; i++) {
        if (bytes[i] === GT && bytes[i - 1] === DASH && bytes[i - 2] === DASH) {
          break;
        }
      }
    } else if (
      (next === 0x4d || next === 0x6d) && // M m
      (bytes[i + 2] === 0x45 || bytes[i + 2] === 0x65) && // E e
      (bytes[i + 3] === 0x54 || bytes[i + 3] === 0x74) && // T t
      (bytes[i + 4] === 0x41 || bytes[i + 4] === 0x61) && // A a
      (isSpaceByte(bytes[i + 5]) || bytes[i + 5] === SLASH)
    ) {
      const meta = readMetaTag(bytes, i + 6, end);
      if (meta.encoding !== null) return meta.encoding;
      if (meta.position >= end) return null;
      i = meta.position;
    } else if (isAsciiLetter(next)) {
      for (i += 2; i < end; i++) {
        if (isSpaceByte(bytes[i]) || bytes[i] === GT) break;
      }
      for (;;) {
        const { attribute, position } = getAttribute(bytes, i, end);
        i = position;
        if (!attribute) break;
      }
    } else if (next === BANG || next === SLASH || next === QUESTION) {
      for (i += 2; i < end; i++) {
        if (bytes[i] === GT) break;
      }
    }
  }
  return null;
}

/**
 * Read the encoding from an XML declaration such as
 * `<?xml version="1.0" encoding="ISO-8859-1"?>` (common in .xhtml files).
 *
 * Rules, as in the reference implementation: the file must start with a
 * case-sensitive `<?xml`; the declaration ends at its first ">" (no 1024 byte
 * limit); the first "encoding" inside it is followed by optional whitespace
 * (any control byte counts here), "=", optional whitespace and a quoted label
 * that contains no whitespace. A UTF-16 label becomes UTF-8.
 *
 * @param bytes The file's bytes.
 * @returns The declared encoding, or `null`.
 */
export function xmlDeclarationEncoding(bytes: Uint8Array): string | null {
  const prefix = [0x3c, 0x3f, 0x78, 0x6d, 0x6c]; // "<?xml"
  if (prefix.some((byte, k) => bytes[k] !== byte)) return null;
  const end = bytes.indexOf(GT, 5);
  if (end === -1) return null;
  const keyword = [0x65, 0x6e, 0x63, 0x6f, 0x64, 0x69, 0x6e, 0x67]; // "encoding"
  let i = 5;
  while (i + 7 < end && keyword.some((byte, k) => bytes[i + k] !== byte)) i++;
  if (i + 7 >= end) return null;
  i += keyword.length;
  while (i < end && bytes[i] <= 0x20) i++;
  if (i >= end || bytes[i] !== EQUALS) return null;
  i++;
  while (i < end && bytes[i] <= 0x20) i++;
  const quote = bytes[i];
  if (i >= end || (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE)) {
    return null;
  }
  let label = "";
  for (i++; i < end; i++) {
    if (bytes[i] === quote) {
      const encoding = encodingForLabel(label);
      return encoding === null ? null : asciiCompatible(encoding);
    }
    if (bytes[i] <= 0x20) return null;
    label += String.fromCharCode(bytes[i]);
  }
  return null;
}

/**
 * Find the encoding an HTML file declares, in the standard's order: byte
 * order mark, then the UTF-16 signatures of `<?x` (a UTF-16 file without a
 * byte order mark, which no ASCII-based scan could read), then the `<meta>`
 * prescan, then the XML declaration.
 *
 * @param bytes The file's bytes.
 * @returns The lowercase encoding name, or `null` when nothing is declared.
 */
export function sniffHtmlEncoding(bytes: Uint8Array): string | null {
  const bom = bomEncoding(bytes);
  if (bom) return bom;
  const lessThanQuestionX = [LT, QUESTION, 0x78];
  if (
    lessThanQuestionX.every(
      (byte, k) => bytes[2 * k] === byte && bytes[2 * k + 1] === 0,
    )
  ) {
    return "utf-16le";
  }
  if (
    lessThanQuestionX.every(
      (byte, k) => bytes[2 * k] === 0 && bytes[2 * k + 1] === byte,
    )
  ) {
    return "utf-16be";
  }
  return prescanMetaCharset(bytes) ?? xmlDeclarationEncoding(bytes);
}

/** An opened HTML file's text and the encoding it was read with. */
export interface DecodedHtml {
  text: string;
  /** Lowercase encoding name, e.g. "utf-8" or "windows-1252" */
  encoding: string;
}

/**
 * Decode an HTML file's bytes into text.
 *
 * A declared encoding (see {@link sniffHtmlEncoding}) is always used. When
 * nothing is declared, the bytes are decoded as strict UTF-8; if they are not
 * valid UTF-8 they are decoded as windows-1252 instead. That last step is the
 * standard's permitted "autodetect" step plus its fallback for Western
 * locales: valid UTF-8 almost never occurs by accident in legacy text, while
 * windows-1252 can decode any byte, so nothing is lost.
 *
 * Invalid sequences in a declared encoding become U+FFFD, as in a browser.
 * The byte order mark is removed by `TextDecoder`.
 *
 * @param bytes The file's bytes.
 * @returns The text and the encoding used.
 */
export function decodeHtml(bytes: Uint8Array): DecodedHtml {
  const declared = sniffHtmlEncoding(bytes);
  if (declared !== null) {
    // x-user-defined can only come from an XML declaration here; Node's
    // TextDecoder lacks it and its upper half is not text anyway.
    const encoding = declared === "x-user-defined" ? "windows-1252" : declared;
    return { text: new TextDecoder(encoding).decode(bytes), encoding };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "utf-8" };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
    };
  }
}
