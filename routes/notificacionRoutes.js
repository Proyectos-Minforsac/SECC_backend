const express = require('express');
const { getNotificaciones, crearNotificacion, marcarLeida } = require('../controllers/notificacionController');

const router = express.Router();

console.log('Cargando rutas de notificaciones...');

router.get('/notificaciones', getNotificaciones);
router.post('/notificaciones', crearNotificacion);
router.put('/notificaciones/:id/leida', marcarLeida);

module.exports = router;
