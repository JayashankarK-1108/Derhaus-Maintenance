# Derhaus Apartments — maintenance app

Splits the monthly water bill by meter reading (with received-vs-metered
discrepancy reconciliation) and shared common charges (watchman, EB,
drainage, repairs, etc.) equally across 12 flats. Backed by Postgres on
Neon, deployable on Render, installable as a PWA.

## 1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a new project.
2. Copy the connection string it gives you (starts with `postgres://...`).
   Use `?sslmode=verify-full` at the end.
3. Run the schema against it. Two options:
   - Paste the contents of `schema.sql` into the Neon SQL editor in your
     browser and run it, or
   - Locally: `DATABASE_URL="<your connection string>" npm run migrate`

`schema.sql` is safe to re-run. It creates all tables and seeds 12 flats
(`Flat A1`–`A6`, `Flat B1`–`B6` — edit `schema.sql` first if your flat
numbers differ).

## 2. Deploy to Render

**Option A — Blueprint (recommended)**
1. Push this folder to a GitHub repo.
2. In Render, click **New > Blueprint**, point it at the repo. Render
   reads `render.yaml` automatically.
3. When prompted, set:
   - `DATABASE_URL` — your Neon connection string
   - `ADMIN_PIN` — a shared PIN; anyone saving changes must enter it
4. Deploy. Render runs `npm install && npm run migrate` (applies the schema
   on every deploy) and starts with `npm start`.

**Option B — Manual web service**
1. New > Web Service, connect the repo.
2. Build command: `npm install && npm run migrate`. Start command: `npm start`.
3. Add environment variables `DATABASE_URL`, `ADMIN_PIN` and
   `NODE_VERSION=22.17.1`.
4. Deploy.

### Access control

Viewing is open to anyone with the URL. Any change (POST/DELETE) requires
the `ADMIN_PIN`; the browser asks for it the first time you save and
remembers it on that device. If `ADMIN_PIN` is not set, the server logs a
warning and allows anyone to make changes — only do that for local testing.

## 3. Using the app

Pick a month at the top. Readings are in **litres**.

1. **Water Bookings** — log each tanker delivery (date, flat, Metro/Private,
   litres, price). The month's total litres and price are the "received"
   water and the water bill. Metro bookings paid by a flat are credited back
   to that flat. Drainage loads are logged here too.
2. **Flat Details** — enter each flat's previous and current meter readings
   plus the common-area meter, and the month's common charges (with which
   flat, if any, paid upfront).
3. **Water Usage** — per flat and common area: usage, % share of total
   metered usage, its share of the received-vs-metered discrepancy, total
   adjusted usage, and water price (% share × water bill).
4. **Final Calculation** — per flat: own water price, equal share of the
   common area's water price, equal shares of watchman / EB / drainage /
   other charges, minus any amounts that flat paid upfront.

## API reference

All `GET` endpoints taking a month expect `?month=YYYY-MM`. Write endpoints
require the `X-Admin-Pin` header when `ADMIN_PIN` is set.

| Method | Path                         | Purpose                                         |
|--------|------------------------------|-------------------------------------------------|
| GET    | /api/flats                   | List all flats                                  |
| GET    | /api/readings                | Meter readings for the month                    |
| POST   | /api/readings                | Upsert a flat's reading for a month             |
| GET    | /api/water-bookings          | Water deliveries for the month                  |
| POST   | /api/water-bookings          | Add a water delivery                            |
| GET    | /api/drainage-bookings       | Drainage loads for the month                    |
| POST   | /api/drainage-bookings       | Add a drainage booking                          |
| DELETE | /api/drainage-bookings/:id   | Delete a drainage booking                       |
| GET    | /api/common-readings         | Common-area meter for the month                 |
| POST   | /api/common-readings         | Upsert the common-area meter                    |
| GET    | /api/common-charges          | Common charges for the month                    |
| POST   | /api/common-charges          | Upsert a common charge (Drainage Load is auto)  |
| GET    | /api/bill                    | Computed water bill (flats + common area)       |
| GET    | /api/health                  | Health check                                    |

Not used by the current UI, kept for future use: `POST /api/water-supply`,
`GET/POST /api/expenses`, `GET/POST /api/payments`.

## Notes / next steps

- Payments here just track paid/pending — wiring an actual UPI deep link
  (`upi://pay?pa=<vpa>&am=<amount>&tn=<note>`) per flat using the `upi_id`
  column on `flats` is a natural next step.
- Free-tier Render web services sleep after inactivity; the first request
  after a while will be slow to wake up.
