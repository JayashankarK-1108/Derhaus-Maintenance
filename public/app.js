const API = '';

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  .then(r => r.json())
  .then(data => {
    flats = data;
    populateFlatDropdown();
  })
  .catch(() => {
    const sel = document.getElementById('booking-flat');
    if (sel) sel.innerHTML = '<option value="">⚠ Could not load flats</option>';
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
  const el = document.getElementById('bookings-table');
  if (bookings.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💧</div>
        <p>No water bookings for this month yet.</p>
      </div>`;
    return;
  }
  const totalLitres = bookings.reduce((s, b) => s + Number(b.litres), 0);
  const totalPrice  = bookings.reduce((s, b) => s + Number(b.price),  0);
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
  const readings = await apiFetch(`${API}/api/readings?month=${month}`);
  renderFlatDetails(readings);
}

function renderFlatDetails(readings) {
  const byFlat = Object.fromEntries(readings.map(r => [r.flat_id, r.reading_units]));
  document.getElementById('flats-table').innerHTML = `
    <table>
      <thead><tr>
        <th>Flat ID</th>
        <th>Owner Name</th>
        <th>Current Reading (units)</th>
      </tr></thead>
      <tbody>
        ${flats.map(f => `
          <tr>
            <td><strong>${f.flat_no}</strong></td>
            <td>${f.owner_name || '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td>
              <input class="reading-input" type="number" data-flat-id="${f.id}"
                value="${byFlat[f.id] !== undefined ? byFlat[f.id] : ''}"
                placeholder="Enter units" min="0">
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function saveReadings() {
  const month  = monthInput.value;
  const inputs = Array.from(document.querySelectorAll('input[data-flat-id]'));
  clearError();
  try {
    for (const inp of inputs) {
      if (inp.value === '') continue;
      const val = Number(inp.value);
      if (val < 0) throw new Error('Readings cannot be negative');
      await apiFetch(`${API}/api/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flat_id: Number(inp.dataset.flatId), month, reading_units: val })
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
  const totalUsageL = Math.round(bill.total_metered_litres).toLocaleString('en-IN');
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Flat ID</th>
        <th>Owner Name</th>
        <th>Prev Reading</th>
        <th>Curr Reading</th>
        <th>Usage (units)</th>
        <th>% Usage</th>
        <th>Total Usage (L)</th>
        <th>Price (₹)</th>
      </tr></thead>
      <tbody>
        ${bill.flats.map(f => `
          <tr>
            <td><strong>${f.flat_no}</strong></td>
            <td>${f.owner_name || '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td>${f.prev_reading ?? '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td>${f.cur_reading  ?? '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td>${f.units}</td>
            <td>${f.pct}%</td>
            <td>${totalUsageL}</td>
            <td>₹${f.water_charge.toLocaleString('en-IN')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

updateIntro();
loadAll();
