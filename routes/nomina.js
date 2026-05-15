// routes/nomina.js
const express = require('express');

function createNominaRoutes(pool) {
  const router = express.Router();

  // ============================================================
  // Obtener todos los empleados
  // ============================================================
  router.get('/empleados', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM empleados ORDER BY nombre');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Agregar nuevo empleado
  // ============================================================
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

  // ============================================================
  // Eliminar empleado
  // ============================================================
  router.delete('/empleados/:id', async (req, res) => {
    try {
      const result = await pool.query('DELETE FROM empleados WHERE id = $1 RETURNING id', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
      res.json({ message: 'Empleado eliminado' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Obtener todas las nóminas
  // ============================================================
  router.get('/', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT n.*, e.nombre as empleado_nombre 
         FROM nominas n 
         JOIN empleados e ON n.empleado_id = e.id 
         ORDER BY n.periodo DESC`
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Generar nómina
  // ============================================================
  router.post('/generar', async (req, res) => {
    const { periodo, empleados_nomina } = req.body;
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

  // ============================================================
  // Pagar nómina
  // ============================================================
  router.put('/:id/pagar', async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE nominas SET pagado = true, fecha_pago = CURRENT_DATE WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Nómina no encontrada' });
      res.json({ message: 'Nómina pagada' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createNominaRoutes;
