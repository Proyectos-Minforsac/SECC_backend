const itemModel = require('../models/itemModel');

async function createItem(req, res) {
  console.log('Controlador: llegando a POST /items');
  console.log('Body recibido:', req.body);
  try {
    const { tipo, nombre, descripcion, precioUnitario } = req.body;

    if (!tipo || !nombre || !descripcion || !precioUnitario) {
      console.log('Controlador: faltan campos en la petición');
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }

    if (nombre.length > 256) return res.status(400).json({ message: "El nombre excede el tamaño permitido" });
    if (descripcion.length > 512) return res.status(400).json({ message: "La dirección excede el tamaño permitido" });

    const nuevoItem = await itemModel.createItem({
      tipo,
      nombre,
      descripcion,
      precioUnitario,
    });

    console.log('Controlador: item creado correctamente');
    res.status(201).json(nuevoItem);
  } catch (error) {
    console.error('Controlador: error al crear ítem', error);
    res.status(500).json({ message: 'Error al crear el ítem', error: error.message });
  }
}

module.exports = {
  createItem,
}