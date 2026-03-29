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

/* ── Mode detection ─────────────────────────────────────────
   IS_SERVER_MODE starts false. detectMode() (called in
   DOMContentLoaded) does a quick probe to /api/data.
   - localhost OR phone on same WiFi via http://[PC-IP]:port → true
   - GitHub Pages PWA / offline → false
   The `api` Proxy below reads IS_SERVER_MODE dynamically so the
   whole app works correctly in both modes with zero other changes.
---------------------------------------------------------- */
let IS_SERVER_MODE = false;

async function detectMode() {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res   = await fetch('/api/data', { signal: ctrl.signal });
    clearTimeout(timer);
    IS_SERVER_MODE = res.ok;
  } catch {
    IS_SERVER_MODE = false;
  }
}

/* -- API helpers -------------------------------------------- */
const API = '/api';

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.errors?.join(', ') || `HTTP ${res.status}`);
  return json;
}

const serverApi = {
  getData:          ()          => apiFetch('/data'),
  getSummary:       (month)     => apiFetch('/summary' + (month ? `?month=${encodeURIComponent(month)}` : '')),
  postData:         (body)      => apiFetch('/data',                  { method: 'POST',   body: JSON.stringify(body) }),
  addItem:          (item)      => apiFetch('/items',                 { method: 'POST',   body: JSON.stringify(item) }),
  updateItem:       (id, b)     => apiFetch(`/items/${id}`,          { method: 'PUT',    body: JSON.stringify(b) }),
  deleteItem:       (id)        => apiFetch(`/items/${id}`,          { method: 'DELETE' }),
  saveSettings:     (b)         => apiFetch('/settings',             { method: 'PATCH',  body: JSON.stringify(b) }),
  backup:           ()          => apiFetch('/backup',               { method: 'POST' }),
  getBackups:       ()          => apiFetch('/backups'),
  getMonths:        ()          => apiFetch('/months'),
  getMonth:         (m)         => apiFetch(`/months/${encodeURIComponent(m)}`),
  setMonthIncome:   (m, income) => apiFetch(`/months/${encodeURIComponent(m)}/income`, { method: 'POST', body: JSON.stringify({ income }) }),
  addSurplus:       (m, date)   => apiFetch(`/months/${encodeURIComponent(m)}/surplus`, { method: 'POST', body: JSON.stringify({ date }) }),
  getLedger:        ()          => apiFetch('/savings-ledger'),
  deleteLedgerEntry:(id)        => apiFetch(`/savings-ledger/${id}`, { method: 'DELETE' }),
};

/* Dynamically delegates to serverApi or localApi based on detected mode */
const api = new Proxy({}, {
  get(_, prop) { return (IS_SERVER_MODE ? serverApi : localApi)[prop]; }
});

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
    toast('Could not connect to backend. Is server.js running?', 'error', 5000);
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
    const isIncome  = (item.type || 'expense') === 'income';
    const isSaving  = !isIncome && (item.category || '').toLowerCase() === 'monthly savings';
    const rowStyle  = isIncome ? 'background:rgba(16,185,129,.06)' : isSaving ? 'background:rgba(16,185,129,.04)' : '';
    const amtColor  = isIncome ? 'var(--success)' : 'var(--danger)';
    const amtPrefix = isIncome ? '+' : '';
    const catBadge  = isIncome
      ? `<span class="category-badge" style="background:rgba(16,185,129,.15);color:var(--success);border-color:rgba(16,185,129,.3)">&#43; extra income</span>`
      : isSaving
        ? `<span class="category-badge savings-cat">&#x2713; monthly savings</span>`
        : `<span class="category-badge">${escHtml(item.category || '\u2014')}</span>`;
    return `
      <tr data-id="${item.id}" style="${rowStyle}">
        <td style="font-weight:${(isSaving || isIncome) ? '600' : '400'}">${escHtml(item.label)}</td>
        <td style="font-weight:600;color:${amtColor}">${amtPrefix}${fmt(item.amount)} <span style="font-size:.75rem;color:var(--text-muted);font-weight:400">${escHtml(item.currency || dc)}</span></td>
        <td>${catBadge}</td>
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
}

function openAddItem() {
  state.editingId = null;
  document.getElementById('item-form').reset();
  setItemType('expense');
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
  openModal('item-modal');
}

async function submitItemForm(e) {
  e.preventDefault();
  const ym   = document.getElementById('item-month').value || state.currentMonth;
  const type = document.getElementById('item-type').value || 'expense';
  const body = {
    label:    document.getElementById('item-label').value.trim(),
    amount:   parseFloat(document.getElementById('item-amount').value),
    category: type === 'income' ? '' : document.getElementById('item-category').value.trim(),
    date:     document.getElementById('item-date').value,
    notes:    document.getElementById('item-notes').value.trim(),
    currency: (document.getElementById('item-currency').value.trim() || state.data?.settings?.defaultCurrency || 'DZD').toUpperCase(),
    month:    ym,
    type:     type
  };
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
  if (!confirm(`Delete "${item.label}"?`)) return;
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

function exportData() {
  if (IS_SERVER_MODE) { window.location.href = '/api/export'; }
  else                { localApi.exportData(); }
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

  // Show sync panel only in local/PWA mode
  const syncSection = document.getElementById('sync-section');
  if (syncSection) {
    syncSection.style.display = IS_SERVER_MODE ? 'none' : 'block';
    if (!IS_SERVER_MODE) {
      const urlInput = document.getElementById('sync-url-input');
      if (urlInput && !urlInput.value) urlInput.value = getSyncUrl();
    }
  }

  try {
    const backups = await api.getBackups();
    const ul = document.getElementById('backups-list');
    ul.innerHTML = backups.length
      ? backups.map(f => `<li><span style="font-size:.88rem;font-family:monospace">${escHtml(f)}</span></li>`).join('')
      : IS_SERVER_MODE
        ? '<li class="text-muted" style="font-size:.88rem">No backups yet.</li>'
        : '<li class="text-muted" style="font-size:.88rem">Use \u201cSave Snapshot\u201d to download a backup to your device.</li>';
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
   SYNC WITH PC SERVER  (local / PWA mode only)
---------------------------------------------------------- */
function _setSyncStatus(el, text, color) {
  if (!el) return;
  el.textContent = text;
  el.style.color = color || 'var(--text-muted)';
}

function doSaveSyncUrl() {
  const urlInput = document.getElementById('sync-url-input');
  if (!urlInput) return;
  const url = urlInput.value.trim();
  if (!url) { toast('Enter a server URL first', 'error'); return; }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    toast('URL must start with http:// (e.g. http://192.168.1.50:3001)', 'error'); return;
  }
  saveSyncUrl(url);
  toast('Server URL saved', 'success');
}

async function doSyncPull() {
  const urlInput = document.getElementById('sync-url-input');
  const statusEl = document.getElementById('sync-status');
  const url = (urlInput?.value || getSyncUrl()).trim().replace(/\/$/, '');
  if (!url) { toast('Enter the PC server URL in Settings → Sync first', 'error'); return; }
  saveSyncUrl(url);

  if (window.location.protocol === 'https:' && url.startsWith('http://')) {
    const msg = '\u26a0\ufe0f Mixed content blocked by browser. Open the app via ' + url + ' on your phone for sync to work.';
    _setSyncStatus(statusEl, msg, 'var(--warning, orange)');
    toast(msg, 'error', 7000);
    return;
  }

  _setSyncStatus(statusEl, '\u23f3 Connecting to server\u2026', '');
  try {
    const reachable = await checkServerReachable(url);
    if (!reachable) {
      _setSyncStatus(statusEl, '\u274c Cannot reach server. Is server.js running? Are you on the same Wi-Fi?', 'var(--danger)');
      return;
    }
    _setSyncStatus(statusEl, '\u2b07\ufe0f Downloading data from PC\u2026', '');
    const data = await syncPullFromServer(url);
    state.data = data;
    await loadData();
    renderDashboard();
    if (state.currentPage === 'savings') await renderSavingsPage();
    _setSyncStatus(statusEl, '\u2705 Pulled from PC \u2014 ' + new Date().toLocaleTimeString(), 'var(--success)');
    toast('Data pulled from PC server!', 'success');
  } catch (err) {
    _setSyncStatus(statusEl, '\u274c Sync failed: ' + err.message, 'var(--danger)');
    toast('Sync failed: ' + err.message, 'error');
  }
}

async function doSyncPush() {
  const urlInput = document.getElementById('sync-url-input');
  const statusEl = document.getElementById('sync-status');
  const url = (urlInput?.value || getSyncUrl()).trim().replace(/\/$/, '');
  if (!url) { toast('Enter the PC server URL in Settings \u2192 Sync first', 'error'); return; }
  saveSyncUrl(url);

  if (window.location.protocol === 'https:' && url.startsWith('http://')) {
    const msg = '\u26a0\ufe0f Mixed content blocked by browser. Open the app via ' + url + ' on your phone for sync to work.';
    _setSyncStatus(statusEl, msg, 'var(--warning, orange)');
    toast(msg, 'error', 7000);
    return;
  }

  _setSyncStatus(statusEl, '\u23f3 Connecting to server\u2026', '');
  try {
    const reachable = await checkServerReachable(url);
    if (!reachable) {
      _setSyncStatus(statusEl, '\u274c Cannot reach server. Is server.js running? Are you on the same Wi-Fi?', 'var(--danger)');
      return;
    }
    _setSyncStatus(statusEl, '\u2b06\ufe0f Uploading data to PC\u2026', '');
    await syncPushToServer(url);
    _setSyncStatus(statusEl, '\u2705 Pushed to PC \u2014 ' + new Date().toLocaleTimeString(), 'var(--success)');
    toast('Data pushed to PC server!', 'success');
  } catch (err) {
    _setSyncStatus(statusEl, '\u274c Sync failed: ' + err.message, 'var(--danger)');
    toast('Sync failed: ' + err.message, 'error');
  }
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

  await detectMode();
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
window.doSaveSyncUrl               = doSaveSyncUrl;
window.doSyncPull                  = doSyncPull;
window.doSyncPush                  = doSyncPush;

