const rentabilidadModel = require('../models/rentabilidadModel');
const analogaModel = require('../models/analogaModel');
const { ORIGENES } = require('../services/rentabilidad');

function responderError(res, mensaje, error) {
  // Los errores con status (400...) son de negocio y su mensaje es seguro de mostrar.
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const textoDe = valor => (typeof valor === 'string' ? valor.trim() : '');

// El tablero de rentabilidad con los filtros de la pantalla (tipo de servicio, año, origen). Solo el jefe.
async function getRentabilidad(req, res) {
  console.log('Controlador: GET /rentabilidad');
  try {
    const tipoServicio = textoDe(req.query.tipoServicio);
    const anio = textoDe(req.query.anio);
    const origen = textoDe(req.query.origen);

    if (anio !== '' && !/^\d{4}$/.test(anio)) return res.status(400).json({ message: 'El año debe tener 4 dígitos' });
    if (origen !== '' && !ORIGENES.includes(origen)) return res.status(400).json({ message: `El origen debe ser ${ORIGENES.join(' o ')}` });

    res.status(200).json(await rentabilidadModel.getRentabilidad({ tipoServicio, anio, origen }));
  } catch (error) {
    responderError(res, 'Error al obtener la rentabilidad', error);
  }
}

// Servicios similares a una cotización: promedios, rango y desviación histórica. El trabajador la ve al cotizar.
async function getAnaloga(req, res) {
  console.log('Controlador: GET /analoga');
  try {
    res.status(200).json(await analogaModel.getAnaloga({
      tipoServicio: textoDe(req.query.tipoServicio),
      destino: textoDe(req.query.destino),
    }));
  } catch (error) {
    responderError(res, 'Error al obtener los servicios similares', error);
  }
}

module.exports = { getRentabilidad, getAnaloga };
