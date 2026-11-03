const validacionModel = require('../models/validacionModel');
const { ACCION } = require('../services/validacion');

// Los errores con status (400, 404, 409...) son de negocio y su mensaje es seguro de mostrar.
function responderError(res, mensaje, error) {
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const aEntero = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

// Bandeja del jefe: estimaciones por decidir y últimas decisiones.
async function getBandeja(req, res) {
  console.log('Controlador: GET /estimaciones');
  try {
    res.status(200).json(await validacionModel.getBandeja());
  } catch (error) {
    responderError(res, 'Error al obtener las validaciones', error);
  }
}

// La estimación vigente de una cotización con su desglose y su bitácora.
async function getDetalle(req, res) {
  console.log('Controlador: GET /estimaciones/cotizacion/:cotizacionId');
  try {
    const cotizacionId = aEntero(req.params.cotizacionId);
    if (!cotizacionId) return res.status(400).json({ message: 'Cotización inválida' });

    res.status(200).json(await validacionModel.getDetalle(cotizacionId));
  } catch (error) {
    responderError(res, 'Error al obtener la estimación', error);
  }
}

// Una decisión del jefe. `leerDatos` saca del cuerpo lo que esa acción necesita.
const decision = (accion, leerDatos) => async (req, res) => {
  console.log(`Controlador: POST /estimaciones/:estimacionId (${accion})`);
  try {
    const estimacionId = aEntero(req.params.estimacionId);
    if (!estimacionId) return res.status(400).json({ message: 'Estimación inválida' });

    const resultado = await validacionModel.decidirEstimacion(estimacionId, accion, leerDatos(req.body || {}), req.usuario);
    res.status(200).json(resultado);
  } catch (error) {
    responderError(res, 'Error al registrar la decisión', error);
  }
};

const validar = decision(ACCION.VALIDAR, (cuerpo) => ({ justificacion: cuerpo.justificacion }));
const ajustar = decision(ACCION.AJUSTAR, (cuerpo) => ({ costoNuevo: cuerpo.costoFinal, justificacion: cuerpo.justificacion }));
const devolver = decision(ACCION.DEVOLVER, (cuerpo) => ({ justificacion: cuerpo.motivo }));

module.exports = { getBandeja, getDetalle, validar, ajustar, devolver };
