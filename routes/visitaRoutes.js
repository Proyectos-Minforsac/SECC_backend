const express = require('express');
const {
  getVisitas,
  getVisitasProgramadas,
  guardarDiagnostico,
  activarPorSolicitud,
  registrarCierre,
  crearProgramada,
  actualizarProgramada,
  eliminarProgramada,
  registrarAvance,
} = require('../controllers/visitaController');

const router = express.Router();

console.log('Cargando rutas de visitas técnicas...');

router.get('/visitas', getVisitas);
router.get('/visitas-programadas', getVisitasProgramadas);

// La visita técnica la crea POST /solicitudes/:id/autorizar; aquí solo avanza su ciclo.
router.post('/visitas/:id/diagnostico', guardarDiagnostico);
router.post('/visitas/:id/cierre', registrarCierre);
router.post('/solicitudes/:id/activar-visita', activarPorSolicitud);

router.post('/visitas/:id/programadas', crearProgramada);
router.put('/visitas-programadas/:id', actualizarProgramada);
router.delete('/visitas-programadas/:id', eliminarProgramada);
router.post('/visitas-programadas/:id/avance', registrarAvance);

module.exports = router;
