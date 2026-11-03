const costoRealModel = require('../models/costoRealModel');
const { FASES } = require('../services/costosReales');

function responderError(res, mensaje, error) {
  // Los errores con status (400, 404, 409...) son de negocio y su mensaje es seguro de mostrar.
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const aEntero = valor => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

// Lo registrado de un servicio: imprevistos, costos confirmados y qué etapas siguen abiertas.
async function getCostosDeServicio(req, res) {
  console.log('Controlador: GET /visitas/:id/costos');
  try {
    const visitaId = aEntero(req.params.id);
    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });

    res.status(200).json(await costoRealModel.getCostosDeServicio(visitaId));
  } catch (error) {
    responderError(res, 'Error al obtener los costos del servicio', error);
  }
}

// La tabla de liquidación ya llenada con lo planificado y lo ejecutado.
async function getLiquidacion(req, res) {
  console.log('Controlador: GET /visitas/:id/liquidacion');
  try {
    const visitaId = aEntero(req.params.id);
    const { fase } = req.query;
    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });
    if (!FASES.includes(fase)) return res.status(400).json({ message: 'Fase de liquidación inválida' });

    res.status(200).json(await costoRealModel.proponerLiquidacion(visitaId, fase));
  } catch (error) {
    responderError(res, 'Error al preparar la liquidación', error);
  }
}

// Liquidación de mantenimiento y soporte, antes de cerrar el servicio. La de diagnóstico e instalación va con Finalizar etapa.
async function liquidarFinal(req, res) {
  console.log('Controlador: POST /visitas/:id/liquidacion-final');
  try {
    const visitaId = aEntero(req.params.id);
    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });

    res.status(200).json(await costoRealModel.liquidarFinal(visitaId, (req.body || {}).etapas, req.usuario));
  } catch (error) {
    responderError(res, 'Error al registrar la liquidación', error);
  }
}

async function registrarImprevisto(req, res) {
  console.log('Controlador: POST /visitas/:id/imprevistos');
  try {
    const visitaId = aEntero(req.params.id);
    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });

    const { etapa, concepto, monto, motivo } = req.body || {};
    res.status(201).json(await costoRealModel.registrarImprevisto(visitaId, { etapa, concepto, monto, motivo }, req.usuario));
  } catch (error) {
    responderError(res, 'Error al registrar el imprevisto', error);
  }
}

// Le pone el monto a un imprevisto (el trabajador completa el que avisó el técnico).
async function completarImprevisto(req, res) {
  console.log('Controlador: PATCH /imprevistos/:id');
  try {
    const costoRealId = aEntero(req.params.id);
    if (!costoRealId) return res.status(400).json({ message: 'Imprevisto inválido' });

    res.status(200).json(await costoRealModel.completarImprevisto(costoRealId, (req.body || {}).monto, req.usuario));
  } catch (error) {
    responderError(res, 'Error al registrar el monto del imprevisto', error);
  }
}

async function eliminarImprevisto(req, res) {
  console.log('Controlador: DELETE /imprevistos/:id');
  try {
    const costoRealId = aEntero(req.params.id);
    if (!costoRealId) return res.status(400).json({ message: 'Imprevisto inválido' });

    res.status(200).json(await costoRealModel.eliminarImprevisto(costoRealId));
  } catch (error) {
    responderError(res, 'Error al descartar el imprevisto', error);
  }
}

// Márgenes y punto del control de cada servicio, para el Historial de Servicios.
async function getServicios(req, res) {
  console.log('Controlador: GET /servicios-costos');
  try {
    res.status(200).json(await costoRealModel.getServicios());
  } catch (error) {
    responderError(res, 'Error al obtener los costos de los servicios', error);
  }
}

module.exports = {
  getCostosDeServicio,
  getLiquidacion,
  liquidarFinal,
  registrarImprevisto,
  completarImprevisto,
  eliminarImprevisto,
  getServicios,
};
