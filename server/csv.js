'use strict';
// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF. Returns header + row objects.
function parseCsv(text) {
  const records = [];
  let row = [], field = '', i = 0, q = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { q = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const nonEmpty = records.filter(r => r.some(c => c.trim() !== ''));
  const header = (nonEmpty.shift() || []).map(h => h.trim());
  const rows = nonEmpty.map(r => header.reduce((o, h, idx) => (o[h] = (r[idx] || '').trim(), o), {}));
  return { header, rows };
}
module.exports = { parseCsv };
