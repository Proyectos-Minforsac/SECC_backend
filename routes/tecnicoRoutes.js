const express = require('express');
const { getTecnicos, createTecnico, updateTecnico, deleteTecnico } = require('../controllers/tecnicoController');

const router = express.Router();

console.log('Cargando rutas de técnicos...');

router.get('/tecnicos', (req, res) => {
  console.log('Ruta GET /tecnicos ejecutada');
  getTecnicos(req, res);
});

router.post('/tecnicos', (req, res) => {
  console.log('Ruta POST /tecnicos ejecutada');
  createTecnico(req, res);
});

router.put('/tecnicos/:id', (req, res) => {
  console.log('Ruta PUT /tecnicos/:id ejecutada');
  updateTecnico(req, res);
});

router.delete('/tecnicos/:id', (req, res) => {
  console.log('Ruta DELETE /tecnicos/:id ejecutada');
  deleteTecnico(req, res);
});

module.exports = router;
