// Reglas de las evidencias que sube el técnico (solo lógica, sin acceso al Excel ni a Drive, para poder probarla).
//
// Una evidencia es una imagen, un PDF o un documento Word que el técnico adjunta al diagnóstico o al avance de una visita.
// Cada archivo pesa como máximo 8 MB y cada diagnóstico o visita admite hasta 10. El archivo viaja como base64 dentro del
// JSON; se comprueba su tipo, su extensión y que sus primeros bytes sean los de ese tipo (no basta con confiar en el nombre).

const { errorHttp, texto, mismoId } = require('./hojasUtils');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_POR_DESTINO = 10;
const NOMBRE_LARGO_MAXIMO = 120;

const AMBITO = { DIAGNOSTICO: 'DIAGNOSTICO', AVANCE: 'AVANCE' };

// tipo MIME -> extensiones aceptadas y cómo empiezan los bytes de ese tipo de archivo
const TIPOS = {
  'image/jpeg': { extensiones: ['.jpg', '.jpeg'], firma: [[0xff, 0xd8, 0xff]] },
  'image/png': { extensiones: ['.png'], firma: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { extensiones: ['.webp'], firma: [[0x52, 0x49, 0x46, 0x46]] },
  'application/pdf': { extensiones: ['.pdf'], firma: [[0x25, 0x50, 0x44, 0x46]] },
  'application/msword': { extensiones: ['.doc'], firma: [[0xd0, 0xcf, 0x11, 0xe0]] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extensiones: ['.docx'], firma: [[0x50, 0x4b, 0x03, 0x04]] },
};

const esImagen = tipo => texto(tipo).startsWith('image/');

// Sin separadores de ruta ni caracteres de control, y de largo acotado (conserva la extensión).
function nombreSeguro(nombre) {
  const limpio = texto(nombre).replace(/[\\/]+/g, '-').replace(/[\u0000-\u001f]/g, '').trim();
  if (limpio.length <= NOMBRE_LARGO_MAXIMO) return limpio;
  const punto = limpio.lastIndexOf('.');
  const extension = punto > 0 ? limpio.slice(punto) : '';
  return limpio.slice(0, NOMBRE_LARGO_MAXIMO - extension.length) + extension;
}

const empiezaCon = (bytes, firma) => firma.every((byte, i) => bytes[i] === byte);

// Valida lo que envía el navegador y devuelve { nombre, tipo, contenido (Buffer) } o lanza un error 400/413.
//   archivo: { nombre, tipo, contenidoBase64 }
function validarArchivo({ nombre, tipo, contenidoBase64 } = {}) {
  const limpio = nombreSeguro(nombre);
  if (!limpio) throw errorHttp(400, 'Falta el nombre del archivo');

  const definicion = TIPOS[texto(tipo)];
  const extension = limpio.includes('.') ? limpio.slice(limpio.lastIndexOf('.')).toLowerCase() : '';
  if (!definicion || !definicion.extensiones.includes(extension)) {
    throw errorHttp(400, `«${limpio}»: solo se aceptan imágenes (JPG, PNG o WEBP), PDF y documentos Word (DOC o DOCX)`);
  }

  if (typeof contenidoBase64 !== 'string' || contenidoBase64 === '') throw errorHttp(400, `«${limpio}»: el archivo viene vacío`);
  // Un base64 de 8 MB mide unos 10,7 MB: se descarta antes de decodificar lo que ya pasa del límite
  if (contenidoBase64.length > Math.ceil((MAX_BYTES * 4) / 3) + 8) throw errorHttp(413, `«${limpio}» pesa más de 8 MB`);

  const contenido = Buffer.from(contenidoBase64, 'base64');
  if (contenido.length === 0) throw errorHttp(400, `«${limpio}»: el archivo viene vacío`);
  if (contenido.length > MAX_BYTES) throw errorHttp(413, `«${limpio}» pesa más de 8 MB`);
  if (!definicion.firma.some(firma => empiezaCon(contenido, firma))) {
    throw errorHttp(400, `«${limpio}»: el contenido no corresponde a un archivo ${definicion.extensiones[0].slice(1).toUpperCase()}`);
  }

  return { nombre: limpio, tipo: texto(tipo), contenido };
}

// ¿Admite el destino (diagnóstico o visita) un archivo más?
function exigirCupo(cantidadActual) {
  if (cantidadActual >= MAX_POR_DESTINO) throw errorHttp(409, `Cada visita admite hasta ${MAX_POR_DESTINO} archivos`);
}

// Una fila de la hoja evidencias, con la forma que consume el frontend. La URL es relativa a la API: el archivo se sirve
// desde el backend, no desde Drive.
const armarEvidencia = fila => ({
  evidenciaId: Number(texto(fila.get('evidenciaId'))),
  nombre: texto(fila.get('nombre')),
  url: `/evidencias/${texto(fila.get('evidenciaId'))}/archivo`,
  esImagen: esImagen(fila.get('tipo')),
  subidoEn: texto(fila.get('subidoEn')),
});

// Evidencias de un diagnóstico (visitaId) o de una visita programada (visitaProgramadaId), las más antiguas primero.
function evidenciasDe(filas, { ambito, visitaId, visitaProgramadaId }) {
  return filas
    .filter(f =>
      texto(f.get('ambito')) === ambito &&
      mismoId(f.get('visitaId'), visitaId) &&
      (ambito === AMBITO.DIAGNOSTICO || mismoId(f.get('visitaProgramadaId'), visitaProgramadaId))
    )
    .map(armarEvidencia)
    .sort((a, b) => a.subidoEn.localeCompare(b.subidoEn));
}

module.exports = { MAX_BYTES, MAX_POR_DESTINO, AMBITO, TIPOS, esImagen, nombreSeguro, validarArchivo, exigirCupo, armarEvidencia, evidenciasDe };
