const express = require('express');
const { getBandeja, getDetalle, validar, ajustar, devolver } = require('../controllers/estimacionController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

// La estimación de costos y su validación son internas: el técnico no accede. Se limita por ruta (no con router.use
// a secas) porque todos los routers cuelgan de /api y este control alcanzaría a los que se montan después.
router.use('/estimaciones', exigirRol('trabajador', 'jefe'));

// El trabajador ve la estimación de su cotización; solo el jefe revisa la bandeja y decide.
const soloJefe = exigirRol('jefe');

router.get('/estimaciones', soloJefe, getBandeja);
router.get('/estimaciones/cotizacion/:cotizacionId', getDetalle);
router.post('/estimaciones/:estimacionId/validar', soloJefe, validar);
router.post('/estimaciones/:estimacionId/ajustar', soloJefe, ajustar);
router.post('/estimaciones/:estimacionId/devolver', soloJefe, devolver);

module.exports = router;
