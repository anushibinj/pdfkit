/**
 * The stylesheet the CSS editor starts with. Users edit it freely, and "Reset
 * CSS" puts this text back.
 *
 * It only uses the generic families `sans-serif`, `serif` and `monospace`. The
 * PDF engine embeds Liberation Sans/Serif/Mono for those (see the integration
 * test); any other family name falls back to one of them.
 */
export const DEFAULT_STYLESHEET = `/* Edit this stylesheet to restyle the PDF.
   Fonts: use sans-serif, serif or monospace.
   Paper size: the page settings below, or an @page { size: ... } rule here
   (an @page rule wins). */

body {
  font-family: sans-serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #1f2328;
}

h1, h2, h3, h4, h5, h6 {
  line-height: 1.25;
  margin: 1.2em 0 0.5em;
}
h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }

p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }

a { color: #0969da; text-decoration: underline; }

code {
  font-family: monospace;
  font-size: 0.9em;
  background-color: #eff1f3;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}
pre {
  background-color: #f6f8fa;
  padding: 12px;
  border-radius: 6px;
  white-space: pre-wrap;
}
pre code { background-color: transparent; padding: 0; }

blockquote {
  color: #59636e;
  border-left: 4px solid #d1d9e0;
  padding: 0 1em;
  margin-left: 0;
}

table { border-collapse: collapse; }
th, td { border: 1px solid #d1d9e0; padding: 6px 12px; }
th { background-color: #f6f8fa; font-weight: bold; }

hr { border: 0; border-top: 1px solid #d1d9e0; margin: 1.5em 0; }

img { max-width: 100%; }
`;

/** Example document shown in the Markdown editor on first load. */
export const SAMPLE_MARKDOWN = `# Project report

Write **Markdown** here, style it in the **CSS** editor, then press
*Convert to PDF*.

## Features

- Headings, lists, links and \`inline code\`
- Tables and ~~strikethrough~~ (GitHub Flavored Markdown)
- Code blocks:

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> Everything happens in your browser. Nothing is uploaded.

| Tool | Runs where |
| ---- | ---------- |
| Markdown to PDF | Your device |
`;
