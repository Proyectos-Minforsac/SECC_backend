const tarifarioModel = require('../models/tarifarioModel');
const parametroCostoModel = require('../models/parametroCostoModel');

function responderError(res, mensaje, error) {
  // Los errores con status (400, 409...) son de negocio y su mensaje es seguro de mostrar.
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

async function getTarifas(req, res) {
  console.log('Controlador: llegando a GET /tarifas');
  try {
    res.status(200).json(await tarifarioModel.getTarifas());
  } catch (error) {
    responderError(res, 'Error al obtener el tarifario', error);
  }
}

// La validación está en el modelo (necesita conocer los destinos que ya existen).
async function crearTarifa(req, res) {
  console.log('Controlador: llegando a POST /tarifas');
  try {
    res.status(201).json(await tarifarioModel.crearTarifa(req.body, req.usuario));
  } catch (error) {
    responderError(res, 'Error al registrar la tarifa', error);
  }
}

async function getParametros(req, res) {
  console.log('Controlador: llegando a GET /parametros-costo');
  try {
    res.status(200).json(await parametroCostoModel.getParametros());
  } catch (error) {
    responderError(res, 'Error al obtener los parámetros de costo', error);
  }
}

async function guardarParametros(req, res) {
  console.log('Controlador: llegando a PUT /parametros-costo');
  try {
    const { valores } = req.body || {};
    res.status(200).json(await parametroCostoModel.guardarParametros(valores, req.usuario));
  } catch (error) {
    responderError(res, 'Error al guardar los parámetros de costo', error);
  }
}

module.exports = { getTarifas, crearTarifa, getParametros, guardarParametros };
