const API = '';

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const monthInput = document.getElementById('month');
monthInput.value = currentMonthStr();

document.getElementById('load-btn').addEventListener('click', loadAll);
document.getElementById('save-supply-btn').addEventListener('click', saveSupply);
document.getElementById('add-expense-btn').addEventListener('click', addExpense);

let flats = [];

async function loadAll() {
  const month = monthInput.value;
  if (!month) return;

  if (flats.length === 0) {
    flats = await fetch(`${API}/api/flats`).then(r => r.json());
    renderReadingsForm();
  }

  const [readings, expenses, bill] = await Promise.all([
    fetch(`${API}/api/readings?month=${month}`).then(r => r.json()),
    fetch(`${API}/api/expenses?month=${month}`).then(r => r.json()),
    fetch(`${API}/api/bill?month=${month}`).then(r => r.json())
  ]);

  fillReadingValues(readings);
  renderExpenses(expenses);
  renderBill(bill);
  renderSummary(bill);
}

function renderReadingsForm() {
  const el = document.getElementById('readings-form');
  el.innerHTML = `<div class="readings-grid">${flats.map(f => `
    <div>
      <label>${f.flat_no}</label>
      <input type="number" data-flat-id="${f.id}" placeholder="units">
    </div>`).join('')}</div>
    <button style="margin-top:10px" id="save-readings-btn">Save readings</button>`;
  document.getElementById('save-readings-btn').addEventListener('click', saveReadings);
}

function fillReadingValues(readings) {
  const byFlat = Object.fromEntries(readings.map(r => [r.flat_id, r.reading_units]));
  el_all('input[data-flat-id]').forEach(inp => {
    const val = byFlat[inp.dataset.flatId];
    inp.value = val !== undefined ? val : '';
  });
}

function el_all(sel) { return Array.from(document.querySelectorAll(sel)); }

async function saveReadings() {
  const month = monthInput.value;
  const inputs = el_all('input[data-flat-id]');
  for (const inp of inputs) {
    if (inp.value === '') continue;
    await fetch(`${API}/api/readings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flat_id: Number(inp.dataset.flatId), month, reading_units: Number(inp.value) })
    });
  }
  loadAll();
}

async function saveSupply() {
  const month = monthInput.value;
  const total_received_litres = Number(document.getElementById('water-received').value || 0);
  const water_bill_amount = Number(document.getElementById('water-bill-amount').value || 0);
  await fetch(`${API}/api/water-supply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, total_received_litres, water_bill_amount })
  });
  loadAll();
}

async function addExpense() {
  const month = monthInput.value;
  const category = document.getElementById('exp-category').value.trim();
  const amount = Number(document.getElementById('exp-amount').value || 0);
  if (!category || !amount) return;
  await fetch(`${API}/api/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, category, amount })
  });
  document.getElementById('exp-category').value = '';
  document.getElementById('exp-amount').value = '';
  loadAll();
}

function renderExpenses(expenses) {
  const el = document.getElementById('expenses-list');
  if (expenses.length === 0) { el.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No expenses added yet.</p>'; return; }
  el.innerHTML = expenses.map(e => `
    <div class="expense-row"><span>${e.category}</span><span>₹${Number(e.amount).toLocaleString('en-IN')}</span></div>
  `).join('');
}

function renderSummary(bill) {
  const el = document.getElementById('summary-cards');
  const discClass = bill.discrepancy_litres > 0 ? 'warning' : '';
  el.innerHTML = `
    <div class="card"><div class="label">Total metered</div><div class="value">${Math.round(bill.total_metered_litres).toLocaleString('en-IN')} L</div></div>
    <div class="card"><div class="label">Total received</div><div class="value">${Math.round(bill.total_received_litres).toLocaleString('en-IN')} L</div></div>
    <div class="card ${discClass}"><div class="label">Discrepancy</div><div class="value">${Math.round(bill.discrepancy_litres).toLocaleString('en-IN')} L</div></div>
    <div class="card"><div class="label">Equal share / flat</div><div class="value">₹${bill.equal_share.toLocaleString('en-IN')}</div></div>
  `;
}

async function togglePaid(flatId, month, amount, paid) {
  await fetch(`${API}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flat_id: flatId, month, amount_due: amount, paid: !paid })
  });
  loadAll();
}
window.togglePaid = togglePaid;

function renderBill(bill) {
  const el = document.getElementById('bill-table');
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Flat</th><th>Units</th><th>Share</th><th>Adjusted L</th><th>Water ₹</th><th>Equal ₹</th><th>Total ₹</th>
      </tr></thead>
      <tbody>
        ${bill.flats.map(f => `
          <tr>
            <td>${f.flat_no}</td>
            <td>${f.units}</td>
            <td>${f.pct}%</td>
            <td>${f.adjusted_litres.toLocaleString('en-IN')}</td>
            <td>₹${f.water_charge.toLocaleString('en-IN')}</td>
            <td>₹${f.equal_share.toLocaleString('en-IN')}</td>
            <td>₹${f.total_due.toLocaleString('en-IN')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

loadAll();
