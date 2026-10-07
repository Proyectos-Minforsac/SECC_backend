const express = require('express');
const clienteRoutes = require('./routes/clienteRoutes');
const tecnicoRoutes = require('./routes/tecnicoRoutes');
const itemRoutes = require('./routes/itemRoutes');
const cotizacionRoutes = require('./routes/cotizacionRoutes');
const conformidadRoutes = require('./routes/conformidadRoutes');
const driveRoutes = require('./routes/driveRoutes');
const authRoutes = require('./routes/authRoutes');
const solicitudRoutes = require('./routes/solicitudRoutes');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*', // O '*' para permitir cualquier origen en desarrollo
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

console.log('Inicializando servidor backend...');
console.log('Puerto configurado:', PORT);

// El límite alto es para el PDF de conformidad que llega en base64.
app.use(express.json({ limit: '12mb' }));
app.use('/api', clienteRoutes);
app.use('/api', tecnicoRoutes);
app.use('/api', itemRoutes);
app.use('/api', cotizacionRoutes);
app.use('/api', conformidadRoutes);
app.use('/api', driveRoutes);
app.use('/api', authRoutes);
app.use('/api', solicitudRoutes);

app.get('/', (req, res) => {
  console.log('GET / recibido');
  res.send('¡Hola desde tu backend en Node.js!');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
