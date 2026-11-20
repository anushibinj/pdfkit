/**
 * Differential test: the tag scanner behind scanHtmlForSkippedResources
 * against jsdom's DOMParser, whose HTML parser (parse5) implements the WHATWG
 * tokenizer and tree builder exactly. Both sides apply the same resource
 * rules (isSkippedImage, isStylesheetLink, isRunnableScript); only the
 * parsing differs, so any disagreement is a scanner bug.
 */
import { describe, expect, it } from "vitest";
import { forEachStartTag, type StartTag } from "./html-start-tags";
import {
  isRunnableScript,
  isSkippedImage,
  isStylesheetLink,
  scanHtmlForSkippedResources,
} from "./skipped-resources";

/**
 * Each img/link/script element as a comparable string, sorted. Sorting makes
 * the comparison independent of order (the tree builder moves content out of
 * tables), while still checking every element, not just the totals.
 */
type Signature = string[];

/** Describe one element for {@link Signature}. */
function describeTag(tag: StartTag): string | null {
  if (tag.name === "img") return `img skipped=${isSkippedImage(tag)}`;
  if (tag.name === "link") return `link stylesheet=${isStylesheetLink(tag)}`;
  if (tag.name === "script") return `script runs=${isRunnableScript(tag)}`;
  return null;
}

/** What the scanner sees. */
function scannerSignature(html: string): Signature {
  const out: string[] = [];
  forEachStartTag(html, (tag) => {
    const line = describeTag(tag);
    if (line) out.push(line);
  });
  return out.sort();
}

/** What a spec-compliant parser builds, as StartTags for the same rules. */
function domSignature(html: string): Signature {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  for (const el of doc.querySelectorAll("img, link, script")) {
    const tag: StartTag = {
      name: el.localName,
      attributes: new Map(Array.from(el.attributes, (a) => [a.name, a.value])),
      text: el.textContent ?? "",
    };
    const line = describeTag(tag);
    if (line) out.push(line);
  }
  return out.sort();
}

/** Mulberry32, a seeded generator, so failures replay from the seed. */
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

type Picker = <T>(list: readonly T[]) => T;

/** One attribute in a random spelling: case, quotes, spaces around "=". */
function attr(pick: Picker, name: string, value: string): string {
  const quote = pick(['"', "'", ""]);
  const safe = quote === "" && /[\s>"'=<`]/.test(value) ? '"' : quote;
  return ` ${pick([name, name.toUpperCase()])}${pick(["=", " = "])}${safe}${value}${safe}`;
}

/** A random <img>, <link> or <script> with every interesting variation. */
function resource(pick: Picker): string {
  switch (pick(["img", "img", "link", "script", "script", "image"] as const)) {
    case "img":
    case "image": {
      const src = pick([
        attr(pick, "src", "logo.png"),
        attr(pick, "src", "https://cdn.example.com/a.png"),
        attr(pick, "src", "data:image/png;base64,iVBOR"),
        attr(pick, "src", "data:image/gif;base64,R0lG"),
        attr(pick, "srcset", "a.png 1x"),
        attr(pick, "src", ""),
        "",
      ]);
      const extra = pick(["", attr(pick, "alt", "x y"), src, " hidden"]);
      return `<${pick(["img", "IMG", "image"])}${src}${extra}${pick([">", "/>", " />"])}`;
    }
    case "link":
      return `<link${attr(pick, "rel", pick(["stylesheet", "StyleSheet preload", "alternate stylesheet", "icon"]))}${attr(pick, "href", "a.css")}>`;
    default: {
      const type = pick([
        "",
        attr(pick, "type", ""),
        attr(pick, "type", "module"),
        attr(pick, "type", " text/javascript "),
        attr(pick, "type", "application/ld+json"),
        attr(pick, "type", "text/javascript; charset=utf-8"),
        attr(pick, "language", "JavaScript"),
        attr(pick, "language", "vbscript"),
      ]);
      const src = pick(["", attr(pick, "src", "app.js")]);
      const body = pick([
        "",
        "  ",
        "go()",
        "if (a<b) document.write('<img src=x.png>')",
        "x = '</scripts>'",
        "<!-- <script>inner()</script> -->",
        "<!--> <img src=y.png>",
      ]);
      return `<${pick(["script", "SCRIPT"])}${type}${src}>${body}</${pick(["script", "Script"])}>`;
    }
  }
}

/** A random piece of document around the resources. */
function piece(pick: Picker, depth: number): string {
  const inner = () => (depth > 2 ? resource(pick) : chunk(pick, depth + 1));
  switch (pick([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const)) {
    case 0:
      return resource(pick);
    case 1:
      return `<!--${pick([" ", "", "-"])}${inner()}${pick(["-->", "--!>", " -->"])}`;
    case 2:
      return pick(["<!-->", "<!--->"]) + inner();
    case 3: {
      const raw = pick([
        "style",
        "title",
        "textarea",
        "iframe",
        "xmp",
        "noembed",
        "noframes",
      ]);
      return `<${raw}>${inner()}</${pick([raw, raw.toUpperCase()])}>`;
    }
    case 4:
      return `<template>${inner()}</template>${inner()}`;
    case 5:
      return `<div class="a">${inner()}</div>`;
    case 6:
      return `<table><tr><td>${inner()}</td></tr></table>`;
    case 7:
      return `<svg viewBox="0 0 1 1">${pick(["<script>draw()</script>", "<style>" + resource(pick) + "</style>", "<image href=a.png/>", "<![CDATA[" + resource(pick) + "]]>", "<p>" + inner(), ""])}</svg>${inner()}`;
    case 8:
      return pick([
        "a < b ",
        "<1>",
        "</>",
        "< img src=a.png>",
        "<?php echo '<img src=a.png>' ?>",
        "<!x <img src=a.png>>",
        "</ img>",
      ]);
    case 9:
      return `<noscript>${inner()}</noscript>`;
    default:
      return `<p>text</p>${inner()}`;
  }
}

/** A sequence of pieces. */
function chunk(pick: Picker, depth: number): string {
  let out = "";
  const count = 1 + Math.floor(pick([0, 1, 2, 3]));
  for (let n = 0; n < count; n++) out += piece(pick, depth);
  return out;
}

/**
 * A whole random document, sometimes cut off at a random point to exercise
 * the end-of-input rules (unclosed tags, comments, raw text, scripts).
 */
function randomDocument(random: () => number): string {
  const pick: Picker = (list) => list[Math.floor(random() * list.length)];
  let html =
    pick(["", "<!doctype html>", "<!DOCTYPE html><html><head>"]) +
    chunk(pick, 0);
  if (random() < 0.25) html = html.slice(0, Math.floor(random() * html.length));
  return html;
}

const RUNS = 3000;

describe("tag scanner vs a spec-compliant parser", () => {
  it.each([
    "<img src=a.png><link rel=stylesheet href=a.css><script>x()</script>",
    "<!-- <img src=a.png> --><!--><img src=b.png>",
    "<style><img src=a.png></style><textarea><script>x()</script></textarea>",
    "<script><!--<script>a()</script><img src=a.png>--></script><img src=b.png>",
    "<template><img src=a.png></template><img src=b.png>",
    "<svg><style><img src=a.png></style><script>x()</script></svg>",
    "<svg><p><style><img src=a.png></style>",
    "<table><img src=a.png><tr><td>x</td></tr></table>",
    "<noscript><img src=a.png></noscript>",
    "<image src=a.png><svg><image href=b.png/></svg>",
    "<img src=a.png",
  ])("agrees on %j", (html) => {
    expect(scannerSignature(html)).toEqual(domSignature(html));
  });

  it(`agrees on ${RUNS} generated documents`, () => {
    const random = seededRandom(20261120);
    const disagreements: string[] = [];
    let elements = 0;
    for (let n = 0; n < RUNS; n++) {
      const html = randomDocument(random);
      const ours = scannerSignature(html);
      const theirs = domSignature(html);
      elements += theirs.length;
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        disagreements.push(
          `${JSON.stringify(html)}\n  scanner: ${ours.join(", ")}\n  parser:  ${theirs.join(", ")}`,
        );
      }
    }
    expect(disagreements.slice(0, 3)).toEqual([]);
    // The documents must actually contain resources to compare.
    expect(elements).toBeGreaterThan(RUNS);
    // jsdom's parser takes a few milliseconds per document.
  }, 60_000);

  it("totals match the per-element comparison", () => {
    const html =
      "<img src=a.png><img src='data:image/png;base64,x'><link rel=stylesheet href=a.css><script src=a.js></script>";
    expect(scanHtmlForSkippedResources(html)).toEqual({
      images: 1,
      stylesheets: 1,
      scripts: 1,
    });
  });

  it.each([
    ["character references", "<img src='&#100;ata:image/png;base64,iVBOR'>"],
    [
      "raw text in an SVG integration point",
      "<svg><title><style><img src=a.png></style></title></svg>",
    ],
    ["tags dropped inside <select>", "<select><img src=a.png></select>"],
    ["tags dropped inside <frameset>", "<frameset><img src=a.png></frameset>"],
  ])("documents a known simplification: %s", (_label, html) => {
    // The scanner reports one skipped image where the parser builds none
    // (or an embeddable one); see "Known simplifications" in html-start-tags.
    expect(scannerSignature(html)).toEqual(["img skipped=true"]);
    expect(domSignature(html)).not.toEqual(["img skipped=true"]);
  });
});
