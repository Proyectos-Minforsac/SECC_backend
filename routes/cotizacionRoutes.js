const express = require('express');
const { createCotizacion } = require('../controllers/cotizacionController');

const router = express.Router();

router.post('/cotizaciones', (req, res) => {
  console.log('Ruta POST /cotizaciones ejecutada');
  createCotizacion(req, res);
});

module.exports = router;