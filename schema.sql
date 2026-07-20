-- Sunrise Apartments maintenance schema
-- Run this once against your Neon database (see README for how)

CREATE TABLE IF NOT EXISTS flats (
  id            SERIAL PRIMARY KEY,
  flat_no       TEXT UNIQUE NOT NULL,
  owner_name    TEXT,
  upi_id        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- One reading per flat per month. Consumption for a month = this reading
-- minus the previous month's reading for the same flat.
CREATE TABLE IF NOT EXISTS meter_readings (
  id            SERIAL PRIMARY KEY,
  flat_id       INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  month         CHAR(7) NOT NULL,          -- 'YYYY-MM'
  reading_units NUMERIC NOT NULL,          -- cumulative meter reading, in units (1 unit = 1000 L)
  recorded_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (flat_id, month)
);

-- Total water actually supplied to the building that month (from the tanker /
-- municipal bill), used to compute the discrepancy against total metered usage.
CREATE TABLE IF NOT EXISTS water_supply (
  id                    SERIAL PRIMARY KEY,
  month                 CHAR(7) UNIQUE NOT NULL,
  total_received_litres NUMERIC NOT NULL,
  water_bill_amount     NUMERIC NOT NULL DEFAULT 0,  -- total ₹ cost to split by usage share
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Shared expenses: watchman salary, EB bill, drainage/STP, etc.
-- split_type 'equal' divides evenly across all flats.
CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  month       CHAR(7) NOT NULL,
  category    TEXT NOT NULL,
  amount      NUMERIC NOT NULL,
  split_type  TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  flat_id     INTEGER NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  month       CHAR(7) NOT NULL,
  amount_due  NUMERIC NOT NULL,
  paid        BOOLEAN NOT NULL DEFAULT FALSE,
  upi_ref     TEXT,
  paid_at     TIMESTAMPTZ,
  UNIQUE (flat_id, month)
);

-- Seed the 12 flats (edit flat numbers/owners as needed)
INSERT INTO flats (flat_no, owner_name, upi_id) VALUES
  ('A1','',''),('A2','',''),('A3','',''),('A4','',''),
  ('B1','',''),('B2','',''),('B3','',''),('B4','',''),
  ('C1','',''),('C2','',''),('C3','',''),('C4','','')
ON CONFLICT (flat_no) DO NOTHING;
