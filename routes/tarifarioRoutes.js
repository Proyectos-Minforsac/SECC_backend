const express = require('express');
const {
  getTarifas,
  crearTarifa,
  getParametros,
  guardarParametros,
} = require('../controllers/tarifarioController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

console.log('Cargando rutas del tarifario...');

// Las tarifas y los parámetros son costos internos: el trabajador los consulta (los usa al cotizar), el técnico
// no accede, y solo el jefe los modifica.
const consultar = exigirRol('trabajador', 'jefe');
const modificar = exigirRol('jefe');

router.get('/tarifas', consultar, getTarifas);
router.post('/tarifas', modificar, crearTarifa);

router.get('/parametros-costo', consultar, getParametros);
router.put('/parametros-costo', modificar, guardarParametros);

module.exports = router;
