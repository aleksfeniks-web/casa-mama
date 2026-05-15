// routes/pagos.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { generarReciboPago } = require('../utils/pdfGenerator');
const fs = require('fs');

// ============================================================
// Registrar un pago y generar recibo PDF
// ============================================================
router.post('/pacientes/:id/pagos', async (req, res) => {
  const { monto, metodo_pago } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Insertar el pago
    const pagoResult = await client.query(
      `INSERT INTO pagos (paciente_id, monto, fecha_pago, metodo_pago) 
       VALUES ($1, $2, CURRENT_DATE, $3) RETURNING id`,
      [req.params.id, monto, metodo_pago]
    );
    const pagoId = pagoResult.rows[0].id;
    
    // 2. Obtener nombre del paciente
    const pacienteResult = await client.query(
      'SELECT name FROM patients WHERE id = $1',
      [req.params.id]
    );
    const nombrePaciente = pacienteResult.rows[0].name;
    
    // 3. Generar PDF del recibo
    const pdfPath = await generarReciboPago({
      id: pagoId,
      paciente_nombre: nombrePaciente,
      monto: monto,
      fecha: new Date(),
      metodo_pago: metodo_pago
    });
    
    // 4. Guardar la ruta del PDF en la BD
    await client.query(
      'UPDATE pagos SET recibo_pdf_url = $1 WHERE id = $2',
      [pdfPath, pagoId]
    );
    
    await client.query('COMMIT');
    
    // 5. Enviar el PDF como respuesta
    res.download(pdfPath, `recibo_${pagoId}.pdf`, (err) => {
      if (err) console.error('Error al enviar PDF:', err);
      setTimeout(() => {
        fs.unlink(pdfPath, (unlinkErr) => {
          if (unlinkErr) console.error('Error al eliminar PDF temporal:', unlinkErr);
        });
      }, 5000);
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al registrar pago:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// Obtener historial de pagos de un paciente
// ============================================================
router.get('/pacientes/:id/pagos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pagos WHERE paciente_id = $1 ORDER BY fecha_pago DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Obtener adeudo actual de un paciente
// ============================================================
router.get('/pacientes/:id/adeudo', async (req, res) => {
  try {
    // Obtener el plan del paciente (precio mensual)
    const planResult = await pool.query(
      `SELECT p.name, pl.precio_mensual 
       FROM patients p
       LEFT JOIN planes pl ON p.plan_id = pl.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    
    const precioMensual = planResult.rows[0].precio_mensual || 0;
    
    // Calcular pagos realizados en el mes actual
    const pagosResult = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) as total_pagado
       FROM pagos 
       WHERE paciente_id = $1 
       AND EXTRACT(MONTH FROM fecha_pago) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(YEAR FROM fecha_pago) = EXTRACT(YEAR FROM CURRENT_DATE)`,
      [req.params.id]
    );
    
    const totalPagado = parseFloat(pagosResult.rows[0].total_pagado) || 0;
    const adeudo = precioMensual - totalPagado;
    
    res.json({ 
      adeudo: Math.max(0, adeudo),
      precio_mensual: precioMensual,
      total_pagado_mes: totalPagado
    });
    
  } catch (err) {
    console.error('Error al calcular adeudo:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
