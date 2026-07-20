require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const { computeBill } = require('./billing');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Flats ---
app.get('/api/flats', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM flats ORDER BY flat_no');
  res.json(rows);
});

// --- Meter readings ---
app.get('/api/readings', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  const { rows } = await pool.query(
    `SELECT r.*, f.flat_no FROM meter_readings r
     JOIN flats f ON f.id = r.flat_id
     WHERE r.month = $1 ORDER BY f.flat_no`, [month]
  );
  res.json(rows);
});

app.post('/api/readings', async (req, res) => {
  const { flat_id, month, reading_units } = req.body;
  if (!flat_id || !month || reading_units === undefined) {
    return res.status(400).json({ error: 'flat_id, month, reading_units are required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO meter_readings (flat_id, month, reading_units)
     VALUES ($1, $2, $3)
     ON CONFLICT (flat_id, month) DO UPDATE SET reading_units = EXCLUDED.reading_units
     RETURNING *`,
    [flat_id, month, reading_units]
  );
  res.json(rows[0]);
});

// --- Water supply (total received + bill amount for the month) ---
app.post('/api/water-supply', async (req, res) => {
  const { month, total_received_litres, water_bill_amount } = req.body;
  if (!month || total_received_litres === undefined) {
    return res.status(400).json({ error: 'month and total_received_litres are required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO water_supply (month, total_received_litres, water_bill_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (month) DO UPDATE SET
       total_received_litres = EXCLUDED.total_received_litres,
       water_bill_amount = EXCLUDED.water_bill_amount
     RETURNING *`,
    [month, total_received_litres, water_bill_amount || 0]
  );
  res.json(rows[0]);
});

// --- Shared expenses ---
app.get('/api/expenses', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month query param required' });
  const { rows } = await pool.query('SELECT * FROM expenses WHERE month = $1 ORDER BY id', [month]);
  res.json(rows);
});

app.post('/api/expenses', async (req, res) => {
  const { month, category, amount } = req.body;
  if (!month || !category || amount === undefined) {
    return res.status(400).json({ error: 'month, category, amount are required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO expenses (month, category, amount, split_type)
     VALUES ($1, $2, $3, 'equal') RETURNING *`,
    [month, category, amount]
  );
  res.json(rows[0]);
});

// --- Computed bill (the reconciliation table) ---
app.get('/api/bill', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  try {
    const bill = await computeBill(month);
    res.json(bill);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute bill' });
  }
});

// --- Payments ---
app.get('/api/payments', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month query param required' });
  const { rows } = await pool.query(
    `SELECT p.*, f.flat_no FROM payments p JOIN flats f ON f.id = p.flat_id
     WHERE p.month = $1 ORDER BY f.flat_no`, [month]
  );
  res.json(rows);
});

app.post('/api/payments', async (req, res) => {
  const { flat_id, month, amount_due, paid, upi_ref } = req.body;
  if (!flat_id || !month || amount_due === undefined) {
    return res.status(400).json({ error: 'flat_id, month, amount_due are required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO payments (flat_id, month, amount_due, paid, upi_ref, paid_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 THEN now() ELSE NULL END)
     ON CONFLICT (flat_id, month) DO UPDATE SET
       amount_due = EXCLUDED.amount_due,
       paid = EXCLUDED.paid,
       upi_ref = EXCLUDED.upi_ref,
       paid_at = CASE WHEN EXCLUDED.paid THEN now() ELSE NULL END
     RETURNING *`,
    [flat_id, month, amount_due, !!paid, upi_ref || null]
  );
  res.json(rows[0]);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunrise Apartments API running on port ${PORT}`));
