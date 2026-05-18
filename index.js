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
// Credenciales
const USERS = {
    admin: { password: 'admin', role: 'admin' },
    superadmin: { password: 'superadmin', role: 'superadmin' }
};

function verificarLogin() {
    const user = document.getElementById('loginUser').value;
    const pass = document.getElementById('loginPass').value;
    
    if (USERS[user] && USERS[user].password === pass) {
        isAdmin = true;
        isSuperAdmin = user === 'superadmin';
        
        const loginModal = document.getElementById('loginModal');
        loginModal.classList.remove('active');
        loginModal.style.display = 'none';
        
        // Mostrar elementos según rol
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('visible'));
        
        if (isSuperAdmin) {
            document.querySelectorAll('.superadmin-only').forEach(el => el.classList.add('visible'));
            showToast('Bienvenido SuperAdministrador - Acceso total', 'success');
            // Mostrar item de inversiones en el menú
            const invItem = document.querySelector('.nav-item[onclick*="inversiones"]');
            if (invItem) invItem.style.display = 'flex';
        } else {
            showToast('Bienvenido Administrador', 'success');
        }
        
        refreshAll();
        loadPatients();
    } else {
        showToast('Usuario o contraseña incorrectos', 'error');
    }
}
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

// Función para colapsar/expandir contenido de ROI
function toggleRoiContent() {
    const roiContent = document.getElementById('roiContent');
    const roiIcon = document.getElementById('roiToggleIcon');
    if (roiContent.style.display === 'none') {
        roiContent.style.display = 'block';
        roiIcon.className = 'fas fa-chevron-up';
    } else {
        roiContent.style.display = 'none';
        roiIcon.className = 'fas fa-chevron-down';
    }
}

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
// ENDPOINTS DE INVERSIONES
// ============================================================

// Obtener todos los inversionistas
app.get('/api/inversionistas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, 
                   COALESCE(SUM(pi.monto), 0) as total_pagado
            FROM inversionistas i
            LEFT JOIN pagos_inversionistas pi ON i.id = pi.inversionista_id
            WHERE i.activo = true
            GROUP BY i.id
            ORDER BY i.fecha_inversion DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener inversionistas:', error);
        res.status(500).json({ error: error.message });
    }
});
async function loadInversionistas() {
    try {
        console.log('Cargando inversionistas...');
        const inversionistas = await apiFetch('/api/inversionistas');
        console.log('Inversionistas recibidos:', inversionistas);
        
        const tbody = document.querySelector('#inversionistasTable tbody');
        if (tbody) {
            if (inversionistas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No hay inversionistas registrados</td></tr>';
            } else {
                tbody.innerHTML = inversionistas.map(inv => {
                    const pagoMensual = inv.monto_inicial * (inv.porcentaje_comision / 100);
                    return `
                        <tr>
                            <td><strong>${escapeHtml(inv.nombre)}</strong><br><small style="color:#666;">${inv.email || ''}</small></td>
                            <td>${formatCurrency(inv.monto_inicial)}</td>
                            <td>${inv.porcentaje_comision}%</td>
                            <td>${formatCurrency(pagoMensual)}</td>
                            <td>${formatCurrency(inv.total_pagado || 0)}</td>
                            <td>${formatDate(inv.fecha_inversion)}</td>
                            <td>
                                <button class="btn btn-success btn-sm" onclick="abrirPagoInversionista(${inv.id})" title="Registrar Pago">
                                    <i class="fas fa-money-bill"></i> Pagar
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
        await loadDashboardInversiones();
    } catch(e) {
        console.error('Error cargando inversionistas:', e);
        showToast('Error al cargar inversionistas: ' + e.message, 'error');
    }
}

async function loadDashboardInversiones() {
    try {
        console.log('Cargando dashboard inversiones...');
        const data = await apiFetch('/api/dashboard-inversiones');
        console.log('Dashboard data:', data);
        
        // Actualizar KPIs
        const totalInversionEl = document.getElementById('totalInversion');
        const totalPagadoEl = document.getElementById('totalPagado');
        const totalPendienteEl = document.getElementById('totalPendiente');
        const pacientesActualesEl = document.getElementById('pacientesActuales');
        
        if (totalInversionEl) totalInversionEl.textContent = formatCurrency(data.resumen?.inversion_total || 0);
        if (totalPagadoEl) totalPagadoEl.textContent = formatCurrency(data.resumen?.pagado_acumulado || 0);
        if (totalPendienteEl) totalPendienteEl.textContent = formatCurrency(data.resumen?.pendiente_por_pagar || 0);
        if (pacientesActualesEl) pacientesActualesEl.textContent = data.resumen?.pacientes_actuales || 0;
        
        // Actualizar gráfico si hay datos
        if (data.pagos_por_mes && data.pagos_por_mes.length > 0) {
            if (inversionistasChart) inversionistasChart.destroy();
            const ctx = document.getElementById('pagosInversionistasChart')?.getContext('2d');
            if (ctx) {
                const labels = data.pagos_por_mes.map(p => `${p.mes}/${p.año}`).reverse();
                const values = data.pagos_por_mes.map(p => p.total_pagado).reverse();
                inversionistasChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Pagos a Inversionistas',
                            data: values,
                            backgroundColor: '#10b981',
                            borderRadius: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: { callback: v => '$' + v.toLocaleString() }
                            }
                        }
                    }
                });
            }
        }
    } catch(e) {
        console.error('Error cargando dashboard inversiones:', e);
        showToast('Error al cargar dashboard: ' + e.message, 'error');
    }
}
// Crear inversionista
app.post('/api/inversionistas', async (req, res) => {
    const { nombre, email, telefono, monto_inicial, porcentaje_comision, fecha_inversion } = req.body;
    
    if (!nombre || !monto_inicial) {
        return res.status(400).json({ error: 'Nombre y monto inicial son requeridos' });
    }
    
    try {
        const result = await pool.query(`
            INSERT INTO inversionistas (nombre, email, telefono, monto_inicial, porcentaje_comision, fecha_inversion)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [nombre, email, telefono, monto_inicial, porcentaje_comision || 5.0, fecha_inversion || new Date()]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear inversionista:', error);
        res.status(500).json({ error: error.message });
    }
});

// Registrar pago a inversionista
app.post('/api/inversionistas/:id/pagos', async (req, res) => {
    const inversionistaId = req.params.id;
    const { monto, mes, año, metodo_pago } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO pagos_inversionistas (inversionista_id, monto, mes, año, metodo_pago)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [inversionistaId, monto, mes, año, metodo_pago]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al registrar pago:', error);
        res.status(500).json({ error: error.message });
    }
});

async function calcularROI() {
    showLoading(true);
    try {
        const data = await apiFetch('/api/calcular-roi');
        
        // Mostrar resumen actual más compacto
        const resumenHtml = `
            <div class="kpi-grid" style="grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 15px;">
                <div class="kpi-card" style="padding: 10px;">
                    <h3 style="font-size: 0.7em;">Utilidad Mensual</h3>
                    <div class="kpi-value" style="font-size: 1.2em; color: ${data.utilidad_mensual >= 0 ? '#10b981' : '#ef4444'}">${formatCurrency(data.utilidad_mensual)}</div>
                </div>
                <div class="kpi-card" style="padding: 10px;">
                    <h3 style="font-size: 0.7em;">Ingreso Mensual</h3>
                    <div class="kpi-value" style="font-size: 1.2em;">${formatCurrency(data.ingreso_mensual)}</div>
                </div>
                <div class="kpi-card" style="padding: 10px;">
                    <h3 style="font-size: 0.7em;">Costo Mensual</h3>
                    <div class="kpi-value" style="font-size: 1.2em;">${formatCurrency(data.costo_mensual)}</div>
                </div>
            </div>
        `;
        
        // Mostrar proyecciones en tabs
        let tabsHtml = '<ul class="tabs" style="display: flex; gap: 10px; border-bottom: 1px solid #e2e8f0; margin-bottom: 15px; padding: 0;">';
        let contentHtml = '';
        
        data.inversionistas.forEach((inv, idx) => {
            const proyeccionesInv = data.proyecciones.filter(p => p.inversionista_id === inv.id);
            tabsHtml += `<li style="list-style: none; padding: 8px 16px; cursor: pointer; ${idx === 0 ? 'border-bottom: 2px solid #2563eb; font-weight: 600;' : ''}" onclick="showInversionistaTab(${idx})">${inv.nombre}</li>`;
            
            contentHtml += `<div class="tab-content" id="tab-${idx}" style="${idx === 0 ? 'display: block;' : 'display: none;'}">
                <div class="table-responsive">
                    <table class="table" style="font-size: 0.8em;">
                        <thead>
                            <tr><th>% Mensual</th><th>Pago Mensual</th><th>Meses a retornar</th><th>Retorno Anual</th><th>ROI Anual</th></tr>
                        </thead>
                        <tbody>
                            ${proyeccionesInv.map(p => `
                                <tr>
                                    <td><strong>${p.porcentaje}%</strong></td>
                                    <td>${formatCurrency(p.pago_mensual)}</td>
                                    <td>${p.meses_retorno} meses</td>
                                    <td>${formatCurrency(p.retorno_anual)}</td>
                                    <td class="${p.roi_anual >= 60 ? 'text-success' : ''}">${p.roi_anual.toFixed(1)}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        });
        tabsHtml += '</ul>';
        
        document.getElementById('roiProyecciones').innerHTML = resumenHtml + tabsHtml + contentHtml;
        document.getElementById('roiCard').style.display = 'block';
        
        // Abrir el contenido por defecto
        document.getElementById('roiContent').style.display = 'block';
        
        showToast('Cálculo de ROI completado');
    } catch(e) {
        showToast('Error al calcular ROI: ' + e.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Función para cambiar entre tabs de inversionistas
function showInversionistaTab(idx) {
    document.querySelectorAll('[id^="tab-"]').forEach(tab => tab.style.display = 'none');
    document.getElementById(`tab-${idx}`).style.display = 'block';
    
    document.querySelectorAll('.tabs li').forEach((li, i) => {
        if (i === idx) {
            li.style.borderBottom = '2px solid #2563eb';
            li.style.fontWeight = '600';
        } else {
            li.style.borderBottom = 'none';
            li.style.fontWeight = 'normal';
        }
    });
}

// Calcular ROI y proyecciones
app.get('/api/calcular-roi', async (req, res) => {
    try {
        // Obtener datos actuales
        const pacientesResult = await pool.query(`
            SELECT COUNT(*) as total_activos 
            FROM patients 
            WHERE status = 'active'
        `);
        const totalPacientes = parseInt(pacientesResult.rows[0].total_activos);
        
        // Obtener configuración financiera
        const configResult = await pool.query(`
            SELECT valor FROM configuracion WHERE clave = 'costos'
        `);
        const config = configResult.rows[0]?.valor || {};
        const costs = typeof config === 'string' ? JSON.parse(config) : config;
        
        // Calcular ingresos y utilidad
        const planesResult = await pool.query(`
            SELECT plan_id, COUNT(*) as cantidad
            FROM patients
            WHERE status = 'active'
            GROUP BY plan_id
        `);
        
        let ingresoTotal = 0;
        for (const row of planesResult.rows) {
            const planPrecio = row.plan_id === 1 ? 8000 : row.plan_id === 2 ? 12000 : 16000;
            ingresoTotal += row.cantidad * planPrecio;
        }
        
        const totalCostos = (costs.personal || 52500) + 
                           (costs.food || 30000) + 
                           (costs.medical || 20000) + 
                           (costs.utilities || 10000) + 
                           (costs.supplies || 6500) + 
                           (costs.insurance || 4000);
        
        const utilidadMensual = ingresoTotal - totalCostos;
        
        // Obtener inversionistas
        const inversionistasResult = await pool.query(`
            SELECT * FROM inversionistas WHERE activo = true
        `);
        const inversionistas = inversionistasResult.rows;
        
        // Calcular proyecciones para diferentes porcentajes
        const porcentajes = [3, 5, 7, 8, 10, 12, 15];
        const proyecciones = [];
        
        for (const inv of inversionistas) {
            for (const porcentaje of porcentajes) {
                const pagoMensual = inv.monto_inicial * (porcentaje / 100);
                const mesesRetorno = Math.ceil(inv.monto_inicial / pagoMensual);
                const retornoAnual = pagoMensual * 12;
                const roiAnual = (retornoAnual / inv.monto_inicial) * 100;
                
                proyecciones.push({
                    inversionista_id: inv.id,
                    inversionista_nombre: inv.nombre,
                    monto_inicial: inv.monto_inicial,
                    porcentaje: porcentaje,
                    pago_mensual: pagoMensual,
                    meses_retorno: mesesRetorno,
                    retorno_anual: retornoAnual,
                    roi_anual: roiAnual
                });
            }
        }
        
        res.json({
            pacientes_activos: totalPacientes,
            ingreso_mensual: ingresoTotal,
            costo_mensual: totalCostos,
            utilidad_mensual: utilidadMensual,
            inversionistas: inversionistas,
            proyecciones: proyecciones
        });
    } catch (error) {
        console.error('Error al calcular ROI:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener dashboard de inversiones (solo superadmin)
app.get('/api/dashboard-inversiones', async (req, res) => {
    try {
        // Obtener resumen de inversiones
        const inversionistas = await pool.query(`
            SELECT 
                i.*,
                COALESCE(SUM(pi.monto), 0) as pagado_total,
                COUNT(pi.id) as num_pagos
            FROM inversionistas i
            LEFT JOIN pagos_inversionistas pi ON i.id = pi.inversionista_id
            WHERE i.activo = true
            GROUP BY i.id
        `);
        
        // Obtener pagos por mes
        const pagosPorMes = await pool.query(`
            SELECT 
                EXTRACT(YEAR FROM fecha_pago) as año,
                EXTRACT(MONTH FROM fecha_pago) as mes,
                SUM(monto) as total_pagado
            FROM pagos_inversionistas
            GROUP BY año, mes
            ORDER BY año DESC, mes DESC
            LIMIT 12
        `);
        
        // Calcular ROI total del negocio
        const pacientes = await pool.query(`SELECT COUNT(*) as total FROM patients WHERE status = 'active'`);
        const inversionTotal = await pool.query(`SELECT COALESCE(SUM(monto_inicial), 0) as total FROM inversionistas WHERE activo = true`);
        const pagadoTotal = await pool.query(`SELECT COALESCE(SUM(monto), 0) as total FROM pagos_inversionistas`);
        
        res.json({
            inversionistas: inversionistas.rows,
            pagos_por_mes: pagosPorMes.rows,
            resumen: {
                total_inversionistas: inversionistas.rows.length,
                inversion_total: parseFloat(inversionTotal.rows[0].total),
                pagado_acumulado: parseFloat(pagadoTotal.rows[0].total),
                pendiente_por_pagar: parseFloat(inversionTotal.rows[0].total) - parseFloat(pagadoTotal.rows[0].total),
                pacientes_actuales: parseInt(pacientes.rows[0].total)
            }
        });
    } catch (error) {
        console.error('Error al obtener dashboard de inversiones:', error);
        res.status(500).json({ error: error.message });
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
