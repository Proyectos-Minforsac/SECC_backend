const express = require('express');
const {
  getSolicitudes,
  createSolicitud,
  updateSolicitud,
  deleteSolicitud,
  enviarOferta,
  aceptarOferta,
  rechazarOferta,
  autorizarViaje,
  crearCarpetaServicio,
  descargarArchivoOferta,
} = require('../controllers/solicitudController');

const router = express.Router();

console.log('Cargando rutas de solicitudes...');

router.get('/solicitudes', (req, res) => {
  console.log('Ruta GET /solicitudes ejecutada');
  getSolicitudes(req, res);
});

router.post('/solicitudes', (req, res) => {
  console.log('Ruta POST /solicitudes ejecutada');
  createSolicitud(req, res);
});

router.put('/solicitudes/:id', (req, res) => {
  console.log('Ruta PUT /solicitudes/:id ejecutada');
  updateSolicitud(req, res);
});

router.delete('/solicitudes/:id', (req, res) => {
  console.log('Ruta DELETE /solicitudes/:id ejecutada');
  deleteSolicitud(req, res);
});

// El técnico crea su oferta o edita la que ya envió.
router.put('/solicitudes/:id/ofertas', (req, res) => {
  console.log('Ruta PUT /solicitudes/:id/ofertas ejecutada');
  enviarOferta(req, res);
});

router.post('/solicitudes/:id/ofertas/:ofertaId/aceptar', (req, res) => {
  console.log('Ruta POST /solicitudes/:id/ofertas/:ofertaId/aceptar ejecutada');
  aceptarOferta(req, res);
});

router.post('/solicitudes/:id/ofertas/:ofertaId/rechazar', (req, res) => {
  console.log('Ruta POST /solicitudes/:id/ofertas/:ofertaId/rechazar ejecutada');
  rechazarOferta(req, res);
});

router.post('/solicitudes/:id/autorizar', (req, res) => {
  console.log('Ruta POST /solicitudes/:id/autorizar ejecutada');
  autorizarViaje(req, res);
});

router.post('/solicitudes/:id/carpeta-servicio', (req, res) => {
  console.log('Ruta POST /solicitudes/:id/carpeta-servicio ejecutada');
  crearCarpetaServicio(req, res);
});

router.get('/ofertas/:ofertaId/archivo', (req, res) => {
  console.log('Ruta GET /ofertas/:ofertaId/archivo ejecutada');
  descargarArchivoOferta(req, res);
});

module.exports = router;
