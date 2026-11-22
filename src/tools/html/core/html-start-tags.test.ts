import { describe, expect, it } from "vitest";
import {
  commentEnd,
  forEachStartTag,
  rawTextEnd,
  readTag,
  scriptDataEnd,
  type StartTag,
} from "./html-start-tags";

/** Tag names reported for `html`, in order. */
function names(html: string): string[] {
  const out: string[] = [];
  forEachStartTag(html, (tag) => out.push(tag.name));
  return out;
}

/** All reported tags. */
function tags(html: string): StartTag[] {
  const out: StartTag[] = [];
  forEachStartTag(html, (tag) => out.push(tag));
  return out;
}

describe("commentEnd", () => {
  it.each([
    ["<!-- a -->x", 10],
    ["<!-->x", 5],
    ["<!--->x", 6],
    ["<!---->x", 7],
    ["<!-- a --->x", 11],
    ["<!-- a --!>x", 11],
    ["<!-- a --!->x-->y", 16],
    ["<!-- never closed", 17],
  ])("%j ends at %i", (html, end) => {
    expect(commentEnd(html, 4)).toBe(end);
  });

  it("stays linear on many comments without the other closer", () => {
    const html = "<!-- c -->".repeat(100_000);
    const start = performance.now();
    let i = 0;
    while (i < html.length) i = commentEnd(html, i + 4);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("rawTextEnd", () => {
  it("finds the matching end tag in any case", () => {
    const html = "<style>a</p></STYLE >";
    expect(rawTextEnd(html, 7, "style")).toBe(12);
  });

  it("ignores end tags that only start with the name", () => {
    const html = "<title>a</titles></title>";
    expect(rawTextEnd(html, 7, "title")).toBe(17);
  });

  it("runs to the end without an end tag", () => {
    expect(rawTextEnd("<textarea>x", 10, "textarea")).toBe(11);
  });
});

describe("scriptDataEnd", () => {
  /** Where the script that starts `html` ends, scanning from its first ">". */
  const end = (html: string) => scriptDataEnd(html, html.indexOf(">") + 1);

  it("ends at the first </script> normally", () => {
    expect(end("<script>a()</script>")).toBe(11);
    expect(end("<script>'</scripts>'</SCRIPT>")).toBe(20);
  });

  it("does not end at </script> inside a double-escaped <script>", () => {
    const html = "<script><!--<script>x</script>--></script>";
    expect(end(html)).toBe(html.length - "</script>".length);
  });

  it("ends at </script> inside a plain escaped comment", () => {
    expect(end("<script><!-- a </script>")).toBe(15);
  });

  it("leaves the escape at <!--> and at -->", () => {
    expect(end("<script><!--></script>")).toBe(13);
    expect(end("<script><!-- a --><script></script>")).toBe(26);
  });

  it("runs to the end without an end tag", () => {
    expect(end("<script>x")).toBe(9);
  });
});

describe("readTag", () => {
  /** Read the tag that starts `html` (its name begins at index 1). */
  const read = (html: string) => readTag(html, 1);

  it("reads a lowercased name and attributes in every quoting style", () => {
    const tag = read(`<IMG SRC="a b" alt='x' width=10 hidden>`);
    expect(tag?.name).toBe("img");
    expect(Object.fromEntries(tag!.attributes)).toEqual({
      src: "a b",
      alt: "x",
      width: "10",
      hidden: "",
    });
    expect(tag?.end).toBe(39);
  });

  it("keeps the first of duplicate attributes", () => {
    expect(read("<img src=a src=b>")?.attributes.get("src")).toBe("a");
  });

  it("allows spaces around = and attributes without whitespace between", () => {
    const tag = read(`<a href = "x"title="y">`);
    expect(Object.fromEntries(tag!.attributes)).toEqual({
      href: "x",
      title: "y",
    });
  });

  it("treats / before > as self-closing and ignores it elsewhere", () => {
    expect(read("<svg/>")?.selfClosing).toBe(true);
    expect(read("<a / href=x>")?.attributes.get("href")).toBe("x");
    expect(read("<img src=a/>")?.attributes.get("src")).toBe("a/");
  });

  it("accepts a leading = in a name and a missing value", () => {
    expect([...read("<p =x>")!.attributes.keys()]).toEqual(["=x"]);
    expect(read("<p a=>")?.attributes.get("a")).toBe("");
  });

  it("returns null when the input ends inside the tag", () => {
    expect(read("<img src=x")).toBeNull();
    expect(read('<img src="x>')).toBeNull();
    expect(read("<img ")).toBeNull();
  });
});

describe("forEachStartTag", () => {
  it("reports start tags in order, skipping end tags, comments and doctypes", () => {
    expect(
      names(
        "<!doctype html><html><!-- <img> --><p>a</p><?php <img> ?><br/></html>",
      ),
    ).toEqual(["html", "p", "br"]);
  });

  it("treats markup inside raw text and RCDATA elements as text", () => {
    expect(
      names(
        "<style><img></style><title><img></title><textarea><img></textarea><iframe><img></iframe><b>",
      ),
    ).toEqual(["style", "title", "textarea", "iframe", "b"]);
  });

  it("passes a script's code on, and skips markup inside it", () => {
    const [script, after] = tags(
      "<script>if (a<b) document.write('<img>')</script><i>",
    );
    expect(script.name).toBe("script");
    expect(script.text).toBe("if (a<b) document.write('<img>')");
    expect(after.name).toBe("i");
  });

  it("turns everything after <plaintext> into text", () => {
    expect(names("<plaintext><img><p>")).toEqual(["plaintext"]);
  });

  it("leaves out elements inside templates, even nested ones", () => {
    expect(
      names("<template><img><template><img></template><img></template><p>"),
    ).toEqual(["template", "p"]);
  });

  it("does not apply raw text rules in SVG, and leaves SVG at a breakout tag", () => {
    expect(names("<svg><style><img></style></svg>")).toEqual([
      "svg",
      "style",
      "img",
    ]);
    expect(names("<svg><title><p>x</title>")).toEqual(["svg", "title", "p"]);
    // after the breakout, <style> is an HTML raw text element again
    expect(names("<svg><p><style><img></style>")).toEqual([
      "svg",
      "p",
      "style",
    ]);
  });

  it("reads <![CDATA[ as a section in SVG and as a bogus comment in HTML", () => {
    expect(names("<svg><![CDATA[ <img> ]]><g>")).toEqual(["svg", "g"]);
    expect(names("<![CDATA[ x ]]><img>")).toEqual(["img"]);
  });

  it("reports <image> as <img> in HTML only", () => {
    expect(names("<image src=a><svg><image href=b>")).toEqual([
      "img",
      "svg",
      "image",
    ]);
  });

  it("drops a tag cut off by the end of the input", () => {
    expect(names("<p><img src=x")).toEqual(["p"]);
  });

  it("treats < not followed by a letter as text", () => {
    expect(names("a < b <1 <> </> <p>")).toEqual(["p"]);
  });

  it("stays fast on large documents", () => {
    const html = '<p class="x">text <img src="a.png"> more</p>'.repeat(100_000);
    const start = performance.now();
    let count = 0;
    forEachStartTag(html, () => count++);
    expect(count).toBe(200_000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
