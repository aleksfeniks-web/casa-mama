// utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Genera un recibo de pago en PDF y retorna la ruta del archivo
 * @param {Object} pago - Datos del pago { id, paciente_nombre, monto, fecha, metodo_pago }
 * @returns {Promise<string>} - Ruta del archivo PDF generado
 */
async function generarReciboPago(pago) {
  return new Promise((resolve, reject) => {
    try {
      // Crear carpeta temporal si no existe
      const dir = path.join(__dirname, '../recibos_temp');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(dir, `recibo_${pago.id}_${Date.now()}.pdf`);
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);
      
      doc.pipe(stream);
      
      // Encabezado
      doc.fontSize(20).text('La Casa de Mamá', { align: 'center' });
      doc.fontSize(12).text('Recibo de Pago - Mensualidad', { align: 'center' });
      doc.moveDown();
      
      // Línea separadora
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();
      
      // Datos del recibo
      doc.fontSize(12);
      doc.text(`Folio: ${pago.id}`, { continued: true });
      doc.text(`Fecha: ${new Date(pago.fecha).toLocaleDateString('es-MX')}`, { align: 'right' });
      doc.moveDown();
      doc.text(`Paciente: ${pago.paciente_nombre}`);
      doc.text(`Monto: $${pago.monto.toLocaleString('es-MX')}`);
      doc.text(`Método de pago: ${pago.metodo_pago}`);
      doc.moveDown();
      
      // Pie de página
      doc.fontSize(10).text('Gracias por su pago. Este recibo es válido como comprobante.', { align: 'center', color: 'gray' });
      
      doc.end();
      
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarReciboPago };
