require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// 1. BASE DE DATOS - Crear pool PRIMERO
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false
  }
});

// ============================================================
// 2. IMPORTAR RUTAS (después de crear pool)
// ============================================================
const createNominaRoutes = require('./routes/nomina');
const nominaRoutes = createNominaRoutes(pool);

// pagos.js - si también necesita pool, modifícalo similar
// Por ahora, asumimos que pagos.js usa su propio pool
const createPagosRoutes = require('./routes/pagos');
const pagosRoutes = createPagosRoutes(pool);

// ============================================================
// 3. MIDDLEWARES
// ============================================================
// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://casa-mama.onrender.com',
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

// ============================================================
// 4. RUTAS API
// ============================================================
app.use('/api/nomina', nominaRoutes);
app.use('/api', pagosRoutes);

// Ruta raíz (sirve el frontend)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Health check
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ============================================================
// 5. PACIENTES (CRUD)
// ============================================================
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

// ============================================================
// 6. HISTORIAL CLÍNICO
// ============================================================
app.get('/api/pacientes/:id/historia', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM historial_clinico WHERE paciente_id = $1 ORDER BY fecha DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pacientes/:id/historia', async (req, res) => {
  const { presion_arterial, frecuencia_cardiaca, temperatura, sintomas, diagnostico, tratamiento } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO historial_clinico (paciente_id, presion_arterial, frecuencia_cardiaca, temperatura, sintomas, diagnostico, tratamiento)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, presion_arterial, frecuencia_cardiaca, temperatura, sintomas, diagnostico, tratamiento]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 7. MEDICAMENTOS
// ============================================================
app.get('/api/medicamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicamentos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/medicamentos', async (req, res) => {
  const { nombre, presentacion, dosis_habitual } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO medicamentos (nombre, presentacion, dosis_habitual) VALUES ($1, $2, $3) RETURNING *',
      [nombre, presentacion, dosis_habitual]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pacientes/:id/medicamentos', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, m.nombre as medicamento_nombre, m.presentacion 
       FROM paciente_medicamentos pm
       JOIN medicamentos m ON pm.medicamento_id = m.id
       WHERE pm.paciente_id = $1 AND pm.activo = true`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pacientes/:id/medicamentos', async (req, res) => {
  const { medicamento_id, dosis, horario } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO paciente_medicamentos (paciente_id, medicamento_id, dosis, horario)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, medicamento_id, dosis, horario]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/medicamentos/aplicar', async (req, res) => {
  const { paciente_medicamento_id, aplicado, observacion } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO aplicaciones_medicamento (paciente_medicamento_id, aplicado, observacion)
       VALUES ($1, $2, $3) RETURNING *`,
      [paciente_medicamento_id, aplicado, observacion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 8. PLANES Y CAMAS
// ============================================================
app.get('/api/planes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM planes');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/planes/:id', async (req, res) => {
  const { nombre, precio_mensual, descripcion } = req.body;
  try {
    await pool.query(
      'UPDATE planes SET nombre = $1, precio_mensual = $2, descripcion = $3 WHERE id = $4',
      [nombre, precio_mensual, descripcion, req.params.id]
    );
    res.json({ message: 'Plan actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 9. SERVICIOS EXTERNOS
// ============================================================
app.get('/api/servicios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM servicios_externos ORDER BY fecha_vencimiento');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servicios', async (req, res) => {
  const { nombre, proveedor, monto, fecha_vencimiento } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO servicios_externos (nombre, proveedor, monto, fecha_vencimiento)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, proveedor, monto, fecha_vencimiento]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/servicios/:id/pagar', async (req, res) => {
  try {
    await pool.query(
      'UPDATE servicios_externos SET pagado = true, fecha_pago = CURRENT_DATE WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Servicio marcado como pagado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ============================================================
// ENDPOINTS DE MEDICAMENTOS
// ============================================================

// Obtener todos los medicamentos del catálogo
app.get('/api/medicamentos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM medicamentos_catalogo 
            ORDER BY nombre
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener medicamentos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Crear nuevo medicamento en el catálogo
app.post('/api/medicamentos', async (req, res) => {
    const { nombre, presentacion, dosis_habitual } = req.body;
    
    if (!nombre) {
        return res.status(400).json({ error: 'El nombre del medicamento es requerido' });
    }
    
    try {
        const result = await pool.query(`
            INSERT INTO medicamentos_catalogo (nombre, presentacion, dosis_habitual)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [nombre, presentacion, dosis_habitual]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear medicamento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener medicamentos asignados a un paciente
app.get('/api/pacientes/:id/medicamentos', async (req, res) => {
    const pacienteId = req.params.id;
    
    try {
        const result = await pool.query(`
            SELECT pm.*, mc.nombre as medicamento_nombre, mc.presentacion
            FROM paciente_medicamentos pm
            LEFT JOIN medicamentos_catalogo mc ON pm.medicamento_id = mc.id
            WHERE pm.paciente_id = $1 AND pm.activo = true
            ORDER BY pm.created_at DESC
        `, [pacienteId]);
        
        // Parsear horario si es JSON string
        const medicamentos = result.rows.map(m => ({
            ...m,
            horario: m.horario ? (typeof m.horario === 'string' ? JSON.parse(m.horario) : m.horario) : []
        }));
        
        res.json(medicamentos);
    } catch (error) {
        console.error('Error al obtener medicamentos del paciente:', error);
        res.status(500).json({ error: error.message });
    }
});

// Asignar medicamento a paciente
app.post('/api/pacientes/:id/medicamentos', async (req, res) => {
    const pacienteId = req.params.id;
    const { medicamento_id, nombre, presentacion, dosis, horario } = req.body;
    
    if (!medicamento_id && !nombre) {
        return res.status(400).json({ error: 'Se requiere medicamento_id o nombre' });
    }
    
    try {
        let medicamentoNombre = nombre;
        let medicamentoPresentacion = presentacion;
        
        // Si se proporciona medicamento_id, obtener datos del catálogo
        if (medicamento_id) {
            const medicamentoCat = await pool.query(`
                SELECT nombre, presentacion FROM medicamentos_catalogo WHERE id = $1
            `, [medicamento_id]);
            
            if (medicamentoCat.rows.length > 0) {
                medicamentoNombre = medicamentoCat.rows[0].nombre;
                medicamentoPresentacion = medicamentoCat.rows[0].presentacion;
            }
        }
        
        const result = await pool.query(`
            INSERT INTO paciente_medicamentos 
            (paciente_id, medicamento_id, medicamento_nombre, dosis, horario, activo)
            VALUES ($1, $2, $3, $4, $5, true)
            RETURNING *
        `, [pacienteId, medicamento_id || null, medicamentoNombre, dosis, JSON.stringify(horario || [])]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al asignar medicamento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Registrar aplicación de medicamento
app.post('/api/medicamentos/aplicar', async (req, res) => {
    const { paciente_medicamento_id, aplicado } = req.body;
    
    try {
        // Crear registro de aplicación
        const result = await pool.query(`
            INSERT INTO aplicaciones_medicamentos 
            (paciente_medicamento_id, fecha_aplicacion, aplicado)
            VALUES ($1, NOW(), $2)
            RETURNING *
        `, [paciente_medicamento_id, aplicado]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al registrar aplicación:', error);
        res.status(500).json({ error: error.message });
    }
});

// Desactivar medicamento de paciente
app.delete('/api/pacientes/:pacienteId/medicamentos/:medicamentoId', async (req, res) => {
    const { pacienteId, medicamentoId } = req.params;
    
    try {
        await pool.query(`
            UPDATE paciente_medicamentos 
            SET activo = false 
            WHERE id = $1 AND paciente_id = $2
        `, [medicamentoId, pacienteId]);
        
        res.json({ message: 'Medicamento desactivado' });
    } catch (error) {
        console.error('Error al desactivar medicamento:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============================================================
// 10. CONFIGURACIÓN FINANCIERA
// ============================================================
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

// ============================================================
// 11. CONFIGURACIÓN GENERAL (SETTINGS)
// ============================================================
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

// ============================================================
// 12. INICIALIZAR BASE DE DATOS Y ARRANCAR SERVIDOR
// ============================================================
const initDB = async () => {
  // Crear tablas si no existen
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
      plan_id INT,
      cama_asignada VARCHAR(20),
      alergias TEXT,
      condiciones_cronicas TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS planes (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      descripcion TEXT,
      precio_mensual DECIMAL(10,2)
    );

    CREATE TABLE IF NOT EXISTS historial_clinico (
      id SERIAL PRIMARY KEY,
      paciente_id INT REFERENCES patients(id) ON DELETE CASCADE,
      fecha DATE NOT NULL DEFAULT CURRENT_DATE,
      presion_arterial VARCHAR(20),
      frecuencia_cardiaca INT,
      temperatura DECIMAL(4,1),
      sintomas TEXT,
      diagnostico TEXT,
      tratamiento TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS medicamentos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(255) NOT NULL,
      presentacion VARCHAR(100),
      dosis_habitual VARCHAR(100)
    );

    CREATE TABLE IF NOT EXISTS paciente_medicamentos (
      id SERIAL PRIMARY KEY,
      paciente_id INT REFERENCES patients(id) ON DELETE CASCADE,
      medicamento_id INT REFERENCES medicamentos(id),
      dosis VARCHAR(100),
      horario TIME[],
      activo BOOLEAN DEFAULT TRUE,
      fecha_inicio DATE DEFAULT CURRENT_DATE
    );

    CREATE TABLE IF NOT EXISTS aplicaciones_medicamento (
      id SERIAL PRIMARY KEY,
      paciente_medicamento_id INT REFERENCES paciente_medicamentos(id),
      fecha_hora TIMESTAMPTZ DEFAULT NOW(),
      aplicado BOOLEAN,
      observacion TEXT
    );

    CREATE TABLE IF NOT EXISTS pagos (
      id SERIAL PRIMARY KEY,
      paciente_id INT REFERENCES patients(id),
      monto DECIMAL(10,2) NOT NULL,
      fecha_pago DATE NOT NULL,
      metodo_pago VARCHAR(50),
      recibo_pdf_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS servicios_externos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100),
      proveedor VARCHAR(100),
      monto DECIMAL(10,2),
      fecha_vencimiento DATE,
      pagado BOOLEAN DEFAULT FALSE,
      fecha_pago DATE
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

  // Insertar datos por defecto
  await pool.query(`
    INSERT INTO financial_config (key, value) VALUES
      ('initialInvestment', '100000'),
      ('costs', '{"personal":52500,"food":30000,"medical":20000,"utilities":10000,"supplies":6500,"insurance":4000,"contingencyPercent":10}'),
      ('pricePerPatient', '12000'),
      ('maxCapacity', '12')
    ON CONFLICT (key) DO NOTHING;
  `);

  await pool.query(`
    INSERT INTO planes (nombre, precio_mensual) VALUES
      ('Básico', 8000),
      ('Intermedio', 12000),
      ('Completo', 16000)
    ON CONFLICT DO NOTHING;
  `);

  console.log('✅ Base de datos lista');
};

// Iniciar
initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor en puerto ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Error DB:', err);
    process.exit(1);
  });
