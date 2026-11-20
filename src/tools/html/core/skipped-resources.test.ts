import { describe, expect, it } from "vitest";
import { forEachStartTag, type StartTag } from "./html-start-tags";
import {
  NO_SKIPPED_RESOURCES,
  countPhrase,
  describeSkippedResources,
  isEmbeddableImageSource,
  isRunnableScript,
  isSkippedImage,
  isStylesheetLink,
  scanHtmlForSkippedResources,
} from "./skipped-resources";

/** The first start tag in `html`, as the scanner reports it. */
function firstTag(html: string): StartTag {
  let found: StartTag | undefined;
  forEachStartTag(html, (tag) => (found ??= tag));
  if (!found) throw new Error(`no start tag in ${html}`);
  return found;
}

describe("isEmbeddableImageSource", () => {
  it.each([
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
    "  DATA:image/PNG;base64,iVBOR  ",
    "data:;base64,iVBORw0KGgo=",
  ])("accepts %j", (src) => {
    expect(isEmbeddableImageSource(src)).toBe(true);
  });

  it.each([
    "logo.png",
    "/images/logo.png",
    "https://example.com/logo.png",
    "file:///C:/logo.png",
    "blob:https://example.com/1",
    "data:image/gif;base64,R0lGOD",
    "data:image/webp;base64,UklGR",
    "data:image/svg+xml,%3Csvg%3E",
    "",
  ])("rejects %j", (src) => {
    expect(isEmbeddableImageSource(src)).toBe(false);
  });
});

describe("isSkippedImage", () => {
  it.each([
    ["<img src=logo.png>", true],
    ["<img srcset='a.png 1x'>", true],
    ["<img src='data:image/png;base64,iVBOR'>", false],
    ["<img alt='no source'>", false],
    ["<img src='  '>", false],
  ])("%s -> %s", (html, expected) => {
    expect(isSkippedImage(firstTag(html))).toBe(expected);
  });
});

describe("isRunnableScript", () => {
  it.each([
    "<script>x()</script>",
    "<script src=app.js></script>",
    "<script type=''>x()</script>",
    "<script type=' Text/JavaScript '>x()</script>",
    "<script type=module>x()</script>",
    "<script type=application/x-javascript>x()</script>",
    "<script language=JavaScript>x()</script>",
    "<svg><script>alert(1)</script></svg>",
  ])("counts %s", (html) => {
    let script: StartTag | undefined;
    forEachStartTag(html, (tag) => {
      if (tag.name === "script") script = tag;
    });
    expect(isRunnableScript(script!)).toBe(true);
  });

  it.each([
    "<script type=application/ld+json>{}</script>",
    "<script type=importmap>{}</script>",
    "<script type='text/javascript; charset=utf-8'>x()</script>",
    "<script type=text/template><p></p></script>",
    "<script language=vbscript>x</script>",
    "<script>   </script>",
  ])("ignores %s", (html) => {
    expect(isRunnableScript(firstTag(html))).toBe(false);
  });
});

describe("isStylesheetLink", () => {
  it.each([
    ["<link rel=stylesheet href=a.css>", true],
    ["<link rel='StyleSheet preload' href=a.css>", true],
    ["<link rel='alternate stylesheet' href=a.css>", false],
    ["<link rel=icon href=a.ico>", false],
    ["<link href=a.css>", false],
  ])("%s -> %s", (html, expected) => {
    expect(isStylesheetLink(firstTag(html))).toBe(expected);
  });
});

describe("scanHtmlForSkippedResources", () => {
  it("counts each kind of skipped resource", () => {
    expect(
      scanHtmlForSkippedResources(`
        <link rel=stylesheet href=https://cdn.example.com/site.css>
        <img src="data:image/png;base64,iVBORw0KGgo=">
        <img src="photo.jpg"><img srcset="a.png 1x"><img alt="no source">
        <script src=app.js></script>
        <script type=application/ld+json>{}</script>
        <!-- <img src="commented-out.png"> -->
        <template><img src="inert.png"></template>`),
    ).toEqual({ images: 2, stylesheets: 1, scripts: 1 });
  });

  it("finds nothing in a self-contained document", () => {
    expect(
      scanHtmlForSkippedResources("<style>p{}</style><p style='x'>Hi</p>"),
    ).toEqual(NO_SKIPPED_RESOURCES);
  });

  it("handles SVG scripts (which have no .text in a DOM) without failing", () => {
    expect(
      scanHtmlForSkippedResources("<svg><script>alert(1)</script></svg>"),
    ).toEqual({ images: 0, stylesheets: 0, scripts: 1 });
  });

  it("never throws on malformed input", () => {
    for (const html of [
      "<",
      "<img",
      "<!--",
      "<script>",
      "</",
      "<svg><![CDATA[",
    ]) {
      expect(() => scanHtmlForSkippedResources(html)).not.toThrow();
    }
  });
});

describe("countPhrase", () => {
  it("picks singular or plural", () => {
    expect(countPhrase(1, "image was", "images were")).toBe("1 image was");
    expect(countPhrase(3, "image was", "images were")).toBe("3 images were");
  });
});

describe("describeSkippedResources", () => {
  it("says nothing when nothing was skipped", () => {
    expect(describeSkippedResources(NO_SKIPPED_RESOURCES)).toEqual([]);
  });

  it("explains each kind, with what to do instead", () => {
    const lines = describeSkippedResources({
      images: 2,
      stylesheets: 1,
      scripts: 3,
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^2 images were left out\. .*data: URLs/);
    expect(lines[1]).toMatch(/^1 linked stylesheet was left out\. .*<style>/);
    expect(lines[2]).toMatch(/^3 scripts were not run/);
  });
});
