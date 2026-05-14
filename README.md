const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// PUT update settings
router.put('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(req.body)) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Configuración guardada' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al guardar configuración' });
  } finally {
    client.release();
  }
});

module.exports = router;
