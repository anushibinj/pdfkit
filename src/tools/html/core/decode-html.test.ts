import { describe, expect, it } from "vitest";
import {
  PRESCAN_BYTE_LIMIT,
  bomEncoding,
  charsetFromContent,
  decodeHtml,
  encodingForLabel,
  getAttribute,
  prescanMetaCharset,
  sniffHtmlEncoding,
  xmlDeclarationEncoding,
} from "./decode-html";

/** ASCII/latin1 text as bytes (one byte per character). */
const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** "café €" in windows-1252: é = E9, € = 80. */
const CAFE_1252 = [0x63, 0x61, 0x66, 0xe9, 0x20, 0x80];

describe("encodingForLabel", () => {
  it.each([
    ["utf-8", "utf-8"],
    ["UTF8", "utf-8"],
    [" utf-8 ", "utf-8"],
    ["latin1", "windows-1252"],
    ["iso-8859-1", "windows-1252"],
    ["windows-1252", "windows-1252"],
    ["Shift_JIS", "shift_jis"],
    ["utf-16", "utf-16le"],
    ["x-user-defined", "x-user-defined"],
  ])("%j -> %s", (label, name) => {
    expect(encodingForLabel(label)).toBe(name);
  });

  it.each(["bogus", "", "iso-2022-kr", "replacement"])(
    "treats %j as unknown",
    (label) => {
      expect(encodingForLabel(label)).toBeNull();
    },
  );
});

describe("bomEncoding", () => {
  it.each([
    [[0xef, 0xbb, 0xbf, 0x3c], "utf-8"],
    [[0xfe, 0xff, 0x00, 0x3c], "utf-16be"],
    [[0xff, 0xfe, 0x3c, 0x00], "utf-16le"],
    [[0x3c, 0x70], null],
    [[0xef, 0xbb], null],
    [[], null],
  ])("%j -> %s", (input, name) => {
    expect(bomEncoding(Uint8Array.from(input))).toBe(name);
  });
});

describe("charsetFromContent", () => {
  it.each([
    ["text/html; charset=windows-1252", "windows-1252"],
    ["text/html;charset=UTF-8", "utf-8"],
    ["text/html; CHARSET = 'latin1' ", "windows-1252"],
    ['text/html; charset="shift_jis"', "shift_jis"],
    ["text/html; charset=utf-8; foo=bar", "utf-8"],
    ["charsetX; charset=utf-8", "utf-8"],
  ])("%j -> %s", (content, name) => {
    expect(charsetFromContent(content)).toBe(name);
  });

  it.each([
    "text/html",
    "text/html; charset=",
    "text/html; charset='utf-8",
    "text/html; charset=bogus",
  ])("finds nothing in %j", (content) => {
    expect(charsetFromContent(content)).toBeNull();
  });
});

describe("getAttribute", () => {
  const read = (text: string) => {
    const b = bytes(text);
    return getAttribute(b, 0, b.length);
  };

  it("reads a quoted value, lowercasing name and value", () => {
    expect(read(' CharSet="UTF-8">')).toEqual({
      attribute: { name: "charset", value: "utf-8" },
      position: 16,
    });
  });

  it("reads an unquoted value up to whitespace or >", () => {
    expect(read("a=b c").attribute).toEqual({ name: "a", value: "b" });
    expect(read("a = b>").attribute).toEqual({ name: "a", value: "b" });
  });

  it("reads a valueless attribute", () => {
    expect(read("hidden>").attribute).toEqual({ name: "hidden", value: "" });
    expect(read("hidden other").attribute).toEqual({
      name: "hidden",
      value: "",
    });
  });

  it("reports the end of the tag", () => {
    expect(read("  />")).toEqual({ attribute: null, position: 3 });
  });

  it("reports running out of input", () => {
    expect(read('a="never closed').attribute).toBeNull();
    expect(read('a="never closed').position).toBeGreaterThanOrEqual(15);
    expect(read("").attribute).toBeNull();
  });
});

describe("prescanMetaCharset", () => {
  it.each([
    ['<meta charset="windows-1252">', "windows-1252"],
    ["<META CHARSET=latin1>", "windows-1252"],
    ["<meta/charset=utf-8>", "utf-8"],
    [
      '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">',
      "windows-1252",
    ],
    [
      '<meta content="text/html; charset=koi8-r" http-equiv="content-type">',
      "koi8-r",
    ],
    ['<meta charset="utf-16le">', "utf-8"],
    ['<meta charset="x-user-defined">', "windows-1252"],
    ['<title>x</title><meta charset="euc-kr">', "euc-kr"],
    ['<meta charset="bogus"><meta charset="gbk">', "gbk"],
  ])("finds the encoding in %j", (html, name) => {
    expect(prescanMetaCharset(bytes(html))).toBe(name);
  });

  it.each([
    // content= without http-equiv is not a declaration
    '<meta content="text/html; charset=windows-1252">',
    // inside a comment or an attribute value of another tag
    '<!-- <meta charset="windows-1252"> -->',
    "<div title='<meta charset=windows-1252>'></div>",
    // an end tag or doctype is skipped whole
    '</meta charset="windows-1252">',
    "<!doctype html>",
    "<metadata charset=windows-1252>",
    "",
  ])("finds nothing in %j", (html) => {
    expect(prescanMetaCharset(bytes(html))).toBeNull();
  });

  it("stops at the 1024-byte limit", () => {
    const pad = "x".repeat(PRESCAN_BYTE_LIMIT);
    expect(prescanMetaCharset(bytes(`${pad}<meta charset=gbk>`))).toBeNull();
    const split = "x".repeat(PRESCAN_BYTE_LIMIT - 10);
    expect(prescanMetaCharset(bytes(`${split}<meta charset=gbk>`))).toBeNull();
  });
});

describe("xmlDeclarationEncoding", () => {
  it.each([
    ['<?xml version="1.0" encoding="ISO-8859-1"?><html>', "windows-1252"],
    ["<?xml version='1.0' encoding = 'utf-16'?>", "utf-8"],
    ['<?xml encoding="shift_jis"?>', "shift_jis"],
  ])("reads %j", (xml, name) => {
    expect(xmlDeclarationEncoding(bytes(xml))).toBe(name);
  });

  it.each([
    '<?XML encoding="gbk"?>',
    '<?xml version="1.0"?>',
    '<?xml encoding="gbk"',
    "<?xml encoding=gbk?>",
    '<?xml encoding="g bk"?>',
    ' <?xml encoding="gbk"?>',
  ])("finds nothing in %j", (xml) => {
    expect(xmlDeclarationEncoding(bytes(xml))).toBeNull();
  });
});

describe("sniffHtmlEncoding", () => {
  it("prefers a byte order mark over a meta declaration", () => {
    const html = [0xef, 0xbb, 0xbf, ...bytes("<meta charset=gbk>")];
    expect(sniffHtmlEncoding(Uint8Array.from(html))).toBe("utf-8");
  });

  it("recognises UTF-16 without a byte order mark by its <?x signature", () => {
    expect(
      sniffHtmlEncoding(Uint8Array.from([0x3c, 0, 0x3f, 0, 0x78, 0])),
    ).toBe("utf-16le");
    expect(
      sniffHtmlEncoding(Uint8Array.from([0, 0x3c, 0, 0x3f, 0, 0x78])),
    ).toBe("utf-16be");
  });

  it("uses the meta prescan, then the XML declaration", () => {
    expect(
      sniffHtmlEncoding(bytes('<?xml encoding="gbk"?><meta charset=koi8-r>')),
    ).toBe("koi8-r");
    expect(sniffHtmlEncoding(bytes('<?xml encoding="gbk"?><p>'))).toBe("gbk");
  });

  it("returns null when nothing is declared", () => {
    expect(sniffHtmlEncoding(bytes("<p>plain</p>"))).toBeNull();
  });
});

describe("decodeHtml", () => {
  it("decodes a declared windows-1252 file (Word's 'Save as Web Page')", () => {
    const html = Uint8Array.from([
      ...bytes(
        '<meta http-equiv=Content-Type content="text/html; charset=windows-1252"><p>',
      ),
      ...CAFE_1252,
    ]);
    const { text, encoding } = decodeHtml(html);
    expect(encoding).toBe("windows-1252");
    expect(text.endsWith("<p>café €")).toBe(true);
  });

  it("reads undeclared valid UTF-8 as UTF-8", () => {
    const html = new TextEncoder().encode("<p>नमस्ते, café</p>");
    expect(decodeHtml(html)).toEqual({
      text: "<p>नमस्ते, café</p>",
      encoding: "utf-8",
    });
  });

  it("falls back to windows-1252 for undeclared bytes that are not UTF-8", () => {
    const { text, encoding } = decodeHtml(Uint8Array.from(CAFE_1252));
    expect(encoding).toBe("windows-1252");
    expect(text).toBe("café €");
  });

  it("removes the byte order mark", () => {
    const html = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes("<p>x</p>")]);
    expect(decodeHtml(html).text).toBe("<p>x</p>");
  });

  it("decodes UTF-16 with a byte order mark", () => {
    const le = [
      0xff,
      0xfe,
      ...[..."<p>é</p>"].flatMap((c) => [c.charCodeAt(0), 0]),
    ];
    expect(decodeHtml(Uint8Array.from(le))).toEqual({
      text: "<p>é</p>",
      encoding: "utf-16le",
    });
  });

  it("reads an XML-declared x-user-defined file as windows-1252", () => {
    const html = Uint8Array.from([
      ...bytes('<?xml encoding="x-user-defined"?>'),
      0xe9,
    ]);
    expect(decodeHtml(html)).toEqual({
      text: '<?xml encoding="x-user-defined"?>é',
      encoding: "windows-1252",
    });
  });

  it("decodes an empty file", () => {
    expect(decodeHtml(new Uint8Array())).toEqual({
      text: "",
      encoding: "utf-8",
    });
  });
});
