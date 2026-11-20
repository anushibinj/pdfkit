/**
 * Differential test: our encoding sniffer against `html-encoding-sniffer`
 * (the reference implementation by the HTML standard's editor, used by jsdom)
 * on thousands of generated inputs. Any disagreement prints the input, so a
 * failure is reproducible from the seed.
 */
import sniffReference from "html-encoding-sniffer";
import { describe, expect, it } from "vitest";
import { sniffHtmlEncoding } from "./decode-html";

/**
 * Mulberry32: a tiny seeded pseudo-random generator, so every run tests the
 * same inputs and a failure can be replayed.
 *
 * @param seed Any 32-bit integer.
 * @returns A function giving floats in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Labels to declare. The labels of the "replacement" encoding (such as
 * iso-2022-kr) are left out on purpose: the reference reports "replacement"
 * for them, while we treat them as unknown (see the deviation test below).
 */
const LABELS = [
  "utf-8",
  "UTF8",
  " utf-8 ",
  "latin1",
  "windows-1252",
  "Windows-1251",
  "iso-8859-2",
  "shift_jis",
  "euc-kr",
  "gbk",
  "koi8-r",
  "utf-16",
  "utf-16be",
  "x-user-defined",
  "bogus",
  "",
];

/** Chooses one element of a list with the seeded generator. */
type Picker = <T>(list: readonly T[]) => T;

/**
 * Wrap a value in double, single or no quotes, sometimes with spaces around
 * the "=" that precedes it.
 *
 * @param pick The seeded picker.
 * @param value The attribute value.
 * @returns `=value` in one of its spellings.
 */
function assignValue(pick: Picker, value: string): string {
  const quote = pick(['"', "'", ""]);
  return `${pick(["", " "])}=${pick(["", " ", "\t"])}${quote}${value}${quote}`;
}

/**
 * Build one `<meta>` tag the way real pages write it, with random attribute
 * order, case, quoting and spacing, and sometimes something missing (no
 * http-equiv, no ">").
 *
 * @param pick The seeded picker.
 * @returns The tag's text.
 */
function metaTag(pick: Picker): string {
  const label = pick(LABELS);
  const attributes = [
    `${pick(["charset", "CHARSET", "Charset"])}${assignValue(pick, label)}`,
    `${pick(["http-equiv", "HTTP-EQUIV"])}${assignValue(pick, pick(["content-type", "Content-Type", "refresh", ""]))}`,
    `content${assignValue(pick, `${pick(["text/html", ""])}${pick([";", "; ", ""])}${pick(["charset", "CharSet", "charsetx", "char set"])}${pick(["=", " = ", ""])}${pick(['"', "'", ""])}${label}`)}`,
    `name${assignValue(pick, "viewport")}`,
  ];
  const chosen = attributes.filter(() => pick([true, true, false]));
  if (pick([true, false])) chosen.reverse();
  const opener = pick([
    "<meta ",
    "<META ",
    "<meta/",
    "<meta\t",
    "<metax ",
    "<meta",
  ]);
  return `${opener}${chosen.join(pick([" ", "  ", "/", "\n"]))}${pick([">", "/>", " >", ""])}`;
}

/**
 * Build one piece of markup: mostly meta tags, plus the constructs the
 * prescan must skip correctly (comments, other tags, end tags, doctypes,
 * processing instructions, text).
 *
 * @param pick The seeded picker.
 * @returns The markup's text.
 */
function segment(pick: Picker): string {
  switch (pick([0, 0, 0, 1, 2, 3, 4, 5, 6] as const)) {
    case 0:
      return metaTag(pick);
    case 1:
      return `<!--${pick(["", " ", "-"])}${pick([metaTag(pick), "x"])}${pick(["-->", "->", "", " -- >"])}`;
    case 2:
      return `<${pick(["p", "div", "a", "title"])}${pick(["", ` title="${pick(["a>b", metaTag(pick), "x"])}"`, " data-x='>'"])}${pick([">", ""])}`;
    case 3:
      return pick([
        "</p>",
        "</meta charset=gbk>",
        "<!doctype html>",
        "<?php echo 1 ?>",
        "<!x>",
        "<>",
      ]);
    case 4:
      return pick(["text ", "\n", " ", "charset=gbk", "<", ">"]);
    case 5:
      return `<?xml version="1.0"${pick(["", ` encoding=${pick(['"', "'", ""])}${pick(LABELS)}${pick(['"', "'", ""])}`])}?>`;
    default:
      return "x".repeat(50);
  }
}

/**
 * Build one input: a few segments, sometimes behind padding that pushes the
 * interesting part across the prescan's 1024-byte limit, and sometimes with
 * one byte deleted or replaced to create near-misses.
 *
 * @param random The seeded generator.
 * @returns The input as latin1 bytes.
 */
function randomInput(random: () => number): Uint8Array {
  const pick: Picker = (list) => list[Math.floor(random() * list.length)];
  let text = "";
  const count = 1 + Math.floor(random() * 4);
  for (let n = 0; n < count; n++) text += segment(pick);
  if (random() < 0.2) {
    text = "x".repeat(960 + Math.floor(random() * 80)) + text;
  }
  if (text.length > 0 && random() < 0.3) {
    const at = Math.floor(random() * text.length);
    const replacement = pick(["", '"', "'", ">", "<", " ", "=", "-"]);
    text = text.slice(0, at) + replacement + text.slice(at + 1);
  }
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

/** The reference's answer in our format: lowercase name, or null. */
function reference(bytes: Uint8Array): string | null {
  const none = "(none)";
  const name = sniffReference(bytes, { defaultEncoding: none });
  return name === none ? null : name.toLowerCase();
}

/** Generated inputs per run (about half a second). */
const RUNS = 20_000;

describe("sniffHtmlEncoding vs html-encoding-sniffer", () => {
  it.each([
    '<meta charset="windows-1252">',
    '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">',
    '<meta content="text/html; charset=windows-1252">',
    '<!-- <meta charset=gbk> --><meta charset="koi8-r">',
    "<!--><meta charset=gbk>",
    '<?xml version="1.0" encoding="ISO-8859-1"?><html>',
    '<meta charset="utf-16">',
    '<meta charset="x-user-defined">',
    "<p title='<meta charset=gbk>'>",
    "<meta charset=bogus><meta charset=euc-kr>",
  ])("agrees on %j", (html) => {
    const input = Uint8Array.from(html, (c) => c.charCodeAt(0));
    expect(sniffHtmlEncoding(input)).toBe(reference(input));
  });

  it(`agrees on ${RUNS} generated inputs`, () => {
    const random = seededRandom(20261120);
    const disagreements: string[] = [];
    let detected = 0;
    for (let n = 0; n < RUNS; n++) {
      const input = randomInput(random);
      const ours = sniffHtmlEncoding(input);
      const theirs = reference(input);
      if (ours !== null) detected++;
      if (ours !== theirs) {
        disagreements.push(
          `${JSON.stringify(String.fromCharCode(...input))}: ours=${ours} reference=${theirs}`,
        );
      }
    }
    expect(disagreements.slice(0, 5)).toEqual([]);
    // Guard against a generator that only produces trivial inputs: at least
    // a tenth must declare an encoding, and at least a tenth must be near
    // misses that the prescan has to reject.
    expect(detected).toBeGreaterThan(RUNS * 0.1);
    expect(detected).toBeLessThan(RUNS * 0.9);
  });

  it("deliberately differs on replacement-encoding labels", () => {
    // The reference returns the "replacement" encoding, which decodes a whole
    // file to a single U+FFFD. We ignore such a declaration and keep reading.
    const input = Uint8Array.from('<meta charset="iso-2022-kr">', (c) =>
      c.charCodeAt(0),
    );
    expect(reference(input)).toBe("replacement");
    expect(sniffHtmlEncoding(input)).toBeNull();
  });
});
