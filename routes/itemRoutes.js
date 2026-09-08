const express = require('express');
const { createItem } = require('../controllers/itemController');

const router = express.Router();

router.post('/items', (req, res) => {
  console.log('Ruta POST /items ejecutada');
  createItem(req, res);
});

module.exports = router;