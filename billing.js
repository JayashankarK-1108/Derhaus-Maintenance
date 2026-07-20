const pool = require('./db');

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m-1 is this month (0-indexed), -1 more for prev
  const py = d.getUTCFullYear();
  const pm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}

// Builds the full reconciled bill for a given month across all flats.
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

  const { rows: supplyRows } = await pool.query(
    'SELECT total_received_litres, water_bill_amount FROM water_supply WHERE month = $1', [month]
  );
  const supply = supplyRows[0] || { total_received_litres: 0, water_bill_amount: 0 };

  const { rows: expenseRows } = await pool.query(
    "SELECT amount FROM expenses WHERE month = $1 AND split_type = 'equal'", [month]
  );
  const totalEqualExpenses = expenseRows.reduce((s, r) => s + Number(r.amount), 0);
  const equalShare = flats.length ? totalEqualExpenses / flats.length : 0;

  // Consumption per flat, in units, defaulting to 0 if a reading is missing.
  const consumption = flats.map(f => {
    const cur = curMap[f.id];
    const prev = prevMap[f.id];
    const units = (cur !== undefined && prev !== undefined) ? Math.max(0, cur - prev) : 0;
    return { flat: f, units };
  });

  const totalUnits = consumption.reduce((s, c) => s + c.units, 0);
  const totalMeteredLitres = totalUnits * 1000;
  const totalReceivedLitres = Number(supply.total_received_litres) || totalMeteredLitres;
  const discrepancyLitres = totalReceivedLitres - totalMeteredLitres;
  const waterBillAmount = Number(supply.water_bill_amount) || 0;

  const bill = consumption.map(({ flat, units }) => {
    const pct = totalUnits > 0 ? units / totalUnits : 0;
    const meteredLitres = units * 1000;
    const discrepancyShareLitres = pct * discrepancyLitres;
    const adjustedLitres = meteredLitres + discrepancyShareLitres;
    const waterCharge = pct * waterBillAmount; // billed proportional to usage share
    const totalDue = waterCharge + equalShare;

    return {
      flat_id: flat.id,
      flat_no: flat.flat_no,
      owner_name: flat.owner_name,
      units,
      pct: Number((pct * 100).toFixed(2)),
      metered_litres: Math.round(meteredLitres),
      discrepancy_share_litres: Math.round(discrepancyShareLitres),
      adjusted_litres: Math.round(adjustedLitres),
      water_charge: Math.round(waterCharge * 100) / 100,
      equal_share: Math.round(equalShare * 100) / 100,
      total_due: Math.round(totalDue * 100) / 100
    };
  });

  return {
    month,
    total_units: totalUnits,
    total_metered_litres: totalMeteredLitres,
    total_received_litres: totalReceivedLitres,
    discrepancy_litres: discrepancyLitres,
    water_bill_amount: waterBillAmount,
    total_equal_expenses: totalEqualExpenses,
    equal_share: Math.round(equalShare * 100) / 100,
    flats: bill
  };
}

module.exports = { computeBill, prevMonth };
