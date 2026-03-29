/**
 * Life Advisor ? app.js
 * Vanilla ES6 SPA: all API calls go to the local Express backend.
 * Per-month savings model: income per month, expenses deducted, surplus button.
 */

'use strict';

/* -- State -------------------------------------------------- */
const state = {
  data:         { meta: {}, settings: { defaultCurrency: 'DZD' }, months: {}, items: [], savingsLedger: [], transactions: [] },
  summary:      { month: '', income: 0, totalCosts: 0, monthlySavings: 0, remaining: 0, surplusUsed: false, allTimeSavings: 0, defaultCurrency: 'DZD' },
  monthData:    null,
  savingsLedger:{ entries: [], totals: {}, defaultCurrency: 'DZD' },
  allMonths:    [],
  currentMonth: currentMonthYM(),
  filter:       { search: '' },
  editingId:    null,
  currentPage:  'dashboard',
  tutorialSeen: localStorage.getItem('tutorialSeen') === '1'
};

function currentMonthYM() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabelFE(ym) {
  if (!ym || !ym.includes('-')) return ym || '';
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/* -- Supabase client --------------------------------------- */
const SUPABASE_URL      = 'https://fwhdqmtktqndcwyqtaoy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3aGRxbXRrdHFuZGN3eXF0YW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzM0NjYsImV4cCI6MjA5MDMwOTQ2Nn0.omBvqsAqhSbxCGsJHSbd1r8cwEIw_Y6GfUFeNu5V52w';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -- DB helpers -------------------------------------------- */
function _newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function _dbRowToItem(r) {
  return {
    id: r.id, label: r.label, amount: parseFloat(r.amount) || 0,
    type: r.type || 'expense', date: r.date || null, month: r.month,
    category: r.category || '', notes: r.notes || '',
    currency: r.currency || 'DZD', createdAt: r.created_at,
    is_recurring: r.is_recurring || false,
    recur_every: r.recur_every ?? null, recur_unit: r.recur_unit ?? null,
    recur_end_type: r.recur_end_type ?? null,
    recur_duration_count: r.recur_duration_count ?? null,
    recur_duration_unit:  r.recur_duration_unit  ?? null,
    recur_end_date:       r.recur_end_date        ?? null,
  };
}
function _dbRowToLedger(r) {
  return {
    id: r.id, itemId: r.item_id || null,
    amount: parseFloat(r.amount) || 0, currency: r.currency || 'DZD',
    date: r.date || null, month: r.month || null,
    source: r.source, label: r.label || '',
  };
}
async function _readData() {
  const [
    { data: sRow, error: se },
    { data: mRows, error: me },
    { data: iRows, error: ie },
    { data: lRows, error: le },
  ] = await Promise.all([
    _sb.from('settings').select('*').eq('id', 'default').maybeSingle(),
    _sb.from('months').select('*'),
    _sb.from('items').select('*').order('created_at', { ascending: true }),
    _sb.from('savings_ledger').select('*'),
  ]);
  if (se || me || ie || le) throw new Error((se || me || ie || le).message);
  const months = {};
  for (const r of (mRows || [])) months[r.ym] = { income: parseFloat(r.income) || 0 };
  return {
    meta: { lastModified: new Date().toISOString() },
    settings: { defaultCurrency: sRow?.default_currency || 'DZD' },
    months,
    items:         (iRows || []).map(_dbRowToItem),
    savingsLedger: (lRows || []).map(_dbRowToLedger),
    transactions: [],
  };
}
function _computeMonthSummary(data, month) {
  const dc  = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const inc = Number(data.months?.[month]?.income) || 0;
  let totalCosts = 0, extraIncome = 0, monthlySavingsAmt = 0;
  for (const item of (data.items || [])) {
    const occ = _recurOccurrencesInMonth(item, month);
    if (!occ) continue;
    const amt = (Number(item.amount) || 0) * occ;
    if ((item.type || 'expense') === 'income') extraIncome += amt;
    else {
      totalCosts += amt;
      if ((item.category || '').toLowerCase().trim() === 'monthly savings') monthlySavingsAmt += amt;
    }
  }
  const remaining   = inc + extraIncome - totalCosts;
  const surplusUsed = (data.savingsLedger || []).some(e => e.month === month && e.source === 'surplus');
  return { month, income: inc, extraIncome, totalCosts, monthlySavings: monthlySavingsAmt, remaining, surplusUsed, currency: dc };
}
function _computeAllTimeSavings(data) {
  const dc = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const byCurrency = {};
  for (const e of (data.savingsLedger || [])) {
    const cur = (e.currency || dc).toUpperCase();
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(e.amount) || 0);
  }
  return { byCurrency, defaultCurrency: dc, total: byCurrency[dc] || 0 };
}

/* -- api object (calls Supabase directly) ------------------- */
const api = {
  getData:    async ()        => _readData(),
  getSummary: async (month)   => {
    const data = await _readData();
    const m    = month || currentMonthYM();
    const ms   = _computeMonthSummary(data, m);
    const ats  = _computeAllTimeSavings(data);
    const dc   = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    return { ...ms, allTimeSavings: ats.total, allTimeByCurrency: ats.byCurrency, defaultCurrency: dc };
  },
  postData: async (d) => {
    const dc = d.settings?.defaultCurrency || 'DZD';
    await Promise.all([
      _sb.from('savings_ledger').delete().neq('id', ''),
      _sb.from('items').delete().neq('id', ''),
      _sb.from('months').delete().neq('ym', ''),
    ]);
    await _sb.from('settings').upsert({ id: 'default', default_currency: dc });
    const mIns = Object.entries(d.months || {}).map(([ym, v]) => ({ ym, income: Number(v.income) || 0 }));
    if (mIns.length) await _sb.from('months').insert(mIns);
    const iIns = (d.items || []).map(i => ({
      id: i.id, label: i.label, amount: Number(i.amount) || 0,
      type: i.type || 'expense', date: i.date || null, month: i.month,
      category: i.category || '', notes: i.notes || '',
      currency: i.currency || dc, created_at: i.createdAt || new Date().toISOString(),
      is_recurring: i.is_recurring || false,
      recur_every: i.recur_every || null, recur_unit: i.recur_unit || null,
      recur_end_type: i.recur_end_type || null,
      recur_duration_count: i.recur_duration_count || null,
      recur_duration_unit:  i.recur_duration_unit  || null,
      recur_end_date:       i.recur_end_date        || null,
    }));
    if (iIns.length) await _sb.from('items').insert(iIns);
    const lIns = (d.savingsLedger || []).map(e => ({
      id: e.id, item_id: e.itemId || null, amount: Number(e.amount) || 0,
      currency: e.currency || dc, date: e.date || null, month: e.month || null,
      source: e.source, label: e.label || '',
    }));
    if (lIns.length) await _sb.from('savings_ledger').insert(lIns);
    return _readData();
  },
  addItem: async (item) => {
    const { data: sRow } = await _sb.from('settings').select('default_currency').eq('id', 'default').maybeSingle();
    const dc    = sRow?.default_currency || 'DZD';
    const month = item.month || (item.date || '').slice(0, 7) || currentMonthYM();
    const isRec = item.is_recurring === true || item.is_recurring === 'true';
    const eType = isRec ? (item.recur_end_type || 'ongoing') : null;
    const row   = {
      id: _newId(), label: String(item.label).trim(), amount: Number(item.amount),
      type: item.type === 'income' ? 'income' : 'expense',
      date: item.date || new Date().toISOString().slice(0, 10), month,
      category: item.category ? String(item.category).trim() : '',
      notes:    item.notes    ? String(item.notes).trim()    : '',
      currency: item.currency ? String(item.currency).trim().toUpperCase() : dc,
      created_at: new Date().toISOString(), is_recurring: isRec,
      recur_every: isRec ? (parseInt(item.recur_every) || 1)       : null,
      recur_unit:  isRec ? (item.recur_unit  || 'month')            : null,
      recur_end_type: eType,
      recur_duration_count: (isRec && eType === 'duration') ? (parseInt(item.recur_duration_count) || null) : null,
      recur_duration_unit:  (isRec && eType === 'duration') ? (item.recur_duration_unit  || null)           : null,
      recur_end_date:       (isRec && eType === 'date')     ? (item.recur_end_date        || null)           : null,
    };
    const { error } = await _sb.from('items').insert(row);
    if (error) throw new Error(error.message);
    await _sb.from('months').upsert({ ym: month, income: 0 }, { onConflict: 'ym', ignoreDuplicates: true });
    if (!isRec && row.category.toLowerCase().trim() === 'monthly savings' && row.type === 'expense') {
      await _sb.from('savings_ledger').insert({
        id: _newId(), item_id: row.id, amount: row.amount, currency: row.currency,
        date: row.date, month: row.month, source: 'savings', label: row.label,
      });
    }
    return _dbRowToItem(row);
  },
  updateItem: async (id, item) => {
    const { data: old, error: fe } = await _sb.from('items').select('*').eq('id', id).maybeSingle();
    if (fe || !old) throw new Error('Item not found');
    const { data: sRow } = await _sb.from('settings').select('default_currency').eq('id', 'default').maybeSingle();
    const dc    = sRow?.default_currency || 'DZD';
    const month = item.month || (item.date || old.date || '').slice(0, 7) || old.month || currentMonthYM();
    const isRec = item.is_recurring === true || item.is_recurring === 'true'
               || (item.is_recurring === undefined && Boolean(old.is_recurring));
    const eType = item.recur_end_type || (isRec ? (old.recur_end_type || 'ongoing') : null);
    const upd   = {
      label:    String((item.label    ?? old.label)    || '').trim(),
      amount:   Number (item.amount   ?? old.amount),
      type:    ((item.type    ?? old.type)    === 'income' ? 'income' : 'expense'),
      date:     item.date    ?? old.date    ?? null,
      month,
      category: String((item.category ?? old.category) || '').trim(),
      notes:    String((item.notes    ?? old.notes)    || '').trim(),
      currency: String((item.currency ?? old.currency) || dc).toUpperCase(),
      updated_at: new Date().toISOString(), is_recurring: isRec,
      recur_every: isRec ? (parseInt(item.recur_every ?? old.recur_every) || 1)                            : null,
      recur_unit:  isRec ? (item.recur_unit  || old.recur_unit  || 'month')                                : null,
      recur_end_type: isRec ? eType : null,
      recur_duration_count: (isRec && eType === 'duration') ? (parseInt(item.recur_duration_count ?? old.recur_duration_count) || null) : null,
      recur_duration_unit:  (isRec && eType === 'duration') ? (item.recur_duration_unit  || old.recur_duration_unit  || null)           : null,
      recur_end_date:       (isRec && eType === 'date')     ? (item.recur_end_date        || old.recur_end_date        || null)           : null,
    };
    const { error } = await _sb.from('items').update(upd).eq('id', id);
    if (error) throw new Error(error.message);
    await _sb.from('savings_ledger').delete().eq('item_id', id);
    if (!isRec && upd.category.toLowerCase().trim() === 'monthly savings' && upd.type === 'expense') {
      await _sb.from('savings_ledger').insert({
        id: _newId(), item_id: id, amount: upd.amount, currency: upd.currency,
        date: upd.date, month: upd.month, source: 'savings', label: upd.label,
      });
    }
    return { id, ..._dbRowToItem(old), ...upd };
  },
  deleteItem: async (id) => {
    await _sb.from('savings_ledger').delete().eq('item_id', id);
    const { error } = await _sb.from('items').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { success: true };
  },
  saveSettings: async (b) => {
    if (b.defaultCurrency !== undefined) {
      const cur = String(b.defaultCurrency).trim().toUpperCase();
      const { error } = await _sb.from('settings').upsert({ id: 'default', default_currency: cur }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    const { data: row } = await _sb.from('settings').select('*').eq('id', 'default').maybeSingle();
    return { defaultCurrency: row?.default_currency || 'DZD' };
  },
  backup: async () => {
    const data = await _readData();
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `life-advisor-${ts}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { file: name };
  },
  getBackups: async () => [],
  getMonths: async () => {
    const { data: mRows } = await _sb.from('months').select('*');
    const { data: iRows } = await _sb.from('items').select('month');
    const set = new Set((mRows || []).map(r => r.ym));
    for (const r of (iRows || [])) if (r.month) set.add(r.month);
    return [...set].sort().reverse().map(ym => {
      const r = (mRows || []).find(r => r.ym === ym);
      return { ym, label: monthLabelFE(ym), income: parseFloat(r?.income) || 0 };
    });
  },
  getMonth: async (m) => {
    const data    = await _readData();
    const summary = _computeMonthSummary(data, m);
    const items   = (data.items || [])
      .map(i => { const occ = _recurOccurrencesInMonth(i, m); return occ > 0 ? { ...i, _occurrences: occ } : null; })
      .filter(Boolean);
    return { ...summary, items, label: monthLabelFE(m) };
  },
  setMonthIncome: async (m, income) => {
    const { error } = await _sb.from('months').upsert({ ym: m, income }, { onConflict: 'ym' });
    if (error) throw new Error(error.message);
    return { month: m, income };
  },
  addSurplus: async (m, date) => {
    const { data: ex } = await _sb.from('savings_ledger').select('id').eq('month', m).eq('source', 'surplus').maybeSingle();
    if (ex) throw new Error('Surplus already added for this month');
    const data = await _readData();
    const ms   = _computeMonthSummary(data, m);
    if (ms.remaining <= 0) throw new Error('No positive remaining balance to add');
    const dc = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const entry = {
      id: _newId(), item_id: null, amount: ms.remaining, currency: dc,
      date: date || new Date().toISOString().slice(0, 10),
      month: m, source: 'surplus', label: `Salary surplus — ${monthLabelFE(m)}`,
    };
    const { error } = await _sb.from('savings_ledger').insert(entry);
    if (error) throw new Error(error.message);
    return _dbRowToLedger(entry);
  },
  getLedger: async () => {
    const { data: sRow } = await _sb.from('settings').select('*').eq('id', 'default').maybeSingle();
    const { data: rows, error } = await _sb.from('savings_ledger').select('*').order('date', { ascending: false });
    if (error) throw new Error(error.message);
    const dc = sRow?.default_currency || 'DZD';
    const entries = (rows || []).map(_dbRowToLedger);
    const byCurrency = {};
    for (const e of entries) {
      const cur = (e.currency || dc).toUpperCase();
      byCurrency[cur] = (byCurrency[cur] || 0) + e.amount;
    }
    return { entries, totals: byCurrency, defaultCurrency: dc };
  },
  deleteLedgerEntry: async (id) => {
    const { data: e, error: fe } = await _sb.from('savings_ledger').select('*').eq('id', id).maybeSingle();
    if (fe || !e) throw new Error('Entry not found');
    if (e.source !== 'surplus') throw new Error('Only surplus entries can be deleted here.');
    const { error } = await _sb.from('savings_ledger').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { success: true };
  },
};

/* -- Currency formatter ------------------------------------- */
function fmt(n, currency = '') {
  const abs = Math.abs(Number(n) || 0);
  const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = ((n < 0) ? '-' : '') + str;
  return currency ? `${num} ${currency}` : num;
}
function fmtShort(n, currency = '') {
  const v = Number(n) || 0;
  let str;
  if (Math.abs(v) >= 1_000_000) str = (v / 1_000_000).toFixed(1) + 'M';
  else if (Math.abs(v) >= 1000) str = (v / 1000).toFixed(1) + 'k';
  else                          str = v.toLocaleString();
  return currency ? `${str} ${currency}` : str;
}

/* -- Recurrence helpers ------------------------------------- */
function addDurationFE(date, count, unit) {
  const d = new Date(date);
  if      (unit === 'day')   d.setDate(d.getDate() + count);
  else if (unit === 'week')  d.setDate(d.getDate() + count * 7);
  else if (unit === 'month') d.setMonth(d.getMonth() + count);
  else if (unit === 'year')  d.setFullYear(d.getFullYear() + count);
  return d;
}

function _recurOccurrencesInMonth(item, ym) {
  if (!item.is_recurring) return item.month === ym ? 1 : 0;
  if (!item.date) return item.month === ym ? 1 : 0;
  const [yr, mo] = ym.split('-').map(Number);
  const monthStart = new Date(yr, mo - 1, 1);
  const monthEnd   = new Date(yr, mo, 0, 23, 59, 59, 999);
  const startDate  = new Date(item.date);
  if (startDate > monthEnd) return 0;
  let recurEnd = null;
  if (item.recur_end_type === 'date' && item.recur_end_date) {
    const d = new Date(item.recur_end_date); d.setHours(23, 59, 59, 999); recurEnd = d;
  } else if (item.recur_end_type === 'duration' && item.recur_duration_count && item.recur_duration_unit) {
    recurEnd = new Date(addDurationFE(new Date(startDate), item.recur_duration_count, item.recur_duration_unit).getTime() - 1);
  }
  if (recurEnd && recurEnd < monthStart) return 0;
  const every = item.recur_every || 1;
  const unit  = item.recur_unit  || 'month';
  let current = new Date(startDate);
  if (current < monthStart) {
    if      (unit === 'day')  { const s = Math.floor((monthStart - current) / (every * 86400000));     if (s > 0) current = addDurationFE(current, s * every, 'day'); }
    else if (unit === 'week') { const s = Math.floor((monthStart - current) / (every * 7 * 86400000)); if (s > 0) current = addDurationFE(current, s * every, 'week'); }
  }
  let count = 0;
  for (let i = 0; i < 500 && current <= monthEnd; i++) {
    if (current >= monthStart && (!recurEnd || current <= recurEnd)) count++;
    current = addDurationFE(current, every, unit);
  }
  return count;
}

function describeRecurrence(item) {
  if (!item.is_recurring) return null;
  const ev  = item.recur_every || 1;
  const u   = item.recur_unit  || 'month';
  const uN  = { day: 'day', week: 'week', month: 'month', year: 'year' };
  const un  = uN[u] || u;
  let str   = ev === 1 ? `Every ${un}` : `Every ${ev} ${un}s`;
  const et  = item.recur_end_type || 'ongoing';
  if (et === 'duration' && item.recur_duration_count) {
    const dc  = item.recur_duration_count;
    const du  = item.recur_duration_unit || 'month';
    const dun = uN[du] || du;
    str += ` · for ${dc} ${dc === 1 ? dun : dun + 's'}`;
  } else if (et === 'date' && item.recur_end_date) {
    str += ` · until ${item.recur_end_date}`;
  } else {
    str += ' · ongoing';
  }
  return str;
}

/* -- Toast -------------------------------------------------- */
function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove());
  }, duration);
}

/* -- Navigation --------------------------------------------- */
function navigate(pageId, historyPush = true) {
  document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#sidebar nav ul li').forEach(li => li.classList.remove('active'));

  const view = document.getElementById(`page-${pageId}`);
  if (view) view.classList.add('active');

  const navItem = document.querySelector(`[data-page="${pageId}"]`);
  if (navItem) navItem.closest('li').classList.add('active');

  const titles = {
    dashboard:      '?? Dashboard',
    guides:         '?? Life Guides ? Overview',
    algeria:        '???? Algeria Papers & Work Abroad',
    military:       '?? Military Exemption Guide',
    ecommerce:      '?? E-Commerce Mastery 2026',
    'ai-creatives': '?? Free AI Tools for Creatives',
    coding:         '?? AI/ML Coding Roadmap',
    savings:        '?? Savings & Monthly Costs',
    tools:          '?? Tools',
    settings:       '?? Settings'
  };
  document.getElementById('page-title').textContent = titles[pageId] || pageId;

  state.currentPage = pageId;
  closeSidebar();

  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'savings')   renderSavingsPage();
  if (pageId === 'settings')  renderSettingsPage();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

/* -- Load all data ------------------------------------------ */
async function loadData() {
  try {
    const cm = state.currentMonth;
    const [dataRes, summaryRes, monthRes, ledgerRes, monthsRes] = await Promise.all([
      api.getData(),
      api.getSummary(cm),
      api.getMonth(cm).catch(() => ({ income: 0, totalCosts: 0, monthlySavings: 0, remaining: 0, surplusUsed: false, items: [], label: monthLabelFE(cm) })),
      api.getLedger().catch(() => ({ entries: [], totals: {}, defaultCurrency: 'DZD' })),
      api.getMonths().catch(() => [])
    ]);
    state.data          = dataRes;
    state.summary       = summaryRes;
    state.monthData     = monthRes;
    state.savingsLedger = ledgerRes;
    state.allMonths     = monthsRes;
    if (!state.allMonths.find(m => m.ym === cm)) {
      state.allMonths.unshift({ ym: cm, label: monthLabelFE(cm), income: 0 });
    }
  } catch (e) {
    toast('Could not load data. Check your connection or Supabase config.', 'error', 5000);
    console.error(e);
  }
}

/* -- Load a specific month ---------------------------------- */
async function loadMonthData(ym) {
  try {
    const [monthRes, ledgerRes, summaryRes] = await Promise.all([
      api.getMonth(ym),
      api.getLedger(),
      api.getSummary(ym)
    ]);
    state.monthData     = monthRes;
    state.savingsLedger = ledgerRes;
    state.summary       = summaryRes;
    if (!state.allMonths.find(m => m.ym === ym)) {
      const fresh = await api.getMonths().catch(() => state.allMonths);
      state.allMonths = fresh;
      if (!state.allMonths.find(m => m.ym === ym)) {
        state.allMonths.unshift({ ym, label: monthLabelFE(ym), income: 0 });
      }
    }
  } catch (e) {
    toast('Error loading month: ' + e.message, 'error');
  }
}

/* -- Dashboard ---------------------------------------------- */
function renderDashboard() {
  const s  = state.summary;
  const dc = s.defaultCurrency || state.data?.settings?.defaultCurrency || 'DZD';
  const remainingColor = (s.remaining >= 0) ? 'var(--success)' : 'var(--danger)';

  document.getElementById('dash-income').textContent   = fmtShort(s.income, dc);
  document.getElementById('dash-costs').textContent    = fmtShort(s.totalCosts, dc);
  document.getElementById('dash-savings').textContent  = fmtShort(s.monthlySavings, dc);
  document.getElementById('dash-surplus').textContent  = (s.remaining >= 0 ? '+' : '') + fmtShort(s.remaining, dc);
  document.getElementById('dash-alltime').textContent  = fmtShort(s.allTimeSavings, dc);
  document.getElementById('dash-surplus-card').style.borderLeftColor = remainingColor;
  document.getElementById('dash-surplus').style.color = remainingColor;

  const maxVal = Math.max(s.income, s.totalCosts, s.monthlySavings, 1);
  document.getElementById('bar-income').style.width   = (s.income / maxVal * 100) + '%';
  document.getElementById('bar-costs').style.width    = (s.totalCosts / maxVal * 100) + '%';
  document.getElementById('bar-savings').style.width  = (s.monthlySavings / maxVal * 100) + '%';
  document.getElementById('bar-surplus').style.width  = (Math.max(0, s.remaining) / maxVal * 100) + '%';
  document.getElementById('bar-income-lbl').textContent   = fmt(s.income, dc);
  document.getElementById('bar-costs-lbl').textContent    = fmt(s.totalCosts, dc);
  document.getElementById('bar-savings-lbl').textContent  = fmt(s.monthlySavings, dc);
  document.getElementById('bar-surplus-lbl').textContent  = (s.remaining >= 0 ? '+' : '') + fmt(s.remaining, dc);

  const recent = [...(state.data.items || [])].reverse().slice(0, 5);
  const tbody  = document.getElementById('dash-recent-tbody');
  tbody.innerHTML = recent.length
    ? recent.map(item => `
        <tr>
          <td>${escHtml(item.label)}</td>
          <td><span class="category-badge">${escHtml(item.category || '\u2014')}</span></td>
          <td class="text-right" style="color:var(--danger);font-weight:600">
            ${fmt(item.amount)} <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">${escHtml(item.currency || dc)}</span>
          </td>
          <td class="text-muted" style="font-size:.82rem">${item.date || ''}</td>
        </tr>`)
      .join('')
    : `<tr><td colspan="4" class="items-empty">No expenses yet — add some in Savings &amp; Monthly Costs</td></tr>`;
}

/* ----------------------------------------------------------
   SAVINGS PAGE ? Per-Month Model
---------------------------------------------------------- */

async function renderSavingsPage() {
  await loadMonthData(state.currentMonth);
  _renderMonthSelector();
  _renderMonthStats();
  _renderSurplusPanel();
  _renderItemsTable();
  _renderSavingsLedger();
}

function _renderMonthSelector() {
  const ym = state.currentMonth;
  document.getElementById('month-label').textContent = monthLabelFE(ym);
  document.getElementById('items-month-label').textContent = monthLabelFE(ym);
  document.getElementById('income-currency-label').textContent =
    state.data?.settings?.defaultCurrency || 'DZD';

  const sel    = document.getElementById('month-select');
  const months = [...state.allMonths];
  if (!months.find(m => m.ym === ym)) months.unshift({ ym, label: monthLabelFE(ym) });
  months.sort((a, b) => b.ym.localeCompare(a.ym));
  sel.innerHTML = months.map(m =>
    `<option value="${m.ym}"${m.ym === ym ? ' selected' : ''}>${m.label || monthLabelFE(m.ym)}</option>`
  ).join('');
}

function _renderMonthStats() {
  const md = state.monthData || {};
  const dc = state.data?.settings?.defaultCurrency || 'DZD';

  document.getElementById('income-input').value             = md.income || 0;
  document.getElementById('sav-income-val').textContent     = fmt(md.income || 0, dc);
  document.getElementById('sav-extra-val').textContent      = fmt(md.extraIncome || 0, dc);
  document.getElementById('sav-costs-val').textContent      = fmt(md.totalCosts || 0, dc);
  document.getElementById('sav-savings-val').textContent    = fmt(md.monthlySavings || 0, dc);

  const remaining = md.remaining ?? 0;
  const remEl     = document.getElementById('sav-remaining-val');
  remEl.textContent = (remaining >= 0 ? '' : '-') + fmt(Math.abs(remaining), dc);
  remEl.style.color = remaining >= 0 ? 'var(--success)' : 'var(--danger)';

  const noteEl = document.getElementById('sav-remaining-note');
  if (remaining < 0) { noteEl.textContent = '\u26A0 over budget!'; noteEl.style.color = 'var(--danger)'; }
  else               { noteEl.textContent = 'income + extra \u2212 expenses'; noteEl.style.color = ''; }
}

function _renderSurplusPanel() {
  const md        = state.monthData || {};
  const dc        = state.data?.settings?.defaultCurrency || 'DZD';
  const panel     = document.getElementById('surplus-panel');
  const remaining = md.remaining ?? 0;
  if (remaining > 0 && !md.surplusUsed) {
    panel.style.display = 'block';
    document.getElementById('surplus-amount-lbl').textContent = fmt(remaining, dc);
    document.getElementById('surplus-month-lbl').textContent  = monthLabelFE(state.currentMonth);
  } else {
    panel.style.display = 'none';
  }
}

function _renderItemsTable() {
  const dc     = state.data?.settings?.defaultCurrency || 'DZD';
  const search = (state.filter.search || '').toLowerCase().trim();
  let items    = (state.monthData?.items || []);

  if (search) items = items.filter(i =>
    i.label.toLowerCase().includes(search) ||
    (i.category || '').toLowerCase().includes(search)
  );

  const tbody = document.getElementById('items-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="items-empty">No items for ${monthLabelFE(state.currentMonth)} yet. Click <strong>+ Add Item</strong> to begin.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => {
    const isIncome   = (item.type || 'expense') === 'income';
    const isSaving   = !isIncome && (item.category || '').toLowerCase() === 'monthly savings';
    const isRecurring = Boolean(item.is_recurring);
    const occ        = item._occurrences || 1;
    const rowStyle   = isIncome ? 'background:rgba(16,185,129,.06)' : isSaving ? 'background:rgba(16,185,129,.04)' : '';
    const amtColor   = isIncome ? 'var(--success)' : 'var(--danger)';
    const amtPrefix  = isIncome ? '+' : '';
    const catBadge   = isIncome
      ? `<span class="category-badge" style="background:rgba(16,185,129,.15);color:var(--success);border-color:rgba(16,185,129,.3)">&#43; extra income</span>`
      : isSaving
        ? `<span class="category-badge savings-cat">&#x2713; monthly savings</span>`
        : `<span class="category-badge">${escHtml(item.category || '\u2014')}</span>`;
    const recurDesc  = isRecurring ? describeRecurrence(item) : '';
    const recurBadge = isRecurring
      ? `<span class="category-badge" style="background:rgba(99,102,241,.1);color:var(--accent);border-color:rgba(99,102,241,.3);display:block;margin-top:3px;font-size:.7rem;white-space:nowrap" title="${escHtml(recurDesc)}">&#x1F501; ${escHtml(recurDesc)}</span>`
      : '';
    const amtDisplay = isRecurring && occ > 1
      ? `${amtPrefix}${fmt(item.amount)} <span style="font-size:.75rem;color:var(--text-muted);font-weight:400">&times;${occ} = ${fmt(item.amount * occ)} ${escHtml(item.currency || dc)}</span>`
      : `${amtPrefix}${fmt(item.amount)} <span style="font-size:.75rem;color:var(--text-muted);font-weight:400">${escHtml(item.currency || dc)}</span>`;
    return `
      <tr data-id="${item.id}" style="${rowStyle}">
        <td style="font-weight:${(isSaving || isIncome) ? '600' : '400'}">${escHtml(item.label)}</td>
        <td style="font-weight:600;color:${amtColor}">${amtDisplay}</td>
        <td>${catBadge}${recurBadge}</td>
        <td class="text-muted" style="font-size:.83rem">${item.date || ''}</td>
        <td>
          <button class="btn-icon" title="Edit"   onclick="openEditItem('${item.id}')">&#9998;</button>
          <button class="btn-icon" title="Delete" onclick="confirmDeleteItem('${item.id}')">&#128465;</button>
        </td>
      </tr>`;
  }).join('');
}

function _renderSavingsLedger() {
  const ledger  = state.savingsLedger || { entries: [], totals: {}, defaultCurrency: 'DZD' };
  const dc      = ledger.defaultCurrency || state.data?.settings?.defaultCurrency || 'DZD';
  const totals  = ledger.totals || {};
  const entries = ledger.entries || [];

  const totalsEl = document.getElementById('alltime-totals-row');
  if (Object.keys(totals).length === 0) {
    totalsEl.innerHTML = `<div class="stat-card alltime"><div class="stat-label">All-Time Savings</div><div class="stat-value">0.00 ${dc}</div></div>`;
  } else {
    totalsEl.innerHTML = Object.entries(totals).map(([cur, amt]) =>
      `<div class="stat-card alltime"><div class="stat-label">All-Time Savings</div><div class="stat-value">${fmt(amt, cur)}</div></div>`
    ).join('');
  }

  const tbody = document.getElementById('ledger-tbody');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="items-empty">No savings history yet. Add an expense categorised "monthly savings" or press the surplus button.</td></tr>`;
    return;
  }
  tbody.innerHTML = entries.map(e => {
    const isSurplus = e.source === 'surplus';
    const badge     = isSurplus
      ? `<span class="source-badge surplus">surplus</span>`
      : `<span class="source-badge savings">savings</span>`;
    const deleteBtn = isSurplus
      ? `<button class="btn-icon btn-icon-danger" title="Remove surplus entry" onclick="deleteLedgerEntry('${e.id}')">&#128465;</button>`
      : `<span style="font-size:.72rem;color:var(--text-muted)">—</span>`;
    return `
      <tr>
        <td class="text-muted" style="font-size:.83rem">${e.date || ''}</td>
        <td class="text-muted" style="font-size:.83rem">${monthLabelFE(e.month) || e.month || ''}</td>
        <td>${badge}</td>
        <td>${escHtml(e.label || '\u2014')}</td>
        <td style="font-weight:600;color:var(--success)">${fmt(e.amount)} <span style="font-size:.75rem;color:var(--text-muted);font-weight:400">${escHtml(e.currency || dc)}</span></td>
        <td>${deleteBtn}</td>
      </tr>`;
  }).join('');
}

/* -- Month navigation --------------------------------------- */
async function changeMonth(dir) {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d      = new Date(y, m - 1 + dir, 1);
  const newYm  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  await selectMonth(newYm);
}

async function selectMonth(ym) {
  if (ym === state.currentMonth) return;
  state.currentMonth  = ym;
  state.filter.search = '';
  const searchEl = document.getElementById('filter-search');
  if (searchEl) searchEl.value = '';
  await renderSavingsPage();
}

async function goToCurrentMonth() {
  await selectMonth(currentMonthYM());
}

/* -- Save income for current month ------------------------- */
async function saveIncome() {
  const val = parseFloat(document.getElementById('income-input').value);
  if (isNaN(val) || val < 0) { toast('Invalid income value', 'error'); return; }
  try {
    await api.setMonthIncome(state.currentMonth, val);
    toast('Income saved for ' + monthLabelFE(state.currentMonth), 'success');
    await renderSavingsPage();
    if (state.currentPage === 'dashboard') renderDashboard();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

/* -- Add surplus to all-time savings ----------------------- */
async function addSurplusToSavings() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await api.addSurplus(state.currentMonth, today);
    toast('Surplus added to All-Time Savings! ??', 'success', 4000);
    await renderSavingsPage();
    if (state.currentPage === 'dashboard') {
      state.summary = await api.getSummary(state.currentMonth);
      renderDashboard();
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

/* -- Delete a ledger entry (surplus only) ------------------ */
async function deleteLedgerEntry(id) {
  if (!confirm('Remove this surplus entry from savings history?')) return;
  try {
    await api.deleteLedgerEntry(id);
    toast('Entry removed', 'info');
    await renderSavingsPage();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

/* -- Filter ------------------------------------------------- */
function applyFilter() {
  const el = document.getElementById('filter-search');
  state.filter.search = el ? el.value : '';
  _renderItemsTable();
}

/* ----------------------------------------------------------
   ADD / EDIT ITEM MODAL
---------------------------------------------------------- */

function setItemType(type) {
  const isIncome = type === 'income';
  document.getElementById('item-type').value = type;
  document.getElementById('type-btn-expense').className = 'type-toggle type-toggle-expense' + (isIncome ? '' : ' type-toggle-active');
  document.getElementById('type-btn-income').className  = 'type-toggle type-toggle-income'  + (isIncome ? ' type-toggle-active' : '');
  const editing = state.editingId;
  document.getElementById('item-modal-title').textContent =
    editing ? (isIncome ? 'Edit Income Entry' : 'Edit Expense')
            : (isIncome ? 'Add Extra Income'  : 'Add Expense');
  document.getElementById('item-submit-btn').textContent = isIncome ? 'Save Income Entry' : 'Save Expense';
  const hint = document.getElementById('savings-hint');
  if (hint) hint.style.display = isIncome ? 'none' : '';
  const catGroup = document.getElementById('category-group');
  if (catGroup) catGroup.style.display = isIncome ? 'none' : '';
  const recurSection = document.getElementById('recur-section');
  if (recurSection) {
    recurSection.style.display = isIncome ? 'none' : '';
    if (isIncome) setRecurring(false);
  }
}

function setRecurring(on) {
  document.getElementById('item-is-recurring').value      = on ? 'true' : 'false';
  document.getElementById('recur-btn-once').className      = 'type-toggle type-toggle-expense' + (!on ? ' type-toggle-active' : '');
  document.getElementById('recur-btn-recurring').className = 'type-toggle type-toggle-income'  + (on  ? ' type-toggle-active' : '');
  document.getElementById('recur-details').style.display   = on ? '' : 'none';
}

function onRecurEndTypeChange() {
  const val = document.getElementById('recur-end-type').value;
  document.getElementById('recur-duration-row').style.display = val === 'duration' ? '' : 'none';
  document.getElementById('recur-enddate-row').style.display  = val === 'date'     ? '' : 'none';
}

function openAddItem() {
  state.editingId = null;
  document.getElementById('item-form').reset();
  setItemType('expense');
  setRecurring(false);
  document.getElementById('recur-end-type').value       = 'ongoing';
  document.getElementById('recur-every').value          = '1';
  document.getElementById('recur-unit').value           = 'month';
  document.getElementById('recur-duration-count').value = '1';
  document.getElementById('recur-duration-unit').value  = 'month';
  document.getElementById('recur-end-date').value       = '';
  onRecurEndTypeChange();
  const ym = state.currentMonth;
  document.getElementById('item-month').value               = ym;
  document.getElementById('item-month-display').textContent = monthLabelFE(ym);
  document.getElementById('item-date').value                = new Date().toISOString().slice(0, 10);
  document.getElementById('item-currency').value            = (state.data?.settings?.defaultCurrency || 'DZD').toUpperCase();
  openModal('item-modal');
}

function openEditItem(id) {
  const item = (state.monthData?.items || []).find(i => i.id === id)
            || (state.data.items || []).find(i => i.id === id);
  if (!item) return;
  state.editingId = id;
  const ym = item.month || state.currentMonth;
  document.getElementById('item-month').value               = ym;
  document.getElementById('item-month-display').textContent = monthLabelFE(ym);
  document.getElementById('item-label').value               = item.label;
  document.getElementById('item-amount').value              = item.amount;
  document.getElementById('item-category').value            = item.category || '';
  document.getElementById('item-date').value                = item.date  || '';
  document.getElementById('item-notes').value               = item.notes || '';
  document.getElementById('item-currency').value            = (item.currency || state.data?.settings?.defaultCurrency || 'DZD').toUpperCase();
  setItemType(item.type || 'expense');
  // Populate recurring fields
  const isRec   = Boolean(item.is_recurring);
  const endType = item.recur_end_type || 'ongoing';
  setRecurring(isRec);
  document.getElementById('recur-every').value          = item.recur_every          || 1;
  document.getElementById('recur-unit').value           = item.recur_unit           || 'month';
  document.getElementById('recur-end-type').value       = endType;
  document.getElementById('recur-duration-count').value = item.recur_duration_count || 1;
  document.getElementById('recur-duration-unit').value  = item.recur_duration_unit  || 'month';
  document.getElementById('recur-end-date').value       = item.recur_end_date       || '';
  onRecurEndTypeChange();
  openModal('item-modal');
}

async function submitItemForm(e) {
  e.preventDefault();
  const ym   = document.getElementById('item-month').value || state.currentMonth;
  const type = document.getElementById('item-type').value || 'expense';
  const isRecurring = document.getElementById('item-is-recurring').value === 'true';
  const body = {
    label:    document.getElementById('item-label').value.trim(),
    amount:   parseFloat(document.getElementById('item-amount').value),
    category: type === 'income' ? '' : document.getElementById('item-category').value.trim(),
    date:     document.getElementById('item-date').value,
    notes:    document.getElementById('item-notes').value.trim(),
    currency: (document.getElementById('item-currency').value.trim() || state.data?.settings?.defaultCurrency || 'DZD').toUpperCase(),
    month:    ym,
    type:     type,
    is_recurring: isRecurring,
  };
  if (isRecurring) {
    body.recur_every = parseInt(document.getElementById('recur-every').value) || 1;
    body.recur_unit  = document.getElementById('recur-unit').value || 'month';
    const endType    = document.getElementById('recur-end-type').value || 'ongoing';
    body.recur_end_type = endType;
    if (endType === 'duration') {
      body.recur_duration_count = parseInt(document.getElementById('recur-duration-count').value) || 1;
      body.recur_duration_unit  = document.getElementById('recur-duration-unit').value || 'month';
    } else if (endType === 'date') {
      body.recur_end_date = document.getElementById('recur-end-date').value || null;
    }
  }
  if (!body.label)                          { toast('Label is required', 'error'); return; }
  if (isNaN(body.amount) || body.amount < 0){ toast('Amount must be \u2265 0', 'error'); return; }
  try {
    const verb = type === 'income' ? 'Income entry' : 'Expense';
    if (state.editingId) { await api.updateItem(state.editingId, body); toast(verb + ' updated', 'success'); }
    else                 { await api.addItem(body);                     toast(verb + ' added', 'success'); }
    closeModal('item-modal');
    state.data = await api.getData();
    await renderSavingsPage();
    if (state.currentPage === 'dashboard') {
      state.summary = await api.getSummary(ym);
      renderDashboard();
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function confirmDeleteItem(id) {
  const item = (state.monthData?.items || []).find(i => i.id === id)
            || (state.data.items || []).find(i => i.id === id);
  if (!item) return;
  const msg = item.is_recurring
    ? `Delete recurring item "${item.label}"?\nThis removes ALL past and future occurrences.`
    : `Delete "${item.label}"?`;
  if (!confirm(msg)) return;
  try {
    await api.deleteItem(id);
    toast('Expense deleted', 'info');
    state.data = await api.getData();
    await renderSavingsPage();
    if (state.currentPage === 'dashboard') {
      state.summary = await api.getSummary(state.currentMonth);
      renderDashboard();
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

/* ----------------------------------------------------------
   EXPORT / IMPORT / BACKUP
---------------------------------------------------------- */

async function exportData() {
  try {
    const data = await _readData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'life-advisor-export.json' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) { toast('Export failed: ' + err.message, 'error'); }
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (typeof parsed !== 'object' || !parsed) throw new Error('Invalid JSON');
      if (!confirm('This will replace all your current data. Continue?')) return;
      await api.postData(parsed);
      await loadData();
      renderSavingsPage();
      renderDashboard();
      toast('Data imported successfully', 'success');
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  };
  input.click();
}

async function saveBackup() {
  try {
    const r = await api.backup();
    toast('Backup saved: ' + r.file, 'success', 4000);
    renderSettingsPage();
  } catch (err) { toast('Backup failed: ' + err.message, 'error'); }
}

/* ----------------------------------------------------------
   SETTINGS PAGE
---------------------------------------------------------- */

async function renderSettingsPage() {
  const dcEl = document.getElementById('settings-default-currency');
  if (dcEl) dcEl.value = state.data?.settings?.defaultCurrency || 'DZD';
  try {
    const backups = await api.getBackups();
    const ul = document.getElementById('backups-list');
    ul.innerHTML = backups.length
      ? backups.map(f => `<li><span style="font-size:.88rem;font-family:monospace">${escHtml(f)}</span></li>`).join('')
      : '<li class="text-muted" style="font-size:.88rem">No backups yet.</li>';
  } catch { /* ignore */ }
}

async function saveSettingsDefaultCurrency() {
  const val = document.getElementById('settings-default-currency').value.trim().toUpperCase();
  if (!val) { toast('Currency code cannot be empty', 'error'); return; }
  try {
    await api.saveSettings({ defaultCurrency: val });
    if (!state.data.settings) state.data.settings = {};
    state.data.settings.defaultCurrency = val;
    toast(`Default currency set to ${val}`, 'success');
    if (state.currentPage === 'savings')   await renderSavingsPage();
    if (state.currentPage === 'dashboard') renderDashboard();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function resetAllData() {
  if (!confirm('?? This will delete ALL data. Are you sure?')) return;
  if (!confirm('Last chance! This is irreversible.')) return;
  try {
    await api.postData({ settings: { defaultCurrency: 'DZD' }, months: {}, items: [], savingsLedger: [], transactions: [] });
    await loadData();
    renderSavingsPage();
    renderDashboard();
    toast('Data reset complete', 'info');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

/* ----------------------------------------------------------
   MODALS & TUTORIAL
---------------------------------------------------------- */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); state.editingId = null; }
function openTutorial() { openModal('tutorial-modal'); }
function closeTutorial() {
  closeModal('tutorial-modal');
  localStorage.setItem('tutorialSeen', '1');
  state.tutorialSeen = true;
}

/* ----------------------------------------------------------
   GUIDES HELPERS
---------------------------------------------------------- */
function toggleCollapsible(el) { el.closest('.collapsible').classList.toggle('open'); }
function copyText(btn) {
  const block = btn.previousElementSibling;
  navigator.clipboard.writeText(block ? block.textContent : '').then(() => {
    btn.textContent = '? Copied!';
    setTimeout(() => { btn.textContent = '?? Copy to Clipboard'; }, 2000);
  }).catch(() => toast('Copy failed', 'error'));
}

/* ----------------------------------------------------------
   UTILITIES
---------------------------------------------------------- */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ----------------------------------------------------------
   INIT
---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('sidebar-toggle').addEventListener('click', openSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });

  document.getElementById('item-form').addEventListener('submit', submitItemForm);

  const filterSearch = document.getElementById('filter-search');
  if (filterSearch) filterSearch.addEventListener('input', applyFilter);

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.classList.remove('open'); state.editingId = null; }
    });
  });

  await loadData();
  navigate('dashboard', false);

  if (!state.tutorialSeen) setTimeout(openTutorial, 800);
});

/* ----------------------------------------------------------
   EXPOSE GLOBALS (inline onclick handlers)
---------------------------------------------------------- */
window.navigate                    = navigate;
window.setItemType                 = setItemType;
window.openAddItem                 = openAddItem;
window.openEditItem                = openEditItem;
window.confirmDeleteItem           = confirmDeleteItem;
window.saveIncome                  = saveIncome;
window.addSurplusToSavings         = addSurplusToSavings;
window.deleteLedgerEntry           = deleteLedgerEntry;
window.changeMonth                 = changeMonth;
window.selectMonth                 = selectMonth;
window.goToCurrentMonth            = goToCurrentMonth;
window.saveSettingsDefaultCurrency = saveSettingsDefaultCurrency;
window.exportData                  = exportData;
window.importData                  = importData;
window.saveBackup                  = saveBackup;
window.resetAllData                = resetAllData;
window.openModal                   = openModal;
window.closeModal                  = closeModal;
window.openTutorial                = openTutorial;
window.closeTutorial               = closeTutorial;
window.toggleCollapsible           = toggleCollapsible;
window.copyText                    = copyText;
window.applyFilter                 = applyFilter;

