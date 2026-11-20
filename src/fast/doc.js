// Turning plain text into a real document. A .pdf must be a PDF (starts with %PDF-): text saved under a .pdf name opens in nothing.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Light markup, nothing fancy: "# Title", "## Heading", "- bullet", blank line = new paragraph, "**bold**".
export function textToHtml(text, title = '') {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let body = '', list = false, para = [];
  const flush = () => { if (para.length) { body += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const closeList = () => { if (list) { body += '</ul>'; list = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) { flush(); closeList(); continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flush(); closeList(); body += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { flush(); if (!list) { body += '<ul>'; list = true; } body += `<li>${inline(m[1])}</li>`; continue; }
    closeList(); para.push(l);
  }
  flush(); closeList();
  if (!body) body = '<p></p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(title)}</title><style>
    @page { size: A4; margin: 18mm 16mm; } body { font: 11pt/1.5 "Segoe UI", Arial, sans-serif; color: #111; }
    h1 { font-size: 22pt; margin: 0 0 4pt; } h2 { font-size: 14pt; margin: 14pt 0 3pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; } h3 { font-size: 11.5pt; margin: 10pt 0 2pt; }
    p { margin: 0 0 6pt; } ul { margin: 0 0 6pt; padding-left: 16pt; } li { margin: 0 0 2pt; }</style></head><body>${body}</body></html>`;
}

// Formats that are zipped/binary: writing text into them makes a broken file, so they are refused instead of faked.
export const BINARY_DOCS = new Set(['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'zip', '7z', 'rar', 'png', 'jpg', 'jpeg', 'gif', 'mp3', 'mp4', 'exe']);
export const looksLikePdf = (buf) => Boolean(buf && buf.length > 200 && Buffer.from(buf.subarray(0, 5)).toString('latin1') === '%PDF-');
