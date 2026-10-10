const express = require('express');
const { crearCarpeta, subirArchivo } = require('../controllers/driveController');

const router = express.Router();

router.post('/drive/carpetas', (req, res) => {
  console.log('Ruta POST /drive/carpetas ejecutada');
  crearCarpeta(req, res);
});

// Cuerpo binario sin interpretar; el tipo real del archivo viaja en ?tipo=.
router.post('/drive/carpetas/:carpetaId/archivos', express.raw({ type: () => true, limit: '50mb' }), (req, res) => {
  console.log('Ruta POST /drive/carpetas/:carpetaId/archivos ejecutada');
  subirArchivo(req, res);
});

module.exports = router;
