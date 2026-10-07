const { conectar } = require('../services/sheetsService');
const driveService = require('../services/driveService');

const ESTADOS_QUE_ADMITEN_OFERTAS = ['PENDIENTE', 'CON OFERTAS'];

// Estructura en Drive, bajo la carpeta raíz del sistema:
//   Solicitudes de Servicio/Solicitud N° X - Cliente/   ofertas de los técnicos (temporal)
//   Clientes/<Cliente>/Servicio N° X - <fecha>/         todo el servicio; la oferta aceptada se mueve aquí
const CARPETA_SOLICITUDES = 'Solicitudes de Servicio';
const CARPETA_CLIENTES = 'Clientes';

// Error con código HTTP; el controlador lo traduce a la respuesta.
function errorHttp(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const texto = valor => String(valor ?? '').trim();
const mismoId = (a, b) => texto(a) === texto(b);
const normalizar = valor => texto(valor).toLowerCase();

// En la hoja las fechas son "YYYY-MM-DD"; si alguien las edita a mano en Excel
// pueden venir como "d/m/yyyy". Ambas se aceptan y se devuelven en el formato pedido.
function partesFecha(valor) {
  const fecha = texto(valor);
  let m = fecha.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { anio: m[1], mes: m[2].padStart(2, '0'), dia: m[3].padStart(2, '0') };
  m = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { anio: m[3], mes: m[2].padStart(2, '0'), dia: m[1].padStart(2, '0') };
  return null;
}

const aISO = valor => {
  const p = partesFecha(valor);
  return p ? `${p.anio}-${p.mes}-${p.dia}` : texto(valor);
};

const aDiaMesAnio = valor => {
  const p = partesFecha(valor);
  return p ? `${p.dia}/${p.mes}/${p.anio}` : texto(valor);
};

// Fecha de hoy en Perú, "YYYY-MM-DD".
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

const sinSeparadores = nombre => texto(nombre).replace(/[\\/]+/g, '-');

const nombreCliente = (filaCliente, clienteId) =>
  sinSeparadores(filaCliente?.get('nombre')) || `Cliente ${texto(clienteId)}`;

// El número de servicio es el de la solicitud y la fecha es la de la solicitud, así el nombre
// no cambia con el tiempo y repetir la operación reutiliza la misma carpeta.
const rutaCarpetaServicio = (filaSolicitud, filaCliente) => [
  CARPETA_CLIENTES,
  nombreCliente(filaCliente, filaSolicitud.get('clienteId')),
  `Servicio N° ${texto(filaSolicitud.get('solicitudId'))} - ${aISO(filaSolicitud.get('fecha'))}`,
];

// Carpeta donde se guardan las ofertas mientras la solicitud no tiene técnico asignado.
const rutaCarpetaOfertas = (filaSolicitud, filaCliente) => [
  CARPETA_SOLICITUDES,
  `Solicitud N° ${texto(filaSolicitud.get('solicitudId'))} - ${nombreCliente(filaCliente, filaSolicitud.get('clienteId'))}`,
];

const idArchivoDrive = enlace => texto(enlace).match(/\/d\/([A-Za-z0-9_-]+)/)?.[1];

function siguienteId(filas, campo) {
  const ids = filas.map(f => parseInt(f.get(campo), 10)).filter(Number.isInteger);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

async function cargarDatos() {
  const doc = await conectar();
  const hojas = {
    solicitudes: doc.sheetsByTitle['solicitudes'],
    solicitudTecnicos: doc.sheetsByTitle['solicitudTecnicos'],
    ofertas: doc.sheetsByTitle['ofertas'],
    clientes: doc.sheetsByTitle['clientes'],
    tecnicos: doc.sheetsByTitle['tecnicos'],
  };

  const faltante = Object.entries(hojas).find(([, hoja]) => !hoja);
  if (faltante) throw new Error(`No existe la hoja "${faltante[0]}" en el Excel`);

  const [solicitudes, solicitudTecnicos, ofertas, clientes, tecnicos] = await Promise.all([
    hojas.solicitudes.getRows(),
    hojas.solicitudTecnicos.getRows(),
    hojas.ofertas.getRows(),
    hojas.clientes.getRows(),
    hojas.tecnicos.getRows(),
  ]);

  return { hojas, filas: { solicitudes, solicitudTecnicos, ofertas, clientes, tecnicos } };
}

// Une las hojas y devuelve las solicitudes con la forma que consume el frontend
// (cliente, técnicos y ofertas ya resueltos por nombre).
function armarSolicitudes({ filas }, soloId) {
  const clientesPorId = new Map(filas.clientes.map(f => [texto(f.get('clienteId')), f]));
  const tecnicosPorId = new Map(filas.tecnicos.map(f => [texto(f.get('tecnicoId')), f]));

  const tecnicosDeSolicitud = new Map();
  for (const f of filas.solicitudTecnicos) {
    const solicitudId = texto(f.get('solicitudId'));
    const tecnico = tecnicosPorId.get(texto(f.get('tecnicoId')));
    if (!tecnico) continue;
    if (!tecnicosDeSolicitud.has(solicitudId)) tecnicosDeSolicitud.set(solicitudId, []);
    tecnicosDeSolicitud.get(solicitudId).push({
      tecnicoId: Number(tecnico.get('tecnicoId')),
      nombre: texto(tecnico.get('nombre')),
    });
  }

  const ofertasDeSolicitud = new Map();
  for (const f of filas.ofertas) {
    const solicitudId = texto(f.get('solicitudId'));
    const ofertaId = Number(f.get('ofertaId'));
    const tecnico = tecnicosPorId.get(texto(f.get('tecnicoId')));
    if (!ofertasDeSolicitud.has(solicitudId)) ofertasDeSolicitud.set(solicitudId, []);
    ofertasDeSolicitud.get(solicitudId).push({
      ofertaId,
      solicitudId: Number(solicitudId),
      tecnicoNombre: tecnico ? texto(tecnico.get('nombre')) : '',
      tecnicoUbicacion: tecnico ? texto(tecnico.get('ubicacion')) : '',
      montoVisita: Number(f.get('montoVisita')) || 0,
      archivoNombre: texto(f.get('archivoNombre')),
      // Ruta relativa a la API: el archivo se sirve desde el backend, no desde Drive.
      archivoUrl: texto(f.get('archivoUrl')) ? `/ofertas/${ofertaId}/archivo` : '',
      estado: texto(f.get('estado')) || 'PENDIENTE',
    });
  }

  return filas.solicitudes
    .filter(f => soloId === undefined || mismoId(f.get('solicitudId'), soloId))
    .map(f => {
      const solicitudId = texto(f.get('solicitudId'));
      const clienteFila = clientesPorId.get(texto(f.get('clienteId')));
      const cliente = clienteFila && {
        clienteId: Number(clienteFila.get('clienteId')),
        nombre: texto(clienteFila.get('nombre')),
        direccion: texto(clienteFila.get('direccion')),
        ruc: texto(clienteFila.get('ruc')),
        correoElectronico: texto(clienteFila.get('correoElectronico')),
        tipoPersona: texto(clienteFila.get('tipoPersona')),
      };

      const solicitud = {
        solicitudId: Number(solicitudId),
        clienteNombre: cliente?.nombre ?? '',
        descripcion: texto(f.get('descripcion')),
        fecha: aDiaMesAnio(f.get('fecha')),
        tecnicos: (tecnicosDeSolicitud.get(solicitudId) ?? []).map(t => t.nombre),
        tecnicoIds: (tecnicosDeSolicitud.get(solicitudId) ?? []).map(t => t.tecnicoId),
        estado: texto(f.get('estado')),
        ofertas: (ofertasDeSolicitud.get(solicitudId) ?? []).sort((a, b) => a.ofertaId - b.ofertaId),
      };
      if (cliente) solicitud.cliente = cliente;

      // La autorización no tiene hoja propia: son columnas de la solicitud, vacías hasta autorizar.
      if (texto(f.get('fechaInicio')) || texto(f.get('instrucciones'))) {
        solicitud.autorizacion = {
          instrucciones: texto(f.get('instrucciones')),
          fechaInicio: aISO(f.get('fechaInicio')),
          fechaFin: aISO(f.get('fechaFin')),
        };
      }

      return solicitud;
    })
    .sort((a, b) => b.solicitudId - a.solicitudId);
}

// Una solicitud ya asignada tiene un servicio en marcha: no se modifica ni se elimina.
function exigirSinAsignar(filaSolicitud, accion) {
  if (!ESTADOS_QUE_ADMITEN_OFERTAS.includes(texto(filaSolicitud.get('estado')))) {
    throw errorHttp(409, `Solo se puede ${accion} una solicitud que aún no fue asignada`);
  }
}

// Comprueba que el cliente y los técnicos existan y devuelve los ids de técnico sin repetidos.
function validarClienteYTecnicos(filas, clienteId, tecnicoIds) {
  if (!filas.clientes.some(f => mismoId(f.get('clienteId'), clienteId))) {
    throw errorHttp(400, 'El cliente no existe');
  }
  const ids = [...new Set(tecnicoIds.map(texto))];
  const desconocido = ids.find(id => !filas.tecnicos.some(f => mismoId(f.get('tecnicoId'), id)));
  if (desconocido) throw errorHttp(400, `El técnico ${desconocido} no existe`);
  return ids;
}

// De abajo hacia arriba, para que al borrar no se corran los índices de las filas restantes.
async function eliminarFilas(filas) {
  for (const fila of [...filas].sort((a, b) => b.rowNumber - a.rowNumber)) {
    await fila.delete();
  }
}

function buscarSolicitud(datos, solicitudId) {
  const fila = datos.filas.solicitudes.find(f => mismoId(f.get('solicitudId'), solicitudId));
  if (!fila) throw errorHttp(404, 'Solicitud no encontrada');
  return fila;
}

async function getAllSolicitudes() {
  const datos = await cargarDatos();
  return armarSolicitudes(datos);
}

async function createSolicitud({ clienteId, descripcion, tecnicoIds }) {
  console.log('Modelo: creando solicitud', { clienteId, descripcion, tecnicoIds });

  const datos = await cargarDatos();
  const { hojas, filas } = datos;

  const idsTecnicos = validarClienteYTecnicos(filas, clienteId, tecnicoIds);

  const solicitudId = siguienteId(filas.solicitudes, 'solicitudId');

  // raw: evita que Sheets reinterprete el texto (fórmulas, fechas) al guardarlo.
  const nuevaFila = await hojas.solicitudes.addRow({
    solicitudId,
    clienteId,
    descripcion,
    fecha: hoyISO(),
    estado: 'PENDIENTE',
    instrucciones: '',
    fechaInicio: '',
    fechaFin: '',
  }, { raw: true });
  filas.solicitudes.push(nuevaFila);

  const filasTecnicos = await hojas.solicitudTecnicos.addRows(
    idsTecnicos.map(tecnicoId => ({ solicitudId, tecnicoId })),
    { raw: true }
  );
  filas.solicitudTecnicos.push(...filasTecnicos);

  return armarSolicitudes(datos, solicitudId)[0];
}

// Edita la solicitud mientras no esté asignada. Con ofertas ya enviadas no se puede cambiar el cliente
// (las ofertas se guardan en una carpeta con su nombre) ni quitar a un técnico que ya ofertó.
async function updateSolicitud(solicitudId, { clienteId, descripcion, tecnicoIds }) {
  console.log('Modelo: editando solicitud', solicitudId);

  const datos = await cargarDatos();
  const { hojas, filas } = datos;

  const filaSolicitud = buscarSolicitud(datos, solicitudId);
  exigirSinAsignar(filaSolicitud, 'modificar');
  const idsNuevos = validarClienteYTecnicos(filas, clienteId, tecnicoIds);

  const ofertas = filas.ofertas.filter(f => mismoId(f.get('solicitudId'), solicitudId));
  if (ofertas.length > 0 && !mismoId(filaSolicitud.get('clienteId'), clienteId)) {
    throw errorHttp(409, 'No se puede cambiar el cliente: la solicitud ya tiene ofertas');
  }

  const actuales = filas.solicitudTecnicos.filter(f => mismoId(f.get('solicitudId'), solicitudId));
  const aQuitar = actuales.filter(f => !idsNuevos.includes(texto(f.get('tecnicoId'))));
  const conOferta = aQuitar.find(f => ofertas.some(o => mismoId(o.get('tecnicoId'), f.get('tecnicoId'))));
  if (conOferta) {
    const tecnico = filas.tecnicos.find(f => mismoId(f.get('tecnicoId'), conOferta.get('tecnicoId')));
    throw errorHttp(409, `No se puede quitar a ${texto(tecnico?.get('nombre'))}: ya envió una oferta`);
  }
  const yaAsignados = new Set(actuales.map(f => texto(f.get('tecnicoId'))));
  const nuevos = idsNuevos.filter(id => !yaAsignados.has(id));

  // Todas las validaciones pasaron: recién ahora se escribe.
  filaSolicitud.set('clienteId', clienteId);
  filaSolicitud.set('descripcion', descripcion);
  await filaSolicitud.save({ raw: true });

  await eliminarFilas(aQuitar);
  filas.solicitudTecnicos = filas.solicitudTecnicos.filter(f => !aQuitar.includes(f));

  if (nuevos.length > 0) {
    const agregadas = await hojas.solicitudTecnicos.addRows(
      nuevos.map(tecnicoId => ({ solicitudId, tecnicoId })),
      { raw: true }
    );
    filas.solicitudTecnicos.push(...agregadas);
  }

  return armarSolicitudes(datos, solicitudId)[0];
}

// Elimina la solicitud con sus ofertas y técnicos asignados. La carpeta de ofertas en Drive va a la
// papelera (recuperable) y se hace al final y sin bloquear: la hoja es la fuente de verdad, y una carpeta
// huérfana en Drive no causa problemas.
async function deleteSolicitud(solicitudId) {
  console.log('Modelo: eliminando solicitud', solicitudId);

  const datos = await cargarDatos();
  const { filas } = datos;

  const filaSolicitud = buscarSolicitud(datos, solicitudId);
  exigirSinAsignar(filaSolicitud, 'eliminar');

  const filaCliente = filas.clientes.find(f => mismoId(f.get('clienteId'), filaSolicitud.get('clienteId')));
  const ofertas = filas.ofertas.filter(f => mismoId(f.get('solicitudId'), solicitudId));
  const rutaOfertas = rutaCarpetaOfertas(filaSolicitud, filaCliente);
  const habiaArchivos = ofertas.some(f => texto(f.get('archivoUrl')));

  await eliminarFilas(ofertas);
  await eliminarFilas(filas.solicitudTecnicos.filter(f => mismoId(f.get('solicitudId'), solicitudId)));
  await filaSolicitud.delete();

  if (habiaArchivos) {
    try {
      await driveService.enviarCarpetaAPapelera(rutaOfertas);
    } catch (error) {
      console.error('Modelo: no se pudo enviar a la papelera la carpeta de ofertas', rutaOfertas.join('/'), error.message);
    }
  }

  return { solicitudId: Number(solicitudId) };
}

// El técnico crea su oferta o edita la que ya envió. Por ahora la oferta es solo el monto: el archivo
// es opcional y el frontend no lo envía. Si llegara uno se sube a Drive antes de tocar la hoja,
// para no dejar una oferta sin cotización si la subida falla.
async function enviarOferta(solicitudId, { tecnicoNombre, montoVisita, archivo }) {
  console.log('Modelo: oferta de', tecnicoNombre, 'para la solicitud', solicitudId);

  const datos = await cargarDatos();
  const { hojas, filas } = datos;

  const filaSolicitud = buscarSolicitud(datos, solicitudId);
  if (!ESTADOS_QUE_ADMITEN_OFERTAS.includes(texto(filaSolicitud.get('estado')))) {
    throw errorHttp(409, 'La solicitud ya fue asignada y no admite más ofertas');
  }

  const filaTecnico = filas.tecnicos.find(f => normalizar(f.get('nombre')) === normalizar(tecnicoNombre));
  const tecnicoId = filaTecnico && texto(filaTecnico.get('tecnicoId'));
  const asignado = tecnicoId && filas.solicitudTecnicos.some(f =>
    mismoId(f.get('solicitudId'), solicitudId) && mismoId(f.get('tecnicoId'), tecnicoId)
  );
  if (!asignado) throw errorHttp(403, 'La solicitud no fue enviada a este técnico');

  const filaOferta = filas.ofertas.find(f =>
    mismoId(f.get('solicitudId'), solicitudId) && mismoId(f.get('tecnicoId'), tecnicoId)
  );
  const ofertaId = filaOferta ? Number(filaOferta.get('ofertaId')) : siguienteId(filas.ofertas, 'ofertaId');

  let archivoNombre = texto(filaOferta?.get('archivoNombre'));
  let archivoUrl = texto(filaOferta?.get('archivoUrl'));
  if (archivo) {
    const cliente = filas.clientes.find(f => mismoId(f.get('clienteId'), filaSolicitud.get('clienteId')));
    const { carpetaId } = await driveService.buscarOCrearRuta(rutaCarpetaOfertas(filaSolicitud, cliente));
    // El prefijo evita que dos técnicos con un archivo del mismo nombre se pisen en la carpeta.
    const archivoId = await driveService.subirArchivo(
      carpetaId,
      `Oferta ${ofertaId} - ${tecnicoNombre} - ${archivo.nombre}`.replace(/[\\/]+/g, '-'),
      archivo.tipo,
      archivo.contenido
    );
    archivoNombre = archivo.nombre;
    archivoUrl = `https://drive.google.com/file/d/${archivoId}/view`;
  }

  if (filaOferta) {
    filaOferta.set('montoVisita', montoVisita);
    filaOferta.set('archivoNombre', archivoNombre);
    filaOferta.set('archivoUrl', archivoUrl);
    filaOferta.set('estado', 'PENDIENTE');
    await filaOferta.save({ raw: true });
  } else {
    const nueva = await hojas.ofertas.addRow({
      ofertaId,
      solicitudId,
      tecnicoId,
      montoVisita,
      archivoNombre,
      archivoUrl,
      estado: 'PENDIENTE',
    }, { raw: true });
    filas.ofertas.push(nueva);
  }

  if (texto(filaSolicitud.get('estado')) === 'PENDIENTE') {
    filaSolicitud.set('estado', 'CON OFERTAS');
    await filaSolicitud.save({ raw: true });
  }

  return armarSolicitudes(datos, solicitudId)[0];
}

// El empleado acepta o rechaza una oferta. Aceptarla asigna la solicitud.
async function decidirOferta(solicitudId, ofertaId, decision) {
  console.log('Modelo:', decision, 'oferta', ofertaId, 'de la solicitud', solicitudId);

  const datos = await cargarDatos();
  const filaSolicitud = buscarSolicitud(datos, solicitudId);

  const filaOferta = datos.filas.ofertas.find(f =>
    mismoId(f.get('ofertaId'), ofertaId) && mismoId(f.get('solicitudId'), solicitudId)
  );
  if (!filaOferta) throw errorHttp(404, 'Oferta no encontrada');

  if (!ESTADOS_QUE_ADMITEN_OFERTAS.includes(texto(filaSolicitud.get('estado')))) {
    throw errorHttp(409, 'La solicitud ya fue asignada');
  }

  // La cotización aceptada pasa de "Solicitudes de Servicio" a la carpeta del servicio del cliente.
  // Se mueve antes de escribir en la hoja: si Drive falla, la oferta sigue pendiente y se puede reintentar.
  if (decision === 'ACEPTADA') {
    const archivoId = idArchivoDrive(filaOferta.get('archivoUrl'));
    if (archivoId) {
      const filaCliente = datos.filas.clientes.find(f => mismoId(f.get('clienteId'), filaSolicitud.get('clienteId')));
      const { carpetaId } = await driveService.buscarOCrearRuta(rutaCarpetaServicio(filaSolicitud, filaCliente));
      await driveService.moverArchivo(archivoId, carpetaId);
    }
  }

  filaOferta.set('estado', decision);
  await filaOferta.save({ raw: true });

  if (decision === 'ACEPTADA') {
    filaSolicitud.set('estado', 'ASIGNADA');
    await filaSolicitud.save({ raw: true });
  }

  return armarSolicitudes(datos, solicitudId)[0];
}

// El empleado autoriza el viaje del técnico cuya oferta aceptó.
async function autorizarViaje(solicitudId, { instrucciones, fechaInicio, fechaFin }) {
  console.log('Modelo: autorizando viaje de la solicitud', solicitudId);

  const datos = await cargarDatos();
  const filaSolicitud = buscarSolicitud(datos, solicitudId);

  if (texto(filaSolicitud.get('estado')) !== 'ASIGNADA') {
    throw errorHttp(409, 'Solo se puede autorizar el viaje de una solicitud asignada');
  }

  filaSolicitud.set('instrucciones', instrucciones);
  filaSolicitud.set('fechaInicio', fechaInicio);
  filaSolicitud.set('fechaFin', fechaFin);
  filaSolicitud.set('estado', 'AUTORIZADO');
  await filaSolicitud.save({ raw: true });

  return armarSolicitudes(datos, solicitudId)[0];
}

// Carpeta de Drive del servicio de una solicitud (se crea si no existe). Es la misma donde
// se mueve la oferta aceptada, y la que usa el cierre del servicio.
async function getCarpetaServicio(solicitudId) {
  const datos = await cargarDatos();
  const filaSolicitud = buscarSolicitud(datos, solicitudId);
  const filaCliente = datos.filas.clientes.find(f => mismoId(f.get('clienteId'), filaSolicitud.get('clienteId')));

  return driveService.buscarOCrearRuta(rutaCarpetaServicio(filaSolicitud, filaCliente));
}

// Id del archivo en Drive de una oferta, o null si no tiene.
async function getArchivoOferta(ofertaId) {
  const datos = await cargarDatos();
  const fila = datos.filas.ofertas.find(f => mismoId(f.get('ofertaId'), ofertaId));
  if (!fila) throw errorHttp(404, 'Oferta no encontrada');

  const archivoId = idArchivoDrive(fila.get('archivoUrl'));
  if (!archivoId) throw errorHttp(404, 'La oferta no tiene archivo');

  return { archivoId, archivoNombre: texto(fila.get('archivoNombre')) };
}

module.exports = {
  getAllSolicitudes,
  createSolicitud,
  updateSolicitud,
  deleteSolicitud,
  enviarOferta,
  decidirOferta,
  autorizarViaje,
  getCarpetaServicio,
  getArchivoOferta,
};
