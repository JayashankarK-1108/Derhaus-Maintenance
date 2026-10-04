const API = '';

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonthStr(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Today as YYYY-MM-DD in the user's local timezone (toISOString would use UTC)
function todayStr() {
  const d = new Date();
  return `${currentMonthStr()}-${String(d.getDate()).padStart(2, '0')}`;
}

// Escape any user/DB-supplied text before putting it into innerHTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const monthInput = document.getElementById('month');
monthInput.value = currentMonthStr();

document.getElementById('booking-date').value = todayStr();

let flats = [];
let activeTab = 'bookings';

const TAB_META = {
  bookings: { icon: '💧', title: 'Water',  accent: 'Bookings',    sub: 'Track water deliveries for the month' },
  flats:    { icon: '🏠', title: 'Flat',   accent: 'Details',     sub: 'View and update meter readings per flat' },
  usage:    { icon: '📊', title: 'Water',  accent: 'Usage',       sub: 'Consumption breakdown and billing' },
  final:    { icon: '🧾', title: 'Final',  accent: 'Calculation', sub: 'Per-flat total charges for the month' }
};

function updateIntro() {
  const m = TAB_META[activeTab];
  document.getElementById('page-title').innerHTML =
    `${m.icon} ${m.title} <span class="accent">${m.accent}</span>`;
  document.getElementById('page-subtitle').textContent = m.sub;
}

// ── Tab switching ───────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = true; });
    document.getElementById(`tab-${activeTab}`).hidden = false;
    updateIntro();
    loadAll();
  });
});

document.getElementById('load-btn').addEventListener('click', loadAll);
document.getElementById('add-booking-btn').addEventListener('click', () => withBusy('add-booking-btn', addBooking));
document.getElementById('add-drainage-btn').addEventListener('click', () => withBusy('add-drainage-btn', addDrainageBooking));
document.getElementById('save-readings-btn').addEventListener('click', () => withBusy('save-readings-btn', saveReadings));
document.getElementById('save-charges-btn').addEventListener('click', () => withBusy('save-charges-btn', saveCommonCharges));

document.getElementById('drainage-date').value = todayStr();

// ── Helpers ─────────────────────────────────────
const PIN_KEY = 'derhaus-admin-pin';
function getPin() {
  try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; }
}
function setPin(pin) {
  try { pin ? localStorage.setItem(PIN_KEY, pin) : localStorage.removeItem(PIN_KEY); } catch {}
}

// Fetch JSON; write requests carry the admin PIN and ask for it once on 401
async function apiFetch(url, opts = {}, retried = false) {
  const isWrite = opts.method && opts.method !== 'GET';
  const headers = { ...(opts.headers || {}) };
  if (isWrite && getPin()) headers['X-Admin-Pin'] = getPin();
  const r = await fetch(url, { ...opts, headers });
  if (r.status === 401 && isWrite && !retried) {
    const pin = window.prompt('Enter the admin PIN to save changes:');
    if (pin) {
      setPin(pin);
      return apiFetch(url, opts, true);
    }
  }
  if (r.status === 401) setPin('');
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${r.status})`);
  }
  return r.json();
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.hidden = false;
}
function clearError() {
  const el = document.getElementById('error-banner');
  el.hidden = true;
  el.textContent = '';
}

// Toast notification
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast-show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('toast-show'), 2800);
}

// Disable a button while an async fn runs (prevents double-submit)
async function withBusy(btnId, fn) {
  const btn = document.getElementById(btnId);
  if (btn && btn.disabled) return;   // already in flight
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  try {
    await fn();
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

// Load flats immediately on page load — runs independently of loadAll
fetch(`${API}/api/flats`)
  .then(r => {
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    return r.json();
  })
  .then(data => {
    if (!Array.isArray(data)) throw new Error('Unexpected response from server');
    flats = data;
    populateFlatDropdown();
  })
  .catch(err => {
    showError('Could not load flat list — ' + err.message + '. Make sure the server is running and DATABASE_URL is set.');
    const sel = document.getElementById('booking-flat');
    if (sel) sel.innerHTML = `<option value="">⚠ ${esc(err.message)}</option>`;
  });

async function ensureFlats() {
  if (flats.length === 0) {
    flats = await apiFetch(`${API}/api/flats`);
    populateFlatDropdown();
  }
}

function populateFlatDropdown() {
  const sel = document.getElementById('booking-flat');
  if (!sel || flats.length === 0) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Flat —</option>' +
    flats.map(f => `<option value="${f.id}">${esc(f.flat_no)}</option>`).join('');
  if (current) sel.value = current;
}

// ── Main loader ─────────────────────────────────
async function loadAll() {
  const month = monthInput.value;
  if (!month) return;
  clearError();
  try {
    await ensureFlats();
    if (activeTab === 'bookings') await loadBookings(month);
    if (activeTab === 'flats')    await loadFlatDetails(month);
    if (activeTab === 'usage')    await loadUsage(month);
    if (activeTab === 'final')    await loadFinalCalc(month);
  } catch (err) {
    showError(err.message || 'Failed to load data. Check your connection.');
  }
}

// ────────────────────────────────────────────────
// Tab 1 — Water Bookings
// ────────────────────────────────────────────────

async function loadBookings(month) {
  const [bookings, drainageBookings] = await Promise.all([
    apiFetch(`${API}/api/water-bookings?month=${month}`),
    apiFetch(`${API}/api/drainage-bookings?month=${month}`)
  ]);
  renderBookings(bookings);
  renderMetroSummary(bookings);
  renderDrainageBookings(drainageBookings);
}

async function addBooking() {
  const booking_date = document.getElementById('booking-date').value;
  const flat_id      = document.getElementById('booking-flat').value   || null;
  const type_of_load = document.getElementById('booking-type').value;
  const litres       = Number(document.getElementById('booking-litres').value || 0);
  const price        = Number(document.getElementById('booking-price').value  || 0);

  if (!booking_date || !type_of_load || !litres) return;
  clearError();
  try {
    if (price < 0) throw new Error('Price cannot be negative');
    await apiFetch(`${API}/api/water-bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_date, type_of_load, price, litres, flat_id: flat_id ? Number(flat_id) : null })
    });
    document.getElementById('booking-flat').value   = '';
    document.getElementById('booking-type').value   = '';
    document.getElementById('booking-litres').value = '';
    document.getElementById('booking-price').value  = '';
    await loadAll();
    showToast('✓ Booking added successfully');
  } catch (err) {
    showError(err.message || 'Failed to add booking.');
  }
}

function renderBookings(bookings) {
  const el      = document.getElementById('bookings-table');
  const summary = document.getElementById('booking-summary');

  const totalLitres    = bookings.reduce((s, b) => s + Number(b.litres), 0);
  const totalPrice     = bookings.reduce((s, b) => s + Number(b.price),  0);
  const pricePerLitre  = totalLitres > 0 ? (totalPrice / totalLitres) : 0;

  summary.innerHTML = bookings.length === 0 ? '' : `
    <div class="card">
      <div class="card-icon">💧</div>
      <div class="label">Total Litres</div>
      <div class="value">${totalLitres.toLocaleString('en-IN')} L</div>
    </div>
    <div class="card">
      <div class="card-icon">💰</div>
      <div class="label">Total Price</div>
      <div class="value">₹${totalPrice.toLocaleString('en-IN')}</div>
    </div>
    <div class="card">
      <div class="card-icon">📐</div>
      <div class="label">Price / Litre</div>
      <div class="value">₹${pricePerLitre.toFixed(4)}</div>
    </div>`;

  if (bookings.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💧</div>
        <p>No water bookings for this month yet.</p>
      </div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Si.No</th>
        <th>Date of Booking</th>
        <th>Flat</th>
        <th>Type of Load</th>
        <th>Price</th>
        <th>Litres</th>
      </tr></thead>
      <tbody>
        ${bookings.map((b, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${new Date(b.booking_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
            <td>${b.flat_no ? `<strong>${esc(b.flat_no)}</strong>` : '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td><span class="load-badge">${esc(b.type_of_load)}</span></td>
            <td>₹${Number(b.price).toLocaleString('en-IN')}</td>
            <td>${Number(b.litres).toLocaleString('en-IN')} L</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4">Total</td>
          <td>₹${totalPrice.toLocaleString('en-IN')}</td>
          <td>${totalLitres.toLocaleString('en-IN')} L</td>
        </tr>
      </tfoot>
    </table>`;
}

// ────────────────────────────────────────────────
// Drainage Bookings
// ────────────────────────────────────────────────

async function addDrainageBooking() {
  const booking_date  = document.getElementById('drainage-date').value;
  const num_loads     = Number(document.getElementById('drainage-loads').value || 1);
  const price_per_load = Number(document.getElementById('drainage-price').value || 0);

  if (!booking_date || num_loads < 1) return;
  clearError();
  try {
    await apiFetch(`${API}/api/drainage-bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_date, num_loads, price_per_load })
    });
    document.getElementById('drainage-loads').value = '1';
    document.getElementById('drainage-price').value = '';
    await loadAll();
    showToast('✓ Drainage booking added');
  } catch (err) {
    showError(err.message || 'Failed to add drainage booking.');
  }
}

window.deleteDrainageBooking = async function(id) {
  clearError();
  try {
    await apiFetch(`${API}/api/drainage-bookings/${id}`, { method: 'DELETE' });
    await loadAll();
  } catch (err) {
    showError(err.message || 'Failed to delete drainage booking.');
  }
};

function renderDrainageBookings(bookings) {
  const summaryEl = document.getElementById('drainage-summary');
  const tableEl   = document.getElementById('drainage-table');

  const totalLoads = bookings.reduce((s, b) => s + Number(b.num_loads), 0);
  const totalPrice = bookings.reduce((s, b) => s + Number(b.total_price), 0);

  summaryEl.innerHTML = bookings.length === 0 ? '' : `
    <div class="cards" style="margin-bottom:0">
      <div class="card">
        <div class="card-icon">🚿</div>
        <div class="label">Total Loads</div>
        <div class="value">${totalLoads}</div>
      </div>
      <div class="card">
        <div class="card-icon">💰</div>
        <div class="label">Total Drainage Cost</div>
        <div class="value">₹${totalPrice.toLocaleString('en-IN')}</div>
      </div>
    </div>`;

  if (bookings.length === 0) {
    tableEl.innerHTML = `
      <div class="empty-state" style="padding:24px 0">
        <div class="empty-icon">🚿</div>
        <p>No drainage bookings for this month yet.</p>
      </div>`;
    return;
  }

  tableEl.innerHTML = `
    <table>
      <thead><tr>
        <th>Si.No</th>
        <th>Date</th>
        <th>No. of Loads</th>
        <th>Price / Load (₹)</th>
        <th>Total (₹)</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${bookings.map((b, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${new Date(b.booking_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
            <td>${b.num_loads}</td>
            <td>₹${Number(b.price_per_load).toLocaleString('en-IN')}</td>
            <td>₹${Number(b.total_price).toLocaleString('en-IN')}</td>
            <td><button class="btn-delete" onclick="deleteDrainageBooking(${b.id})" title="Delete">✕</button></td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Total</td>
          <td>${totalLoads}</td>
          <td></td>
          <td>₹${totalPrice.toLocaleString('en-IN')}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;
}

// ────────────────────────────────────────────────
// Tab 2 — Flat Details
// ────────────────────────────────────────────────

async function loadFlatDetails(month) {
  const [readings, prevReadings, commonReading, commonCharges] = await Promise.all([
    apiFetch(`${API}/api/readings?month=${month}`),
    apiFetch(`${API}/api/readings?month=${prevMonthStr(month)}`),
    apiFetch(`${API}/api/common-readings?month=${month}`),
    apiFetch(`${API}/api/common-charges?month=${month}`)
  ]);
  renderFlatDetails(readings, prevReadings, commonReading);
  renderCommonCharges(commonCharges);
}

function renderFlatDetails(readings, prevReadings = [], commonReading = null) {
  const byFlat     = Object.fromEntries(readings.map(r => [r.flat_id, Number(r.reading_units)]));
  const byFlatPrev = Object.fromEntries(prevReadings.map(r => [r.flat_id, Number(r.reading_units)]));

  const dash = `<span style="color:var(--text-secondary)">—</span>`;

  const commonPrev = commonReading?.prev_reading != null ? Number(commonReading.prev_reading) : null;
  const commonCur  = commonReading?.cur_reading  != null ? Number(commonReading.cur_reading)  : null;
  const commonConsumed = commonCur !== null && commonPrev !== null ? Math.max(0, commonCur - commonPrev) : null;

  document.getElementById('flats-table').innerHTML = `
    <table>
      <thead><tr>
        <th>Flat ID</th>
        <th>Owner Name</th>
        <th>Previous Reading</th>
        <th>Current Reading</th>
        <th>Water Consumed</th>
      </tr></thead>
      <tbody>
        ${flats.map(f => {
          const cur      = byFlat[f.id]     !== undefined ? byFlat[f.id]     : null;
          const prev     = byFlatPrev[f.id] !== undefined ? byFlatPrev[f.id] : null;
          const consumed = cur !== null && prev !== null ? Math.max(0, cur - prev) : null;
          return `
          <tr>
            <td><strong>${esc(f.flat_no)}</strong></td>
            <td>${f.owner_name ? esc(f.owner_name) : dash}</td>
            <td>
              <input class="reading-input" type="number" data-prev-flat-id="${f.id}"
                value="${prev !== null ? prev : ''}"
                placeholder="Enter prev" min="0"
                oninput="recalcConsumed(${f.id})">
            </td>
            <td>
              <input class="reading-input" type="number" data-flat-id="${f.id}"
                value="${cur !== null ? cur : ''}"
                placeholder="Enter reading" min="0"
                oninput="recalcConsumed(${f.id})">
            </td>
            <td id="consumed-${f.id}">${consumed !== null
              ? `<span class="consumed-badge">${consumed} L</span>`
              : dash}</td>
          </tr>`;
        }).join('')}
        <tr class="common-row">
          <td><strong>Common</strong></td>
          <td style="color:var(--text-secondary)">Common Usage</td>
          <td>
            <input class="reading-input" type="number" id="common-prev-reading"
              value="${commonPrev !== null ? commonPrev : ''}"
              placeholder="Enter prev" min="0"
              oninput="recalcCommonConsumed()">
          </td>
          <td>
            <input class="reading-input" type="number" id="common-cur-reading"
              value="${commonCur !== null ? commonCur : ''}"
              placeholder="Enter reading" min="0"
              oninput="recalcCommonConsumed()">
          </td>
          <td id="consumed-common">${commonConsumed !== null
            ? `<span class="consumed-badge">${commonConsumed} L</span>`
            : dash}</td>
        </tr>
      </tbody>
    </table>`;
}

// Live recalculate Water Consumed when either reading input changes
window.recalcConsumed = function(flatId) {
  const curInp  = document.querySelector(`input[data-flat-id="${flatId}"]`);
  const prevInp = document.querySelector(`input[data-prev-flat-id="${flatId}"]`);
  const el      = document.getElementById(`consumed-${flatId}`);
  if (!curInp || !prevInp || !el) return;
  const cur  = curInp.value  !== '' ? Number(curInp.value)  : null;
  const prev = prevInp.value !== '' ? Number(prevInp.value) : null;
  const dash = `<span style="color:var(--text-secondary)">—</span>`;
  el.innerHTML = (cur !== null && prev !== null)
    ? `<span class="consumed-badge">${Math.max(0, cur - prev)} L</span>`
    : dash;
};

window.recalcCommonConsumed = function() {
  const curInp  = document.getElementById('common-cur-reading');
  const prevInp = document.getElementById('common-prev-reading');
  const el      = document.getElementById('consumed-common');
  if (!curInp || !prevInp || !el) return;
  const cur  = curInp.value  !== '' ? Number(curInp.value)  : null;
  const prev = prevInp.value !== '' ? Number(prevInp.value) : null;
  const dash = `<span style="color:var(--text-secondary)">—</span>`;
  el.innerHTML = (cur !== null && prev !== null)
    ? `<span class="consumed-badge">${Math.max(0, cur - prev)} L</span>`
    : dash;
};

async function saveReadings() {
  const month = monthInput.value;
  const prev  = prevMonthStr(month);
  clearError();
  try {
    // Save current month readings
    for (const inp of document.querySelectorAll('input[data-flat-id]')) {
      if (inp.value === '') continue;
      const val = Number(inp.value);
      if (val < 0) throw new Error('Readings cannot be negative');
      await apiFetch(`${API}/api/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flat_id: Number(inp.dataset.flatId), month, reading_units: val })
      });
    }
    // Save previous month readings (stored in DB under the prior month)
    for (const inp of document.querySelectorAll('input[data-prev-flat-id]')) {
      if (inp.value === '') continue;
      const val = Number(inp.value);
      if (val < 0) throw new Error('Readings cannot be negative');
      await apiFetch(`${API}/api/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flat_id: Number(inp.dataset.prevFlatId), month: prev, reading_units: val })
      });
    }
    // Save common area readings
    const commonPrevInp = document.getElementById('common-prev-reading');
    const commonCurInp  = document.getElementById('common-cur-reading');
    if (commonPrevInp || commonCurInp) {
      const prevVal = commonPrevInp?.value !== '' ? Number(commonPrevInp.value) : null;
      const curVal  = commonCurInp?.value  !== '' ? Number(commonCurInp.value)  : null;
      if ((prevVal !== null && prevVal < 0) || (curVal !== null && curVal < 0)) {
        throw new Error('Readings cannot be negative');
      }
      await apiFetch(`${API}/api/common-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, prev_reading: prevVal, cur_reading: curVal })
      });
    }
    await loadAll();
    showToast('✓ Readings saved');
  } catch (err) {
    showError(err.message || 'Failed to save readings.');
  }
}

// ────────────────────────────────────────────────
// Tab 3 — Water Usage
// ────────────────────────────────────────────────

async function loadUsage(month) {
  const bill = await apiFetch(`${API}/api/bill?month=${month}`);
  renderSummary(bill);
  renderUsage(bill);
}

function renderSummary(bill) {
  const discClass = bill.discrepancy_litres > 0 ? 'warning' : '';
  document.getElementById('summary-cards').innerHTML = `
    <div class="card">
      <div class="card-icon">🔵</div>
      <div class="label">Total Metered</div>
      <div class="value">${Math.round(bill.total_metered_litres).toLocaleString('en-IN')} L</div>
    </div>
    <div class="card">
      <div class="card-icon">🚰</div>
      <div class="label">Total Received</div>
      <div class="value">${Math.round(bill.total_received_litres).toLocaleString('en-IN')} L</div>
    </div>
    <div class="card ${discClass}">
      <div class="card-icon">⚖️</div>
      <div class="label">Discrepancy</div>
      <div class="value">${Math.round(bill.discrepancy_litres).toLocaleString('en-IN')} L</div>
    </div>
    <div class="card">
      <div class="card-icon">💰</div>
      <div class="label">Equal Share / Flat</div>
      <div class="value">₹${bill.equal_share.toLocaleString('en-IN')}</div>
    </div>`;
}

function renderUsage(bill) {
  const el = document.getElementById('usage-table');
  if (!bill.flats || bill.flats.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <p>No usage data for this month yet.</p>
      </div>`;
    return;
  }

  const dash = `<span style="color:var(--text-secondary)">—</span>`;

  // All shares come from the server (billing.js) so every tab uses the same numbers
  const c = bill.common;
  const grandAdjustedTotal = bill.flats.reduce((s, f) => s + f.adjusted_litres, 0) + c.adjusted_litres;
  const grandTotalPrice = Math.round(
    (bill.flats.reduce((s, f) => s + f.water_charge, 0) + c.water_charge) * 100
  ) / 100;

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Flat ID</th>
        <th>Owner Name</th>
        <th>Prev Reading</th>
        <th>Curr Reading</th>
        <th>Usage (L)</th>
        <th>% Usage</th>
        <th>Predicted Usage (L)</th>
        <th>Total Usage (L)</th>
        <th>Price (₹)</th>
      </tr></thead>
      <tbody>
        ${bill.flats.map(f => `
          <tr>
            <td><strong>${esc(f.flat_no)}</strong></td>
            <td>${f.owner_name ? esc(f.owner_name) : dash}</td>
            <td>${f.prev_reading ?? dash}</td>
            <td>${f.cur_reading  ?? dash}</td>
            <td>${Number(f.units).toLocaleString('en-IN')}</td>
            <td>${f.pct}%</td>
            <td>${Number(f.discrepancy_share_litres).toLocaleString('en-IN')}</td>
            <td>${f.adjusted_litres.toLocaleString('en-IN')}</td>
            <td>₹${f.water_charge.toLocaleString('en-IN')}</td>
          </tr>`).join('')}
        <tr class="common-row">
          <td><strong>Common</strong></td>
          <td>Common Usage</td>
          <td>${c.prev_reading !== null ? c.prev_reading.toLocaleString('en-IN') : dash}</td>
          <td>${c.cur_reading  !== null ? c.cur_reading.toLocaleString('en-IN')  : dash}</td>
          <td>${c.units.toLocaleString('en-IN')}</td>
          <td>${c.pct}%</td>
          <td>${c.discrepancy_share_litres.toLocaleString('en-IN')}</td>
          <td>${c.adjusted_litres.toLocaleString('en-IN')}</td>
          <td>₹${c.water_charge.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4"><strong>Total</strong></td>
          <td><strong>${Math.round(bill.total_metered_litres).toLocaleString('en-IN')} L</strong></td>
          <td><strong>100%</strong></td>
          <td><strong>${Math.round(bill.discrepancy_litres).toLocaleString('en-IN')} L</strong></td>
          <td><strong>${grandAdjustedTotal.toLocaleString('en-IN')} L</strong></td>
          <td><strong>₹${grandTotalPrice.toLocaleString('en-IN')}</strong></td>
        </tr>
      </tfoot>
    </table>`;
}

// ────────────────────────────────────────────────
// Common Charges
// ────────────────────────────────────────────────

function renderMetroSummary(bookings) {
  const el = document.getElementById('metro-summary-table');
  if (!el) return;

  // Aggregate Metro bookings per flat
  const metroByFlat = {};
  for (const b of bookings) {
    if (b.type_of_load !== 'Metro') continue;
    const key = b.flat_id;
    if (!metroByFlat[key]) metroByFlat[key] = { flat_no: b.flat_no, count: 0, totalPrice: 0 };
    metroByFlat[key].count      += 1;
    metroByFlat[key].totalPrice += Number(b.price);
  }

  const dash = `<span style="color:var(--text-secondary)">—</span>`;
  const rows = flats
    .map(f => {
      const data = metroByFlat[f.id];
      if (!data) return null;
      const priceEach = Math.round(data.totalPrice / data.count);
      return { flat_no: f.flat_no, count: data.count, priceEach, total: data.totalPrice };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:24px 0">
      <div class="empty-icon">🚛</div>
      <p>No Metro bookings this month.</p>
    </div>`;
    return;
  }

  const grandCount = rows.reduce((s, r) => s + r.count, 0);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Flat Number</th>
        <th>No. of Metro Bookings</th>
        <th>Price / Booking (₹)</th>
        <th>Total Price (₹)</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><strong>${esc(r.flat_no)}</strong></td>
            <td>${r.count > 0 ? r.count : dash}</td>
            <td>${r.count > 0 ? `₹${r.priceEach.toLocaleString('en-IN')}` : dash}</td>
            <td>${r.count > 0 ? `₹${r.total.toLocaleString('en-IN')}` : dash}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>${grandCount}</strong></td>
          <td></td>
          <td><strong>₹${grandTotal.toLocaleString('en-IN')}</strong></td>
        </tr>
      </tfoot>
    </table>`;
}

const COMMON_CATEGORIES = [
  'Common EB', 'Drainage Load', 'Miscellaneous',
  'Watchman Salary', 'Electrical Works', 'Lift Works', 'Civil Works', 'Plumbing Works'
];

function renderCommonCharges(charges) {
  const byCategory = Object.fromEntries(charges.map(c => [c.category, c]));
  const flatOptions = '<option value="">— None —</option>' +
    flats.map(f => `<option value="${f.id}">${esc(f.flat_no)}</option>`).join('');

  document.getElementById('common-charges-table').innerHTML = `
    <table>
      <thead><tr>
        <th>Category</th>
        <th>Amount (₹)</th>
        <th>Paid By</th>
      </tr></thead>
      <tbody>
        ${COMMON_CATEGORIES.map(cat => {
          const row = byCategory[cat];
          const amount = row ? Number(row.amount) : 0;
          const paidBy = row ? (row.paid_by_flat_id || '') : '';
          const isDrainage = cat === 'Drainage Load';
          return `
          <tr>
            <td><strong>${cat}</strong>${isDrainage ? ' <span style="font-size:11px;color:var(--text-secondary)">(auto)</span>' : ''}</td>
            <td>
              ${isDrainage
                ? `<span class="consumed-badge">₹${Number(amount).toLocaleString('en-IN')}</span>
                   <input type="hidden" data-charge-cat="${cat}" value="${amount}">`
                : `<input class="reading-input" type="number" data-charge-cat="${cat}"
                     value="${amount}" placeholder="0" min="0">`
              }
            </td>
            <td>
              <select class="table-select" data-charge-paid="${cat}">
                ${flatOptions.replace(`value="${paidBy}"`, `value="${paidBy}" selected`)}
              </select>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function saveCommonCharges() {
  const month = monthInput.value;
  clearError();
  try {
    for (const cat of COMMON_CATEGORIES) {
      const amtInp  = document.querySelector(`input[data-charge-cat="${cat}"]`);
      const paidSel = document.querySelector(`select[data-charge-paid="${cat}"]`);
      const amount        = amtInp  ? Number(amtInp.value || 0) : 0;
      const paid_by_flat_id = paidSel?.value ? Number(paidSel.value) : null;
      if (amount < 0) throw new Error('Amount cannot be negative');
      await apiFetch(`${API}/api/common-charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, category: cat, amount, paid_by_flat_id })
      });
    }
    await loadAll();
    showToast('✓ Common charges saved');
  } catch (err) {
    showError(err.message || 'Failed to save common charges.');
  }
}

// ────────────────────────────────────────────────
// Tab 4 — Final Calculation
// ────────────────────────────────────────────────

async function loadFinalCalc(month) {
  const [bill, commonCharges, bookings] = await Promise.all([
    apiFetch(`${API}/api/bill?month=${month}`),
    apiFetch(`${API}/api/common-charges?month=${month}`),
    apiFetch(`${API}/api/water-bookings?month=${month}`)
  ]);
  renderFinalCalc(bill, commonCharges, bookings);
}

function renderFinalCalc(bill, commonCharges, bookings = []) {
  const el = document.getElementById('final-table');
  const numFlats = flats.length || 12;
  const dash = `<span style="color:var(--text-secondary)">—</span>`;
  const round2 = n => Math.round(n * 100) / 100;

  // Per-flat Metro paid amount (sum of all Metro booking prices for this flat)
  const metroPaidByFlat = {};
  for (const b of bookings) {
    if (b.type_of_load !== 'Metro' || !b.flat_id) continue;
    metroPaidByFlat[b.flat_id] = (metroPaidByFlat[b.flat_id] || 0) + Number(b.price);
  }

  // Build lookup for common charges by category
  const byCategory = Object.fromEntries(commonCharges.map(c => [c.category, Number(c.amount)]));

  // Per-flat credit where a flat paid a common charge upfront. The flat is still
  // charged its own equal share below, so the credit is the full amount it paid
  // (net effect: share − amount, i.e. it gets back what the other flats owe).
  const commonCreditByFlat = {};
  for (const c of commonCharges) {
    if (!c.paid_by_flat_id) continue;
    commonCreditByFlat[c.paid_by_flat_id] =
      round2((commonCreditByFlat[c.paid_by_flat_id] || 0) + Number(c.amount));
  }

  // Per-flat split amounts (equal share)
  const watchmanShare  = round2((byCategory['Watchman Salary'] || 0) / numFlats);
  const ebShare        = round2((byCategory['Common EB']       || 0) / numFlats);
  const drainageShare  = round2((byCategory['Drainage Load']   || 0) / numFlats);

  // "Other Maintenance" = everything except Water, Watchman, EB, Drainage
  const OTHER_CATS = ['Miscellaneous', 'Electrical Works', 'Lift Works', 'Civil Works', 'Plumbing Works'];
  const otherTotal  = OTHER_CATS.reduce((s, cat) => s + (byCategory[cat] || 0), 0);
  const otherShare  = round2(otherTotal / numFlats);

  // Water: each flat pays its own usage share (from the server) plus an equal
  // part of the common area's water cost.
  const commonWaterShare = round2((bill.common?.water_charge || 0) / numFlats);
  const billFlats = bill.flats || [];

  if (billFlats.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧾</div>
        <p>No data for this month yet. Add meter readings and bookings first.</p>
      </div>`;
    return;
  }

  // Grand totals row
  const totalWaterUsage  = billFlats.reduce((s, f) => s + f.adjusted_litres, 0);
  const totalWaterPrice  = round2(billFlats.reduce((s, f) => s + f.water_charge, 0));
  const totalCommonWater = commonWaterShare * numFlats;
  const totalWatchman    = watchmanShare * numFlats;
  const totalEB          = ebShare       * numFlats;
  const totalDrainage    = drainageShare * numFlats;
  const totalOther       = otherShare    * numFlats;
  const totalMetroPaid      = Object.values(metroPaidByFlat).reduce((s, v) => s + v, 0);
  const totalCommonCredit   = Object.values(commonCreditByFlat).reduce((s, v) => s + v, 0);

  const fmt  = n => Number(n).toLocaleString('en-IN');
  const fmtR = n => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtAdj = n => n === 0
    ? dash
    : `<span style="color:var(--danger-text);font-weight:600">-₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;

  el.innerHTML = `
    <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Flat ID</th>
        <th>Owner Name</th>
        <th>Total Usage (L)</th>
        <th>Water Price (₹)</th>
        <th>Common Water (₹)</th>
        <th>Watchman Salary (₹)</th>
        <th>EB Bill (₹)</th>
        <th>Drainage Bill (₹)</th>
        <th>Other Maintenance (₹)</th>
        <th>Adjusted Amount (₹)</th>
        <th>Grand Total (₹)</th>
      </tr></thead>
      <tbody>
        ${billFlats.map(f => {
          const metroPaid    = metroPaidByFlat[f.flat_id]    || 0;
          const commonCredit = commonCreditByFlat[f.flat_id] || 0;
          const totalAdj     = round2(metroPaid + commonCredit);
          const gross        = f.water_charge + commonWaterShare + watchmanShare + ebShare + drainageShare + otherShare;
          const grand        = round2(gross - totalAdj);
          return `
          <tr>
            <td><strong>${esc(f.flat_no)}</strong></td>
            <td>${f.owner_name ? esc(f.owner_name) : dash}</td>
            <td>${fmt(f.adjusted_litres)}</td>
            <td>${fmtR(f.water_charge)}</td>
            <td>${fmtR(commonWaterShare)}</td>
            <td>${fmtR(watchmanShare)}</td>
            <td>${fmtR(ebShare)}</td>
            <td>${fmtR(drainageShare)}</td>
            <td>${fmtR(otherShare)}</td>
            <td>${fmtAdj(totalAdj)}</td>
            <td><strong>${fmtR(grand)}</strong></td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2"><strong>Total</strong></td>
          <td><strong>${fmt(totalWaterUsage)} L</strong></td>
          <td><strong>${fmtR(totalWaterPrice)}</strong></td>
          <td><strong>${fmtR(totalCommonWater)}</strong></td>
          <td><strong>${fmtR(totalWatchman)}</strong></td>
          <td><strong>${fmtR(totalEB)}</strong></td>
          <td><strong>${fmtR(totalDrainage)}</strong></td>
          <td><strong>${fmtR(totalOther)}</strong></td>
          <td><strong><span style="color:var(--danger-text)">-₹${(totalMetroPaid + totalCommonCredit).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></strong></td>
          <td><strong>${fmtR(totalWaterPrice + totalCommonWater + totalWatchman + totalEB + totalDrainage + totalOther - totalMetroPaid - totalCommonCredit)}</strong></td>
        </tr>
      </tfoot>
    </table>
    </div>`;
}

updateIntro();
loadAll();
