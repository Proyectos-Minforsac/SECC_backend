const express = require('express');
const { getClientes, createCliente, updateCliente, deleteCliente } = require('../controllers/clienteController');

const router = express.Router();

console.log('Cargando rutas de clientes...');

router.get('/clientes', (req, res) => {
  console.log('Ruta GET /clientes ejecutada');
  getClientes(req, res);
});

router.post('/clientes', (req, res) => {
  console.log('Ruta POST /clientes ejecutada');
  createCliente(req, res);
});

router.put('/clientes/:id', (req, res) => {
  console.log('Ruta PUT /clientes/:id ejecutada');
  updateCliente(req, res);
});

router.delete('/clientes/:id', (req, res) => {
  console.log('Ruta DELETE /clientes/:id ejecutada');
  deleteCliente(req, res);
});

module.exports = router;
