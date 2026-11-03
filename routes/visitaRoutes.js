const express = require('express');
const {
  getVisitas,
  getVisitasProgramadas,
  guardarDiagnostico,
  activarPorSolicitud,
  cancelarPorSolicitud,
  registrarCierre,
  crearProgramada,
  actualizarProgramada,
  eliminarProgramada,
  registrarAvance,
  finalizarEtapa,
} = require('../controllers/visitaController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

console.log('Cargando rutas de visitas técnicas...');

router.get('/visitas', getVisitas);
router.get('/visitas-programadas', getVisitasProgramadas);

// La visita técnica la crea POST /solicitudes/:id/autorizar; aquí solo avanza su ciclo.
router.post('/visitas/:id/diagnostico', guardarDiagnostico);
// Cerrar el servicio y finalizar la instalación llevan los costos reales: son del trabajador y el jefe, no del técnico.
const interno = exigirRol('trabajador', 'jefe');
router.post('/visitas/:id/cierre', interno, registrarCierre);
router.post('/visitas/:id/finalizar-etapa', interno, finalizarEtapa);
router.post('/solicitudes/:id/activar-visita', activarPorSolicitud);
router.post('/solicitudes/:id/cancelar-visita', cancelarPorSolicitud);

router.post('/visitas/:id/programadas', crearProgramada);
router.put('/visitas-programadas/:id', actualizarProgramada);
router.delete('/visitas-programadas/:id', eliminarProgramada);
router.post('/visitas-programadas/:id/avance', registrarAvance);

module.exports = router;
