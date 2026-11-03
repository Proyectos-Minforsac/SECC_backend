const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, hoyISO, exigirColumnas, siguienteId } = require('../services/hojasUtils');
const { DESTINO_GENERAL, normalizarDestino, destinosDe, resolverTarifas } = require('../services/tarifas');
const { RUBROS, calcularEstimacion, normalizarActividades } = require('../services/calculoCostos');
const { ESTADO, ACCION, aNumeroONulo, estadoAlCrear, vigentePorCotizacion } = require('../services/validacion');
const { calcularAnaloga, sugerir } = require('../services/analoga');
const tarifarioModel = require('./tarifarioModel');
const parametroCostoModel = require('./parametroCostoModel');
const resumenModel = require('./resumenModel');

const COLUMNAS_ESTIMACION = [
  'estimacionId', 'cotizacionId', 'solicitudId', 'version', 'estado', 'tipoServicio', 'destino', 'moneda', 'tipoCambio',
  'costoDiagnostico', 'costoTransporte', 'costoHospedaje', 'costoAlimentacion', 'costoManoObra', 'costoMateriales',
  'costoImprevistos', 'tasaImprevistos', 'costoParametrico', 'ventaSinIGV', 'ventaSoles', 'margenParametrico',
  'costoAnalogo', 'casosAnalogo', 'costoFinal', 'margenFinal', 'entradas', 'tarifasUsadas',
  'creadaPor', 'creadaEn', 'enviadaEn', 'validadaPor', 'validadaEn',
];

const COLUMNAS_INDUCTORES = [
  'inductorCostoId', 'cotizacionId', 'categoria', 'descripcion', 'cantidad', 'costoUnitario', 'subtotal',
  'estimacionId', 'etapa', 'nTecnicos', 'dias', 'noches', 'viajes',
];

const COLUMNAS_AJUSTES = [
  'ajusteId', 'estimacionId', 'cotizacionId', 'version', 'accion', 'costoAntes', 'costoDespues', 'margenAntes',
  'margenDespues', 'justificacion', 'usuarioId', 'usuario', 'rol', 'fecha',
];

const NOMBRE_ETAPA = { INSTALACION: 'Instalación', MANTENIMIENTO: 'Mantenimiento', SOPORTE: 'Soporte' };

function exigirHoja(doc, nombre) {
  const hoja = doc.sheetsByTitle[nombre];
  if (!hoja) throw new Error(`No existe la hoja "${nombre}" en el Excel (npm run hojas:preparar la crea)`);
  return hoja;
}

// De la solicitud de origen sale el tipo de servicio y lo que costó el diagnóstico: el monto de la oferta aceptada.
// Una cotización sin solicitud (o con una que no existe) no lleva ninguno de los dos.
async function datosDeLaSolicitud(doc, solicitudId) {
  if (!solicitudId) return { tipoServicio: '', costoDiagnostico: 0 };

  const [solicitudes, ofertas] = await Promise.all([
    exigirHoja(doc, 'solicitudes').getRows(),
    exigirHoja(doc, 'ofertas').getRows(),
  ]);
  const solicitud = solicitudes.find(f => mismoId(f.get('solicitudId'), solicitudId));
  const aceptada = ofertas.find(f => mismoId(f.get('solicitudId'), solicitudId) && texto(f.get('estado')) === 'ACEPTADA');

  return {
    tipoServicio: texto(solicitud?.get('tipoServicio')),
    costoDiagnostico: Number(texto(aceptada?.get('montoVisita'))) || 0,
  };
}

// Calcula y valida la estimación ANTES de que la cotización escriba nada, para que un error (falta una tarifa, un
// costo de compra, una justificación...) no deje una cotización a medias. Devuelve lo que `registrarEstimacion` necesita.
//
// - entradas: lo que ingresó el trabajador { destino, tipoCambio, actividades }
// - items: los ítems ya calculados de la cotización (con su costoUnitario de compra)
// - usuario: quien la envía. Si es el jefe, la estimación nace validada (y `justificacion` explica un margen bajo el mínimo)
async function prepararEstimacion({ entradas, items, ventaSinIGV, moneda, solicitudId, usuario, justificacion }) {
  if (!entradas || typeof entradas !== 'object' || Array.isArray(entradas)) {
    throw errorHttp(400, 'Falta la estimación de costos de la cotización');
  }

  const doc = await conectar();
  const estimaciones = exigirHoja(doc, 'estimacionesCosto');
  const inductores = exigirHoja(doc, 'inductoresCosto');
  const ajustes = exigirHoja(doc, 'ajustesCosto');
  const filasEstimaciones = await estimaciones.getRows();
  const filasInductores = await inductores.getRows();
  const filasAjustes = await ajustes.getRows();
  exigirColumnas(estimaciones, COLUMNAS_ESTIMACION, 'estimacionesCosto');
  exigirColumnas(inductores, COLUMNAS_INDUCTORES, 'inductoresCosto');
  exigirColumnas(ajustes, COLUMNAS_AJUSTES, 'ajustesCosto');

  // Tarifas que rigen hoy en el destino (con respaldo GENERAL) y parámetros del jefe
  const { tarifas } = await tarifarioModel.getTarifas();
  const destino = normalizarDestino(entradas.destino, destinosDe(tarifas)) || DESTINO_GENERAL;
  const { TASA_IMPREVISTOS, MARGEN_MINIMO, MIN_CASOS_ANALOGA } = await parametroCostoModel.getValores();
  const origen = await datosDeLaSolicitud(doc, solicitudId);

  const { resultado, problemas } = calcularEstimacion({
    actividades: entradas.actividades,
    tarifas: resolverTarifas(tarifas, destino, hoyISO()),
    destino,
    items,
    costoDiagnostico: origen.costoDiagnostico,
    tasaImprevistos: TASA_IMPREVISTOS,
    ventaSinIGV,
    moneda,
    tipoCambio: entradas.tipoCambio,
  });
  if (problemas.length > 0) throw errorHttp(400, problemas.join('. '));

  // Lo que sugería la analogía en este momento (servicios similares ya cerrados) queda guardado con la estimación: así
  // después se puede medir qué tan exacta fue, con la información que había entonces.
  const analoga = calcularAnaloga(await resumenModel.getCasos(), {
    tipoServicio: origen.tipoServicio,
    destino,
    minCasos: MIN_CASOS_ANALOGA,
  });
  const sugerencia = sugerir(analoga, { costoParametrico: resultado.costoTotal, ventaSoles: resultado.ventaSoles });

  // Quién la envía decide en qué estado nace (HU-17, HU-26); si falta una justificación se rechaza aquí, sin escribir nada.
  const inicial = estadoAlCrear({
    rol: usuario?.rol,
    margen: resultado.margen,
    margenMinimo: MARGEN_MINIMO ?? null,
    justificacion,
  });

  return {
    resultado,
    destino,
    moneda,
    tipoServicio: origen.tipoServicio,
    analoga: { costo: sugerencia?.costo ?? null, casos: analoga.n },
    inicial,
    // Lo ingresado, ya limpio: permite reabrir la estimación tal cual al corregir una cotización devuelta
    entradas: { destino, tipoCambio: resultado.tipoCambio, actividades: normalizarActividades(entradas.actividades) },
    estimaciones,
    inductores,
    ajustes,
    filasEstimaciones,
    filasInductores,
    filasAjustes,
  };
}

// Anota una fila en la bitácora de la validación. Solo se agregan filas: lo ya anotado no se modifica nunca.
async function anotarEnBitacora(hojaAjustes, filasAjustes, { estimacion, accion, costoAntes, costoDespues, margenAntes, margenDespues, justificacion, usuario }) {
  return hojaAjustes.addRow({
    ajusteId: siguienteId(filasAjustes, 'ajusteId'),
    estimacionId: estimacion.estimacionId,
    cotizacionId: estimacion.cotizacionId,
    version: estimacion.version,
    accion,
    costoAntes,
    costoDespues,
    margenAntes: margenAntes ?? '',
    margenDespues: margenDespues ?? '',
    justificacion: justificacion ?? '',
    usuarioId: usuario.usuarioId,
    usuario: usuario.nombre,
    rol: usuario.rol,
    fecha: new Date().toISOString(),
  }, { raw: true });
}

// Guarda la estimación: una fila en estimacionesCosto con todo congelado (valores, tarifas usadas, lo ingresado), las
// líneas por actividad y rubro en inductoresCosto y su primer paso en la bitácora. Se llama con la cotización ya creada.
// `version` es 1 en una cotización nueva; al corregir una devuelta se guarda una versión nueva y la anterior queda de historial.
async function registrarEstimacion(preparada, { cotizacionId, solicitudId, usuario, version = 1 }) {
  const { resultado: r, destino, moneda, tipoServicio, entradas, inicial } = preparada;
  const estimacionId = siguienteId(preparada.filasEstimaciones, 'estimacionId');
  const ahora = new Date().toISOString();
  const validada = inicial.estado === ESTADO.VALIDADA;

  // raw: evita que Sheets reinterprete el texto (fórmulas, fechas, JSON) al guardarlo.
  await preparada.estimaciones.addRow({
    estimacionId,
    cotizacionId,
    solicitudId: solicitudId || '',
    version,
    estado: inicial.estado,
    tipoServicio,
    destino,
    moneda,
    tipoCambio: r.tipoCambio,
    costoDiagnostico: r.diagnostico,
    costoTransporte: r.transporte,
    costoHospedaje: r.hospedaje,
    costoAlimentacion: r.alimentacion,
    costoManoObra: r.manoObra,
    costoMateriales: r.materiales,
    costoImprevistos: r.imprevistos,
    tasaImprevistos: r.tasaImprevistos,
    costoParametrico: r.costoTotal,
    ventaSinIGV: r.ventaSinIGV,
    ventaSoles: r.ventaSoles,
    margenParametrico: r.margen ?? '',
    // El costo final cambia si el jefe ajusta; el análogo queda como se sugirió (vacío sin servicios similares suficientes)
    costoAnalogo: preparada.analoga.costo ?? '',
    casosAnalogo: preparada.analoga.casos,
    costoFinal: r.costoTotal,
    margenFinal: r.margen ?? '',
    entradas: JSON.stringify(entradas),
    tarifasUsadas: JSON.stringify(r.tarifasUsadas),
    creadaPor: usuario.nombre,
    creadaEn: ahora,
    enviadaEn: ahora,
    validadaPor: validada ? usuario.nombre : '',
    validadaEn: validada ? ahora : '',
  }, { raw: true });

  let inductorCostoId = siguienteId(preparada.filasInductores, 'inductorCostoId');
  const lineas = r.lineas.map(linea => {
    const rubro = RUBROS.find(x => x.categoria === linea.categoria);
    return {
      inductorCostoId: inductorCostoId++,
      cotizacionId,
      categoria: linea.categoria,
      descripcion: `${NOMBRE_ETAPA[linea.etapa]} · ${rubro.etiqueta}`,
      cantidad: linea.cantidad,
      costoUnitario: linea.costoUnitario,
      subtotal: linea.subtotal,
      estimacionId,
      etapa: linea.etapa,
      nTecnicos: linea.nTecnicos,
      dias: linea.dias,
      noches: linea.noches,
      viajes: linea.viajes,
    };
  });
  if (lineas.length > 0) await preparada.inductores.addRows(lineas, { raw: true });

  // El trabajador envía a revisión; el jefe, que valida al crear, deja su validación (con la justificación si la hubo)
  await anotarEnBitacora(preparada.ajustes, preparada.filasAjustes, {
    estimacion: { estimacionId, cotizacionId, version },
    accion: validada ? ACCION.VALIDAR : ACCION.ENVIAR,
    costoAntes: r.costoTotal,
    costoDespues: r.costoTotal,
    margenAntes: r.margen,
    margenDespues: r.margen,
    justificacion: inicial.justificacion,
    usuario,
  });

  return {
    estimacionId,
    version,
    estado: inicial.estado,
    destino,
    viaticos: r.viaticos,
    manoObra: r.manoObra,
    materiales: r.materiales,
    diagnostico: r.diagnostico,
    imprevistos: r.imprevistos,
    costoTotal: r.costoTotal,
    ventaSoles: r.ventaSoles,
    margen: r.margen,
    costoAnalogo: preparada.analoga.costo,
    casosAnalogo: preparada.analoga.casos,
  };
}

// --- Lectura ------------------------------------------------------------------------------------------

function leerJSON(valor) {
  try {
    return JSON.parse(texto(valor));
  } catch {
    return null;
  }
}

// Una fila de estimacionesCosto con los números como números y las entradas/tarifas ya leídas.
function armarEstimacion(fila) {
  const num = campo => aNumeroONulo(fila[campo]);
  return {
    estimacionId: num('estimacionId'),
    cotizacionId: num('cotizacionId'),
    solicitudId: texto(fila.solicitudId),
    version: num('version') ?? 1,
    estado: texto(fila.estado),
    tipoServicio: texto(fila.tipoServicio),
    destino: texto(fila.destino),
    moneda: texto(fila.moneda),
    tipoCambio: num('tipoCambio'),
    costoDiagnostico: num('costoDiagnostico'),
    costoTransporte: num('costoTransporte'),
    costoHospedaje: num('costoHospedaje'),
    costoAlimentacion: num('costoAlimentacion'),
    costoManoObra: num('costoManoObra'),
    costoMateriales: num('costoMateriales'),
    costoImprevistos: num('costoImprevistos'),
    tasaImprevistos: num('tasaImprevistos'),
    costoParametrico: num('costoParametrico'),
    ventaSinIGV: num('ventaSinIGV'),
    ventaSoles: num('ventaSoles'),
    margenParametrico: num('margenParametrico'),
    costoAnalogo: num('costoAnalogo'),
    casosAnalogo: num('casosAnalogo'),
    costoFinal: num('costoFinal'),
    margenFinal: num('margenFinal'),
    entradas: leerJSON(fila.entradas),
    tarifasUsadas: leerJSON(fila.tarifasUsadas),
    creadaPor: texto(fila.creadaPor),
    creadaEn: texto(fila.creadaEn),
    enviadaEn: texto(fila.enviadaEn),
    validadaPor: texto(fila.validadaPor),
    validadaEn: texto(fila.validadaEn),
  };
}

// Todas las estimaciones guardadas. Si la hoja aún no existe no hay ninguna: las cotizaciones anteriores a este control
// quedan exentas, y la hoja es obligatoria para crear una nueva (prepararEstimacion avisa si falta).
async function getEstimaciones() {
  const hoja = (await conectar()).sheetsByTitle['estimacionesCosto'];
  if (!hoja) return [];
  return (await hoja.getRows()).map(f => f.toObject()).map(armarEstimacion);
}

// Versión que rige para cada cotización: Map(cotizacionId como texto -> estimación).
async function getVigentes() {
  const vigentes = new Map();
  for (const estimacion of await getEstimaciones()) {
    const clave = String(estimacion.cotizacionId);
    const actual = vigentes.get(clave);
    if (!actual || estimacion.version > actual.version) vigentes.set(clave, estimacion);
  }
  return vigentes;
}

async function getVigente(cotizacionId) {
  return vigentePorCotizacion(await getEstimaciones(), cotizacionId);
}

module.exports = {
  COLUMNAS_AJUSTES,
  exigirHoja,
  prepararEstimacion,
  registrarEstimacion,
  anotarEnBitacora,
  armarEstimacion,
  getEstimaciones,
  getVigentes,
  getVigente,
};
