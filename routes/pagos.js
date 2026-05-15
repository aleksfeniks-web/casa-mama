// routes/pagos.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { generarReciboPago } = require('../utils/pdfGenerator');
const fs = require('fs');

// Registrar un pago y generar recibo PDF
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
      'SELECT nombre FROM patients WHERE id = $1',
      [req.params.id]
    );
    const nombrePaciente = pacienteResult.rows[0].nombre;
    
    // 3. Generar PDF del recibo
    const pdfPath = await generarReciboPago({
      id: pagoId,
      paciente_nombre: nombrePaciente,
      monto: monto,
      fecha: new Date(),
      metodo_pago: metodo_pago
    });
    
    // 4. (Opcional) Guardar la ruta del PDF en la BD
    await client.query(
      'UPDATE pagos SET recibo_pdf_url = $1 WHERE id = $2',
      [pdfPath, pagoId]
    );
    
    await client.query('COMMIT');
    
    // 5. Enviar el PDF como respuesta (o solo la URL)
    res.download(pdfPath, `recibo_${pagoId}.pdf`, (err) => {
      if (err) console.error('Error al enviar PDF:', err);
      // Limpiar archivo temporal después de enviar
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

// Obtener historial de pagos de un paciente
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

module.exports = router;
