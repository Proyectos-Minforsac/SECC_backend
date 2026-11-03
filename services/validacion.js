// Reglas de la validación del jefe (juicio de expertos, RN-08), sin acceso al Excel para poder probarlas.
//
// Una estimación nace EN REVISIÓN y el jefe la decide una sola vez:
//   VALIDAR  -> VALIDADA  (con justificación si el margen queda bajo el mínimo)
//   AJUSTAR  -> VALIDADA  con otro costo (la justificación es siempre obligatoria)
//   DEVOLVER -> DEVUELTA  con el motivo; el trabajador corrige y reenvía, lo que crea una versión nueva EN REVISIÓN
// Si el jefe crea la cotización, nace VALIDADA (con el mismo requisito de justificación).
// Cada paso se anota en la bitácora; las cotizaciones sin estimación (anteriores a este control) quedan exentas.

const { errorHttp, texto } = require('./hojasUtils');
const { calcularMargen, redondear } = require('./calculoCostos');

const ESTADO = {
  EN_REVISION: 'EN REVISIÓN',
  VALIDADA: 'VALIDADA',
  DEVUELTA: 'DEVUELTA',
};

const ACCION = {
  ENVIAR: 'ENVIAR',
  VALIDAR: 'VALIDAR',
  AJUSTAR: 'AJUSTAR',
  DEVOLVER: 'DEVOLVER',
};

const JUSTIFICACION_MINIMA = 10;
const JUSTIFICACION_MAXIMA = 500;
const COSTO_MAXIMO = 1000000000;

const aNumeroONulo = valor => {
  const limpio = texto(valor);
  if (limpio === '') return null;
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
};

// ¿El margen queda bajo el mínimo que fijó el jefe? Sin mínimo definido no hay con qué compararlo. Un margen que no
// se puede calcular (cotización sin venta) tampoco se puede dar por bueno.
function margenBajoMinimo(margen, minimo) {
  if (minimo === null || minimo === undefined) return false;
  if (margen === null || margen === undefined) return true;
  return margen < minimo;
}

// Texto obligatorio (motivo, justificación) o null si es opcional y viene vacío. Se guarda sin espacios sobrantes.
function leerTexto(valor, etiqueta, { obligatorio }) {
  const limpio = texto(valor);
  if (limpio === '' && !obligatorio) return null;
  if (limpio.length < JUSTIFICACION_MINIMA) {
    throw errorHttp(400, `${etiqueta}: escribe al menos ${JUSTIFICACION_MINIMA} caracteres`);
  }
  if (limpio.length > JUSTIFICACION_MAXIMA) {
    throw errorHttp(400, `${etiqueta}: máximo ${JUSTIFICACION_MAXIMA} caracteres`);
  }
  return limpio;
}

// Estado con el que nace una estimación y qué se exige para ello. El trabajador siempre la envía a revisión; el jefe
// la valida en el mismo paso (HU-26), con justificación si el margen queda bajo el mínimo.
function estadoAlCrear({ rol, margen, margenMinimo, justificacion }) {
  if (rol !== 'jefe') return { estado: ESTADO.EN_REVISION, justificacion: null };

  const exigida = margenBajoMinimo(margen, margenMinimo);
  return {
    estado: ESTADO.VALIDADA,
    justificacion: leerTexto(justificacion, 'Justificación del margen bajo el mínimo', { obligatorio: exigida }),
  };
}

// Resultado de una decisión del jefe sobre una estimación EN REVISIÓN.
//   estimacion: { estado, costoFinal, ventaSoles, margenFinal } (números)
//   datos: { costoNuevo, justificacion }  (para DEVOLVER, `justificacion` es el motivo)
function decidir(accion, estimacion, margenMinimo, datos = {}) {
  if (estimacion.estado !== ESTADO.EN_REVISION) {
    const yaPaso = estimacion.estado === ESTADO.VALIDADA ? 'ya fue validada' : 'ya fue devuelta';
    throw errorHttp(409, `Esta estimación ${yaPaso}: recarga para ver su estado actual`);
  }

  const costoAntes = estimacion.costoFinal;
  const margenAntes = estimacion.margenFinal;

  if (accion === ACCION.VALIDAR) {
    const exigida = margenBajoMinimo(margenAntes, margenMinimo);
    return {
      estado: ESTADO.VALIDADA,
      costoDespues: costoAntes,
      margenDespues: margenAntes,
      justificacion: leerTexto(datos.justificacion, 'Justificación del margen bajo el mínimo', { obligatorio: exigida }),
    };
  }

  if (accion === ACCION.AJUSTAR) {
    const costoNuevo = Number(datos.costoNuevo);
    if (texto(datos.costoNuevo) === '' || !Number.isFinite(costoNuevo) || costoNuevo <= 0 || costoNuevo > COSTO_MAXIMO) {
      throw errorHttp(400, 'Ingresa el costo total ajustado (un monto mayor que cero)');
    }
    const costoDespues = redondear(costoNuevo);
    if (costoDespues === costoAntes) {
      throw errorHttp(400, 'El costo ajustado es igual al estimado: usa Validar si estás de acuerdo');
    }
    return {
      estado: ESTADO.VALIDADA,
      costoDespues,
      margenDespues: calcularMargen(estimacion.ventaSoles, costoDespues),
      justificacion: leerTexto(datos.justificacion, 'Justificación del ajuste', { obligatorio: true }),
    };
  }

  if (accion === ACCION.DEVOLVER) {
    return {
      estado: ESTADO.DEVUELTA,
      costoDespues: costoAntes,
      margenDespues: margenAntes,
      justificacion: leerTexto(datos.justificacion, 'Motivo de la devolución', { obligatorio: true }),
    };
  }

  throw errorHttp(400, 'Acción de validación desconocida');
}

// La estimación que rige para una cotización es su versión más reciente: al corregir una cotización devuelta se crea
// una versión nueva y las anteriores quedan como historial. `filas` son objetos planos con cotizacionId y version.
function vigentePorCotizacion(filas, cotizacionId) {
  let vigente = null;
  for (const fila of filas) {
    if (texto(fila.cotizacionId) !== texto(cotizacionId)) continue;
    const version = aNumeroONulo(fila.version) ?? 1;
    if (!vigente || version > vigente.version) vigente = { fila, version };
  }
  return vigente ? vigente.fila : null;
}

// HU-23: sin estimación validada no hay PDF ni Aceptar/Rechazar. Sin estimación (cotización anterior) está permitido.
function motivoDeBloqueo(estimacion) {
  if (!estimacion) return null;
  const estado = texto(estimacion.estado);
  if (estado === ESTADO.VALIDADA) return null;
  if (estado === ESTADO.DEVUELTA) {
    return 'El jefe devolvió la cotización: corrígela y reenvíala a validación';
  }
  return 'La cotización aún no fue validada por el jefe';
}

module.exports = {
  ESTADO,
  ACCION,
  JUSTIFICACION_MINIMA,
  JUSTIFICACION_MAXIMA,
  aNumeroONulo,
  margenBajoMinimo,
  leerTexto,
  estadoAlCrear,
  decidir,
  vigentePorCotizacion,
  motivoDeBloqueo,
};
