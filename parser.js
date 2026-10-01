/* Agine Report: inventory sheet parser (header-name based) */
const AGP = (() => {
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const txt = v => (v == null ? '' : String(v)).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const num = v => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null || typeof v === 'boolean') return 0;
    const s = String(v).replace(/ /g, '').replace(/₹/g, '').replace(/,/g, '').trim();
    return s !== '' && !isNaN(+s) ? +s : 0;
  };
  const iso = v => {
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') { const m = v.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); if (!isNaN(d)) return d.toISOString().slice(0, 10); } }
    return null;
  };

  const UNITS = { S: 'Supplier', C: 'Customer Material – Not Lifted', '1': 'KSFC – Main Unit', '2': 'MTD Foundry', '3': 'Bambor (BMR)', '4': 'KUWADVA', '5': 'Asia Agro',
    '6': 'Agricon Zambia', '7': 'Kranti BMR', '8': 'Unit 4', '9': 'Galaxy BMR', '10': 'Ahmedabad Bavla', '11': 'Unit 5', '12': 'Visaman', '13': 'Mayur HDG', '14': 'KSFCIPL' };
  const UNIT_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', 'S', 'C'];
  const STATUS = { ST: 'Store', WS: 'Shop Floor (WIP)', QL: 'Quality', RJ: 'Rejection', HL: 'Hold' };

  // customer names: parent-group exact/contains rules, then item-name keywords
  const PARENT_CUST = [
    [/\bCAB\b|-CAB\b/, 'CAB'], [/EMERSON/, 'Emerson'], [/ATLAS COPCO - INDIA/, 'Atlas Copco India'], [/^GLOBAL\b|- GLOBAL$|^GLOBAL - /, 'Global'],
    [/^IWIS$/, 'IWIS'], [/^IDEX/, 'IDEX / Richter'], [/^BOSCH/, 'Bosch'], [/^MEGA$/, 'MEGA'], [/^SIGRA$/, 'SIGRA'], [/^NIF$/, 'NIF'], [/^ABEL$/, 'ABEL'],
    [/^TMTL$/, 'TMTL'], [/^KRANTI$/, 'Kranti'], [/^JUKI$/, 'JUKI'], [/^DELTA$/, 'Delta'], [/^ESA$/, 'ESA'], [/^KSD$/, 'KSD'], [/^TIRTH AGRO$/, 'Tirth Agro'],
    [/^E-BI$/, 'E-BI'], [/^MAYR$/, 'MAYR'], [/^KOEL$/, 'KOEL'], [/^LNT$/, 'L&T'], [/^AAL$/, 'AAL'], [/^ASHISH$/, 'Ashish'], [/^PBL$/, 'PBL'], [/^NVB$/, 'NVB'],
    [/^LIQUID METAL$/, 'Liquid Metal']
  ];
  const NAME_CUST = [
    [/\bEMLON\b/, 'Emlon'], [/\bEMERSON\b/, 'Emerson'], [/\bATLAS COPCO\b/, 'CAB'], [/\bIWIS\b/, 'IWIS'], [/\bMEGA\b/, 'MEGA'], [/\bSIGRA\b/, 'SIGRA'],
    [/\bCAB\b/, 'CAB'], [/["“]GLOBAL["”]|\bGLOBAL\b/, 'Global'], [/\bTMTL\b/, 'TMTL'], [/\bJUKI\b/, 'JUKI'], [/\bKSB\b/, 'KSB'], [/\bMASTA\b/, 'Masta Bearing']
  ];
  const INTERNAL = 'KSFCIPL – Internal';
  function customer(parent, name, unitCode, whName) {
    const p = txt(parent).toUpperCase();
    for (const [re, n] of PARENT_CUST) if (re.test(p)) return n;
    const nm = txt(name).toUpperCase();
    for (const [re, n] of NAME_CUST) if (re.test(nm)) return n;
    if (unitCode === 'C' && whName) return titleCase(whName);
    return INTERNAL;
  }
  const titleCase = s => txt(s).toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Pvt|Ltd|Llp)\b\.?/g, m => m.toUpperCase().replace('LLP', 'LLP'));

  const COLS = { pc: ['itemcode'], pd: ['itemname'], cat: ['itemgroup'], wh: ['warehouse', 'warehousecode', 'whscode'], whn: ['warehousename'],
    par: ['uparentitem', 'parentitem'], q: ['totalstockqty', 'stockqty', 'quantity', 'qty'], uc: ['unitcost'], v: ['totalstockvalue', 'stockvalue', 'value'],
    d: ['laststockindate', 'laststockin', 'materialdate'], age: ['stockagedays'] };
  function mapHeaders(h) {
    const n = h.map(norm), idx = {};
    for (const k in COLS) { idx[k] = -1; for (const w of COLS[k]) { const i = n.indexOf(w); if (i >= 0) { idx[k] = i; break; } } }
    return idx;
  }
  const findHeaderRow = rows => { for (let i = 0; i < Math.min(rows.length, 30); i++) if ((rows[i] || []).some(c => norm(c) === 'itemcode')) return i; return -1; };

  function parse(header, rows) {
    const I = mapHeaders(header);
    const miss = ['pc', 'wh', 'q', 'd'].filter(k => I[k] < 0);
    if (miss.length) return { error: 'Missing columns: ' + miss.map(k => COLS[k][0]).join(', '), recs: [], issues: {} };
    const g = (r, k) => (I[k] >= 0 ? r[I[k]] : '');
    const recs = [], seen = new Set(), issues = { duplicates: 0, noDate: 0, noQty: 0, noWh: 0, unknownWh: 0, skipped: 0 };
    for (const r of rows) {
      const pc = txt(g(r, 'pc'));
      if (!pc || /^total$/i.test(pc)) { issues.skipped++; continue; }
      const key = r.map(x => (x == null ? '' : String(x))).join('\u0001');
      if (seen.has(key)) { issues.duplicates++; continue; } seen.add(key);
      const wh = txt(g(r, 'wh')).toUpperCase(), whn = txt(g(r, 'whn'));
      const m = wh.match(/^(S|C|\d+)/), uc0 = m ? m[1] : '';
      let unit;
      if (!wh) { unit = 'Unknown warehouse'; issues.noWh++; }
      else if (UNITS[uc0]) unit = UNITS[uc0];
      else { unit = 'Unknown (' + (uc0 || wh) + ')'; issues.unknownWh++; }
      const typ = uc0 === 'S' ? 'At Supplier' : uc0 === 'C' ? 'Customer – Not Lifted' : (STATUS[wh.slice(uc0.length).replace(/\d+$/, '')] || 'Other');
      const d = iso(g(r, 'd')); if (!d) issues.noDate++;
      const q = num(g(r, 'q')); if (!q) issues.noQty++;
      const par = txt(g(r, 'par'));
      recs.push({ pc, pd: txt(g(r, 'pd')), cat: txt(g(r, 'cat')) || 'Not set', wh, whn: whn || '—', unit, uk: UNITS[uc0] ? uc0 : 'X',
        store: whn ? (wh + ' – ' + whn) : (wh || '—'), st: typ, sup: uc0 === 'S' ? (whn || wh) : '', par: par && par !== '0' ? par : '—',
        cust: customer(par === '0' ? '' : par, g(r, 'pd'), uc0, whn), q, uc: num(g(r, 'uc')), v: num(g(r, 'v')), d });
    }
    return { recs, issues, cols: I };
  }
  return { parse, mapHeaders, findHeaderRow, UNITS, UNIT_ORDER, norm, INTERNAL };
})();
if (typeof module !== 'undefined') module.exports = AGP;
