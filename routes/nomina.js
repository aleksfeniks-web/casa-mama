// routes/nomina.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');

// Obtener todos los empleados
router.get('/empleados', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM empleados ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agregar nuevo empleado
router.post('/empleados', async (req, res) => {
  const { nombre, puesto, salario_base, horario } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO empleados (nombre, puesto, salario_base, horario) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, puesto, salario_base, horario]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generar nómina para un período
router.post('/generar', async (req, res) => {
  const { periodo, empleados_nomina } = req.body; // periodo = '2025-01-01'
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const emp of empleados_nomina) {
      await client.query(
        `INSERT INTO nominas (empleado_id, periodo, total, pagado) 
         VALUES ($1, $2, $3, $4)`,
        [emp.id, periodo, emp.total, false]
      );
    }
    
    await client.query('COMMIT');
    res.json({ message: `Nómina del período ${periodo} generada correctamente` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Obtener nóminas por período
router.get('/periodo/:fecha', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.*, e.nombre, e.puesto 
       FROM nominas n 
       JOIN empleados e ON n.empleado_id = e.id 
       WHERE n.periodo = $1`,
      [req.params.fecha]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
