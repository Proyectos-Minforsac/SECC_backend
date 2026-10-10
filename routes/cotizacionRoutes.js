const express = require('express');
const {
  createCotizacion,
  getCotizaciones,
  getCotizacionesPorSolicitud,
  updateEstadoCotizacion,
} = require('../controllers/cotizacionController');

const router = express.Router();

router.get('/cotizaciones', (req, res) => {
  console.log('Ruta GET /cotizaciones ejecutada');
  getCotizaciones(req, res);
});

router.get('/cotizaciones/solicitud/:solicitudId', (req, res) => {
  console.log('Ruta GET /cotizaciones/solicitud/:solicitudId ejecutada');
  getCotizacionesPorSolicitud(req, res);
});

router.post('/cotizaciones', (req, res) => {
  console.log('Ruta POST /cotizaciones ejecutada');
  createCotizacion(req, res);
});

router.patch('/cotizaciones/:id/estado', (req, res) => {
  console.log('Ruta PATCH /cotizaciones/:id/estado ejecutada');
  updateEstadoCotizacion(req, res);
});

module.exports = router;
