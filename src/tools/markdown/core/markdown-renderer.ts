import { Marked } from "marked";

/** Turns Markdown source into an HTML fragment (the `<body>` content). */
export interface MarkdownRenderer {
  /**
   * @param markdown Markdown source.
   * @returns An HTML fragment, without `<html>`, `<head>` or `<body>`.
   */
  render(markdown: string): string;
}

/**
 * {@link MarkdownRenderer} backed by `marked`, with GitHub Flavored Markdown
 * (tables, strikethrough, task lists, autolinks) enabled.
 *
 * Raw HTML inside the Markdown is passed through, as CommonMark requires. That
 * is safe here because the HTML is never inserted into the page's DOM: it only
 * goes to the PDF engine inside a Web Worker, and the engine sanitises it
 * (see `IronpressEngine`).
 */
export class MarkedMarkdownRenderer implements MarkdownRenderer {
  /**
   * A private instance, so global `marked.use(...)` calls elsewhere can never
   * change how this tool renders.
   */
  private readonly marked = new Marked({ gfm: true, breaks: false });

  /**
   * Render Markdown synchronously.
   *
   * `async: false` selects marked's synchronous overload, so the return type
   * is `string` rather than `string | Promise<string>`. Synchronous rendering
   * is fine because this runs in a worker, never on the UI thread.
   *
   * @param markdown Markdown source.
   * @returns The HTML fragment.
   */
  render(markdown: string): string {
    return this.marked.parse(markdown, { async: false });
  }
}
