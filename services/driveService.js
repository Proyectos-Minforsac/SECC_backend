const { OAuth2Client } = require('google-auth-library');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TIPO_CARPETA = 'application/vnd.google-apps.folder';

let cliente = null;

// Drive actúa como una cuenta de Google real (la dueña de la carpeta), no como la cuenta de servicio de
// Sheets: las cuentas de servicio no tienen espacio de almacenamiento y no pueden ser dueñas de archivos.
// Los archivos ocupan el espacio de esa cuenta. El refresh token se obtiene una vez con
// `npm run drive:token` y la librería renueva el acceso sola.
function obtenerCliente() {
  if (!cliente) {
    const { DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET, DRIVE_OAUTH_REFRESH_TOKEN } = process.env;
    if (!DRIVE_OAUTH_CLIENT_ID || !DRIVE_OAUTH_CLIENT_SECRET || !DRIVE_OAUTH_REFRESH_TOKEN) {
      throw new Error(
        'Falta configurar Google Drive: DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET y DRIVE_OAUTH_REFRESH_TOKEN'
      );
    }
    cliente = new OAuth2Client(DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET);
    cliente.setCredentials({ refresh_token: DRIVE_OAUTH_REFRESH_TOKEN });
  }
  return cliente;
}

// Carpeta (de la cuenta de Drive configurada) dentro de la cual se organiza todo lo del sistema.
function carpetaRaiz() {
  const id = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!id) throw new Error('Falta DRIVE_PARENT_FOLDER_ID en la configuración del servidor');
  return id;
}

const escaparConsulta = (texto) => texto.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function solicitar(opciones) {
  const respuesta = await obtenerCliente().request({ params: { supportsAllDrives: true }, ...opciones });
  return respuesta.data;
}

async function buscar(consulta, campos) {
  const data = await solicitar({
    url: `${API}/files`,
    params: { q: `${consulta} and trashed = false`, fields: `files(${campos})`, supportsAllDrives: true, includeItemsFromAllDrives: true },
  });
  return data.files || [];
}

// Idempotente: si la carpeta ya existe (p.ej. un cierre que se interrumpió), se reutiliza.
async function buscarOCrearCarpeta(nombre, padreId = carpetaRaiz()) {
  const [existente] = await buscar(
    `name = '${escaparConsulta(nombre)}' and '${padreId}' in parents and mimeType = '${TIPO_CARPETA}'`,
    'id, webViewLink'
  );
  if (existente) return { carpetaId: existente.id, url: existente.webViewLink };

  const creada = await solicitar({
    url: `${API}/files`,
    method: 'POST',
    params: { supportsAllDrives: true, fields: 'id, webViewLink' },
    data: { name: nombre, mimeType: TIPO_CARPETA, parents: [padreId] },
  });
  return { carpetaId: creada.id, url: creada.webViewLink };
}

// Crea (o reutiliza) una cadena de carpetas anidadas bajo la raíz, p.ej.
// ['Clientes', 'ACME', 'Servicio N° 3 - 2026-10-07']. Devuelve la última.
async function buscarOCrearRuta(nombres) {
  let carpeta = { carpetaId: carpetaRaiz() };
  for (const nombre of nombres) {
    carpeta = await buscarOCrearCarpeta(nombre, carpeta.carpetaId);
  }
  return carpeta;
}

// Busca una cadena de carpetas bajo la raíz sin crear nada. Devuelve el id de la última o null.
async function buscarRuta(nombres) {
  let padreId = carpetaRaiz();
  for (const nombre of nombres) {
    const [carpeta] = await buscar(
      `name = '${escaparConsulta(nombre)}' and '${padreId}' in parents and mimeType = '${TIPO_CARPETA}'`,
      'id'
    );
    if (!carpeta) return null;
    padreId = carpeta.id;
  }
  return padreId;
}

// Manda a la papelera de Drive la carpeta de esa ruta (con sus archivos). Es recuperable desde
// la papelera. Solo actúa dentro de la raíz del sistema: la ruta siempre parte de ella.
async function enviarCarpetaAPapelera(nombres) {
  if (nombres.length === 0) throw new Error('Falta la ruta de la carpeta');
  const carpetaId = await buscarRuta(nombres);
  if (!carpetaId) return false;

  await solicitar({
    url: `${API}/files/${carpetaId}`,
    method: 'PATCH',
    params: { supportsAllDrives: true, fields: 'id' },
    data: { trashed: true },
  });
  return true;
}

// Una carpeta es válida si es una carpeta de Drive que cuelga, a cualquier profundidad
// razonable, de la raíz configurada.
async function descendeDeLaRaiz(carpetaId) {
  const raiz = carpetaRaiz();
  let actual = carpetaId;
  for (let nivel = 0; nivel < 6; nivel++) {
    const carpeta = await solicitar({
      url: `${API}/files/${actual}`,
      params: { supportsAllDrives: true, fields: 'parents, mimeType' },
    });
    if (carpeta.mimeType !== TIPO_CARPETA) return false;
    const padres = carpeta.parents || [];
    if (padres.includes(raiz)) return true;
    if (padres.length === 0) return false;
    actual = padres[0];
  }
  return false;
}

const carpetasVerificadas = new Set();

// Solo se escribe dentro de las carpetas creadas bajo la carpeta raíz configurada.
async function verificarCarpeta(carpetaId) {
  if (carpetasVerificadas.has(carpetaId)) return;
  if (!(await descendeDeLaRaiz(carpetaId))) {
    const error = new Error('La carpeta indicada no pertenece a la carpeta del sistema en Drive');
    error.status = 403;
    throw error;
  }
  carpetasVerificadas.add(carpetaId);
}

// Sube (o reemplaza, si ya existe uno con el mismo nombre) un archivo en la carpeta del servicio.
async function subirArchivo(carpetaId, nombre, tipoMime, contenido) {
  await verificarCarpeta(carpetaId);

  const [existente] = await buscar(`name = '${escaparConsulta(nombre)}' and '${carpetaId}' in parents`, 'id');
  const archivoId =
    existente?.id ??
    (
      await solicitar({
        url: `${API}/files`,
        method: 'POST',
        params: { supportsAllDrives: true, fields: 'id' },
        data: { name: nombre, parents: [carpetaId] },
      })
    ).id;

  await solicitar({
    url: `${UPLOAD_API}/files/${archivoId}`,
    method: 'PATCH',
    params: { uploadType: 'media', supportsAllDrives: true, fields: 'id' },
    headers: { 'Content-Type': tipoMime },
    body: contenido,
  });

  return archivoId;
}

// Mueve un archivo a otra carpeta (idempotente). Tanto la carpeta actual del archivo como la de
// destino deben colgar de la raíz del sistema: no se mueve nada que esté fuera de ella.
async function moverArchivo(archivoId, carpetaDestinoId) {
  await verificarCarpeta(carpetaDestinoId);

  const { parents = [] } = await solicitar({
    url: `${API}/files/${archivoId}`,
    params: { supportsAllDrives: true, fields: 'parents' },
  });
  if (parents.includes(carpetaDestinoId)) return;

  await Promise.all(parents.map(verificarCarpeta));

  await solicitar({
    url: `${API}/files/${archivoId}`,
    method: 'PATCH',
    params: {
      supportsAllDrives: true,
      addParents: carpetaDestinoId,
      removeParents: parents.join(','),
      fields: 'id',
    },
  });
}

// Devuelve el archivo como stream junto con su nombre y tipo. Quien llame debe haber validado
// que el id salió de la base de datos: aquí no se comprueba la carpeta de origen.
async function descargarArchivo(archivoId) {
  const metadatos = await solicitar({
    url: `${API}/files/${archivoId}`,
    params: { supportsAllDrives: true, fields: 'name, mimeType' },
  });
  const stream = await solicitar({
    url: `${API}/files/${archivoId}`,
    params: { supportsAllDrives: true, alt: 'media' },
    responseType: 'stream',
  });
  return { nombre: metadatos.name, tipo: metadatos.mimeType, stream };
}

module.exports = {
  buscarOCrearCarpeta,
  buscarOCrearRuta,
  enviarCarpetaAPapelera,
  subirArchivo,
  moverArchivo,
  descargarArchivo,
};
