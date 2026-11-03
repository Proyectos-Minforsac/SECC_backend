const express = require('express');
const {
  getCostosDeServicio,
  getLiquidacion,
  liquidarFinal,
  registrarImprevisto,
  completarImprevisto,
  eliminarImprevisto,
  getServicios,
} = require('../controllers/costoRealController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

// Los costos reales y los márgenes son internos: el técnico no accede. El rol se pide en cada ruta (no con router.use a
// secas) porque las visitas comparten el prefijo /visitas con rutas que el técnico sí usa.
const interno = exigirRol('trabajador', 'jefe');

router.get('/servicios-costos', interno, getServicios);
router.get('/visitas/:id/costos', interno, getCostosDeServicio);
router.get('/visitas/:id/liquidacion', interno, getLiquidacion);
router.post('/visitas/:id/liquidacion-final', interno, liquidarFinal);

router.post('/visitas/:id/imprevistos', interno, registrarImprevisto);
router.patch('/imprevistos/:id', interno, completarImprevisto);
router.delete('/imprevistos/:id', interno, eliminarImprevisto);

module.exports = router;
