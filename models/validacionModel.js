const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, exigirColumnas } = require('../services/hojasUtils');
const { ESTADO, ACCION, aNumeroONulo, decidir } = require('../services/validacion');
const estimacionModel = require('./estimacionModel');
const notificacionModel = require('./notificacionModel');
const parametroCostoModel = require('./parametroCostoModel');
const analogaModel = require('./analogaModel');

// Decisiones que se muestran en el historial de la bandeja (el envío es solo un paso intermedio).
const ACCIONES_DE_DECISION = [ACCION.VALIDAR, ACCION.AJUSTAR, ACCION.DEVOLVER];
const MAXIMO_HISTORIAL = 100;

const aMonto = valor => `S/ ${Number(valor).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const aPorcentaje = valor => (valor === null || valor === undefined ? 'sin margen' : `${Number(valor).toFixed(2)} %`);

function armarAjuste(fila) {
  return {
    ajusteId: aNumeroONulo(fila.ajusteId),
    estimacionId: aNumeroONulo(fila.estimacionId),
    cotizacionId: aNumeroONulo(fila.cotizacionId),
    version: aNumeroONulo(fila.version) ?? 1,
    accion: texto(fila.accion),
    costoAntes: aNumeroONulo(fila.costoAntes),
    costoDespues: aNumeroONulo(fila.costoDespues),
    margenAntes: aNumeroONulo(fila.margenAntes),
    margenDespues: aNumeroONulo(fila.margenDespues),
    justificacion: texto(fila.justificacion),
    usuario: texto(fila.usuario),
    rol: texto(fila.rol),
    fecha: texto(fila.fecha),
  };
}

// La bitácora en orden cronológico. Sin la hoja no hay nada que mostrar.
async function getBitacora(doc) {
  const hoja = doc.sheetsByTitle['ajustesCosto'];
  if (!hoja) return [];
  return (await hoja.getRows()).map(f => armarAjuste(f.toObject())).sort((a, b) => a.ajusteId - b.ajusteId);
}

// Cotizaciones y clientes por id, para poner el número de cotización y el nombre del cliente en cada fila.
async function getCotizacionesYClientes(doc) {
  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaClientes = doc.sheetsByTitle['clientes'];
  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");

  const [filasCotizaciones, filasClientes] = await Promise.all([
    hojaCotizaciones.getRows(),
    hojaClientes ? hojaClientes.getRows() : [],
  ]);
  const clientes = new Map(filasClientes.map(f => [texto(f.get('clienteId')), f.toObject()]));
  const cotizaciones = new Map(
    filasCotizaciones.map(f => {
      const c = f.toObject();
      return [texto(c.cotizacionId), { ...c, cliente: clientes.get(texto(c.clienteId)) ?? null }];
    })
  );
  return { cotizaciones, clientes };
}

// Bandeja del jefe: las estimaciones que esperan su decisión (las más antiguas primero) y las últimas decisiones.
async function getBandeja() {
  const doc = await conectar();
  const [vigentes, bitacora, { cotizaciones }, valores] = await Promise.all([
    estimacionModel.getVigentes(),
    getBitacora(doc),
    getCotizacionesYClientes(doc),
    parametroCostoModel.getValores(),
  ]);

  const referencia = cotizacionId => {
    const c = cotizaciones.get(String(cotizacionId));
    return { numeroCotizacion: texto(c?.numeroCotizacion), clienteNombre: texto(c?.cliente?.nombre) };
  };

  // Una estimación cuya cotización no existe (una creación que falló a medias) no se lista: no hay nada que revisar.
  const pendientes = [...vigentes.values()]
    .filter(e => e.estado === ESTADO.EN_REVISION && cotizaciones.has(String(e.cotizacionId)))
    .sort((a, b) => texto(a.enviadaEn || a.creadaEn).localeCompare(texto(b.enviadaEn || b.creadaEn)))
    .map(e => ({
      estimacionId: e.estimacionId,
      cotizacionId: e.cotizacionId,
      version: e.version,
      ...referencia(e.cotizacionId),
      tipoServicio: e.tipoServicio,
      destino: e.destino,
      moneda: e.moneda,
      creadaPor: e.creadaPor,
      enviadaEn: e.enviadaEn || e.creadaEn,
      ventaSoles: e.ventaSoles,
      costoFinal: e.costoFinal,
      margenFinal: e.margenFinal,
    }));

  const historial = bitacora
    .filter(a => ACCIONES_DE_DECISION.includes(a.accion))
    .reverse()
    .slice(0, MAXIMO_HISTORIAL)
    .map(a => ({ ...a, ...referencia(a.cotizacionId) }));

  return { margenMinimo: valores.MARGEN_MINIMO ?? null, pendientes, historial };
}

// Todo lo que el jefe necesita para decidir (y el trabajador para ver su estimación): la estimación vigente de la
// cotización con su desglose por actividad y rubro, los ítems con su costo de compra y la bitácora.
async function getDetalle(cotizacionId) {
  const doc = await conectar();
  const vigente = await estimacionModel.getVigente(cotizacionId);
  if (!vigente) throw errorHttp(404, 'Esta cotización no tiene estimación de costos (es anterior al control de costos)');

  const hojaItems = doc.sheetsByTitle['items'];
  const hojaItemsCotizacion = doc.sheetsByTitle['itemsCotizacion'];
  const hojaInductores = doc.sheetsByTitle['inductoresCosto'];
  if (!hojaItems) throw new Error("Falta la hoja 'items'");
  if (!hojaItemsCotizacion) throw new Error("Falta la hoja 'itemsCotizacion'");
  if (!hojaInductores) throw new Error("Falta la hoja 'inductoresCosto'");

  const [{ cotizaciones }, filasItems, filasItemsCotizacion, filasInductores, bitacora, valores, analoga] = await Promise.all([
    getCotizacionesYClientes(doc),
    hojaItems.getRows(),
    hojaItemsCotizacion.getRows(),
    hojaInductores.getRows(),
    getBitacora(doc),
    parametroCostoModel.getValores(),
    analogaModel.getAnaloga({ tipoServicio: vigente.tipoServicio, destino: vigente.destino }),
  ]);

  const cotizacion = cotizaciones.get(String(cotizacionId));
  if (!cotizacion) throw errorHttp(404, 'Cotización no encontrada');

  const itemsPorId = new Map(filasItems.map(f => [texto(f.get('itemId')), f.toObject()]));
  const items = filasItemsCotizacion
    .map(f => f.toObject())
    .filter(ic => mismoId(ic.cotizacionId, cotizacionId))
    .sort((a, b) => Number(a.orden) - Number(b.orden))
    .map(ic => {
      const item = itemsPorId.get(texto(ic.itemId)) ?? {};
      return {
        tipo: texto(item.tipo),
        nombre: texto(item.nombre),
        cantidad: aNumeroONulo(ic.cantidad) ?? 0,
        precioUnitario: aNumeroONulo(item.precioUnitario) ?? 0,
        subtotal: aNumeroONulo(ic.subtotal) ?? 0,
        costoUnitario: aNumeroONulo(ic.costoUnitario),
        costoSubtotal: aNumeroONulo(ic.costoSubtotal),
      };
    });

  const lineas = filasInductores
    .map(f => f.toObject())
    .filter(l => mismoId(l.estimacionId, vigente.estimacionId))
    .map(l => ({
      etapa: texto(l.etapa),
      categoria: texto(l.categoria),
      nTecnicos: aNumeroONulo(l.nTecnicos) ?? 0,
      dias: aNumeroONulo(l.dias) ?? 0,
      noches: aNumeroONulo(l.noches) ?? 0,
      viajes: aNumeroONulo(l.viajes) ?? 0,
      cantidad: aNumeroONulo(l.cantidad) ?? 0,
      costoUnitario: aNumeroONulo(l.costoUnitario) ?? 0,
      subtotal: aNumeroONulo(l.subtotal) ?? 0,
    }));

  return {
    margenMinimo: valores.MARGEN_MINIMO ?? null,
    // Servicios similares ya cerrados, para que el jefe contraste la estimación con la realidad (HU-34)
    analoga,
    cotizacion: {
      cotizacionId: aNumeroONulo(cotizacion.cotizacionId),
      numeroCotizacion: texto(cotizacion.numeroCotizacion),
      fecha: texto(cotizacion.fecha),
      solicitante: texto(cotizacion.solicitante),
      moneda: texto(cotizacion.moneda),
      estado: texto(cotizacion.estado),
      garantiaMeses: aNumeroONulo(cotizacion.garantiaMeses),
      subtotal: aNumeroONulo(cotizacion.subtotal) ?? 0,
      total: aNumeroONulo(cotizacion.total) ?? 0,
      clienteNombre: texto(cotizacion.cliente?.nombre),
    },
    estimacion: vigente,
    items,
    lineas,
    bitacora: bitacora.filter(a => mismoId(a.cotizacionId, cotizacionId)),
  };
}

// El jefe decide una estimación EN REVISIÓN: valida, ajusta el costo o la devuelve. Todo se comprueba antes de escribir.
// Primero se anota la bitácora y después se cambia el estado: si algo falla en medio, el reintento deja una anotación
// repetida pero nunca una decisión sin registro.
async function decidirEstimacion(estimacionId, accion, datos, usuario) {
  console.log(`Modelo: ${accion} de la estimación`, estimacionId);

  const doc = await conectar();
  const hojaEstimaciones = estimacionModel.exigirHoja(doc, 'estimacionesCosto');
  const hojaAjustes = estimacionModel.exigirHoja(doc, 'ajustesCosto');
  const filas = await hojaEstimaciones.getRows();
  const filasAjustes = await hojaAjustes.getRows();
  exigirColumnas(hojaAjustes, estimacionModel.COLUMNAS_AJUSTES, 'ajustesCosto');
  exigirColumnas(hojaEstimaciones, ['estado', 'costoFinal', 'margenFinal', 'validadaPor', 'validadaEn'], 'estimacionesCosto');

  const fila = filas.find(f => mismoId(f.get('estimacionId'), estimacionId));
  if (!fila) throw errorHttp(404, 'Estimación no encontrada');

  const estimacion = estimacionModel.armarEstimacion(fila.toObject());
  const { MARGEN_MINIMO } = await parametroCostoModel.getValores();
  const decision = decidir(accion, estimacion, MARGEN_MINIMO ?? null, datos);

  await estimacionModel.anotarEnBitacora(hojaAjustes, filasAjustes, {
    estimacion,
    accion,
    costoAntes: estimacion.costoFinal,
    costoDespues: decision.costoDespues,
    margenAntes: estimacion.margenFinal,
    margenDespues: decision.margenDespues,
    justificacion: decision.justificacion,
    usuario,
  });

  fila.set('estado', decision.estado);
  if (decision.estado === ESTADO.VALIDADA) {
    fila.set('costoFinal', decision.costoDespues);
    fila.set('margenFinal', decision.margenDespues ?? '');
    fila.set('validadaPor', usuario.nombre);
    fila.set('validadaEn', new Date().toISOString());
  }
  await fila.save({ raw: true });

  await avisarDecision({ ...estimacion, estado: decision.estado }, accion, decision, usuario);

  return {
    estimacionId: estimacion.estimacionId,
    cotizacionId: estimacion.cotizacionId,
    version: estimacion.version,
    estado: decision.estado,
    costoFinal: decision.costoDespues,
    margenFinal: decision.margenDespues,
  };
}

// --- Avisos --------------------------------------------------------------------------------------------
// Son un complemento: si fallan se anota en el servidor y la acción que los originó sigue valiendo.

async function crearAviso(aviso) {
  try {
    await notificacionModel.crearNotificacion(aviso);
  } catch (error) {
    console.error('Validación: no se pudo crear el aviso', error.message);
  }
}

async function referenciaDeCotizacion(cotizacionId) {
  const { cotizaciones } = await getCotizacionesYClientes(await conectar());
  const cotizacion = cotizaciones.get(String(cotizacionId));
  return {
    numero: texto(cotizacion?.numeroCotizacion),
    cliente: texto(cotizacion?.cliente?.nombre),
    solicitudId: aNumeroONulo(cotizacion?.solicitudId) ?? '',
  };
}

// El trabajador envió (o reenvió) una estimación: el jefe recibe el aviso con la acción "Revisar".
//   estimacion: { estimacionId, cotizacionId, version, estado, costoFinal, margenFinal }
async function avisarEnvio(estimacion, usuario) {
  if (estimacion.estado !== ESTADO.EN_REVISION) return;
  try {
    const ref = await referenciaDeCotizacion(estimacion.cotizacionId);
    const corregida = estimacion.version > 1;
    await crearAviso({
      rolDestino: 'jefe',
      tipo: 'VALIDACION_PENDIENTE',
      mensaje:
        `${usuario.nombre} ${corregida ? 'reenvió corregida' : 'envió'} la cotización ${ref.numero} (${ref.cliente}) a validación. ` +
        `Costo estimado ${aMonto(estimacion.costoFinal)}, margen ${aPorcentaje(estimacion.margenFinal)}.`,
      solicitudId: ref.solicitudId,
      cotizacionId: estimacion.cotizacionId,
      clave: `validacion-pendiente-${estimacion.estimacionId}`,
    });
  } catch (error) {
    console.error('Validación: no se pudo avisar al jefe', error.message);
  }
}

// El jefe decidió: el trabajador recibe el aviso (el motivo, si la devolvió; el PDF habilitado, si la validó).
async function avisarDecision(estimacion, accion, decision, usuario) {
  try {
    const ref = await referenciaDeCotizacion(estimacion.cotizacionId);
    const aviso = { rolDestino: 'trabajador', solicitudId: ref.solicitudId, cotizacionId: estimacion.cotizacionId };

    if (accion === ACCION.DEVOLVER) {
      await crearAviso({
        ...aviso,
        tipo: 'COTIZACION_DEVUELTA',
        mensaje: `La cotización ${ref.numero} (${ref.cliente}) fue devuelta por ${usuario.nombre}. Motivo: ${decision.justificacion}`,
        clave: `validacion-devuelta-${estimacion.estimacionId}`,
      });
      return;
    }

    await crearAviso({
      ...aviso,
      tipo: 'COTIZACION_VALIDADA',
      mensaje:
        `La cotización ${ref.numero} (${ref.cliente}) fue validada por ${usuario.nombre}` +
        `${accion === ACCION.AJUSTAR ? ' con un ajuste de costo' : ''}. Ya puedes descargar el PDF y enviarla al cliente.`,
      clave: `validacion-validada-${estimacion.estimacionId}`,
    });
  } catch (error) {
    console.error('Validación: no se pudo avisar al trabajador', error.message);
  }
}

module.exports = { getBandeja, getDetalle, decidirEstimacion, avisarEnvio, getBitacora };
