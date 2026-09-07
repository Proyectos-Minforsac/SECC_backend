const cotizacionModel = require('../models/cotizacionModel');
const clienteModel = require('../models/clienteModel');

async function createCotizacion(req, res) {
  console.log('Controlador: llegando a POST /cotizaciones');
  console.log('Body recibido:', req.body);
  try {
    const { clienteId, numeroCotizacion, fecha, solicitante, moneda, estado } = req.body;

    if (!clienteId || !numeroCotizacion || !fecha || !solicitante || !moneda || !estado) {
      console.log('Controlador: faltan campos en la petición');
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }

    const clienteExistente = await clienteModel.getClienteById(clienteId);
    if (!clienteExistente) {
      console.log('Controlador: cliente no encontrado', clienteId);
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    const nuevaCotizacion = await cotizacionModel.createCotizacion({
      clienteId,
      numeroCotizacion,
      fecha,
      solicitante,
      moneda,
      estado,
    });

    console.log('Controlador: cotización creada correctamente');
    res.status(201).json(nuevaCotizacion);
  } catch (error) {
    console.error('Controlador: error al crear cotización', error);
    res.status(500).json({ message: 'Error al crear el ítem', error: error.message });
  }
}

module.exports = {
  createCotizacion,
}