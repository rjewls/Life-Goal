/**
 * local-api.js
 * localStorage-backed API adapter + manual PC-server sync.
 *
 * Implements the EXACT same method signatures as serverApi in app.js.
 * Loaded before app.js — exposes `localApi`, `getSyncUrl`, `saveSyncUrl`,
 * `checkServerReachable`, `syncPullFromServer`, `syncPushToServer` globally.
 */
'use strict';

const LS_KEY      = 'lifeAdvisorData';
const LS_SYNC_URL = 'lifeAdvisorSyncUrl';

const _LOCAL_DEFAULT = {
  meta: { createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
  settings: { defaultCurrency: 'DZD' },
  months: {}, items: [], savingsLedger: [], transactions: []
};

/* ── storage helpers ─────────────────────────────────────── */
function _lsRead() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(_LOCAL_DEFAULT);
    const d = JSON.parse(raw);
    if (!d.months)                      d.months = {};
    if (!d.settings)                    d.settings = { defaultCurrency: 'DZD' };
    if (!d.savingsLedger)               d.savingsLedger = [];
    if (!Array.isArray(d.items))        d.items = [];
    if (!Array.isArray(d.transactions)) d.transactions = [];
    return d;
  } catch { return structuredClone(_LOCAL_DEFAULT); }
}

function _lsWrite(data) {
  if (!data.meta) data.meta = {};
  data.meta.lastModified = new Date().toISOString();
  localStorage.setItem(LS_KEY, JSON.stringify(data));
  return data;
}

/* ── computation logic (mirrors server.js) ──────────────── */
function _newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function _currentMonthLocal() {
  return new Date().toISOString().slice(0, 7);
}
function _monthLabelLocal(ym) {
  if (!ym || !ym.includes('-')) return ym || '';
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function _computeMonthSummary(data, month) {
  const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const inc   = Number(data.months?.[month]?.income) || 0;
  const items = (data.items || []).filter(i => i.month === month);
  let totalCosts = 0, extraIncome = 0, monthlySavingsAmt = 0;
  for (const item of items) {
    const amt = Number(item.amount) || 0;
    if ((item.type || 'expense') === 'income') {
      extraIncome += amt;
    } else {
      totalCosts += amt;
      if ((item.category || '').toLowerCase().trim() === 'monthly savings')
        monthlySavingsAmt += amt;
    }
  }
  const remaining   = inc + extraIncome - totalCosts;
  const surplusUsed = (data.savingsLedger || []).some(
    e => e.month === month && e.source === 'surplus'
  );
  return { month, income: inc, extraIncome, totalCosts, monthlySavings: monthlySavingsAmt, remaining, surplusUsed, currency: dc };
}
function _computeAllTimeSavings(data) {
  const dc         = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const byCurrency = {};
  for (const entry of (data.savingsLedger || [])) {
    const cur = (entry.currency || dc).toUpperCase();
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(entry.amount) || 0);
  }
  return { byCurrency, defaultCurrency: dc, total: byCurrency[dc] || 0 };
}
function _syncLedger(data, item, action) {
  const isSavingsCategory = (item.category || '').toLowerCase().trim() === 'monthly savings';
  const isExpenseType     = (item.type || 'expense') !== 'income';
  const dc                = (data.settings?.defaultCurrency || 'DZD').toUpperCase();

  if (action === 'delete') {
    data.savingsLedger = data.savingsLedger.filter(e => e.itemId !== item.id);
    return;
  }
  if (!isSavingsCategory || !isExpenseType) {
    data.savingsLedger = data.savingsLedger.filter(e => e.itemId !== item.id);
    return;
  }
  if (action === 'add') {
    data.savingsLedger.push({
      id:       _newId(), itemId: item.id, amount: item.amount,
      currency: item.currency || dc,
      date:     item.date || new Date().toISOString().slice(0, 10),
      month:    item.month, source: 'savings', label: item.label
    });
  } else if (action === 'update') {
    const idx = data.savingsLedger.findIndex(e => e.itemId === item.id);
    if (idx === -1) {
      data.savingsLedger.push({
        id:       _newId(), itemId: item.id, amount: item.amount,
        currency: item.currency || dc,
        date:     item.date || new Date().toISOString().slice(0, 10),
        month:    item.month, source: 'savings', label: item.label
      });
    } else {
      data.savingsLedger[idx] = {
        ...data.savingsLedger[idx],
        amount:   item.amount,
        currency: item.currency  || data.savingsLedger[idx].currency,
        date:     item.date      || data.savingsLedger[idx].date,
        month:    item.month     || data.savingsLedger[idx].month,
        label:    item.label
      };
    }
  }
}

/* ── localApi ────────────────────────────────────────────── */
const localApi = {
  getData() {
    return Promise.resolve(_lsRead());
  },
  getSummary(month) {
    const data = _lsRead();
    const dc   = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const m    = month || _currentMonthLocal();
    const ms   = _computeMonthSummary(data, m);
    const ats  = _computeAllTimeSavings(data);
    return Promise.resolve({
      ...ms, allTimeSavings: ats.total,
      allTimeByCurrency: ats.byCurrency, defaultCurrency: dc
    });
  },
  postData(body) {
    if (!body.settings)                     body.settings = { defaultCurrency: 'DZD' };
    if (!body.months)                       body.months = {};
    if (!Array.isArray(body.items))         body.items = [];
    if (!Array.isArray(body.savingsLedger)) body.savingsLedger = [];
    if (!Array.isArray(body.transactions))  body.transactions = [];
    return Promise.resolve(_lsWrite(body));
  },
  addItem(item) {
    const data  = _lsRead();
    const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const month = item.month || (item.date || '').slice(0, 7) || _currentMonthLocal();
    const newItem = {
      id:        _newId(),
      label:     String(item.label).trim(),
      amount:    Number(item.amount),
      type:      item.type === 'income' ? 'income' : 'expense',
      date:      item.date || new Date().toISOString().slice(0, 10),
      month,
      category:  item.category ? String(item.category).trim() : '',
      notes:     item.notes    ? String(item.notes).trim()    : '',
      currency:  item.currency ? String(item.currency).trim().toUpperCase() : dc,
      createdAt: new Date().toISOString()
    };
    data.items.push(newItem);
    if (!data.months[month]) data.months[month] = { income: 0 };
    _syncLedger(data, newItem, 'add');
    _lsWrite(data);
    return Promise.resolve(newItem);
  },
  updateItem(id, body) {
    const data = _lsRead();
    const idx  = data.items.findIndex(i => i.id === id);
    if (idx === -1) return Promise.reject(new Error('Item not found'));
    const old     = data.items[idx];
    const updated = {
      ...old, ...body, id,
      amount:    Number(body.amount ?? old.amount),
      month:     body.month || (body.date || old.date || '').slice(0, 7) || old.month || _currentMonthLocal(),
      updatedAt: new Date().toISOString()
    };
    data.items[idx] = updated;
    const wasOldSavings = (old.category || '').toLowerCase().trim() === 'monthly savings';
    if (wasOldSavings) _syncLedger(data, old, 'delete');
    _syncLedger(data, updated, 'add');
    _lsWrite(data);
    return Promise.resolve(updated);
  },
  deleteItem(id) {
    const data = _lsRead();
    const item = data.items.find(i => i.id === id);
    if (!item) return Promise.reject(new Error('Item not found'));
    _syncLedger(data, item, 'delete');
    data.items = data.items.filter(i => i.id !== id);
    _lsWrite(data);
    return Promise.resolve({ success: true });
  },
  saveSettings(body) {
    const data = _lsRead();
    if (body.defaultCurrency) {
      data.settings.defaultCurrency = String(body.defaultCurrency).trim().toUpperCase();
    }
    _lsWrite(data);
    return Promise.resolve(data.settings);
  },
  backup() {
    const data = _lsRead();
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `life-advisor-backup-${ts}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    return Promise.resolve({ file: name });
  },
  getBackups() {
    return Promise.resolve([]);
  },
  getMonths() {
    const data     = _lsRead();
    const monthSet = new Set(Object.keys(data.months || {}));
    for (const item of (data.items || [])) { if (item.month) monthSet.add(item.month); }
    return Promise.resolve(
      [...monthSet].sort().reverse().map(ym => ({
        ym, label: _monthLabelLocal(ym), income: data.months?.[ym]?.income || 0
      }))
    );
  },
  getMonth(m) {
    const data    = _lsRead();
    const summary = _computeMonthSummary(data, m);
    const items   = (data.items || []).filter(i => i.month === m);
    return Promise.resolve({ ...summary, items, label: _monthLabelLocal(m) });
  },
  setMonthIncome(m, income) {
    const data = _lsRead();
    if (!data.months[m]) data.months[m] = {};
    data.months[m].income = income;
    _lsWrite(data);
    return Promise.resolve({ month: m, income });
  },
  addSurplus(m, date) {
    const data    = _lsRead();
    const already = (data.savingsLedger || []).some(e => e.month === m && e.source === 'surplus');
    if (already) return Promise.reject(new Error('Surplus already added for this month'));
    const ms = _computeMonthSummary(data, m);
    if (ms.remaining <= 0) return Promise.reject(new Error('No positive remaining balance to add'));
    const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const entry = {
      id:       _newId(), itemId: null, amount: ms.remaining, currency: dc,
      date:     date || new Date().toISOString().slice(0, 10),
      month:    m, source: 'surplus',
      label:    `Salary surplus \u2014 ${_monthLabelLocal(m)}`
    };
    data.savingsLedger.push(entry);
    _lsWrite(data);
    return Promise.resolve(entry);
  },
  getLedger() {
    const data = _lsRead();
    const dc   = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const ats  = _computeAllTimeSavings(data);
    return Promise.resolve({
      entries: [...(data.savingsLedger || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      totals:  ats.byCurrency,
      defaultCurrency: dc
    });
  },
  deleteLedgerEntry(id) {
    const data  = _lsRead();
    const entry = data.savingsLedger.find(e => e.id === id);
    if (!entry) return Promise.reject(new Error('Entry not found'));
    if (entry.source !== 'surplus')
      return Promise.reject(new Error('Only surplus entries can be deleted here. Delete the source item instead.'));
    data.savingsLedger = data.savingsLedger.filter(e => e.id !== id);
    _lsWrite(data);
    return Promise.resolve({ success: true });
  },
  exportData() {
    const data = _lsRead();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'data.json'; a.click();
    URL.revokeObjectURL(url);
  }
};

/* ── Sync helpers ────────────────────────────────────────── */

function getSyncUrl() {
  return (localStorage.getItem(LS_SYNC_URL) || '').replace(/\/$/, '');
}

function saveSyncUrl(url) {
  localStorage.setItem(LS_SYNC_URL, (url || '').trim().replace(/\/$/, ''));
}

async function checkServerReachable(url) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res   = await fetch(url + '/api/data', { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

async function syncPullFromServer(url) {
  const res = await fetch(url + '/api/data');
  if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}`);
  const serverData = await res.json();
  _lsWrite(serverData);
  return serverData;
}

async function syncPushToServer(url) {
  const data = _lsRead();
  const res  = await fetch(url + '/api/data', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}`);
  return res.json();
}
