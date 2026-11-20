const evidenciaModel = require('../models/evidenciaModel');
const driveService = require('../services/driveService');
const { esImagen } = require('../services/evidencias');

function responderError(res, mensaje, error) {
  // Los errores con status (400, 403, 409...) son de negocio y su mensaje es seguro de mostrar.
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const aEntero = valor => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

async function subirEvidencia(req, res) {
  console.log('Controlador: llegando a POST /evidencias');
  try {
    const { visitaId, visitaProgramadaId, nombre, tipo, contenidoBase64 } = req.body || {};

    const idVisita = aEntero(visitaId);
    if (!idVisita) return res.status(400).json({ message: 'Visita inválida' });

    // Sin visita programada la evidencia es del diagnóstico
    const hayProgramada = visitaProgramadaId !== undefined && visitaProgramadaId !== null && visitaProgramadaId !== '';
    const idProgramada = hayProgramada ? aEntero(visitaProgramadaId) : undefined;
    if (hayProgramada && !idProgramada) return res.status(400).json({ message: 'Visita programada inválida' });

    const evidencia = await evidenciaModel.subirEvidencia(
      { visitaId: idVisita, visitaProgramadaId: idProgramada, nombre, tipo, contenidoBase64 },
      req.usuario
    );
    res.status(201).json(evidencia);
  } catch (error) {
    responderError(res, 'No se pudo subir el archivo', error);
  }
}

async function quitarEvidencia(req, res) {
  console.log('Controlador: llegando a DELETE /evidencias/:id');
  try {
    const evidenciaId = aEntero(req.params.id);
    if (!evidenciaId) return res.status(400).json({ message: 'Evidencia inválida' });

    res.status(200).json(await evidenciaModel.quitarEvidencia(evidenciaId, req.usuario));
  } catch (error) {
    responderError(res, 'No se pudo quitar el archivo', error);
  }
}

// El archivo se sirve desde el backend (no desde Drive). Las imágenes y los PDF se muestran en el navegador; los demás se descargan.
async function descargarEvidencia(req, res) {
  console.log('Controlador: llegando a GET /evidencias/:id/archivo');
  try {
    const evidenciaId = aEntero(req.params.id);
    if (!evidenciaId) return res.status(400).json({ message: 'Evidencia inválida' });

    const { archivoId, nombre, tipo } = await evidenciaModel.getArchivo(evidenciaId);
    const { stream } = await driveService.descargarArchivo(archivoId);

    const sePuedeMostrar = esImagen(tipo) || tipo === 'application/pdf';
    res.setHeader('Content-Type', tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${sePuedeMostrar ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    stream.on('error', error => {
      console.error('Controlador: error al transmitir la evidencia', error);
      res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    responderError(res, 'No se pudo descargar el archivo', error);
  }
}

module.exports = { subirEvidencia, quitarEvidencia, descargarEvidencia };
