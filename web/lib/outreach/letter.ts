// Print-ready direct-mail letter. The mailing address comes free from public
// records, so physical mail is the zero-cost way to reach a prospected owner —
// no paid data provider and no messaging service required.

export type LetterInput = {
  ownerName: string;
  propertyAddress: string;
  body: string;
  agentName: string;
  agentEmail?: string;
  date?: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Splits the drafted body into paragraphs, preserving intentional blank lines.
export function toParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function buildLetterHtml(input: LetterInput): string {
  const date =
    input.date ??
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const paragraphs = toParagraphs(input.body)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Letter — ${escapeHtml(input.propertyAddress)}</title>
<style>
  @page { size: letter; margin: 1in; }
  body { color: #10231c; font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.55; margin: 0; }
  .sheet { margin: 0 auto; max-width: 6.5in; padding: 0.5in 0; }
  .date { margin-bottom: 28px; }
  .recipient { margin-bottom: 28px; white-space: pre-line; }
  p { margin: 0 0 14px; }
  .signature { margin-top: 34px; }
  .signature .name { margin-top: 34px; }
  .meta { border-top: 1px solid #dce1d9; color: #5c6b65; font-size: 9pt; margin-top: 44px; padding-top: 10px; }
  .no-print { background: #f3f0e6; border: 1px solid #dce1d9; border-radius: 8px; margin-bottom: 24px; padding: 12px 16px; }
  .no-print button { background: #143f33; border: 0; border-radius: 6px; color: white; cursor: pointer; font: inherit; font-size: 10pt; padding: 8px 16px; }
  @media print { .no-print { display: none; } .sheet { padding: 0; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="no-print">
      This letter is ready to print and mail. Nothing was sent electronically.
      <button onclick="window.print()">Print</button>
    </div>

    <div class="date">${escapeHtml(date)}</div>

    <div class="recipient">${escapeHtml(input.ownerName)}
${escapeHtml(input.propertyAddress)}</div>

    <div class="body">
      ${paragraphs}
    </div>

    <div class="signature">
      Sincerely,
      <div class="name">${escapeHtml(input.agentName)}</div>
      ${input.agentEmail ? `<div>${escapeHtml(input.agentEmail)}</div>` : ""}
    </div>

    <div class="meta">
      Regarding ${escapeHtml(input.propertyAddress)}. If you would prefer not to receive mail about your property, let me know and I will remove you from my list.
    </div>
  </div>
</body>
</html>`;
}
