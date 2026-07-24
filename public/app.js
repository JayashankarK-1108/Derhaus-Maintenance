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

const monthInput = document.getElementById('month');
monthInput.value = currentMonthStr();

document.getElementById('booking-date').value = new Date().toISOString().split('T')[0];

let flats = [];
let activeTab = 'bookings';

const TAB_META = {
  bookings: { icon: '💧', title: 'Water', accent: 'Bookings',   sub: 'Track water deliveries for the month' },
  flats:    { icon: '🏠', title: 'Flat',  accent: 'Details',    sub: 'View and update meter readings per flat' },
  usage:    { icon: '📊', title: 'Water', accent: 'Usage',      sub: 'Consumption breakdown and billing' }
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
document.getElementById('add-booking-btn').addEventListener('click', addBooking);
document.getElementById('save-readings-btn').addEventListener('click', saveReadings);
document.getElementById('save-charges-btn').addEventListener('click', saveCommonCharges);

// ── Helpers ─────────────────────────────────────
async function apiFetch(url, opts) {
  const r = await fetch(url, opts);
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
    if (sel) sel.innerHTML = `<option value="">⚠ ${err.message}</option>`;
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
    flats.map(f => `<option value="${f.id}">${f.flat_no}</option>`).join('');
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
  } catch (err) {
    showError(err.message || 'Failed to load data. Check your connection.');
  }
}

// ────────────────────────────────────────────────
// Tab 1 — Water Bookings
// ────────────────────────────────────────────────

async function loadBookings(month) {
  const bookings = await apiFetch(`${API}/api/water-bookings?month=${month}`);
  renderBookings(bookings);
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
            <td>${b.flat_no ? `<strong>${b.flat_no}</strong>` : '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td><span class="load-badge">${b.type_of_load}</span></td>
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
            <td><strong>${f.flat_no}</strong></td>
            <td>${f.owner_name || dash}</td>
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
  } catch (err) {
    showError(err.message || 'Failed to save readings.');
  }
}

// ────────────────────────────────────────────────
// Tab 3 — Water Usage
// ────────────────────────────────────────────────

async function loadUsage(month) {
  const [bill, commonReading] = await Promise.all([
    apiFetch(`${API}/api/bill?month=${month}`),
    apiFetch(`${API}/api/common-readings?month=${month}`)
  ]);
  renderSummary(bill);
  renderUsage(bill, commonReading);
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

function renderUsage(bill, commonReading = null) {
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

  // Common area calculations
  const commonPrev = commonReading?.prev_reading != null ? Number(commonReading.prev_reading) : null;
  const commonCur  = commonReading?.cur_reading  != null ? Number(commonReading.cur_reading)  : null;
  const commonUnits = (commonCur !== null && commonPrev !== null) ? Math.max(0, commonCur - commonPrev) : 0;

  // Totals
  const grandTotalUnits  = bill.total_units + commonUnits;
  const commonPct        = grandTotalUnits > 0 ? Number(((commonUnits / grandTotalUnits) * 100).toFixed(2)) : 0;
  const commonCharge     = grandTotalUnits > 0 ? Math.round((commonUnits / grandTotalUnits) * bill.water_bill_amount * 100) / 100 : 0;

  const totalUsageL      = Math.round(bill.total_metered_litres + commonUnits).toLocaleString('en-IN');
  const totalFlatPrice   = bill.flats.reduce((s, f) => s + f.water_charge, 0);
  const grandTotalPrice  = Math.round((totalFlatPrice + commonCharge) * 100) / 100;
  const grandTotalUsage  = bill.flats.reduce((s, f) => s + f.units, 0) + commonUnits;

  const commonDiscShare = Math.round(commonPct / 100 * bill.discrepancy_litres);
  const totalDiscrepancy = Math.round(bill.discrepancy_litres);

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
            <td><strong>${f.flat_no}</strong></td>
            <td>${f.owner_name || dash}</td>
            <td>${f.prev_reading ?? dash}</td>
            <td>${f.cur_reading  ?? dash}</td>
            <td>${Number(f.units).toLocaleString('en-IN')}</td>
            <td>${f.pct}%</td>
            <td>${Number(f.discrepancy_share_litres).toLocaleString('en-IN')}</td>
            <td>${totalUsageL}</td>
            <td>₹${f.water_charge.toLocaleString('en-IN')}</td>
          </tr>`).join('')}
        <tr class="common-row">
          <td><strong>Common</strong></td>
          <td>Common Usage</td>
          <td>${commonPrev !== null ? commonPrev.toLocaleString('en-IN') : dash}</td>
          <td>${commonCur  !== null ? commonCur.toLocaleString('en-IN')  : dash}</td>
          <td>${commonUnits.toLocaleString('en-IN')}</td>
          <td>${commonPct}%</td>
          <td>${commonDiscShare.toLocaleString('en-IN')}</td>
          <td>${totalUsageL}</td>
          <td>₹${commonCharge.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4"><strong>Total</strong></td>
          <td><strong>${grandTotalUsage.toLocaleString('en-IN')} L</strong></td>
          <td><strong>100%</strong></td>
          <td><strong>${totalDiscrepancy.toLocaleString('en-IN')} L</strong></td>
          <td><strong>${totalUsageL}</strong></td>
          <td><strong>₹${grandTotalPrice.toLocaleString('en-IN')}</strong></td>
        </tr>
      </tfoot>
    </table>`;
}

// ────────────────────────────────────────────────
// Common Charges
// ────────────────────────────────────────────────

const COMMON_CATEGORIES = ['Common EB', 'Drainage Load', 'Miscellaneous'];

function renderCommonCharges(charges) {
  const byCategory = Object.fromEntries(charges.map(c => [c.category, c]));
  const flatOptions = '<option value="">— None —</option>' +
    flats.map(f => `<option value="${f.id}">${f.flat_no}</option>`).join('');

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
          const amount = row ? row.amount : '';
          const paidBy = row ? (row.paid_by_flat_id || '') : '';
          return `
          <tr>
            <td><strong>${cat}</strong></td>
            <td>
              <input class="reading-input" type="number" data-charge-cat="${cat}"
                value="${amount}" placeholder="0" min="0">
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
  } catch (err) {
    showError(err.message || 'Failed to save common charges.');
  }
}

updateIntro();
loadAll();
