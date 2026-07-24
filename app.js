const express = require('express');
const clienteRoutes = require('./routes/clienteRoutes');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173', // O '*' para permitir cualquier origen en desarrollo
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

console.log('Inicializando servidor backend...');
console.log('Puerto configurado:', PORT);

app.use(express.json());
app.use('/api', clienteRoutes);

app.get('/', (req, res) => {
  console.log('GET / recibido');
  res.send('¡Hola desde tu backend en Node.js!');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
