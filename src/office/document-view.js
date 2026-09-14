// Agent documents are untrusted. Build DOM nodes; never interpret HTML.
export function documentView(body, document = globalThis.document) {
  const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  function inline(node, value) {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
    let from = 0;
    for (const match of value.matchAll(pattern)) {
      node.append(document.createTextNode(value.slice(from, match.index))); const token = match[0];
      if (token.startsWith('`')) node.append(el('code', token.slice(1, -1)));
      else if (token.startsWith('**')) node.append(el('strong', token.slice(2, -2)));
      else {
        const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/); let url;
        try { url = new URL(href); } catch {}
        if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) { const a = el('a', label); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; node.append(a); }
        else node.append(document.createTextNode(label));
      }
      from = match.index + token.length;
    }
    node.append(document.createTextNode(value.slice(from)));
  }
  const root = el('div'); root.className = 'pw-document'; const lines = String(body).split('\n');
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (!line.trim()) continue;
    if (/^```/.test(line)) { const code = []; while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]); const pre = el('pre'); pre.append(el('code', code.join('\n'))); root.append(pre); continue; }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]) && cells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c))) {
      const wrap = el('div'); wrap.className = 'pw-table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Document table');
      const table = el('table'), head = el('thead'), tr = el('tr');
      for (const cell of cells(line)) { const th = el('th'); th.scope = 'col'; inline(th, cell); tr.append(th); } head.append(tr); table.append(head); const tbody = el('tbody'); i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) { const row = el('tr'); for (const cell of cells(lines[++i])) { const td = el('td'); inline(td, cell); row.append(td); } tbody.append(row); }
      table.append(tbody); wrap.append(table); root.append(wrap); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) { const h = el(heading[1].length === 1 ? 'h4' : 'h5'); inline(h, heading[2]); root.append(h); continue; }
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if (item) { const tag = /^\s*\d/.test(line) ? 'ol' : 'ul'; let list = root.lastElementChild; if (list?.tagName.toLowerCase() !== tag) { list = el(tag); root.append(list); } const li = el('li'); inline(li, item[1]); list.append(li); continue; }
    if (/^\s*---+\s*$/.test(line)) { root.append(el('hr')); continue; }
    const paragraph = el('p'); inline(paragraph, line); root.append(paragraph);
  }
  return root;
}
