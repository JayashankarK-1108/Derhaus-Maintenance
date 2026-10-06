require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const pool = require('./db');
const { computeBill } = require('./billing');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Write protection ---
// When ADMIN_PIN is set, every non-GET /api request must send it in the
// X-Admin-Pin header. Reads stay open so residents can view bills.
const ADMIN_PIN = process.env.ADMIN_PIN || '';
if (!ADMIN_PIN) {
  console.warn('WARNING: ADMIN_PIN is not set — anyone with the URL can modify data.');
}

function pinMatches(given) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

app.use('/api', (req, res, next) => {
  if (!ADMIN_PIN || req.method === 'GET') return next();
  if (!pinMatches(req.get('X-Admin-Pin'))) {
    return res.status(401).json({ error: 'admin PIN required' });
  }
  next();
});

// --- Validation helpers ---
function validateMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return 'month must be in YYYY-MM format';
  }
  return null;
}

function validateDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    return 'booking_date must be in YYYY-MM-DD format';
  }
  return null;
}

// Returns an error message unless v is a finite number >= 0 (> 0 when strict).
function checkNumber(name, v, { strict = false, optional = false } = {}) {
  if (v === undefined || v === null || v === '') return optional ? null : `${name} is required`;
  const n = Number(v);
  if (typeof v === 'boolean' || !Number.isFinite(n)) return `${name} must be a number`;
  if (strict ? n <= 0 : n < 0) return strict ? `${name} must be greater than zero` : `${name} cannot be negative`;
  return null;
}

function checkId(name, v, { optional = false } = {}) {
  if (v === undefined || v === null || v === '') return optional ? null : `${name} is required`;
  return Number.isInteger(Number(v)) && Number(v) > 0 ? null : `${name} must be a positive integer`;
}

const firstError = (...errs) => errs.find(Boolean) || null;

const LOAD_TYPES = ['Metro', 'Private'];

// Keep the 'Drainage Load' common charge equal to that month's drainage bookings
function syncDrainageCharge(month) {
  return pool.query(
    `INSERT INTO common_charges (month, category, amount)
     SELECT $1::char(7), 'Drainage Load', COALESCE(SUM(total_price), 0)
     FROM drainage_bookings WHERE to_char(booking_date, 'YYYY-MM') = $1::char(7)
     ON CONFLICT (month, category) DO UPDATE SET amount = EXCLUDED.amount`,
    [month]
  );
}

// --- Flats ---
app.get('/api/flats', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM flats ORDER BY flat_no');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load flats' });
  }
});

// --- Meter readings ---
app.get('/api/readings', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const { rows } = await pool.query(
      `SELECT r.*, f.flat_no FROM meter_readings r
       JOIN flats f ON f.id = r.flat_id
       WHERE r.month = $1 ORDER BY f.flat_no`, [month]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load readings' });
  }
});

app.post('/api/readings', async (req, res) => {
  const { flat_id, month, reading_units } = req.body;
  const err = firstError(
    checkId('flat_id', flat_id),
    validateMonth(month),
    checkNumber('reading_units', reading_units)
  );
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await pool.query(
      `INSERT INTO meter_readings (flat_id, month, reading_units)
       VALUES ($1, $2, $3)
       ON CONFLICT (flat_id, month) DO UPDATE SET reading_units = EXCLUDED.reading_units
       RETURNING *`,
      [flat_id, month, reading_units]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save reading' });
  }
});

// --- Water supply (total received + bill amount for the month) ---
app.post('/api/water-supply', async (req, res) => {
  const { month, total_received_litres, water_bill_amount } = req.body;
  const err = firstError(
    validateMonth(month),
    checkNumber('total_received_litres', total_received_litres),
    checkNumber('water_bill_amount', water_bill_amount, { optional: true })
  );
  if (err) return res.status(400).json({ error: err });
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save water supply' });
  }
});

// --- Shared expenses ---
app.get('/api/expenses', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const { rows } = await pool.query('SELECT * FROM expenses WHERE month = $1 ORDER BY id', [month]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load expenses' });
  }
});

app.post('/api/expenses', async (req, res) => {
  const { month, category, amount } = req.body;
  const err = firstError(
    !category || typeof category !== 'string' ? 'category is required' : null,
    validateMonth(month),
    checkNumber('amount', amount, { strict: true })
  );
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses (month, category, amount, split_type)
       VALUES ($1, $2, $3, 'equal') RETURNING *`,
      [month, category, amount]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to add expense' });
  }
});

// --- Water bookings (individual deliveries) ---
app.get('/api/water-bookings', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const { rows } = await pool.query(
      `SELECT wb.*, f.flat_no FROM water_bookings wb
       LEFT JOIN flats f ON f.id = wb.flat_id
       WHERE to_char(wb.booking_date, 'YYYY-MM') = $1
       ORDER BY wb.booking_date, wb.id`, [month]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load water bookings' });
  }
});

app.post('/api/water-bookings', async (req, res) => {
  const { booking_date, type_of_load, price, litres, flat_id } = req.body;
  const paidByMaint = req.body.paid_by_maint === true;
  const hasFlat = flat_id !== undefined && flat_id !== null && flat_id !== '';
  const err = firstError(
    validateDate(booking_date),
    LOAD_TYPES.includes(type_of_load) ? null : `type_of_load must be one of: ${LOAD_TYPES.join(', ')}`,
    checkNumber('litres', litres, { strict: true }),
    checkNumber('price', price, { optional: true }),
    checkId('flat_id', flat_id, { optional: true }),
    hasFlat === paidByMaint ? 'select either a flat or Maint for the booking' : null
  );
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await pool.query(
      `INSERT INTO water_bookings (booking_date, type_of_load, price, litres, flat_id, paid_by_maint)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [booking_date, type_of_load, price || 0, litres, hasFlat ? flat_id : null, paidByMaint]
    );

    // Sync monthly aggregates (total litres, total price, price/litre) into water_supply
    const month = booking_date.substring(0, 7);
    await pool.query(
      `INSERT INTO water_supply (month, total_received_litres, water_bill_amount, price_per_litre)
       SELECT
         $1::char(7),
         COALESCE(SUM(litres), 0),
         COALESCE(SUM(price), 0),
         CASE WHEN SUM(litres) > 0 THEN ROUND(SUM(price)::NUMERIC / SUM(litres), 4) ELSE 0 END
       FROM water_bookings
       WHERE to_char(booking_date, 'YYYY-MM') = $1::char(7)
       ON CONFLICT (month) DO UPDATE SET
         total_received_litres = EXCLUDED.total_received_litres,
         water_bill_amount     = EXCLUDED.water_bill_amount,
         price_per_litre       = EXCLUDED.price_per_litre`,
      [month]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to add water booking' });
  }
});

// --- Computed bill (the reconciliation table) ---
app.get('/api/bill', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const bill = await computeBill(month);
    res.json(bill);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute bill' });
  }
});

// --- Drainage bookings ---
app.get('/api/drainage-bookings', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM drainage_bookings
       WHERE to_char(booking_date, 'YYYY-MM') = $1
       ORDER BY booking_date`, [month]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load drainage bookings' });
  }
});

app.post('/api/drainage-bookings', async (req, res) => {
  const { booking_date, num_loads, price_per_load } = req.body;
  const err = firstError(
    validateDate(booking_date),
    Number.isInteger(Number(num_loads)) && Number(num_loads) >= 1 ? null : 'num_loads must be a positive integer',
    checkNumber('price_per_load', price_per_load, { optional: true })
  );
  if (err) return res.status(400).json({ error: err });
  const month = booking_date.slice(0, 7);
  try {
    const { rows } = await pool.query(
      `INSERT INTO drainage_bookings (booking_date, num_loads, price_per_load)
       VALUES ($1, $2, $3) RETURNING *`,
      [booking_date, Number(num_loads), Number(price_per_load || 0)]
    );
    await syncDrainageCharge(month);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save drainage booking' });
  }
});

app.delete('/api/drainage-bookings/:id', async (req, res) => {
  const idErr = checkId('id', req.params.id);
  if (idErr) return res.status(400).json({ error: 'invalid id' });
  try {
    // Derive the month in SQL — converting the DATE via JS would shift it by the server's timezone
    const { rows } = await pool.query(
      `DELETE FROM drainage_bookings WHERE id=$1
       RETURNING to_char(booking_date, 'YYYY-MM') AS month`, [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    await syncDrainageCharge(rows[0].month);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to delete drainage booking' });
  }
});

// --- Common readings (meter for common area) ---
app.get('/api/common-readings', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM common_readings WHERE month = $1', [month]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load common readings' });
  }
});

app.post('/api/common-readings', async (req, res) => {
  const { month, prev_reading, cur_reading } = req.body;
  const err = firstError(
    validateMonth(month),
    checkNumber('prev_reading', prev_reading, { optional: true }),
    checkNumber('cur_reading', cur_reading, { optional: true })
  );
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await pool.query(
      `INSERT INTO common_readings (month, prev_reading, cur_reading)
       VALUES ($1, $2, $3)
       ON CONFLICT (month) DO UPDATE SET
         prev_reading = EXCLUDED.prev_reading,
         cur_reading  = EXCLUDED.cur_reading,
         recorded_at  = now()
       RETURNING *`,
      [month, prev_reading ?? null, cur_reading ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save common readings' });
  }
});

// --- Common charges (Common EB, Drainage Load, Miscellaneous) ---
app.get('/api/common-charges', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    // Always re-sync Drainage Load from drainage_bookings so it stays accurate
    await syncDrainageCharge(month);
    const { rows } = await pool.query(
      `SELECT cc.*, f.flat_no FROM common_charges cc
       LEFT JOIN flats f ON f.id = cc.paid_by_flat_id
       WHERE cc.month = $1 ORDER BY cc.id`, [month]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load common charges' });
  }
});

app.post('/api/common-charges', async (req, res) => {
  const { month, category, amount, paid_by_flat_id } = req.body;
  const err = firstError(
    !category || typeof category !== 'string' ? 'category is required' : null,
    validateMonth(month),
    checkNumber('amount', amount, { optional: true }),
    checkId('paid_by_flat_id', paid_by_flat_id, { optional: true })
  );
  if (err) return res.status(400).json({ error: err });
  try {
    let finalAmount;
    if (category === 'Drainage Load') {
      // Amount is always derived from drainage_bookings; never allow manual override
      const { rows: dr } = await pool.query(
        `SELECT COALESCE(SUM(total_price), 0) AS total
         FROM drainage_bookings WHERE to_char(booking_date, 'YYYY-MM') = $1::char(7)`, [month]
      );
      finalAmount = dr[0].total;
    } else {
      finalAmount = amount ?? 0;
    }
    const { rows } = await pool.query(
      `INSERT INTO common_charges (month, category, amount, paid_by_flat_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (month, category) DO UPDATE SET
         amount          = EXCLUDED.amount,
         paid_by_flat_id = EXCLUDED.paid_by_flat_id
       RETURNING *`,
      [month, category, finalAmount, paid_by_flat_id || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save common charge' });
  }
});

// --- Payments ---
app.get('/api/payments', async (req, res) => {
  const { month } = req.query;
  const monthErr = validateMonth(month);
  if (monthErr) return res.status(400).json({ error: monthErr });
  try {
    const { rows } = await pool.query(
      `SELECT p.*, f.flat_no FROM payments p JOIN flats f ON f.id = p.flat_id
       WHERE p.month = $1 ORDER BY f.flat_no`, [month]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load payments' });
  }
});

app.post('/api/payments', async (req, res) => {
  const { flat_id, month, amount_due, paid, upi_ref } = req.body;
  const err = firstError(
    checkId('flat_id', flat_id),
    validateMonth(month),
    checkNumber('amount_due', amount_due)
  );
  if (err) return res.status(400).json({ error: err });
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to record payment' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Derhaus Maintenance API running on port ${PORT}`));
