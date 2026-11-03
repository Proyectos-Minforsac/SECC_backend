const express = require('express');
const {
  createCotizacion,
  actualizarCotizacion,
  getCotizaciones,
  getCotizacion,
  getCotizacionParaEdicion,
  getCotizacionesPorSolicitud,
  updateEstadoCotizacion,
} = require('../controllers/cotizacionController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

// Las cotizaciones llevan costos internos: el técnico no accede. Se limita por ruta (no con router.use a secas)
// porque todos los routers cuelgan de /api y este control alcanzaría a los que se montan después.
router.use('/cotizaciones', exigirRol('trabajador', 'jefe'));

router.get('/cotizaciones', (req, res) => {
  console.log('Ruta GET /cotizaciones ejecutada');
  getCotizaciones(req, res);
});

router.get('/cotizaciones/solicitud/:solicitudId', (req, res) => {
  console.log('Ruta GET /cotizaciones/solicitud/:solicitudId ejecutada');
  getCotizacionesPorSolicitud(req, res);
});

router.get('/cotizaciones/:id/edicion', (req, res) => {
  console.log('Ruta GET /cotizaciones/:id/edicion ejecutada');
  getCotizacionParaEdicion(req, res);
});

router.get('/cotizaciones/:id', (req, res) => {
  console.log('Ruta GET /cotizaciones/:id ejecutada');
  getCotizacion(req, res);
});

router.post('/cotizaciones', (req, res) => {
  console.log('Ruta POST /cotizaciones ejecutada');
  createCotizacion(req, res);
});

router.put('/cotizaciones/:id', (req, res) => {
  console.log('Ruta PUT /cotizaciones/:id ejecutada');
  actualizarCotizacion(req, res);
});

router.patch('/cotizaciones/:id/estado', (req, res) => {
  console.log('Ruta PATCH /cotizaciones/:id/estado ejecutada');
  updateEstadoCotizacion(req, res);
});

module.exports = router;
