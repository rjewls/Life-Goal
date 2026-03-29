/**
 * Life Advisor — server.js  (Supabase edition)
 * Express backend: serves static files, all data stored in Supabase.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fsp     = require('fs/promises');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

/* ── Supabase ─────────────────────────────────────────────── */
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n\u274c  Missing SUPABASE_URL or SUPABASE_KEY in .env\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── Express ──────────────────────────────────────────────── */
const app        = express();
const PORT       = process.env.PORT || 3001;
const BACKUP_DIR = path.join(__dirname, 'backups');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/static', express.static(path.join(__dirname, 'static')));

/* ── Helpers ──────────────────────────────────────────────── */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/* ── Row mappers ──────────────────────────────────────────── */
function dbRowToItem(r) {
  return {
    id:                  r.id,
    label:               r.label,
    amount:              parseFloat(r.amount) || 0,
    type:                r.type      || 'expense',
    date:                r.date      || null,
    month:               r.month,
    category:            r.category  || '',
    notes:               r.notes     || '',
    currency:            r.currency  || 'DZD',
    createdAt:           r.created_at,
    is_recurring:        r.is_recurring         || false,
    recur_every:         r.recur_every          ?? null,
    recur_unit:          r.recur_unit           ?? null,
    recur_end_type:      r.recur_end_type       ?? null,
    recur_duration_count: r.recur_duration_count ?? null,
    recur_duration_unit:  r.recur_duration_unit  ?? null,
    recur_end_date:       r.recur_end_date       ?? null,
  };
}
function dbRowToLedger(r) {
  return {
    id:       r.id,
    itemId:   r.item_id || null,
    amount:   parseFloat(r.amount) || 0,
    currency: r.currency || 'DZD',
    date:     r.date     || null,
    month:    r.month    || null,
    source:   r.source,
    label:    r.label    || '',
  };
}

/* ── readData: assemble full state from all tables ────────── */
async function readData() {
  const [
    { data: settingsRow, error: se },
    { data: monthRows,   error: me },
    { data: itemRows,    error: ie },
    { data: ledgerRows,  error: le },
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 'default').maybeSingle(),
    supabase.from('months').select('*'),
    supabase.from('items').select('*').order('created_at', { ascending: true }),
    supabase.from('savings_ledger').select('*'),
  ]);

  if (se || me || ie || le) {
    const err = se || me || ie || le;
    throw new Error('Supabase read error: ' + err.message);
  }

  const months = {};
  for (const row of (monthRows || [])) {
    months[row.ym] = { income: parseFloat(row.income) || 0 };
  }

  return {
    meta:          { lastModified: new Date().toISOString() },
    settings:      { defaultCurrency: settingsRow?.default_currency || 'DZD' },
    months,
    items:         (itemRows   || []).map(dbRowToItem),
    savingsLedger: (ledgerRows || []).map(dbRowToLedger),
    transactions:  []
  };
}

/* ── Computation (unchanged logic, works on assembled data) ── */
function computeMonthSummary(data, month) {
  const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const inc   = Number(data.months?.[month]?.income) || 0;
  const items = data.items || [];
  let totalCosts = 0, extraIncome = 0, monthlySavingsAmt = 0;
  for (const item of items) {
    const occ = recurOccurrencesInMonth(item, month);
    if (occ === 0) continue;
    const amt = (Number(item.amount) || 0) * occ;
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

function computeAllTimeSavings(data) {
  const dc         = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
  const byCurrency = {};
  for (const entry of (data.savingsLedger || [])) {
    const cur = (entry.currency || dc).toUpperCase();
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(entry.amount) || 0);
  }
  return { byCurrency, defaultCurrency: dc, total: byCurrency[dc] || 0 };
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

/* ── Recurrence helpers ───────────────────────────────────── */
function addDurationSrv(date, count, unit) {
  const d = new Date(date);
  if      (unit === 'day')   d.setUTCDate(d.getUTCDate() + count);
  else if (unit === 'week')  d.setUTCDate(d.getUTCDate() + count * 7);
  else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + count);
  else if (unit === 'year')  d.setUTCFullYear(d.getUTCFullYear() + count);
  return d;
}

function recurOccurrencesInMonth(item, ym) {
  if (!item.is_recurring) return item.month === ym ? 1 : 0;
  if (!item.date) return item.month === ym ? 1 : 0;

  const startDate  = new Date(item.date + 'T00:00:00Z');
  const [yr, mo]   = ym.split('-').map(Number);
  const monthStart = new Date(Date.UTC(yr, mo - 1, 1));
  const monthEnd   = new Date(Date.UTC(yr, mo, 0, 23, 59, 59, 999));

  if (startDate > monthEnd) return 0;

  let recurEnd = null;
  if (item.recur_end_type === 'date' && item.recur_end_date) {
    recurEnd = new Date(item.recur_end_date + 'T23:59:59Z');
  } else if (item.recur_end_type === 'duration' && item.recur_duration_count && item.recur_duration_unit) {
    recurEnd = addDurationSrv(new Date(startDate), item.recur_duration_count, item.recur_duration_unit);
    recurEnd = new Date(recurEnd.getTime() - 1); // exclusive boundary
  }

  if (recurEnd && recurEnd < monthStart) return 0;

  const every = item.recur_every || 1;
  const unit  = item.recur_unit  || 'month';

  let current = new Date(startDate);
  // Fast-forward to near monthStart for day/week frequencies
  if (current < monthStart) {
    if (unit === 'day') {
      const steps = Math.floor((monthStart - current) / (every * 86400000));
      if (steps > 0) current = addDurationSrv(current, steps * every, 'day');
    } else if (unit === 'week') {
      const steps = Math.floor((monthStart - current) / (every * 7 * 86400000));
      if (steps > 0) current = addDurationSrv(current, steps * every, 'week');
    }
  }

  let count = 0;
  const MAX_ITER = 500;
  for (let i = 0; i < MAX_ITER && current <= monthEnd; i++) {
    if (current >= monthStart && (!recurEnd || current <= recurEnd)) count++;
    current = addDurationSrv(current, every, unit);
  }
  return count;
}

/* ── Routes ───────────────────────────────────────────────── */

// GET /api/data
app.get('/api/data', async (req, res) => {
  try { res.json(await readData()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/data  — bulk import (replaces all data)
app.post('/api/data', async (req, res) => {
  try {
    const d = req.body;
    if (typeof d !== 'object' || !d)
      return res.status(400).json({ error: 'Body must be a JSON object' });

    const dc = d.settings?.defaultCurrency || 'DZD';

    // Clear all data tables
    await Promise.all([
      supabase.from('savings_ledger').delete().neq('id', ''),
      supabase.from('items').delete().neq('id', ''),
      supabase.from('months').delete().neq('ym', ''),
    ]);

    await supabase.from('settings').upsert({ id: 'default', default_currency: dc });

    const monthInserts = Object.entries(d.months || {})
      .map(([ym, v]) => ({ ym, income: Number(v.income) || 0 }));
    if (monthInserts.length)
      await supabase.from('months').insert(monthInserts);

    const itemInserts = (d.items || []).map(item => ({
      id: item.id, label: item.label, amount: Number(item.amount) || 0,
      type: item.type || 'expense', date: item.date || null, month: item.month,
      category: item.category || '', notes: item.notes || '',
      currency: item.currency || dc, created_at: item.createdAt || new Date().toISOString(),
      is_recurring: item.is_recurring || false,
      recur_every: item.recur_every || null, recur_unit: item.recur_unit || null,
      recur_end_type: item.recur_end_type || null,
      recur_duration_count: item.recur_duration_count || null,
      recur_duration_unit: item.recur_duration_unit || null,
      recur_end_date: item.recur_end_date || null,
    }));
    if (itemInserts.length)
      await supabase.from('items').insert(itemInserts);

    const ledgerInserts = (d.savingsLedger || []).map(e => ({
      id: e.id, item_id: e.itemId || null, amount: Number(e.amount) || 0,
      currency: e.currency || dc, date: e.date || null, month: e.month || null,
      source: e.source, label: e.label || '',
    }));
    if (ledgerInserts.length)
      await supabase.from('savings_ledger').insert(ledgerInserts);

    res.json(await readData());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/summary
app.get('/api/summary', async (req, res) => {
  try {
    const data  = await readData();
    const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const month = req.query.month || currentMonth();
    const ms    = computeMonthSummary(data, month);
    const ats   = computeAllTimeSavings(data);
    res.json({ ...ms, allTimeSavings: ats.total, allTimeByCurrency: ats.byCurrency, defaultCurrency: dc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/months
app.get('/api/months', async (req, res) => {
  try {
    const { data: monthRows } = await supabase.from('months').select('*');
    const { data: itemRows  } = await supabase.from('items').select('month');
    const monthSet = new Set((monthRows || []).map(r => r.ym));
    for (const r of (itemRows || [])) if (r.month) monthSet.add(r.month);
    const months = [...monthSet].sort().reverse().map(ym => {
      const row = (monthRows || []).find(r => r.ym === ym);
      return { ym, label: monthLabel(ym), income: parseFloat(row?.income) || 0 };
    });
    res.json(months);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/months/:month
app.get('/api/months/:month', async (req, res) => {
  try {
    const data    = await readData();
    const month   = req.params.month;
    const summary = computeMonthSummary(data, month);
    // Include all items active in this month (one-time + projected recurring)
    const items   = (data.items || [])
      .map(i => { const occ = recurOccurrencesInMonth(i, month); return occ > 0 ? { ...i, _occurrences: occ } : null; })
      .filter(Boolean);
    res.json({ ...summary, items, label: monthLabel(month) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/months/:month/income
app.post('/api/months/:month/income', async (req, res) => {
  try {
    const income = Number(req.body.income);
    if (isNaN(income) || income < 0)
      return res.status(400).json({ error: 'income must be a non-negative number' });
    const ym = req.params.month;
    const { error } = await supabase.from('months')
      .upsert({ ym, income }, { onConflict: 'ym' });
    if (error) throw new Error(error.message);
    res.json({ month: ym, income });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/months/:month/surplus
app.post('/api/months/:month/surplus', async (req, res) => {
  try {
    const month = req.params.month;
    const { data: existing } = await supabase.from('savings_ledger')
      .select('id').eq('month', month).eq('source', 'surplus').maybeSingle();
    if (existing)
      return res.status(409).json({ error: 'Surplus already added for this month' });

    const data = await readData();
    const ms   = computeMonthSummary(data, month);
    if (ms.remaining <= 0)
      return res.status(400).json({ error: 'No positive remaining balance to add' });

    const dc    = (data.settings?.defaultCurrency || 'DZD').toUpperCase();
    const entry = {
      id:       newId(),
      item_id:  null,
      amount:   ms.remaining,
      currency: dc,
      date:     req.body.date || new Date().toISOString().slice(0, 10),
      month,
      source:   'surplus',
      label:    `Salary surplus \u2014 ${monthLabel(month)}`
    };
    const { error } = await supabase.from('savings_ledger').insert(entry);
    if (error) throw new Error(error.message);
    res.status(201).json(dbRowToLedger(entry));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/savings-ledger
app.get('/api/savings-ledger', async (req, res) => {
  try {
    const { data: settingsRow } = await supabase.from('settings')
      .select('*').eq('id', 'default').maybeSingle();
    const { data: ledgerRows, error } = await supabase.from('savings_ledger')
      .select('*').order('date', { ascending: false });
    if (error) throw new Error(error.message);
    const dc      = settingsRow?.default_currency || 'DZD';
    const entries = (ledgerRows || []).map(dbRowToLedger);
    const byCurrency = {};
    for (const e of entries) {
      const cur = (e.currency || dc).toUpperCase();
      byCurrency[cur] = (byCurrency[cur] || 0) + e.amount;
    }
    res.json({ entries, totals: byCurrency, defaultCurrency: dc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/savings-ledger/:id
app.delete('/api/savings-ledger/:id', async (req, res) => {
  try {
    const { data: entry, error: fe } = await supabase.from('savings_ledger')
      .select('*').eq('id', req.params.id).maybeSingle();
    if (fe || !entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.source !== 'surplus')
      return res.status(400).json({ error: 'Only surplus entries can be deleted here. Delete the source item instead.' });
    const { error } = await supabase.from('savings_ledger').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/export
app.get('/api/export', async (req, res) => {
  try {
    const data = await readData();
    res.setHeader('Content-Disposition', 'attachment; filename="data.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/items
app.post('/api/items', async (req, res) => {
  try {
    const errors = validateItem(req.body);
    if (errors.length) return res.status(400).json({ errors });

    const { data: settingsRow } = await supabase.from('settings')
      .select('default_currency').eq('id', 'default').maybeSingle();
    const dc    = settingsRow?.default_currency || 'DZD';
    const month = req.body.month || (req.body.date || '').slice(0, 7) || currentMonth();

    const isRecurring = req.body.is_recurring === true || req.body.is_recurring === 'true';
    const endType = isRecurring ? (req.body.recur_end_type || 'ongoing') : null;
    const item = {
      id:         newId(),
      label:      String(req.body.label).trim(),
      amount:     Number(req.body.amount),
      type:       req.body.type === 'income' ? 'income' : 'expense',
      date:       req.body.date || new Date().toISOString().slice(0, 10),
      month,
      category:   req.body.category ? String(req.body.category).trim() : '',
      notes:      req.body.notes    ? String(req.body.notes).trim()    : '',
      currency:   req.body.currency ? String(req.body.currency).trim().toUpperCase() : dc,
      created_at: new Date().toISOString(),
      is_recurring:         isRecurring,
      recur_every:          isRecurring ? (parseInt(req.body.recur_every) || 1) : null,
      recur_unit:           isRecurring ? (req.body.recur_unit || 'month')      : null,
      recur_end_type:       endType,
      recur_duration_count: (isRecurring && endType === 'duration') ? (parseInt(req.body.recur_duration_count) || null) : null,
      recur_duration_unit:  (isRecurring && endType === 'duration') ? (req.body.recur_duration_unit || null) : null,
      recur_end_date:       (isRecurring && endType === 'date')     ? (req.body.recur_end_date || null) : null,
    };

    const { error: ie } = await supabase.from('items').insert(item);
    if (ie) throw new Error(ie.message);

    await supabase.from('months')
      .upsert({ ym: month, income: 0 }, { onConflict: 'ym', ignoreDuplicates: true });

    // Only auto-add to savings ledger for non-recurring items
    if (!isRecurring && item.category.toLowerCase().trim() === 'monthly savings' && item.type === 'expense') {
      await supabase.from('savings_ledger').insert({
        id: newId(), item_id: item.id, amount: item.amount, currency: item.currency,
        date: item.date, month: item.month, source: 'savings', label: item.label,
      });
    }

    res.status(201).json(dbRowToItem(item));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/items/:id
app.put('/api/items/:id', async (req, res) => {
  try {
    const { data: oldRow, error: fe } = await supabase.from('items')
      .select('*').eq('id', req.params.id).maybeSingle();
    if (fe || !oldRow) return res.status(404).json({ error: 'Item not found' });

    const merged = { ...dbRowToItem(oldRow), ...req.body };
    const errors = validateItem(merged);
    if (errors.length) return res.status(400).json({ errors });

    const { data: settingsRow } = await supabase.from('settings')
      .select('default_currency').eq('id', 'default').maybeSingle();
    const dc    = settingsRow?.default_currency || 'DZD';
    const month = req.body.month
      || (req.body.date || oldRow.date || '').slice(0, 7)
      || oldRow.month || currentMonth();

    const isRecurringUpd = req.body.is_recurring === true   || req.body.is_recurring === 'true'
                        || (req.body.is_recurring === undefined && Boolean(oldRow.is_recurring));
    const endTypeUpd = req.body.recur_end_type
                    || (isRecurringUpd ? (oldRow.recur_end_type || 'ongoing') : null);
    const updated = {
      label:      String(merged.label).trim(),
      amount:     Number(merged.amount),
      type:       merged.type === 'income' ? 'income' : 'expense',
      date:       merged.date || null,
      month,
      category:   String(merged.category || '').trim(),
      notes:      String(merged.notes    || '').trim(),
      currency:   String(merged.currency || dc).toUpperCase(),
      updated_at: new Date().toISOString(),
      is_recurring:         isRecurringUpd,
      recur_every:          isRecurringUpd ? (parseInt(req.body.recur_every ?? oldRow.recur_every) || 1) : null,
      recur_unit:           isRecurringUpd ? (req.body.recur_unit    || oldRow.recur_unit    || 'month') : null,
      recur_end_type:       isRecurringUpd ? endTypeUpd : null,
      recur_duration_count: (isRecurringUpd && endTypeUpd === 'duration') ? (parseInt(req.body.recur_duration_count ?? oldRow.recur_duration_count) || null) : null,
      recur_duration_unit:  (isRecurringUpd && endTypeUpd === 'duration') ? (req.body.recur_duration_unit || oldRow.recur_duration_unit || null) : null,
      recur_end_date:       (isRecurringUpd && endTypeUpd === 'date')     ? (req.body.recur_end_date    || oldRow.recur_end_date    || null) : null,
    };

    const { error: ue } = await supabase.from('items').update(updated).eq('id', req.params.id);
    if (ue) throw new Error(ue.message);

    await supabase.from('savings_ledger').delete().eq('item_id', req.params.id);
    // Only auto-add to savings ledger for non-recurring items
    if (!isRecurringUpd && updated.category.toLowerCase().trim() === 'monthly savings' && updated.type === 'expense') {
      await supabase.from('savings_ledger').insert({
        id: newId(), item_id: req.params.id, amount: updated.amount, currency: updated.currency,
        date: updated.date, month: updated.month, source: 'savings', label: updated.label,
      });
    }

    res.json({ id: req.params.id, ...dbRowToItem(oldRow), ...updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/items/:id
app.delete('/api/items/:id', async (req, res) => {
  try {
    const { data: item, error: fe } = await supabase.from('items')
      .select('*').eq('id', req.params.id).maybeSingle();
    if (fe || !item) return res.status(404).json({ error: 'Item not found' });
    await supabase.from('savings_ledger').delete().eq('item_id', req.params.id);
    const { error } = await supabase.from('items').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/settings
app.patch('/api/settings', async (req, res) => {
  try {
    if (req.body.defaultCurrency !== undefined) {
      const cur = String(req.body.defaultCurrency).trim().toUpperCase();
      if (!cur) return res.status(400).json({ error: 'defaultCurrency cannot be empty' });
      const { error } = await supabase.from('settings')
        .upsert({ id: 'default', default_currency: cur }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    const { data: row } = await supabase.from('settings')
      .select('*').eq('id', 'default').maybeSingle();
    res.json({ defaultCurrency: row?.default_currency || 'DZD' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/backup  — saves a local .json snapshot in the backups/ folder
app.post('/api/backup', async (req, res) => {
  try {
    const data = await readData();
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `data-${ts}.json`;
    await fsp.writeFile(path.join(BACKUP_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
    res.json({ file: filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/backups
app.get('/api/backups', async (req, res) => {
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const files = await fsp.readdir(BACKUP_DIR);
    res.json(files.filter(f => f.endsWith('.json')).sort().reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── root \u2192 index.html ────────────────────────────────────── */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── start ────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n  \u2705  Life Advisor running \u2192 http://localhost:${PORT}`);
  console.log(`  \u2601\ufe0f   Supabase: ${SUPABASE_URL}\n`);
});

