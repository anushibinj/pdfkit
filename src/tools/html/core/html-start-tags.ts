/**
 * A small, linear HTML scanner that reports the start tags an HTML parser
 * turns into elements, without building a DOM.
 *
 * Why not `DOMParser`: in Chromium a parsed document inherits the page's
 * Content Security Policy, so merely parsing the user's HTML reports a CSP
 * violation (a console error) for every `style="..."` and `onclick="..."`
 * attribute and every `<style>` element in it, even though nothing runs.
 * A full parser library (parse5) avoids that but adds about 40 KB gzipped.
 * Counting images, stylesheets and scripts only needs to know which start
 * tags become elements, so this module implements just the parts of the
 * WHATWG tokenizer that decide that:
 *
 * - comments (`<!-- ... -->`, ended early by `<!-->`, `<!--->`, `--!>`),
 *   doctypes, `<?...>` and other bogus comments: skipped;
 * - start tags with attributes (any quoting, missing whitespace, duplicate
 *   names where the first wins); a tag cut off by the end of the input is
 *   dropped, as the tokenizer drops it;
 * - raw text (`<style>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`),
 *   RCDATA (`<title>`, `<textarea>`) and script data, including its escape
 *   states, so markup inside them is text, not elements; `<plaintext>`
 *   turns the rest of the input into text;
 * - template contents: elements inside `<template>` are inert (not part of
 *   the document), so they are not reported;
 * - SVG and MathML ("foreign content"): raw-text rules do not apply there,
 *   `<![CDATA[...]]>` is a section, and an HTML "breakout" tag such as
 *   `<img>` or `<p>` leaves foreign content, as in the tree builder.
 *
 * Known simplifications, all rare in documents meant for print (the result
 * feeds a warning, never the PDF), each pinned by a test:
 * - character references are not decoded (`src="&#100;ata:..."`);
 * - SVG/MathML integration points (`<foreignObject>`, `<desc>` and `<title>`
 *   in SVG, `<mi>` and similar in MathML) are treated as foreign, so a raw
 *   text element inside them is not recognised;
 * - start tags that the tree builder drops are still reported: those inside
 *   `<select>` (whose parsing browsers are currently changing) and
 *   `<frameset>`.
 * Everything else is checked by a differential test that compares this
 * scanner with jsdom's spec-compliant parser on generated documents.
 */

/** One start tag that becomes an element. */
export interface StartTag {
  /** Lowercase tag name ("image" in HTML content is reported as "img") */
  name: string;
  /** Attributes by lowercase name; only the first of duplicates is kept */
  attributes: ReadonlyMap<string, string>;
  /**
   * The raw text up to the matching end tag, for `<script>` only (used to
   * tell an empty script from one with code).
   */
  text?: string;
}

/** Elements whose content is raw text: markup inside is not parsed. */
const RAW_TEXT = new Set([
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "title",
  "textarea",
]);

/**
 * HTML start tags that end SVG/MathML foreign content (the tree builder's
 * "breakout" list; `<font>` breaks out only with color, face or size).
 */
const FOREIGN_BREAKOUT = new Set(
  (
    "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 " +
    "h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small " +
    "span strong strike sub sup table tt u ul var"
  ).split(" "),
);

/** HTML's ASCII whitespace: tab, LF, FF, CR, space. */
function isWhitespace(char: string | undefined): boolean {
  return (
    char === "\t" ||
    char === "\n" ||
    char === "\f" ||
    char === "\r" ||
    char === " "
  );
}

/** True for A-Z and a-z. */
function isAsciiAlpha(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z]$/.test(char);
}

/**
 * Find where a comment ends, given the position just after `<!--`.
 *
 * Tokenizer rules: `<!-->` and `<!--->` are complete (empty) comments;
 * otherwise the comment ends at the first `-->` or `--!>`; an unterminated
 * comment runs to the end of the input.
 *
 * @param html The document.
 * @param start Index just after `<!--`.
 * @returns The index just after the comment.
 */
export function commentEnd(html: string, start: number): number {
  if (html[start] === ">") return start + 1;
  if (html.startsWith("->", start)) return start + 2;
  // Walk from one "--" to the next, so each character is looked at a
  // constant number of times. (Two separate searches for "-->" and "--!>"
  // would each run to the end of the input for every comment when one of
  // the two never occurs: quadratic on a file with many comments.)
  for (
    let at = html.indexOf("--", start);
    at !== -1;
    at = html.indexOf("--", at + 1)
  ) {
    if (html[at + 2] === ">") return at + 3;
    if (html[at + 2] === "!" && html[at + 3] === ">") return at + 4;
  }
  return html.length;
}

/**
 * True when `html` has an end tag for `name` at `at` (`</name` in any case,
 * followed by whitespace, "/" or ">"), which is what ends raw text.
 *
 * @param html The document.
 * @param at Index of the "<".
 * @param name Lowercase tag name.
 */
function isEndTagFor(html: string, at: number, name: string): boolean {
  if (html[at] !== "<" || html[at + 1] !== "/") return false;
  const candidate = html.slice(at + 2, at + 2 + name.length);
  if (candidate.toLowerCase() !== name) return false;
  const after = html[at + 2 + name.length];
  return isWhitespace(after) || after === "/" || after === ">";
}

/**
 * Find the end of a raw text or RCDATA element's content: the first matching
 * end tag. Without one, the content runs to the end of the input.
 *
 * @param html The document.
 * @param start Index just after the start tag.
 * @param name The element's lowercase name.
 * @returns The index of the end tag's "<" (or the input's length).
 */
export function rawTextEnd(html: string, start: number, name: string): number {
  for (
    let at = html.indexOf("</", start);
    at !== -1;
    at = html.indexOf("</", at + 2)
  ) {
    if (isEndTagFor(html, at, name)) return at;
  }
  return html.length;
}

/**
 * Find the end of a `<script>` element's content, following the tokenizer's
 * script data states. They matter because of old-style scripts wrapped in
 * comments: inside `<!-- ... -->`, a `<script>` start "double escapes", and
 * the next `</script>` then only ends that inner part, not the element.
 *
 * States: normal; escaped (after `<!--`); double escaped (after `<script`
 * inside escaped). `-->` returns to normal from either escaped state.
 *
 * @param html The document.
 * @param start Index just after the `<script ...>` start tag.
 * @returns The index of the closing `</script`'s "<" (or the input's length).
 */
export function scriptDataEnd(html: string, start: number): number {
  type Mode = "normal" | "escaped" | "double";
  let mode: Mode = "normal";
  /** Consecutive "-" just seen in an escaped state (2+ arms "-->"). */
  let dashes = 0;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (mode === "normal") {
      if (html.startsWith("<!--", i)) {
        // "<!--" enters the escaped state with both dashes counted, so an
        // immediate ">" (as in "<!-->") leaves it again.
        mode = "escaped";
        dashes = 2;
        i += 3;
      } else if (isEndTagFor(html, i, "script")) {
        return i;
      }
      continue;
    }
    if (char === "-") {
      dashes++;
      continue;
    }
    const closesComment = char === ">" && dashes >= 2;
    dashes = 0;
    if (closesComment) {
      mode = "normal";
    } else if (char === "<" && mode === "escaped") {
      if (isEndTagFor(html, i, "script")) return i;
      if (isScriptStartAt(html, i)) {
        mode = "double";
        i += "<script".length - 1;
      }
    } else if (char === "<" && mode === "double") {
      if (isEndTagFor(html, i, "script")) {
        mode = "escaped";
        i += "</script".length - 1;
      }
    }
  }
  return html.length;
}

/** True for `<script` (any case) followed by whitespace, "/" or ">". */
function isScriptStartAt(html: string, at: number): boolean {
  if (html.slice(at + 1, at + 7).toLowerCase() !== "script") return false;
  const after = html[at + 7];
  return isWhitespace(after) || after === "/" || after === ">";
}

/** A tag read by {@link readTag}. */
export interface ReadTag {
  name: string;
  attributes: Map<string, string>;
  selfClosing: boolean;
  /** Index just after the tag's ">" */
  end: number;
}

/**
 * Read a start or end tag, from the first letter of its name to its ">",
 * following the tokenizer's tag and attribute states:
 *
 * - The name runs to whitespace, "/" or ">", and is lowercased.
 * - Before each attribute, whitespace is skipped. "/" directly before ">"
 *   makes the tag self-closing; elsewhere it is ignored.
 * - An attribute name runs to whitespace, "/", ">" or "=" (a leading "="
 *   belongs to the name). After the name, optional whitespace and "="
 *   introduce a value; otherwise the value is empty.
 * - A value in quotes runs to the matching quote, and the next attribute may
 *   follow without whitespace. An unquoted value runs to whitespace or ">".
 * - The first attribute with a given name wins; later duplicates are dropped.
 *
 * @param html The document.
 * @param start Index of the name's first letter.
 * @returns The tag, or `null` when the input ends inside it (the tokenizer
 *   then drops the tag).
 */
export function readTag(html: string, start: number): ReadTag | null {
  const n = html.length;
  let i = start;
  while (
    i < n &&
    !isWhitespace(html[i]) &&
    html[i] !== "/" &&
    html[i] !== ">"
  ) {
    i++;
  }
  const name = html.slice(start, i).toLowerCase();
  const attributes = new Map<string, string>();
  const add = (key: string, value: string) => {
    if (!attributes.has(key)) attributes.set(key, value);
  };
  for (;;) {
    while (i < n && isWhitespace(html[i])) i++;
    if (i >= n) return null;
    if (html[i] === ">")
      return { name, attributes, selfClosing: false, end: i + 1 };
    if (html[i] === "/") {
      if (html[i + 1] === ">") {
        return { name, attributes, selfClosing: true, end: i + 2 };
      }
      i++;
      continue;
    }
    // Attribute name; a leading "=" is part of it.
    const nameStart = i;
    i++;
    while (
      i < n &&
      !isWhitespace(html[i]) &&
      html[i] !== "/" &&
      html[i] !== ">" &&
      html[i] !== "="
    ) {
      i++;
    }
    const key = html.slice(nameStart, i).toLowerCase();
    let j = i;
    while (j < n && isWhitespace(html[j])) j++;
    if (html[j] !== "=") {
      add(key, "");
      i = j;
      continue;
    }
    i = j + 1;
    while (i < n && isWhitespace(html[i])) i++;
    if (i >= n) return null;
    const quote = html[i];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, i + 1);
      if (close === -1) return null;
      add(key, html.slice(i + 1, close));
      i = close + 1;
    } else if (quote === ">") {
      add(key, "");
    } else {
      const valueStart = i;
      while (i < n && !isWhitespace(html[i]) && html[i] !== ">") i++;
      if (i >= n) return null;
      add(key, html.slice(valueStart, i));
    }
  }
}

/**
 * Report, in document order, every start tag that becomes an element of the
 * document (see the module comment for what is covered).
 *
 * The main loop looks only at "<" characters:
 * - `<!--` comment, `<!...>` doctype or bogus comment (in foreign content,
 *   `<![CDATA[...]]>`), `<?...>` bogus comment: skipped.
 * - `</` + letter: an end tag, which closes template or foreign content.
 * - `<` + letter: a start tag. Inside template contents it is not reported.
 *   A raw text element's content is skipped up to its end tag; a script's
 *   content is skipped by {@link scriptDataEnd} and passed on as `text`.
 * - Anything else is text.
 *
 * @param html The document or fragment.
 * @param visit Called once per element-creating start tag.
 */
export function forEachStartTag(
  html: string,
  visit: (tag: StartTag) => void,
): void {
  const n = html.length;
  let templateDepth = 0;
  let foreignDepth = 0;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return;
    i = lt;
    const next = html[i + 1];
    if (next === "!") {
      if (html.startsWith("<!--", i)) {
        i = commentEnd(html, i + 4);
      } else if (foreignDepth > 0 && html.startsWith("<![CDATA[", i)) {
        const close = html.indexOf("]]>", i + 9);
        i = close === -1 ? n : close + 3;
      } else {
        const close = html.indexOf(">", i + 2);
        i = close === -1 ? n : close + 1;
      }
      continue;
    }
    if (next === "?") {
      const close = html.indexOf(">", i + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (next === "/") {
      if (isAsciiAlpha(html[i + 2])) {
        const tag = readTag(html, i + 2);
        if (!tag) return;
        i = tag.end;
        if (tag.name === "template" && templateDepth > 0) {
          // Closing a template also closes any foreign content inside it.
          templateDepth--;
          foreignDepth = 0;
        } else if (
          (tag.name === "svg" || tag.name === "math") &&
          foreignDepth > 0
        ) {
          foreignDepth--;
        } else if (
          (tag.name === "br" || tag.name === "p") &&
          foreignDepth > 0
        ) {
          foreignDepth = 0;
        }
      } else if (html[i + 2] === ">") {
        i += 3;
      } else {
        const close = html.indexOf(">", i + 2);
        i = close === -1 ? n : close + 1;
      }
      continue;
    }
    if (!isAsciiAlpha(next)) {
      i++;
      continue;
    }

    const tag = readTag(html, i + 1);
    if (!tag) return;
    i = tag.end;
    let name = tag.name;
    if (foreignDepth > 0) {
      const breaksOut =
        FOREIGN_BREAKOUT.has(name) ||
        (name === "font" &&
          ["color", "face", "size"].some((a) => tag.attributes.has(a)));
      if (breaksOut) foreignDepth = 0;
    }
    const html5 = foreignDepth === 0;
    if (html5 && name === "image") name = "img";

    let text: string | undefined;
    if (html5 && name === "script") {
      const end = scriptDataEnd(html, i);
      text = html.slice(i, end);
      i = end;
    } else if (name === "script") {
      // An SVG/MathML script's content is ordinary markup, parsed on by this
      // loop. Its text before the next tag is enough to tell "empty" from
      // "has code", and reading only that far keeps the scan linear.
      const nextTag = html.indexOf("<", i);
      text = html.slice(i, nextTag === -1 ? n : nextTag);
    } else if (html5 && RAW_TEXT.has(name)) {
      i = rawTextEnd(html, i, name);
    } else if (html5 && name === "plaintext") {
      i = n;
    }

    if (templateDepth === 0) visit({ name, attributes: tag.attributes, text });
    if (html5 && name === "template") templateDepth++;
    if ((name === "svg" || name === "math") && !tag.selfClosing) foreignDepth++;
  }
}
