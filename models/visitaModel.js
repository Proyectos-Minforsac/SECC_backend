const { conectar } = require('../services/sheetsService');
const {
  errorHttp,
  texto,
  mismoId,
  aDiaMesAnio,
  aISO,
  hoyISO,
  siguienteId,
} = require('../services/hojasUtils');

// Ciclo de un servicio: AUTORIZADA (viaje autorizado) -> DIAGNÓSTICO COMPLETADO (el técnico envió su
// diagnóstico) -> ACTIVO (el cliente aceptó la cotización; se habilitan las visitas de instalación).
// Si el cliente rechaza la cotización, el servicio pasa a CANCELADA y ya no avanza.
const ESTADO_AUTORIZADA = 'AUTORIZADA';
const ESTADO_DIAGNOSTICO = 'DIAGNÓSTICO COMPLETADO';
const ESTADO_ACTIVO = 'ACTIVO';
const ESTADO_CANCELADA = 'CANCELADA';

// Etapas posteriores al diagnóstico, en el orden en que se habilitan. Cada visita programada pertenece a una.
// La etapa en curso es TIPOS_VISITA[etapasFinalizadas]: el empleado finaliza una etapa para habilitar la siguiente.
const TIPOS_VISITA = ['INSTALACION', 'MANTENIMIENTO', 'SOPORTE'];

const SEPARADOR_COMPONENTES = ';';

// "9:30" -> "09:30"
const aHora = valor => {
  const m = texto(valor).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : texto(valor);
};

async function cargarDatos() {
  const doc = await conectar();
  const hojas = {
    visitas: doc.sheetsByTitle['visitasTecnicas'],
    programadas: doc.sheetsByTitle['visitasProgramadas'],
    solicitudes: doc.sheetsByTitle['solicitudes'],
    ofertas: doc.sheetsByTitle['ofertas'],
    clientes: doc.sheetsByTitle['clientes'],
    tecnicos: doc.sheetsByTitle['tecnicos'],
  };

  const faltante = Object.entries(hojas).find(([, hoja]) => !hoja);
  if (faltante) throw new Error(`No existe la hoja "${faltante[0]}" en el Excel`);

  const [visitas, programadas, solicitudes, ofertas, clientes, tecnicos] = await Promise.all([
    hojas.visitas.getRows(),
    hojas.programadas.getRows(),
    hojas.solicitudes.getRows(),
    hojas.ofertas.getRows(),
    hojas.clientes.getRows(),
    hojas.tecnicos.getRows(),
  ]);

  return { hojas, filas: { visitas, programadas, solicitudes, ofertas, clientes, tecnicos } };
}

// Etapas posteriores al diagnóstico que el empleado ya finalizó (0 si la columna está vacía).
const etapasFinalizadas = filaVisita => Number(texto(filaVisita.get('etapasFinalizadas'))) || 0;

// Las visitas programadas anteriores a la columna "tipo" eran todas de instalación.
const tipoDe = fila => texto(fila.get('tipo')) || TIPOS_VISITA[0];

// Une las hojas y devuelve las visitas con la forma que consume el frontend. El cliente, las
// instrucciones y la fecha no se duplican en visitasTecnicas: salen de la solicitud.
function armarVisitas({ filas }, soloId) {
  const solicitudesPorId = new Map(filas.solicitudes.map(f => [texto(f.get('solicitudId')), f]));
  const clientesPorId = new Map(filas.clientes.map(f => [texto(f.get('clienteId')), f]));
  const tecnicosPorId = new Map(filas.tecnicos.map(f => [texto(f.get('tecnicoId')), f]));

  return filas.visitas
    .filter(f => soloId === undefined || mismoId(f.get('visitaId'), soloId))
    .map(f => {
      const solicitud = solicitudesPorId.get(texto(f.get('solicitudId')));
      const cliente = solicitud && clientesPorId.get(texto(solicitud.get('clienteId')));
      const tecnico = tecnicosPorId.get(texto(f.get('tecnicoId')));

      const visita = {
        visitaId: Number(texto(f.get('visitaId'))),
        solicitudId: Number(texto(f.get('solicitudId'))),
        clienteNombre: texto(cliente?.get('nombre')),
        tecnicoNombre: texto(tecnico?.get('nombre')),
        // Instrucciones y fecha tentativa de inicio que el empleado fijó al autorizar el viaje.
        descripcion: texto(solicitud?.get('instrucciones')),
        fecha: aDiaMesAnio(solicitud?.get('fechaInicio')),
        estado: texto(f.get('estado')) || ESTADO_AUTORIZADA,
        etapasFinalizadas: etapasFinalizadas(f),
      };

      if (texto(f.get('diagnosticoEn'))) {
        visita.diagnostico = {
          descripcion: texto(f.get('diagnosticoDescripcion')),
          componentes: texto(f.get('diagnosticoComponentes'))
            .split(SEPARADOR_COMPONENTES)
            .map(texto)
            .filter(Boolean),
          // Las evidencias (imágenes y documentos) todavía no se guardan en el backend.
          evidencias: [],
        };
      }

      if (texto(f.get('canceladaEn'))) {
        visita.cancelacion = {
          // Instante ISO de la cancelación; el frontend lo formatea a la hora local.
          fecha: texto(f.get('canceladaEn')),
          motivo: texto(f.get('motivoCancelacion')),
        };
      }

      if (texto(f.get('cierreFecha'))) {
        visita.cierre = {
          fecha: aDiaMesAnio(f.get('cierreFecha')),
          carpetaUrl: texto(f.get('cierreCarpetaUrl')),
        };
      }

      return visita;
    })
    .sort((a, b) => b.visitaId - a.visitaId);
}

function armarProgramada(fila) {
  const programada = {
    visitaProgramadaId: Number(texto(fila.get('visitaProgramadaId'))),
    visitaId: Number(texto(fila.get('visitaId'))),
    tipo: tipoDe(fila),
    fecha: aISO(fila.get('fecha')),
    horaInicio: aHora(fila.get('horaInicio')),
    horaFin: aHora(fila.get('horaFin')),
    descripcionTareas: texto(fila.get('descripcionTareas')),
  };

  if (texto(fila.get('completadaEn'))) {
    programada.avance = { descripcion: texto(fila.get('avanceDescripcion')), evidencias: [] };
  }

  return programada;
}

const armarProgramadas = ({ filas }) => filas.programadas.map(armarProgramada);

const clave = fila => `${aISO(fila.get('fecha'))}${aHora(fila.get('horaInicio'))}`;

function buscarVisita(datos, visitaId) {
  const fila = datos.filas.visitas.find(f => mismoId(f.get('visitaId'), visitaId));
  if (!fila) throw errorHttp(404, 'Visita técnica no encontrada');
  return fila;
}

function buscarProgramada(datos, visitaProgramadaId) {
  const fila = datos.filas.programadas.find(f => mismoId(f.get('visitaProgramadaId'), visitaProgramadaId));
  if (!fila) throw errorHttp(404, 'Visita programada no encontrada');
  return fila;
}

const estaCompletada = fila => texto(fila.get('completadaEn')) !== '';

// Con el servicio cerrado o cancelado ya no se agenda ni se modifica nada.
function exigirServicioAbierto(filaVisita) {
  if (texto(filaVisita.get('cierreFecha'))) throw errorHttp(409, 'El servicio ya fue cerrado');
  if (texto(filaVisita.get('estado')) === ESTADO_CANCELADA) throw errorHttp(409, 'El servicio fue cancelado');
}

async function getVisitas() {
  return armarVisitas(await cargarDatos());
}

async function getVisitasProgramadas() {
  return armarProgramadas(await cargarDatos());
}

// La crea autorizarViaje de solicitudModel. El técnico es el de la oferta aceptada. Si la solicitud ya
// tiene visita (un reintento tras un fallo a medias) se devuelve esa en vez de duplicarla.
async function crearVisitaDeSolicitud(solicitudId) {
  console.log('Modelo: creando la visita técnica de la solicitud', solicitudId);

  const datos = await cargarDatos();
  const { hojas, filas } = datos;

  const existente = filas.visitas.find(f => mismoId(f.get('solicitudId'), solicitudId));
  if (existente) return armarVisitas(datos, existente.get('visitaId'))[0];

  const oferta = filas.ofertas.find(f =>
    mismoId(f.get('solicitudId'), solicitudId) && texto(f.get('estado')) === 'ACEPTADA'
  );
  if (!oferta) throw errorHttp(409, 'La solicitud no tiene una oferta aceptada');

  const visitaId = siguienteId(filas.visitas, 'visitaId');
  // raw: evita que Sheets reinterprete el texto (fórmulas, fechas) al guardarlo.
  const nueva = await hojas.visitas.addRow({
    visitaId,
    solicitudId,
    tecnicoId: texto(oferta.get('tecnicoId')),
    estado: ESTADO_AUTORIZADA,
    diagnosticoDescripcion: '',
    diagnosticoComponentes: '',
    diagnosticoEn: '',
    cierreFecha: '',
    cierreCarpetaUrl: '',
  }, { raw: true });
  filas.visitas.push(nueva);

  return armarVisitas(datos, visitaId)[0];
}

// El técnico envía su diagnóstico. Solo se puede una vez, mientras el servicio esté recién autorizado.
async function guardarDiagnostico(visitaId, { descripcion, componentes }) {
  console.log('Modelo: guardando el diagnóstico de la visita', visitaId);

  const datos = await cargarDatos();
  const fila = buscarVisita(datos, visitaId);

  if (texto(fila.get('estado')) !== ESTADO_AUTORIZADA) {
    throw errorHttp(409, 'El diagnóstico de esta visita ya fue registrado');
  }

  fila.set('diagnosticoDescripcion', descripcion);
  // El separador no puede formar parte de un componente: se reemplaza por una coma.
  fila.set('diagnosticoComponentes', componentes.map(c => c.replaceAll(SEPARADOR_COMPONENTES, ',')).join(`${SEPARADOR_COMPONENTES} `));
  fila.set('diagnosticoEn', new Date().toISOString());
  fila.set('estado', ESTADO_DIAGNOSTICO);
  await fila.save({ raw: true });

  return armarVisitas(datos, visitaId)[0];
}

// Se llama al aceptar la cotización ligada a la solicitud: habilita la etapa de Instalación.
// Devuelve la visita, o null si la solicitud no tiene una (la cotización no nació de una visita técnica).
async function activarPorSolicitud(solicitudId) {
  console.log('Modelo: activando la visita técnica de la solicitud', solicitudId);

  const datos = await cargarDatos();
  const fila = datos.filas.visitas.find(f => mismoId(f.get('solicitudId'), solicitudId));
  if (!fila) return null;

  exigirServicioAbierto(fila);
  if (texto(fila.get('estado')) !== ESTADO_ACTIVO) {
    fila.set('estado', ESTADO_ACTIVO);
    await fila.save({ raw: true });
  }

  return armarVisitas(datos, fila.get('visitaId'))[0];
}

// Se llama al rechazar la cotización ligada a la solicitud: el servicio se cancela porque no hubo acuerdo
// con el cliente, y la solicitud también queda CANCELADA. Devuelve la visita, o null si la solicitud no
// tiene una. Es seguro repetirla: completa lo que haya quedado a medias en un intento anterior.
async function cancelarPorSolicitud(solicitudId, motivo) {
  console.log('Modelo: cancelando el servicio de la solicitud', solicitudId);

  const datos = await cargarDatos();
  const fila = datos.filas.visitas.find(f => mismoId(f.get('solicitudId'), solicitudId));
  if (!fila) return null;

  const faltantes = ['motivoCancelacion', 'canceladaEn'].filter(c => !(datos.hojas.visitas.headerValues || []).includes(c));
  if (faltantes.length) {
    throw new Error(`La hoja 'visitasTecnicas' no tiene la(s) columna(s): ${faltantes.join(', ')}`);
  }

  const estado = texto(fila.get('estado'));
  if (estado === ESTADO_ACTIVO) throw errorHttp(409, 'El servicio ya está activo y no se puede cancelar');
  if (texto(fila.get('cierreFecha'))) throw errorHttp(409, 'El servicio ya fue cerrado');

  if (estado !== ESTADO_CANCELADA) {
    fila.set('estado', ESTADO_CANCELADA);
    fila.set('motivoCancelacion', motivo);
    fila.set('canceladaEn', new Date().toISOString());
    await fila.save({ raw: true });
  }

  const filaSolicitud = datos.filas.solicitudes.find(f => mismoId(f.get('solicitudId'), solicitudId));
  if (filaSolicitud && texto(filaSolicitud.get('estado')) !== 'CANCELADA') {
    filaSolicitud.set('estado', 'CANCELADA');
    await filaSolicitud.save({ raw: true });
  }

  return armarVisitas(datos, fila.get('visitaId'))[0];
}

// El empleado cierra el servicio cuando ya subió todos sus archivos a Drive.
async function registrarCierre(visitaId, carpetaUrl) {
  console.log('Modelo: cerrando el servicio de la visita', visitaId);

  const datos = await cargarDatos();
  const fila = buscarVisita(datos, visitaId);

  fila.set('cierreFecha', hoyISO());
  fila.set('cierreCarpetaUrl', carpetaUrl);
  await fila.save({ raw: true });

  return armarVisitas(datos, visitaId)[0];
}

// Se puede programar en la etapa en curso o en las siguientes (el técnico las verá bloqueadas hasta que
// se finalicen las anteriores), pero no en una etapa ya finalizada.
async function crearProgramada(visitaId, { tipo, fecha, horaInicio, horaFin, descripcionTareas }) {
  console.log('Modelo: programando una visita del servicio', visitaId);

  const datos = await cargarDatos();
  const { hojas, filas } = datos;
  const filaVisita = buscarVisita(datos, visitaId);
  exigirServicioAbierto(filaVisita);

  if (texto(filaVisita.get('estado')) !== ESTADO_ACTIVO) {
    throw errorHttp(409, 'El servicio todavía no está activo');
  }
  if (TIPOS_VISITA.indexOf(tipo) < etapasFinalizadas(filaVisita)) {
    throw errorHttp(409, 'La etapa ya fue finalizada y no admite más visitas');
  }

  const visitaProgramadaId = siguienteId(filas.programadas, 'visitaProgramadaId');
  const nueva = await hojas.programadas.addRow({
    visitaProgramadaId,
    visitaId,
    tipo,
    fecha,
    horaInicio,
    horaFin,
    descripcionTareas,
    avanceDescripcion: '',
    completadaEn: '',
  }, { raw: true });

  return armarProgramada(nueva);
}

// Reprogramar: solo mientras el técnico no la haya completado.
async function actualizarProgramada(visitaProgramadaId, { fecha, horaInicio, horaFin, descripcionTareas }) {
  console.log('Modelo: reprogramando la visita', visitaProgramadaId);

  const datos = await cargarDatos();
  const fila = buscarProgramada(datos, visitaProgramadaId);
  exigirServicioAbierto(buscarVisita(datos, fila.get('visitaId')));
  if (estaCompletada(fila)) throw errorHttp(409, 'La visita ya fue completada y no se puede modificar');

  fila.set('fecha', fecha);
  fila.set('horaInicio', horaInicio);
  fila.set('horaFin', horaFin);
  fila.set('descripcionTareas', descripcionTareas);
  await fila.save({ raw: true });

  return armarProgramada(fila);
}

async function eliminarProgramada(visitaProgramadaId) {
  console.log('Modelo: eliminando la visita programada', visitaProgramadaId);

  const datos = await cargarDatos();
  const fila = buscarProgramada(datos, visitaProgramadaId);
  exigirServicioAbierto(buscarVisita(datos, fila.get('visitaId')));
  if (estaCompletada(fila)) throw errorHttp(409, 'La visita ya fue completada y no se puede eliminar');

  await fila.delete();

  return { visitaProgramadaId: Number(visitaProgramadaId) };
}

// El técnico deja su avance. Solo cuando el servicio está activo, la visita es de la etapa en curso y es la
// visita "del momento": la primera, en orden cronológico, que aún no completó dentro de su etapa.
async function registrarAvance(visitaProgramadaId, { descripcion }) {
  console.log('Modelo: registrando el avance de la visita', visitaProgramadaId);

  const datos = await cargarDatos();
  const fila = buscarProgramada(datos, visitaProgramadaId);
  const filaVisita = buscarVisita(datos, fila.get('visitaId'));

  if (estaCompletada(fila)) throw errorHttp(409, 'Esta visita ya fue completada');
  if (texto(filaVisita.get('estado')) !== ESTADO_ACTIVO) {
    throw errorHttp(409, 'El servicio todavía no está activo');
  }
  if (TIPOS_VISITA.indexOf(tipoDe(fila)) !== etapasFinalizadas(filaVisita)) {
    throw errorHttp(409, 'Primero deben finalizarse las etapas anteriores');
  }

  const actual = datos.filas.programadas
    .filter(f =>
      mismoId(f.get('visitaId'), fila.get('visitaId')) && tipoDe(f) === tipoDe(fila) && !estaCompletada(f)
    )
    .sort((a, b) => clave(a).localeCompare(clave(b)))[0];
  if (!mismoId(actual?.get('visitaProgramadaId'), visitaProgramadaId)) {
    throw errorHttp(409, 'Primero debes completar las visitas anteriores');
  }

  fila.set('avanceDescripcion', descripcion);
  fila.set('completadaEn', new Date().toISOString());
  await fila.save({ raw: true });

  return armarProgramada(fila);
}

// El empleado da por terminada la etapa en curso (sin importar cuántas visitas tuvo) y habilita la siguiente.
// Exige al menos una visita y que el técnico haya completado todas, para no dejar visitas sin reporte.
async function finalizarEtapa(visitaId) {
  console.log('Modelo: finalizando la etapa en curso del servicio', visitaId);

  const datos = await cargarDatos();
  const fila = buscarVisita(datos, visitaId);
  exigirServicioAbierto(fila);

  if (texto(fila.get('estado')) !== ESTADO_ACTIVO) {
    throw errorHttp(409, 'El servicio todavía no está activo');
  }

  const finalizadas = etapasFinalizadas(fila);
  if (finalizadas >= TIPOS_VISITA.length) throw errorHttp(409, 'Todas las etapas del servicio ya fueron finalizadas');

  const visitasEtapa = datos.filas.programadas.filter(f =>
    mismoId(f.get('visitaId'), visitaId) && tipoDe(f) === TIPOS_VISITA[finalizadas]
  );
  if (visitasEtapa.length === 0) throw errorHttp(409, 'Programa al menos una visita antes de finalizar la etapa');
  if (!visitasEtapa.every(estaCompletada)) {
    throw errorHttp(409, 'El técnico aún tiene visitas pendientes en esta etapa');
  }

  fila.set('etapasFinalizadas', finalizadas + 1);
  await fila.save({ raw: true });

  return armarVisitas(datos, visitaId)[0];
}

module.exports = {
  TIPOS_VISITA,
  getVisitas,
  getVisitasProgramadas,
  crearVisitaDeSolicitud,
  guardarDiagnostico,
  activarPorSolicitud,
  cancelarPorSolicitud,
  registrarCierre,
  crearProgramada,
  actualizarProgramada,
  eliminarProgramada,
  registrarAvance,
  finalizarEtapa,
};
