require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Database ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      birthdate DATE,
      curp VARCHAR(18),
      phone VARCHAR(20),
      contact VARCHAR(255),
      contact_phone VARCHAR(20),
      entry_date DATE,
      fee NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'active',
      conditions TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS financial_config (
      id SERIAL PRIMARY KEY,
      key VARCHAR(100) UNIQUE NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(100) UNIQUE NOT NULL,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO financial_config (key, value) VALUES
      ('initialInvestment', '100000'),
      ('costs', '{"personal":52500,"food":30000,"medical":20000,"utilities":10000,"supplies":6500,"insurance":4000,"contingencyPercent":10}'),
      ('pricePerPatient', '12000'),
      ('maxCapacity',     '12')
    ON CONFLICT (key) DO NOTHING;
  `);

  console.log('✅ Base de datos lista');
};

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ─── Patients ────────────────────────────────────────────────────────────────
app.get('/api/patients', async (req, res) => {
  try {
    const { status, search } = req.query;
    let q = 'SELECT * FROM patients WHERE 1=1';
    const params = [];
    if (status) { params.push(status); q += ` AND status=$${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      q += ` AND (name ILIKE $${params.length} OR curp ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/patients/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM patients WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/patients', async (req, res) => {
  try {
    const { name, birthdate, curp, phone, contact, contact_phone, entry_date, fee, status, conditions, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const r = await pool.query(
      `INSERT INTO patients (name,birthdate,curp,phone,contact,contact_phone,entry_date,fee,status,conditions,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, birthdate||null, curp||null, phone||null, contact||null, contact_phone||null,
       entry_date||null, fee||0, status||'active', conditions||null, notes||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/patients/:id', async (req, res) => {
  try {
    const { name, birthdate, curp, phone, contact, contact_phone, entry_date, fee, status, conditions, notes } = req.body;
    const r = await pool.query(
      `UPDATE patients SET name=$1,birthdate=$2,curp=$3,phone=$4,contact=$5,contact_phone=$6,
       entry_date=$7,fee=$8,status=$9,conditions=$10,notes=$11,updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [name, birthdate||null, curp||null, phone||null, contact||null, contact_phone||null,
       entry_date||null, fee||0, status||'active', conditions||null, notes||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/patients/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM patients WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json({ message: 'Eliminado', id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Financial Config ────────────────────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM financial_config');
    const config = {};
    r.rows.forEach(row => { config[row.key] = row.value; });
    res.json(config);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(req.body)) {
      await client.query(
        `INSERT INTO financial_config (key,value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Config guardada' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── Settings ────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM settings');
    const s = {};
    r.rows.forEach(row => { s[row.key] = row.value; });
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(req.body)) {
      await client.query(
        `INSERT INTO settings (key,value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [key, value]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Settings guardados' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── Start ───────────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Error DB:', err);
    process.exit(1);
  });
