const express = require('express');
const { login } = require('../controllers/authController');

const router = express.Router();

console.log('Cargando rutas de autenticación...');

router.post('/login', (req, res) => {
  console.log('Ruta POST /login ejecutada');
  login(req, res);
});

module.exports = router;
