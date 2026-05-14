require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');

const patientsRouter = require('./routes/patients');
const configRouter = require('./routes/config');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed frontend origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman) in dev
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/patients', patientsRouter);
app.use('/api/config', configRouter);
app.use('/api/settings', settingsRouter);

// 404
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Start
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`📦 Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch(err => {
    console.error('❌ Error al inicializar la base de datos:', err);
    process.exit(1);
  });
