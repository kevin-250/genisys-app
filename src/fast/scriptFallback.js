// Stage 9: the AI script fallback. Used only when no action fits. Small exact context in, ONE PowerShell code block out.

export function buildScriptMessages(command, context, example) {
  const ctx = Object.entries(context || {}).map(([k, v]) => `${k}:\n${v.map((p) => `  ${p}`).join('\n')}`).join('\n') || '(no matching paths found)';
  return [
    { role: 'system', content: 'You write ONE short Windows PowerShell script for a single PC task.\nRules: use ONLY paths listed in CONTEXT or the folders given; NEVER invent a path. Quote paths and use -LiteralPath. Start programs with Start-Process. Never use Invoke-Expression, never download and run, never edit the registry. Output exactly one ```powershell code block and nothing else. If a needed path or program is not in CONTEXT, output exactly: NOT_FOUND: <what is missing>' },
    { role: 'user', content: `${example ? `SIMILAR EXAMPLE (${example.name}):\n${example.prompt.slice(0, 700)}\n\n` : ''}CONTEXT:\n${ctx}\n\nCOMMAND: ${command}` },
  ];
}

// -> { script } | { notFound } | { error }.  Only text inside the code block is ever used.
export function extractScript(reply) {
  const text = String(reply ?? '');
  const nf = text.match(/^\s*NOT_FOUND:?\s*(.*)$/im);
  if (nf && !/```/.test(text)) return { notFound: nf[1].trim() || 'something needed' };
  const blocks = [...text.matchAll(/```(?:powershell|ps1|pwsh|ps)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if (blocks.length === 0) return { error: 'no code block in the reply' };
  if (blocks.length > 1) return { error: 'more than one code block' };
  const script = blocks[0][1].trim();
  return script ? { script } : { error: 'empty code block' };
}

// tiny non-crypto hash (works in the page and in tests)
export function hashScript(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
