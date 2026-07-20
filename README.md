# Sunrise Apartments — maintenance app

Splits water usage (by meter reading, with supply-vs-metered discrepancy
reconciliation) and shared expenses (watchman, EB, drainage, etc.) equally
across 12 flats, backed by Postgres on Neon, deployable on Render.

## 1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a new project.
2. Copy the connection string it gives you (starts with `postgres://...`,
   ends with `?sslmode=require`).
3. Run the schema against it. Two options:
   - Paste the contents of `schema.sql` into the Neon SQL editor in your
     browser and run it, or
   - Locally: `DATABASE_URL="<your connection string>" npm run migrate`

This creates the `flats`, `meter_readings`, `water_supply`, `expenses`,
and `payments` tables, and seeds 12 flats (`A1`–`C4` — edit `schema.sql`
first if your flat numbers differ).

## 2. Deploy to Render

**Option A — Blueprint (recommended)**
1. Push this folder to a GitHub repo.
2. In Render, click **New > Blueprint**, point it at the repo. Render
   reads `render.yaml` automatically.
3. When prompted, paste your Neon connection string as the `DATABASE_URL`
   environment variable (it's marked `sync: false` so Render will ask).
4. Deploy. Render builds with `npm install` and starts with `npm start`.

**Option B — Manual web service**
1. New > Web Service, connect the repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add environment variable `DATABASE_URL` = your Neon connection string.
4. Deploy.

## 3. Using the app

Open the deployed URL. For each month:
1. Enter every flat's current cumulative meter reading (units — 1 unit =
   1000 litres). Consumption is computed automatically as this month's
   reading minus last month's for that flat.
2. Enter the total water received that month (from the tanker/municipal
   bill) and the total ₹ water bill amount.
3. Add shared expenses (watchman salary, EB bill, drainage/STP, etc.) —
   each one is split equally across all 12 flats.
4. The bill table shows, per flat: consumption units, % share of total
   usage, adjusted litres (consumption + its share of the
   received-vs-metered discrepancy), water charge (₹, proportional to
   usage share), equal share (₹), and total due.

## API reference

| Method | Path              | Purpose                                  |
|--------|-------------------|-------------------------------------------|
| GET    | /api/flats        | List all flats                             |
| GET    | /api/readings     | `?month=YYYY-MM` readings for that month   |
| POST   | /api/readings     | Upsert a flat's reading for a month        |
| POST   | /api/water-supply | Set total received litres + bill ₹ for month |
| GET    | /api/expenses     | `?month=YYYY-MM` shared expenses           |
| POST   | /api/expenses     | Add a shared (equal-split) expense         |
| GET    | /api/bill         | `?month=YYYY-MM` full computed bill        |
| GET    | /api/payments     | `?month=YYYY-MM` payment status per flat   |
| POST   | /api/payments     | Record/toggle a flat's payment             |

## Notes / next steps

- Payments here just track paid/pending — wiring an actual UPI deep link
  (`upi://pay?pa=<vpa>&am=<amount>&tn=<note>`) per flat using the `upi_id`
  column on `flats` is a natural next step, matching what you did for
  Sip & Snack.
- `split_type` on expenses is currently always `'equal'` — if you later
  want usage-based non-water expenses (e.g. per-flat parking), extend the
  check constraint and billing.js accordingly.
- Free-tier Render web services sleep after inactivity; the first request
  after a while will be slow to wake up. Fine for a 12-flat association,
  but worth knowing.
