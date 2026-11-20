const express = require('express');
const { subirEvidencia, quitarEvidencia, descargarEvidencia } = require('../controllers/evidenciaController');
const { exigirRol } = require('../services/autorizacion');

const router = express.Router();

console.log('Cargando rutas de evidencias...');

// Solo el técnico sube o quita archivos (y solo en sus servicios: lo comprueba el modelo)
router.post('/evidencias', exigirRol('tecnico'), subirEvidencia);
router.delete('/evidencias/:id', exigirRol('tecnico'), quitarEvidencia);

// El archivo se abre desde una etiqueta <img> o un enlace, que no envían la cabecera de sesión: como el de las ofertas, no la exige
router.get('/evidencias/:id/archivo', descargarEvidencia);

module.exports = router;
