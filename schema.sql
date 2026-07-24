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
  ('Flat A1','',''),('Flat A2','',''),('Flat A3','',''),
  ('Flat A4','',''),('Flat A5','',''),('Flat A6','',''),
  ('Flat B1','',''),('Flat B2','',''),('Flat B3','',''),
  ('Flat B4','',''),('Flat B5','',''),('Flat B6','','')
ON CONFLICT (flat_no) DO NOTHING;

-- Individual water delivery bookings (replaces manual water_supply entry)
CREATE TABLE IF NOT EXISTS water_bookings (
  id           SERIAL PRIMARY KEY,
  booking_date DATE NOT NULL,
  type_of_load TEXT NOT NULL,
  price        NUMERIC NOT NULL DEFAULT 0,
  litres       NUMERIC NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Add flat_id to water_bookings (safe to re-run)
ALTER TABLE water_bookings ADD COLUMN IF NOT EXISTS flat_id INTEGER REFERENCES flats(id);

-- Add price_per_litre to water_supply for monthly summary storage
ALTER TABLE water_supply ADD COLUMN IF NOT EXISTS price_per_litre NUMERIC DEFAULT 0;

-- Common area meter readings (one row per month)
CREATE TABLE IF NOT EXISTS common_readings (
  id            SERIAL PRIMARY KEY,
  month         CHAR(7) UNIQUE NOT NULL,
  prev_reading  NUMERIC,
  cur_reading   NUMERIC,
  recorded_at   TIMESTAMPTZ DEFAULT now()
);

-- Common charges: fixed rows per month (Common EB, Drainage Load, Miscellaneous)
CREATE TABLE IF NOT EXISTS common_charges (
  id               SERIAL PRIMARY KEY,
  month            CHAR(7) NOT NULL,
  category         TEXT NOT NULL,
  amount           NUMERIC NOT NULL DEFAULT 0,
  paid_by_flat_id  INTEGER REFERENCES flats(id),
  UNIQUE (month, category)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_meter_readings_month ON meter_readings(month);
CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month);
CREATE INDEX IF NOT EXISTS idx_payments_month ON payments(month);
CREATE INDEX IF NOT EXISTS idx_water_bookings_date ON water_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_common_charges_month ON common_charges(month);
