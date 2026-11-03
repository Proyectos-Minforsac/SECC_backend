const express = require('express');
const { getRentabilidad, getAnaloga } = require('../controllers/rentabilidadController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

// Costos y márgenes son internos: el técnico no accede. El trabajador consulta los servicios similares al cotizar; el
// tablero de rentabilidad es solo del jefe.
router.get('/analoga', exigirRol('trabajador', 'jefe'), getAnaloga);
router.get('/rentabilidad', exigirRol('jefe'), getRentabilidad);

module.exports = router;
