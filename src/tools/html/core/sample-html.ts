/**
 * Example document shown in the HTML editor on first load.
 *
 * It is self-contained on purpose (CSS in a `<style>` element, no images or
 * scripts), so converting it shows no "left out" notice, and it only uses the
 * generic font families, which the engine maps to embedded Liberation fonts.
 */
export const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice 2026-042</title>
<!-- Edit this HTML, or open your own .html file, then press Convert to PDF.
     Paper size and margins come from the page settings below, unless an
     @page { size: ...; margin: ... } rule here sets them (that rule wins). -->
<style>
  body { font-family: sans-serif; font-size: 10.5pt; color: #1f2328; }
  header { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  .muted { color: #59636e; }
  table { width: 100%; border-collapse: collapse; margin-top: 24pt; }
  th, td { padding: 6pt 8pt; border-bottom: 1px solid #d1d9e0; text-align: left; }
  th { background-color: #f6f8fa; }
  td.amount, th.amount { text-align: right; }
  tfoot td { font-weight: bold; border-bottom: none; }
  .note { margin-top: 24pt; padding: 10pt 12pt; background-color: #eef6ff; border-left: 4px solid #0969da; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Invoice</h1>
    <div class="muted">No. 2026-042 &middot; 20 November 2026</div>
  </div>
  <div style="text-align: right">
    <strong>Example Studio</strong><br>
    <span class="muted">12 Sample Street<br>Springfield</span>
  </div>
</header>

<table>
  <thead>
    <tr><th>Description</th><th class="amount">Hours</th><th class="amount">Amount</th></tr>
  </thead>
  <tbody>
    <tr><td>Design review</td><td class="amount">6</td><td class="amount">$540.00</td></tr>
    <tr><td>Front-end build</td><td class="amount">14</td><td class="amount">$1,260.00</td></tr>
    <tr><td>Accessibility audit</td><td class="amount">4</td><td class="amount">$360.00</td></tr>
  </tbody>
  <tfoot>
    <tr><td>Total</td><td class="amount">24</td><td class="amount">$2,160.00</td></tr>
  </tfoot>
</table>

<p class="note">This PDF was made in your browser. The HTML never left your device.</p>
</body>
</html>
`;
