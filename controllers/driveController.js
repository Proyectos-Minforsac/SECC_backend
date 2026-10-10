const driveService = require('../services/driveService');

const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;

function responderError(res, mensaje, error) {
  console.error(`Controlador: ${mensaje}`, error);
  const status = error.status || (error.code >= 400 && error.code < 600 ? error.code : 500);
  res.status(status).json({ message: mensaje, error: error.message });
}

// Crea (o reutiliza) la carpeta de Drive de un servicio y devuelve su enlace.
async function crearCarpeta(req, res) {
  console.log('Controlador: llegando a POST /drive/carpetas');
  try {
    const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
    if (!nombre || nombre.length > 200) {
      return res.status(400).json({ message: 'El nombre de la carpeta es obligatorio (máximo 200 caracteres)' });
    }

    res.status(201).json(await driveService.buscarOCrearCarpeta(nombre));
  } catch (error) {
    responderError(res, 'No se pudo crear la carpeta en Google Drive', error);
  }
}

// El archivo llega como cuerpo binario (express.raw); nombre y tipo van en la query.
async function subirArchivo(req, res) {
  console.log('Controlador: llegando a POST /drive/carpetas/:carpetaId/archivos');
  try {
    const { carpetaId } = req.params;
    const nombre = String(req.query.nombre || '').trim();
    const tipo = String(req.query.tipo || 'application/octet-stream');

    if (!ID_DRIVE.test(carpetaId)) return res.status(400).json({ message: 'Carpeta inválida' });
    if (!nombre || nombre.length > 200) {
      return res.status(400).json({ message: 'El nombre del archivo es obligatorio (máximo 200 caracteres)' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: 'El archivo está vacío' });
    }

    const archivoId = await driveService.subirArchivo(carpetaId, nombre, tipo, req.body);
    res.status(201).json({ archivoId });
  } catch (error) {
    responderError(res, 'No se pudo subir el archivo a Google Drive', error);
  }
}

module.exports = { crearCarpeta, subirArchivo };
