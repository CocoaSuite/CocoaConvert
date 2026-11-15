export type Cell = string | number | boolean | null;
export interface Table {
  columns: string[];
  rows: Cell[][];
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF, embedded newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function serializeDelimited(table: Table, delimiter: string): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /["\r\n]/.test(s) || s.includes(delimiter) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [table.columns.map(esc).join(delimiter), ...table.rows.map((r) => r.map(esc).join(delimiter))];
  return lines.join('\r\n') + '\r\n';
}

/** Header row plus data rows. Duplicate or empty headers get unique names. */
export function tableFromDelimited(text: string, delimiter: string): Table {
  const grid = parseDelimited(text, delimiter);
  if (!grid.length) return { columns: [], rows: [] };
  const width = Math.max(...grid.map((r) => r.length));
  const seen = new Map<string, number>();
  const columns = Array.from({ length: width }, (_, i) => {
    let name = (grid[0][i] ?? '').trim() || `column_${i + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n) name = `${name}_${n + 1}`;
    return name;
  });
  const rows = grid.slice(1).map((r) => columns.map((_, i) => r[i] ?? ''));
  return { columns, rows };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function flatten(value: unknown, prefix: string, out: Record<string, Cell>): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length && prefix) out[prefix] = '';
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value)) {
    if (value.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
      out[prefix || 'value'] = JSON.stringify(value);
    } else {
      value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    }
  } else {
    out[prefix || 'value'] = value === undefined ? null : (value as Cell);
  }
}

/** Turns JSON into a table: an array of records, a single record, or a wrapper holding one array. */
export function tableFromJson(data: unknown): Table {
  let records: unknown[];
  if (Array.isArray(data)) records = data;
  else if (isPlainObject(data)) {
    const arrays = Object.values(data).filter(Array.isArray);
    records = arrays.length === 1 && Object.keys(data).length === 1 ? (arrays[0] as unknown[]) : [data];
  } else records = [data];

  const columns: string[] = [];
  const index = new Map<string, number>();
  const flat = records.map((r) => {
    const o: Record<string, Cell> = {};
    flatten(r, '', o);
    for (const k of Object.keys(o)) {
      if (!index.has(k)) {
        index.set(k, columns.length);
        columns.push(k);
      }
    }
    return o;
  });
  return { columns, rows: flat.map((o) => columns.map((c) => (c in o ? o[c] : null))) };
}

/** Numbers and booleans come back as their JSON types; everything else stays text. */
export function inferCell(v: Cell): Cell {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return v;
}

export function recordsFromTable(table: Table): Record<string, Cell>[] {
  return table.rows.map((r) => Object.fromEntries(table.columns.map((c, i) => [c, inferCell(r[i])])));
}

export function sqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlValue(v: Cell): string {
  if (v === null || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function tableToSql(table: Table, tableName: string): string {
  const typed = table.rows.map((r) => r.map(inferCell));
  const types = table.columns.map((_, i) => {
    const vals = typed.map((r) => r[i]).filter((v) => v !== null);
    if (vals.length && vals.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'INTEGER';
    if (vals.length && vals.every((v) => typeof v === 'number')) return 'REAL';
    if (vals.length && vals.every((v) => typeof v === 'boolean')) return 'BOOLEAN';
    return 'TEXT';
  });
  const name = sqlIdentifier(tableName);
  const cols = table.columns.map(sqlIdentifier);
  const lines = [
    `CREATE TABLE ${name} (\n${cols.map((c, i) => `  ${c} ${types[i]}`).join(',\n')}\n);`,
    '',
    ...typed.map((r) => `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${r.map(sqlValue).join(', ')});`),
  ];
  return lines.join('\n') + '\n';
}

export function tableToMarkdown(table: Table): string {
  const esc = (v: Cell) => (v === null ? '' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const head = `| ${table.columns.map(esc).join(' | ')} |`;
  const rule = `| ${table.columns.map(() => '---').join(' | ')} |`;
  const body = table.rows.map((r) => `| ${r.map(esc).join(' | ')} |`);
  return [head, rule, ...body].join('\n') + '\n';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1c1c1c}
table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
pre,code{font-family:ui-monospace,Consolas,monospace}pre{background:#f4f4f2;padding:12px;overflow:auto}img{max-width:100%}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function tableToHtml(table: Table, title: string): string {
  const cell = (tag: string, v: Cell) => `<${tag}>${escapeHtml(v === null ? '' : String(v))}</${tag}>`;
  const thead = `<thead><tr>${table.columns.map((c) => cell('th', c)).join('')}</tr></thead>`;
  const tbody = `<tbody>\n${table.rows.map((r) => `<tr>${r.map((v) => cell('td', v)).join('')}</tr>`).join('\n')}\n</tbody>`;
  return htmlDocument(title, `<table>\n${thead}\n${tbody}\n</table>`);
}
