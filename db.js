const { Pool } = require('pg');
require('dotenv').config();

// Neon requires SSL and serves valid certificates, so verify them.
// DATABASE_URL comes from your Neon project's connection string,
// e.g. postgres://user:password@ep-xxxx.neon.tech/dbname?sslmode=verify-full
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

module.exports = pool;
