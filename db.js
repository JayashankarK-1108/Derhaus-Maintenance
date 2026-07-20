const { Pool } = require('pg');
require('dotenv').config();

// Neon requires SSL. DATABASE_URL comes from your Neon project's connection string,
// e.g. postgres://user:password@ep-xxxx.neon.tech/dbname?sslmode=require
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
