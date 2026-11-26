// Excel and ZIP downloads of a form's answers. Ported from StickyForms (src/routes/forms.js),
// with members (name, username) in place of personal-link recipients.
const fs = require('node:fs/promises');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { ZipArchive } = require('archiver');
const storage = require('./storage');
const { tally, answerText, parseJson } = require('./results');

function humanize(name) {
  const s = String(name).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// SQLite stores UTC; Excel has no time zones, so cells are shifted to Cebu time (UTC+8).
const cebuTime = (utc) => (utc ? new Date(new Date(`${String(utc).replace(' ', 'T')}Z`).getTime() + 8 * 3600000) : null);

// Windows-safe file/folder name.
function safeName(name, fallback = 'file', max = 80) {
  let n = String(name ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  return n.slice(0, max).trim() || fallback;
}

const exportName = (form) => `${(form.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'form')}-entries`;
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

// `fileCell(submission, field, value)` decides what a file cell shows.
function buildWorkbook(form, subs, fileCell) {
  const fields = parseJson(form.fields, []);
  // Answers to questions that were later removed from the form are kept as extra columns.
  const known = new Set(fields.map((f) => f.name));
  const extra = [...new Set(subs.flatMap((s) => Object.keys(s.data)))].filter((k) => !known.has(k));
  const columns = [
    ...fields.map((f) => ({ key: f.name, header: f.label || humanize(f.name), type: f.type, field: f })),
    ...extra.map((k) => ({ key: k, header: `${humanize(k)} (removed question)`, type: 'text' })),
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Images Camera Club';
  const ws = wb.addWorksheet('Entries', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Submitted at', key: '_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Member', key: '_name', width: 24 },
    { header: 'Username / email', key: '_who', width: 26 },
    ...columns.map((c, i) => ({ header: c.header, key: `f${i}`, width: Math.min(45, Math.max(14, c.header.length + 4, c.type === 'file' ? 30 : 0)) })),
    { header: 'Last edited', key: '_edited', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  ];
  for (const s of subs) {
    const row = { _at: cebuTime(s.submittedAt), _edited: cebuTime(s.editedAt), _name: s.memberName || '(removed member)', _who: s.memberLogin || '' };
    columns.forEach((c, i) => {
      const v = s.data[c.key];
      if (c.type === 'checkbox') row[`f${i}`] = v ? 'Yes' : 'No';
      else if (c.type === 'file') row[`f${i}`] = v?.fileId ? fileCell(s, c.field, v) : '';
      else if (c.type === 'poll' || c.type === 'ranking') row[`f${i}`] = answerText(c.field, v);
      else row[`f${i}`] = v ?? '';
    });
    const added = ws.addRow(row);
    columns.forEach((c, i) => {
      const cell = added.getCell(`f${i}`);
      if (c.type === 'file' && cell.value?.hyperlink) cell.font = { color: { argb: 'FF7A5222' }, underline: true };
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const results = Object.values(tally(fields, subs));
  if (results.length) {
    const rs = wb.addWorksheet('Poll results');
    rs.columns = [{ width: 40 }, { width: 16 }, { width: 16 }];
    for (const r of results) {
      rs.addRow([r.label, r.type === 'poll' ? 'Votes' : 'Average rank', r.type === 'poll' ? '% of responses' : '1st-place votes']).font = { bold: true };
      for (const o of r.options) {
        rs.addRow(r.type === 'poll' ? [o.option, o.count, o.percent / 100] : [o.option, o.averageRank ?? '', o.firstPlace]);
        if (r.type === 'poll') rs.lastRow.getCell(3).numFmt = '0%';
      }
      rs.addRow([`${r.responses} response${r.responses === 1 ? '' : 's'}`]).font = { italic: true, color: { argb: 'FF6E695D' } };
      rs.addRow([]);
    }
  }
  return wb;
}

async function sendWorkbook(res, form, subs, fileUrl) {
  const wb = buildWorkbook(form, subs, (s, f, v) => ({ text: v.name, hyperlink: fileUrl(v.fileId) }));
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${exportName(form)}-${today()}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

// ZIP: the workbook plus every uploaded file, one folder per upload question, each file named
// after the member who sent it (contest entries come out ready to judge).
async function sendZip(res, form, subs, fileRows) {
  const fields = parseJson(form.fields, []);
  const byId = new Map(fileRows.map((f) => [f.id, f]));
  const folderOf = {};
  const usedFolders = new Set();
  for (const f of fields.filter((x) => x.type === 'file')) {
    let name = safeName(f.label || humanize(f.name), f.name);
    for (let n = 2; usedFolders.has(name.toLowerCase()); n += 1) name = `${safeName(f.label || f.name)} (${n})`;
    usedFolders.add(name.toLowerCase());
    folderOf[f.name] = name;
  }

  const entries = [];
  const usedPaths = new Set();
  const placeFile = (s, f, v) => {
    const row = byId.get(v.fileId);
    const folder = folderOf[f.name];
    if (!row || !folder) return `${v.name} (file missing)`;
    const ext = path.extname(row.original_name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
    const base = safeName(`${s.memberName || 'member'} - ${path.basename(row.original_name, path.extname(row.original_name))}`, 'file', 150);
    let rel = `${folder}/${base}${ext}`;
    for (let n = 2; usedPaths.has(rel.toLowerCase()); n += 1) rel = `${folder}/${base} (${n})${ext}`;
    usedPaths.add(rel.toLowerCase());
    entries.push({ abs: storage.absolutePath(row.stored_path), name: rel });
    return { text: rel, hyperlink: rel.split('/').map(encodeURIComponent).join('/') };
  };

  const wb = buildWorkbook(form, subs, placeFile);
  const base = `${exportName(form)}-${today()}`;
  const present = [];
  for (const e of entries) {
    try { await fs.access(e.abs); present.push(e); } catch { /* missing from disk: skip */ }
  }

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${base}.zip"`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('warning', (err) => console.warn('zip warning:', err.message));
  zip.on('error', (err) => { console.error('zip error:', err); res.destroy(err); });
  zip.pipe(res);
  zip.append(Buffer.from(await wb.xlsx.writeBuffer()), { name: `${base}/${exportName(form)}.xlsx` });
  for (const e of present) zip.file(e.abs, { name: `${base}/${e.name}` });
  await zip.finalize();
}

module.exports = { sendWorkbook, sendZip, humanize };
