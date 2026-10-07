const pool = require('./db');

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  const py = d.getUTCFullYear();
  const pm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}

const round2 = n => Math.round(n * 100) / 100;
const round3 = n => Math.round(n * 1000) / 1000;

// Builds the full reconciled water bill for a given month across all flats
// plus the common-area meter. All readings are in litres.
//
// Every consumer (each flat and the common area) gets:
//   pct            = its metered litres / total metered litres (flats + common)
//   discrepancy    = pct × (received − metered), so shares sum to the discrepancy
//   adjusted       = metered + discrepancy share  (sums to total received)
//   water_charge   = adjusted litres × price per litre
// price_per_litre = all bookings' price ÷ all booked litres (flat and Maint
// bookings alike), rounded to 3 decimals — the same rate the Bookings tab shows.
async function computeBill(month) {
  const prior = prevMonth(month);

  const { rows: flats } = await pool.query('SELECT id, flat_no, owner_name, upi_id FROM flats ORDER BY flat_no');

  const { rows: currentReadings } = await pool.query(
    'SELECT flat_id, reading_units FROM meter_readings WHERE month = $1', [month]
  );
  const { rows: priorReadings } = await pool.query(
    'SELECT flat_id, reading_units FROM meter_readings WHERE month = $1', [prior]
  );
  const curMap = Object.fromEntries(currentReadings.map(r => [r.flat_id, Number(r.reading_units)]));
  const prevMap = Object.fromEntries(priorReadings.map(r => [r.flat_id, Number(r.reading_units)]));

  const { rows: [commonRow] } = await pool.query(
    'SELECT prev_reading, cur_reading FROM common_readings WHERE month = $1', [month]
  );
  const commonPrev = commonRow?.prev_reading != null ? Number(commonRow.prev_reading) : null;
  const commonCur  = commonRow?.cur_reading  != null ? Number(commonRow.cur_reading)  : null;
  const commonUnits = (commonPrev !== null && commonCur !== null) ? Math.max(0, commonCur - commonPrev) : 0;

  // Aggregate total received litres and bill amount from individual water bookings
  const { rows: [supply] } = await pool.query(
    `SELECT COALESCE(SUM(litres), 0) AS total_received_litres,
            COALESCE(SUM(price), 0)  AS water_bill_amount
     FROM water_bookings
     WHERE to_char(booking_date, 'YYYY-MM') = $1`, [month]
  );

  const { rows: expenseRows } = await pool.query(
    "SELECT amount FROM expenses WHERE month = $1 AND split_type = 'equal'", [month]
  );
  const totalEqualExpenses = expenseRows.reduce((s, r) => s + Number(r.amount), 0);
  const equalShare = flats.length ? totalEqualExpenses / flats.length : 0;

  const consumption = flats.map(f => {
    const cur = curMap[f.id];
    const prev = prevMap[f.id];
    const units = (cur !== undefined && prev !== undefined) ? Math.max(0, cur - prev) : 0;
    return { flat: f, units, cur, prev };
  });

  const flatUnits = consumption.reduce((s, c) => s + c.units, 0);
  const totalMeteredLitres = flatUnits + commonUnits;
  const bookedLitres = Number(supply.total_received_litres) || 0;
  const totalReceivedLitres = bookedLitres || totalMeteredLitres;
  const discrepancyLitres = totalReceivedLitres - totalMeteredLitres;
  const waterBillAmount = Number(supply.water_bill_amount) || 0;
  const pricePerLitre = bookedLitres > 0 ? round3(waterBillAmount / bookedLitres) : 0;

  function share(units) {
    const pct = totalMeteredLitres > 0 ? units / totalMeteredLitres : 0;
    const discrepancyShareLitres = pct * discrepancyLitres;
    const adjustedLitres = Math.round(units + discrepancyShareLitres);
    return {
      units,
      pct: Number((pct * 100).toFixed(2)),
      metered_litres: Math.round(units),
      discrepancy_share_litres: Math.round(discrepancyShareLitres),
      adjusted_litres: adjustedLitres,
      water_charge: round2(adjustedLitres * pricePerLitre)
    };
  }

  const bill = consumption.map(({ flat, units, cur, prev }) => {
    const s = share(units);
    return {
      flat_id: flat.id,
      flat_no: flat.flat_no,
      owner_name: flat.owner_name,
      prev_reading: prev ?? null,
      cur_reading: cur ?? null,
      ...s,
      equal_share: round2(equalShare),
      total_due: round2(s.water_charge + equalShare)
    };
  });

  return {
    month,
    total_units: totalMeteredLitres,
    total_metered_litres: totalMeteredLitres,
    total_received_litres: totalReceivedLitres,
    discrepancy_litres: discrepancyLitres,
    water_bill_amount: waterBillAmount,
    price_per_litre: pricePerLitre,
    total_equal_expenses: totalEqualExpenses,
    equal_share: round2(equalShare),
    flats: bill,
    common: { prev_reading: commonPrev, cur_reading: commonCur, ...share(commonUnits) }
  };
}

module.exports = { computeBill, prevMonth };
