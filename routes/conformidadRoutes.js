const express = require('express');
const { enviarConformidad } = require('../controllers/conformidadController');

const router = express.Router();

router.post('/conformidad/enviar', (req, res) => {
  console.log('Ruta POST /conformidad/enviar ejecutada');
  enviarConformidad(req, res);
});

module.exports = router;
