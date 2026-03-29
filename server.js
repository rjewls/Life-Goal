/**
 * Life Advisor â€” server.js
 * Minimal Express backend: serves static files and reads/writes data.json
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const fsp     = require('fs/promises');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

/* â”€â”€ middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));          // serves index.html at /
app.use('/static', express.static(path.join(__dirname, 'static')));

/* â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const DEFAULT_DATA = {
  meta: { createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
  settings: { defaultCurrency: 'DZD' },
  months: {},          // { "2026-02": { income: 65000 }, ... }
  items: [],           // each item has a `month` field (YYYY-MM)
  savingsLedger: [],   // all-time savings history
  transactions: []
};

async function readData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const d = JSON.parse(raw);
    // â”€â”€ Migrate old format â”€â”€
    if (!d.months)  d.months = {};
    if (!d.savingsLedger) d.savingsLedger = [];
    // If old data had settings.monthlyIncome, preserve as current-month income
    if (d.settings?.monthlyIncome && d.settings.monthlyIncome > 0) {
      const cur = currentMonth();
      if (!d.months[cur]) d.months[cur] = { income: d.settings.monthlyIncome };
      delete d.settings.monthlyIncome;
    }
    // Remove old type:"saving" items â€” or convert to type:"cost" for backward compat
    if (Array.isArray(d.items)) {
      d.items = d.items.map(item => {
        const out = { ...item };
        if (!out.month) out.month = (out.date || '').slice(0, 7) || currentMonth();
        // Normalise type: only 'income' or 'expense' (default)
        if (out.type !== 'income') out.type = 'expense';
        delete out.recurringMonthly;
        return out;
      });
    }
    return d;
  } catch {
    await writeData(DEFAULT_DATA);
    return structuredClone(DEFAULT_DATA);
  }
}

async function writeData(data) {
  data.meta = data.meta || {};
  data.meta.lastModified = new Date().toISOString();
  await fsp.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(ym) {
  // "2026-02" â†’ "February 2026"
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/* Compute summary for a specific month */
function computeMonthSummary(data, month) {
  const dc  = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const inc = Number(data.months?.[month]?.income) || 0;
  const items = (data.items || []).filter(i => i.month === month);

  let totalCosts    = 0;   // sum of expense-type items
  let extraIncome   = 0;   // sum of income-type items
  let monthlySavingsAmt = 0;
  for (const item of items) {
    const amt = Number(item.amount) || 0;
    if ((item.type || 'expense') === 'income') {
      extraIncome += amt;
    } else {
      totalCosts += amt;
      if ((item.category || '').toLowerCase().trim() === 'monthly savings') {
        monthlySavingsAmt += amt;
      }
    }
  }
  const remaining  = inc + extraIncome - totalCosts;
  const surplusUsed = (data.savingsLedger || []).some(
    e => e.month === month && e.source === 'surplus'
  );
  return { month, income: inc, extraIncome, totalCosts, monthlySavings: monthlySavingsAmt, remaining, surplusUsed, currency: dc };
}

/* Compute all-time savings total */
function computeAllTimeSavings(data) {
  const dc = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const byCurrency = {};
  for (const entry of (data.savingsLedger || [])) {
    const cur = (entry.currency || dc).toUpperCase();
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(entry.amount) || 0);
  }
  return { byCurrency, defaultCurrency: dc, total: byCurrency[dc] || 0 };
}

/* simple UUID-like ID */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function validateItem(body) {
  const errors = [];
  if (!body.label || String(body.label).trim() === '') errors.push('label is required');
  if (body.amount === undefined || body.amount === null || body.amount === '')
    errors.push('amount is required');
  const amt = Number(body.amount);
  if (isNaN(amt) || amt < 0) errors.push('amount must be a non-negative number');
  return errors;
}

/* Sync savings ledger when a "monthly savings" expense item is added/updated/deleted */
function syncLedgerForItem(data, item, action) {
  const isSavingsCategory = (item.category || '').toLowerCase().trim() === 'monthly savings';
  const isExpenseType     = (item.type || 'expense') !== 'income';

  if (action === 'delete') {
    // Always clean up ledger entries for this item on delete
    data.savingsLedger = data.savingsLedger.filter(e => e.itemId !== item.id);
    return;
  }

  // Only expense-type items with category 'monthly savings' go to the ledger
  if (!isSavingsCategory || !isExpenseType) {
    // Remove any stale ledger entry (e.g. type changed from expense to income)
    data.savingsLedger = data.savingsLedger.filter(e => e.itemId !== item.id);
    return;
  }

  if (action === 'add') {
    data.savingsLedger.push({
      id:       newId(),
      itemId:   item.id,
      amount:   item.amount,
      currency: item.currency || (data.settings?.defaultCurrency || 'DZD').toUpperCase(),
      date:     item.date || new Date().toISOString().slice(0, 10),
      month:    item.month,
      source:   'savings',
      label:    item.label
    });
  } else if (action === 'update') {
    const idx = data.savingsLedger.findIndex(e => e.itemId === item.id);
    if (idx === -1) {
      // wasn't a savings item before â€” add it now
      data.savingsLedger.push({
        id:       newId(),
        itemId:   item.id,
        amount:   item.amount,
        currency: item.currency || (data.settings?.defaultCurrency || 'DZD').toUpperCase(),
        date:     item.date || new Date().toISOString().slice(0, 10),
        month:    item.month,
        source:   'savings',
        label:    item.label
      });
    } else {
      data.savingsLedger[idx] = {
        ...data.savingsLedger[idx],
        amount:   item.amount,
        currency: item.currency || data.savingsLedger[idx].currency,
        date:     item.date    || data.savingsLedger[idx].date,
        month:    item.month   || data.savingsLedger[idx].month,
        label:    item.label
      };
    }
  }
}

/* â”€â”€ routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// GET /api/data  â€” full data
app.get('/api/data', async (req, res) => {
  try {
    res.json(await readData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/data  â€” overwrite (import)
app.post('/api/data', async (req, res) => {
  try {
    const incoming = req.body;
    if (typeof incoming !== 'object' || !incoming)
      return res.status(400).json({ error: 'Body must be a JSON object' });
    if (!incoming.settings) incoming.settings = { defaultCurrency: 'DZD' };
    if (!incoming.months)   incoming.months = {};
    if (!Array.isArray(incoming.items)) incoming.items = [];
    if (!Array.isArray(incoming.savingsLedger)) incoming.savingsLedger = [];
    if (!Array.isArray(incoming.transactions)) incoming.transactions = [];
    const saved = await writeData(incoming);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/summary â€” overall summary (used by dashboard)
app.get('/api/summary', async (req, res) => {
  try {
    const data  = await readData();
    const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const month = req.query.month || currentMonth();
    const ms    = computeMonthSummary(data, month);
    const ats   = computeAllTimeSavings(data);
    res.json({ ...ms, allTimeSavings: ats.total, allTimeByCurrency: ats.byCurrency, defaultCurrency: dc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/months â€” list all months that have data
app.get('/api/months', async (req, res) => {
  try {
    const data = await readData();
    // Collect all months from months obj and from items
    const monthSet = new Set(Object.keys(data.months || {}));
    for (const item of (data.items || [])) {
      if (item.month) monthSet.add(item.month);
    }
    const months = [...monthSet].sort().reverse().map(ym => ({
      ym, label: monthLabel(ym),
      income: data.months?.[ym]?.income || 0
    }));
    res.json(months);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/months/:month â€” summary + items for one month
app.get('/api/months/:month', async (req, res) => {
  try {
    const data  = await readData();
    const month = req.params.month;
    const summary = computeMonthSummary(data, month);
    const items   = (data.items || []).filter(i => i.month === month);
    res.json({ ...summary, items, label: monthLabel(month) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/months/:month/income â€” set income for a month
app.post('/api/months/:month/income', async (req, res) => {
  try {
    const income = Number(req.body.income);
    if (isNaN(income) || income < 0)
      return res.status(400).json({ error: 'income must be a non-negative number' });
    const data = await readData();
    if (!data.months[req.params.month]) data.months[req.params.month] = {};
    data.months[req.params.month].income = income;
    await writeData(data);
    res.json({ month: req.params.month, income });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/months/:month/surplus â€” add remaining balance to savings ledger
app.post('/api/months/:month/surplus', async (req, res) => {
  try {
    const data  = await readData();
    const month = req.params.month;
    // Check not already done
    const already = (data.savingsLedger || []).some(
      e => e.month === month && e.source === 'surplus'
    );
    if (already) return res.status(409).json({ error: 'Surplus already added for this month' });

    const ms = computeMonthSummary(data, month);
    if (ms.remaining <= 0)
      return res.status(400).json({ error: 'No positive remaining balance to add' });

    const entry = {
      id:       newId(),
      itemId:   null,
      amount:   ms.remaining,
      currency: (data.settings?.defaultCurrency || 'DZD').toUpperCase(),
      date:     req.body.date || new Date().toISOString().slice(0, 10),
      month,
      source:   'surplus',
      label:    `Salary surplus â€” ${monthLabel(month)}`
    };
    data.savingsLedger.push(entry);
    await writeData(data);
    res.status(201).json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/savings-ledger â€” full savings history
app.get('/api/savings-ledger', async (req, res) => {
  try {
    const data = await readData();
    const dc   = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const ats  = computeAllTimeSavings(data);
    res.json({
      entries: [...(data.savingsLedger || [])].sort((a, b) => b.date.localeCompare(a.date)),
      totals:  ats.byCurrency,
      defaultCurrency: dc
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/savings-ledger/:id â€” remove a surplus entry (not savings items â€” those go via items)
app.delete('/api/savings-ledger/:id', async (req, res) => {
  try {
    const data = await readData();
    const entry = data.savingsLedger.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.source !== 'surplus')
      return res.status(400).json({ error: 'Only surplus entries can be deleted here. Delete the source item instead.' });
    data.savingsLedger = data.savingsLedger.filter(e => e.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export  â€” download file
app.get('/api/export', async (req, res) => {
  try {
    const data = await readData();
    res.setHeader('Content-Disposition', 'attachment; filename="data.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/items  â€” add item
app.post('/api/items', async (req, res) => {
  try {
    const errors = validateItem(req.body);
    if (errors.length) return res.status(400).json({ errors });

    const data = await readData();
    const dc   = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const month = req.body.month || (req.body.date || '').slice(0, 7) || currentMonth();
    const item = {
      id:        newId(),
      label:     String(req.body.label).trim(),
      amount:    Number(req.body.amount),
      type:      (req.body.type || 'expense') === 'income' ? 'income' : 'expense',
      date:      req.body.date || new Date().toISOString().slice(0, 10),
      month,
      category:  req.body.category ? String(req.body.category).trim() : '',
      notes:     req.body.notes    ? String(req.body.notes).trim()    : '',
      currency:  req.body.currency ? String(req.body.currency).trim().toUpperCase() : dc,
      createdAt: new Date().toISOString()
    };
    data.items.push(item);
    // Ensure month exists
    if (!data.months[month]) data.months[month] = { income: 0 };
    syncLedgerForItem(data, item, 'add');
    await writeData(data);
    res.status(201).json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/items/:id  â€” update item
app.put('/api/items/:id', async (req, res) => {
  try {
    const data = await readData();
    const idx  = data.items.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    const errors = validateItem({ ...data.items[idx], ...req.body });
    if (errors.length) return res.status(400).json({ errors });

    const old = data.items[idx];
    const updated = {
      ...old,
      ...req.body,
      id:     req.params.id,
      amount: Number(req.body.amount ?? old.amount),
      month:  req.body.month || (req.body.date || old.date || '').slice(0, 7) || old.month || currentMonth(),
      updatedAt: new Date().toISOString()
    };
    data.items[idx] = updated;

    // Handle ledger: if old item was savings, remove; apply new state
    const wasOldSavings = (old.category || '').toLowerCase().trim() === 'monthly savings';
    if (wasOldSavings) syncLedgerForItem(data, old, 'delete');
    syncLedgerForItem(data, updated, 'add');

    await writeData(data);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/items/:id
app.delete('/api/items/:id', async (req, res) => {
  try {
    const data  = await readData();
    const item  = data.items.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    syncLedgerForItem(data, item, 'delete');
    data.items = data.items.filter(i => i.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/settings  â€” update currency / settings
app.patch('/api/settings', async (req, res) => {
  try {
    const data = await readData();
    if (req.body.defaultCurrency !== undefined) {
      const cur = String(req.body.defaultCurrency).trim().toUpperCase();
      if (!cur) return res.status(400).json({ error: 'defaultCurrency cannot be empty' });
      data.settings.defaultCurrency = cur;
    }
    await writeData(data);
    res.json(data.settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/backup  â€” write timestamped backup
app.post('/api/backup', async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const data = await readData();
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(BACKUP_DIR, `data-${ts}.json`);
    await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    res.json({ success: true, file: `backups/data-${ts}.json` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/backups  â€” list backup files
app.get('/api/backups', async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    const files = await fsp.readdir(BACKUP_DIR);
    res.json(files.filter(f => f.endsWith('.json')).sort().reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* â”€â”€ root â†’ index.html â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* â”€â”€ start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
app.listen(PORT, () => {
  console.log(`\n  âœ…  Life Advisor running â†’ http://localhost:${PORT}\n`);
  readData().then(() => console.log('  ðŸ“‚  data.json ready\n'));
});

