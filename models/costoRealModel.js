const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, aISO, hoyISO, exigirColumnas, siguienteId, borrarFilas } = require('../services/hojasUtils');
const { redondear, calcularMargen } = require('../services/calculoCostos');
const { ESTADO, aNumeroONulo } = require('../services/validacion');
const { resolverTarifas } = require('../services/tarifas');
const costos = require('../services/costosReales');
const estimacionModel = require('./estimacionModel');
const tarifarioModel = require('./tarifarioModel');

// Costos reales de un servicio: las dos liquidaciones (al finalizar la instalación y al cerrar el servicio), los imprevistos
// que se registran entre una y otra y el resumen que queda al cerrar. Solo aplica a los servicios cuya cotización aceptada
// pasó por la estimación y validación de costos; los anteriores quedan exentos.

const COLUMNAS_COSTOS = [
  'costoRealId', 'visitaId', 'etapa', 'rubro', 'clase', 'concepto', 'cantidad', 'costoUnitario', 'subtotal', 'motivo',
  'estado', 'visitaProgramadaId', 'registradoPor', 'registradoEn', 'confirmadoPor',
];

const COLUMNAS_RESUMEN = [
  'resumenId', 'visitaId', 'solicitudId', 'tipoServicio', 'destino', 'cotizaciones', 'ventaSoles', 'costoParametrico',
  'costoAnalogo', 'costoEstimado', 'costoReal', 'imprevistosProvision', 'imprevistosReal', 'margenEstimado', 'margenReal',
  'desviacionCosto', 'desviacionMargen', 'origen', 'cerradoPor', 'cerradoEn',
];

const ESTADO_ACTIVO = 'ACTIVO';
const TIPO_INSTALACION = 'INSTALACION';

// --- Lectura ---------------------------------------------------------------------------------------------

// Todas las hojas que hacen falta. Las de costos pueden no existir todavía: se leen como vacías hasta que se prepare el Excel.
async function cargarDatos() {
  const doc = await conectar();
  const exigir = nombre => estimacionModel.exigirHoja(doc, nombre);
  const hojas = {
    visitas: exigir('visitasTecnicas'),
    programadas: exigir('visitasProgramadas'),
    cotizaciones: exigir('cotizaciones'),
    ofertas: exigir('ofertas'),
    solicitudes: exigir('solicitudes'),
    clientes: exigir('clientes'),
    inductores: exigir('inductoresCosto'),
    costos: doc.sheetsByTitle['costosReales'] ?? null,
    resumenes: doc.sheetsByTitle['resumenProceso'] ?? null,
  };

  const [visitas, programadas, cotizaciones, ofertas, solicitudes, clientes, inductores, costosFilas, resumenFilas, vigentes] = await Promise.all([
    hojas.visitas.getRows(),
    hojas.programadas.getRows(),
    hojas.cotizaciones.getRows(),
    hojas.ofertas.getRows(),
    hojas.solicitudes.getRows(),
    hojas.clientes.getRows(),
    hojas.inductores.getRows(),
    hojas.costos ? hojas.costos.getRows() : [],
    hojas.resumenes ? hojas.resumenes.getRows() : [],
    estimacionModel.getVigentes(),
  ]);

  return { hojas, filas: { visitas, programadas, cotizaciones, ofertas, solicitudes, clientes, inductores, costos: costosFilas, resumenes: resumenFilas }, vigentes };
}

// Un costo real de la hoja, con los números como números.
function armarCosto(fila) {
  const concepto = texto(fila.concepto);
  return {
    costoRealId: aNumeroONulo(fila.costoRealId),
    visitaId: aNumeroONulo(fila.visitaId),
    etapa: texto(fila.etapa),
    rubro: texto(fila.rubro),
    clase: texto(fila.clase),
    concepto,
    etiqueta: costos.CONCEPTOS_IMPREVISTO[concepto]?.etiqueta ?? concepto,
    cantidad: aNumeroONulo(fila.cantidad),
    costoUnitario: aNumeroONulo(fila.costoUnitario),
    subtotal: aNumeroONulo(fila.subtotal),
    motivo: texto(fila.motivo),
    estado: texto(fila.estado),
    registradoPor: texto(fila.registradoPor),
    registradoEn: texto(fila.registradoEn),
    confirmadoPor: texto(fila.confirmadoPor),
  };
}

// Todo lo que se sabe de un servicio para controlar sus costos: su visita, las estimaciones validadas de las cotizaciones
// que el cliente aceptó, lo ejecutado y los costos ya registrados.
function contextoDeVisita(datos, visitaId) {
  const { filas, vigentes } = datos;

  const filaVisita = filas.visitas.find(f => mismoId(f.get('visitaId'), visitaId));
  if (!filaVisita) throw errorHttp(404, 'Visita técnica no encontrada');

  const solicitudId = texto(filaVisita.get('solicitudId'));
  const solicitud = filas.solicitudes.find(f => mismoId(f.get('solicitudId'), solicitudId));
  const oferta = filas.ofertas.find(f => mismoId(f.get('solicitudId'), solicitudId) && texto(f.get('estado')) === 'ACEPTADA');
  const cliente = filas.clientes.find(f => mismoId(f.get('clienteId'), solicitud?.get('clienteId')));

  const aceptadas = filas.cotizaciones.filter(f => mismoId(f.get('solicitudId'), solicitudId) && texto(f.get('estado')) === 'ACEPTADA');
  const estimaciones = aceptadas
    .map(f => vigentes.get(texto(f.get('cotizacionId'))))
    .filter(e => e && e.estado === ESTADO.VALIDADA);
  const idsEstimacion = new Set(estimaciones.map(e => String(e.estimacionId)));

  const filasCostos = filas.costos.filter(f => mismoId(f.get('visitaId'), visitaId));

  return {
    filaVisita,
    visita: {
      visitaId: Number(texto(filaVisita.get('visitaId'))),
      solicitudId,
      estado: texto(filaVisita.get('estado')),
      etapasFinalizadas: Number(texto(filaVisita.get('etapasFinalizadas'))) || 0,
      liquidacionInstalacionEn: texto(filaVisita.get('liquidacionInstalacionEn')),
      liquidacionFinalEn: texto(filaVisita.get('liquidacionFinalEn')),
      cierreFecha: texto(filaVisita.get('cierreFecha')),
    },
    aplica: estimaciones.length > 0,
    estimaciones,
    cotizacionIds: aceptadas.map(f => texto(f.get('cotizacionId'))),
    lineas: filas.inductores.map(f => f.toObject()).filter(l => idsEstimacion.has(texto(l.estimacionId))),
    diagnostico: redondear(Number(texto(oferta?.get('montoVisita'))) || 0),
    clienteNombre: texto(cliente?.get('nombre')),
    tipoServicio: texto(solicitud?.get('tipoServicio')) || estimaciones[0]?.tipoServicio || '',
    destino: estimaciones[0]?.destino ?? '',
    // Las visitas programadas del servicio, tal como las necesita ejecutadoDe
    programadas: filas.programadas
      .filter(f => mismoId(f.get('visitaId'), visitaId))
      .map(f => ({
        tipo: texto(f.get('tipo')) || TIPO_INSTALACION,
        fecha: aISO(f.get('fecha')),
        completada: texto(f.get('completadaEn')) !== '',
      })),
    filasCostos,
    costos: filasCostos.map(f => armarCosto(f.toObject())),
  };
}

const cargarContexto = async visitaId => contextoDeVisita(await cargarDatos(), visitaId);

const instalacionLiquidada = ctx => costos.etapaLiquidada(TIPO_INSTALACION, ctx.visita);

function exigirServicioAbierto(ctx) {
  if (ctx.visita.cierreFecha) throw errorHttp(409, 'El servicio ya fue cerrado');
  if (ctx.visita.estado !== ESTADO_ACTIVO) throw errorHttp(409, 'El servicio todavía no está activo');
}

// Tarifas que rigen hoy en el destino de la estimación: el respaldo cuando una etapa no se planificó.
async function tarifasVigentes(destino) {
  try {
    const { tarifas } = await tarifarioModel.getTarifas();
    const vigentes = resolverTarifas(tarifas, destino || 'GENERAL', hoyISO());
    return Object.fromEntries(Object.entries(vigentes).map(([inductor, tarifa]) => [inductor, tarifa?.monto]));
  } catch (error) {
    console.error('Costos reales: no se pudieron leer las tarifas vigentes', error.message);
    return {};
  }
}

const imprevistosDe = (ctx, etapas) =>
  ctx.costos.filter(c => c.clase === costos.CLASE.IMPREVISTO && (!etapas || etapas.includes(c.etapa)));

// --- Propuesta de liquidación (HU-28, HU-29) -----------------------------------------------------------------

// La tabla de una liquidación ya llenada con lo planificado y lo ejecutado, para que el trabajador la confirme o corrija.
// fase: INSTALACION (al finalizar la instalación) o FINAL (al cerrar el servicio).
// Devuelve { aplica: false } si el servicio es anterior al control de costos.
async function proponerLiquidacion(visitaId, fase) {
  const ctx = await cargarContexto(visitaId);
  if (!ctx.aplica) return { aplica: false };

  exigirServicioAbierto(ctx);
  const { visita } = ctx;
  const programadas = ctx.programadas;

  if (fase === 'INSTALACION') {
    if (visita.etapasFinalizadas >= 1 || visita.liquidacionInstalacionEn) throw errorHttp(409, 'La instalación ya fue finalizada');
    const instalacion = programadas.filter(v => v.tipo === TIPO_INSTALACION);
    if (instalacion.length === 0) throw errorHttp(409, 'Programa al menos una visita antes de finalizar la etapa');
    if (!instalacion.every(v => v.completada)) throw errorHttp(409, 'El técnico aún tiene visitas pendientes en esta etapa');
  } else if (fase === 'FINAL') {
    if (visita.liquidacionFinalEn) return { aplica: true, fase, yaLiquidada: true, liquidadaEn: visita.liquidacionFinalEn };
    if (!programadas.every(v => v.completada)) throw errorHttp(409, 'El técnico aún tiene visitas sin reporte');
  }

  const etapas = costos.etapasPorLiquidar(fase, instalacionLiquidada(ctx));
  const plan = costos.construirPlan(ctx.lineas, ctx.estimaciones);
  const ejecutado = costos.ejecutadoDe(programadas);
  const tarifas = await tarifasVigentes(ctx.destino);
  const agregado = costos.agregarEstimaciones(ctx.estimaciones);

  const propuestas = etapas.map(etapa => {
    if (etapa === 'DIAGNOSTICO') {
      return {
        etapa,
        nombre: costos.NOMBRE_ETAPA[etapa],
        ejecutado: ejecutado[etapa],
        // Lo que costó la oferta aceptada es un hecho: no se edita
        diagnostico: ctx.diagnostico,
        planificado: { subtotal: plan.diagnostico, rubros: {} },
      };
    }

    const delPlan = plan[etapa];
    return {
      etapa,
      nombre: costos.NOMBRE_ETAPA[etapa],
      ejecutado: ejecutado[etapa],
      entradas: costos.proponerEntradas(etapa, delPlan, ejecutado[etapa]),
      precios: costos.proponerPrecios(delPlan, tarifas),
      ...(etapa === TIPO_INSTALACION ? { materiales: plan.materiales } : {}),
      planificado: {
        entradas: delPlan.entradas,
        rubros: Object.fromEntries(Object.entries(delPlan.rubros).map(([categoria, rubro]) => [categoria, rubro.subtotal])),
        ...(etapa === TIPO_INSTALACION ? { materiales: plan.materiales } : {}),
        subtotal: delPlan.subtotal,
      },
    };
  });

  const deEstaFase = imprevistosDe(ctx, etapas);
  return {
    aplica: true,
    fase,
    yaLiquidada: false,
    etapas: propuestas,
    imprevistos: deEstaFase,
    pendientes: deEstaFase.filter(c => c.estado === costos.ESTADO_COSTO.PENDIENTE).length,
    // La provisión que se calculó al cotizar, frente a lo que ya se gastó en imprevistos en todo el servicio
    provision: agregado.provision,
    imprevistosServicio: costos.totalesDeCostos(imprevistosDe(ctx)).imprevistos,
  };
}

// --- Liquidación (escritura) -----------------------------------------------------------------------------------

// Comprueba la liquidación que envió el navegador y deja listas las filas a guardar. No escribe nada: si algo no cuadra
// (un número inválido, un imprevisto sin monto, una columna que falta) se rechaza antes de tocar el Excel.
function prepararLiquidacion(ctx, fase, enviadas, datos) {
  const hoja = datos.hojas.costos;
  if (!hoja) throw new Error('No existe la hoja "costosReales" en el Excel (npm run hojas:preparar la crea)');
  exigirColumnas(hoja, COLUMNAS_COSTOS, 'costosReales');
  exigirColumnas(datos.hojas.visitas, ['liquidacionInstalacionEn', 'liquidacionFinalEn'], 'visitasTecnicas');

  const etapas = costos.etapasPorLiquidar(fase, instalacionLiquidada(ctx));
  const pendientes = imprevistosDe(ctx, etapas).filter(c => c.estado === costos.ESTADO_COSTO.PENDIENTE);
  if (pendientes.length > 0) {
    throw errorHttp(
      409,
      `Hay ${pendientes.length} imprevisto(s) avisado(s) por el técnico sin monto: regístralos o descártalos antes de liquidar`
    );
  }

  return { etapas, lineas: costos.validarLiquidacion(etapas, enviadas, ctx.diagnostico) };
}

// Guarda las filas de la liquidación. Antes quita las que un intento anterior pudo dejar a medias, así repetirla no duplica.
async function escribirLiquidacion(ctx, datos, preparada, usuario) {
  const hoja = datos.hojas.costos;
  const visitaId = ctx.visita.visitaId;

  // Lectura directa (sin caché): se borra por número de fila
  const frescas = await hoja.getRows({ offset: 0 });
  const previas = frescas.filter(f =>
    mismoId(f.get('visitaId'), visitaId) &&
    texto(f.get('clase')) === costos.CLASE.DIRECTO &&
    preparada.etapas.includes(texto(f.get('etapa')))
  );
  await borrarFilas(hoja, previas);

  const ahora = new Date().toISOString();
  let costoRealId = siguienteId(frescas.filter(f => !previas.includes(f)), 'costoRealId');
  await hoja.addRows(
    preparada.lineas.map(linea => ({
      costoRealId: costoRealId++,
      visitaId,
      etapa: linea.etapa,
      rubro: linea.rubro,
      clase: costos.CLASE.DIRECTO,
      concepto: linea.concepto,
      cantidad: linea.cantidad,
      costoUnitario: linea.costoUnitario,
      subtotal: linea.subtotal,
      motivo: '',
      estado: costos.ESTADO_COSTO.REGISTRADO,
      visitaProgramadaId: '',
      registradoPor: usuario.nombre,
      registradoEn: ahora,
      confirmadoPor: usuario.nombre,
    })),
    { raw: true }
  );
}

// Liquidación final (HU-29): mantenimiento y soporte, y lo anterior si faltaba. Se hace antes de subir los archivos a Drive,
// así un error de números se ve de inmediato y subir los archivos puede repetirse sin volver a liquidar.
async function liquidarFinal(visitaId, enviadas, usuario) {
  console.log('Modelo: liquidación final de costos del servicio', visitaId);

  const datos = await cargarDatos();
  const ctx = contextoDeVisita(datos, visitaId);
  if (!ctx.aplica) throw errorHttp(409, 'Este servicio es anterior al control de costos: no necesita liquidación');
  exigirServicioAbierto(ctx);
  if (ctx.visita.liquidacionFinalEn) throw errorHttp(409, 'La liquidación final de este servicio ya fue registrada');
  if (!ctx.programadas.every(v => v.completada)) throw errorHttp(409, 'El técnico aún tiene visitas sin reporte');

  const preparada = prepararLiquidacion(ctx, 'FINAL', enviadas, datos);
  await escribirLiquidacion(ctx, datos, preparada, usuario);

  ctx.filaVisita.set('liquidacionFinalEn', new Date().toISOString());
  await ctx.filaVisita.save({ raw: true });

  return { visitaId: ctx.visita.visitaId, etapas: preparada.etapas };
}

// --- Resumen al cerrar el servicio (HU-29) -----------------------------------------------------------------------

// Calcula Creal, Mreal y las desviaciones del servicio y guarda (o reemplaza) su fila en resumenProceso. Se llama al
// cerrar el servicio. Devuelve null si el servicio es anterior al control de costos.
async function registrarResumen(visitaId, usuario) {
  console.log('Modelo: guardando el resumen del proceso del servicio', visitaId);

  const datos = await cargarDatos();
  const ctx = contextoDeVisita(datos, visitaId);
  if (!ctx.aplica) return null;

  if (!ctx.visita.liquidacionFinalEn) throw errorHttp(409, 'Registra primero la liquidación de los costos reales del servicio');

  const hoja = datos.hojas.resumenes;
  if (!hoja) throw new Error('No existe la hoja "resumenProceso" en el Excel (npm run hojas:preparar la crea)');
  exigirColumnas(hoja, COLUMNAS_RESUMEN, 'resumenProceso');

  const totales = costos.totalesDeCostos(ctx.costos);
  if (totales.pendientes > 0) throw errorHttp(409, 'Hay imprevistos sin monto: regístralos o descártalos antes de cerrar el servicio');

  const estimado = costos.agregarEstimaciones(ctx.estimaciones);
  const costoReal = redondear(totales.directos + totales.imprevistos);
  const resultado = costos.calcularResumen({ ventaSoles: estimado.ventaSoles, costoEstimado: estimado.costoEstimado, costoReal });

  const datosFila = {
    visitaId: ctx.visita.visitaId,
    solicitudId: ctx.visita.solicitudId,
    tipoServicio: ctx.tipoServicio,
    destino: ctx.destino,
    cotizaciones: ctx.cotizacionIds.join(','),
    ventaSoles: estimado.ventaSoles,
    costoParametrico: estimado.costoParametrico,
    // Lo que sugería la analogía al cotizar (vacío si no había servicios similares suficientes): sirve para medir su exactitud
    costoAnalogo: estimado.costoAnalogo ?? '',
    costoEstimado: estimado.costoEstimado,
    costoReal,
    imprevistosProvision: estimado.provision,
    imprevistosReal: totales.imprevistos,
    margenEstimado: resultado.margenEstimado ?? '',
    margenReal: resultado.margenReal ?? '',
    desviacionCosto: resultado.desviacionCosto,
    desviacionMargen: resultado.desviacionMargen ?? '',
    origen: 'SISTEMA',
    cerradoPor: usuario.nombre,
    cerradoEn: new Date().toISOString(),
  };

  // La referencia es el nombre con el que se reconoce el servicio en el tablero; las hojas preparadas antes no la tienen
  if ((hoja.headerValues || []).includes('referencia')) {
    datosFila.referencia = `${ctx.clienteNombre} · Servicio ${ctx.visita.visitaId}`.trim();
  }

  const existente = datos.filas.resumenes.find(f => mismoId(f.get('visitaId'), visitaId));
  if (existente) {
    for (const [campo, valor] of Object.entries(datosFila)) existente.set(campo, valor);
    await existente.save({ raw: true });
  } else {
    await hoja.addRow({ resumenId: siguienteId(datos.filas.resumenes, 'resumenId'), ...datosFila }, { raw: true });
  }

  return { ...datosFila, ...resultado };
}

// --- Imprevistos (HU-27, HU-32) ----------------------------------------------------------------------------------

// El imprevisto solo se puede registrar, completar o descartar mientras su etapa no esté liquidada.
function exigirEtapaAbierta(ctx, etapa) {
  if (costos.etapaLiquidada(etapa, ctx.visita)) {
    throw errorHttp(409, `Los costos de «${costos.NOMBRE_ETAPA[etapa]}» ya fueron liquidados: no admiten más imprevistos`);
  }
}

function exigirControl(ctx) {
  if (!ctx.aplica) throw errorHttp(409, 'Este servicio es anterior al control de costos: no registra imprevistos');
}

async function hojaDeCostos(datos) {
  const hoja = datos.hojas.costos;
  if (!hoja) throw new Error('No existe la hoja "costosReales" en el Excel (npm run hojas:preparar la crea)');
  exigirColumnas(hoja, COLUMNAS_COSTOS, 'costosReales');
  return hoja;
}

// El trabajador registra un imprevisto del servicio con su monto y motivo.
async function registrarImprevisto(visitaId, entrada, usuario) {
  console.log('Modelo: registrando un imprevisto del servicio', visitaId);

  const imprevisto = costos.validarImprevisto(entrada);
  const datos = await cargarDatos();
  const ctx = contextoDeVisita(datos, visitaId);
  exigirControl(ctx);
  exigirServicioAbierto(ctx);
  exigirEtapaAbierta(ctx, imprevisto.etapa);
  // El mantenimiento y el soporte existen a partir de que se finaliza la instalación
  if ((imprevisto.etapa === 'MANTENIMIENTO' || imprevisto.etapa === 'SOPORTE') && ctx.visita.etapasFinalizadas < 1) {
    throw errorHttp(409, `La etapa «${costos.NOMBRE_ETAPA[imprevisto.etapa]}» se habilita al finalizar la instalación`);
  }

  const hoja = await hojaDeCostos(datos);
  const fila = await hoja.addRow({
    costoRealId: siguienteId(datos.filas.costos, 'costoRealId'),
    visitaId: ctx.visita.visitaId,
    etapa: imprevisto.etapa,
    rubro: costos.CONCEPTOS_IMPREVISTO[imprevisto.concepto].rubro,
    clase: costos.CLASE.IMPREVISTO,
    concepto: imprevisto.concepto,
    cantidad: 1,
    costoUnitario: imprevisto.monto,
    subtotal: imprevisto.monto,
    motivo: imprevisto.motivo,
    estado: costos.ESTADO_COSTO.REGISTRADO,
    visitaProgramadaId: '',
    registradoPor: usuario.nombre,
    registradoEn: new Date().toISOString(),
    confirmadoPor: usuario.nombre,
  }, { raw: true });

  return armarCosto(fila.toObject());
}

// Busca un imprevisto por id. Lo demás de la hoja (costos directos de una liquidación) no se toca desde aquí.
function buscarImprevisto(datos, costoRealId) {
  const fila = datos.filas.costos.find(f => mismoId(f.get('costoRealId'), costoRealId));
  if (!fila || texto(fila.get('clase')) !== costos.CLASE.IMPREVISTO) throw errorHttp(404, 'Imprevisto no encontrado');
  return fila;
}

// Le pone el monto a un imprevisto que avisó el técnico (o corrige el de uno ya registrado).
async function completarImprevisto(costoRealId, monto, usuario) {
  console.log('Modelo: completando el imprevisto', costoRealId);

  const montoValido = costos.validarMonto(monto);
  const datos = await cargarDatos();
  const fila = buscarImprevisto(datos, costoRealId);
  const ctx = contextoDeVisita(datos, texto(fila.get('visitaId')));
  exigirServicioAbierto(ctx);
  exigirEtapaAbierta(ctx, texto(fila.get('etapa')));
  await hojaDeCostos(datos);

  fila.set('cantidad', 1);
  fila.set('costoUnitario', montoValido);
  fila.set('subtotal', montoValido);
  fila.set('estado', costos.ESTADO_COSTO.REGISTRADO);
  fila.set('confirmadoPor', usuario.nombre);
  await fila.save({ raw: true });

  return armarCosto(fila.toObject());
}

// Descarta un imprevisto registrado por error (o un aviso del técnico que no corresponde).
async function eliminarImprevisto(costoRealId) {
  console.log('Modelo: descartando el imprevisto', costoRealId);

  const datos = await cargarDatos();
  const fila = buscarImprevisto(datos, costoRealId);
  const ctx = contextoDeVisita(datos, texto(fila.get('visitaId')));
  exigirServicioAbierto(ctx);
  exigirEtapaAbierta(ctx, texto(fila.get('etapa')));

  await fila.delete();
  return { costoRealId: Number(costoRealId) };
}

// HU-32: el técnico avisa un imprevisto en el reporte de una visita. Queda PENDIENTE hasta que el trabajador le pone el monto.
// Es seguro repetirlo: si la visita ya tiene su aviso no se crea otro. Devuelve null si el servicio no pasa por el control.
async function registrarAvisoDeTecnico({ visitaId, visitaProgramadaId, etapa, tecnicoNombre, concepto, descripcion }) {
  console.log('Modelo: el técnico avisa un imprevisto en la visita', visitaProgramadaId);

  const aviso = costos.validarAviso({ concepto, descripcion });
  const datos = await cargarDatos();
  const ctx = contextoDeVisita(datos, visitaId);
  if (!ctx.aplica) return null;

  const yaAvisado = ctx.filasCostos.find(f =>
    mismoId(f.get('visitaProgramadaId'), visitaProgramadaId) && texto(f.get('clase')) === costos.CLASE.IMPREVISTO
  );
  if (yaAvisado) return armarCosto(yaAvisado.toObject());

  exigirEtapaAbierta(ctx, etapa);
  const hoja = await hojaDeCostos(datos);
  const fila = await hoja.addRow({
    costoRealId: siguienteId(datos.filas.costos, 'costoRealId'),
    visitaId: ctx.visita.visitaId,
    etapa,
    rubro: costos.CONCEPTOS_IMPREVISTO[aviso.concepto].rubro,
    clase: costos.CLASE.IMPREVISTO,
    concepto: aviso.concepto,
    cantidad: '',
    costoUnitario: '',
    subtotal: '',
    motivo: aviso.descripcion,
    estado: costos.ESTADO_COSTO.PENDIENTE,
    visitaProgramadaId,
    registradoPor: tecnicoNombre,
    registradoEn: new Date().toISOString(),
    confirmadoPor: '',
  }, { raw: true });

  return armarCosto(fila.toObject());
}

// --- Consultas para las pantallas -------------------------------------------------------------------------------

// Lo registrado de un servicio: imprevistos, costos confirmados y en qué etapas ya no se admiten cambios.
async function getCostosDeServicio(visitaId) {
  const ctx = await cargarContexto(visitaId);
  const agregado = costos.agregarEstimaciones(ctx.estimaciones);
  const imprevistos = imprevistosDe(ctx);

  return {
    aplicaControl: ctx.aplica,
    liquidacionInstalacion: ctx.visita.liquidacionInstalacionEn || null,
    liquidacionFinal: ctx.visita.liquidacionFinalEn || null,
    etapasLiquidadas: Object.fromEntries(costos.ETAPAS.map(etapa => [etapa, costos.etapaLiquidada(etapa, ctx.visita)])),
    imprevistos: imprevistos.map(c => ({ ...c, liquidada: costos.etapaLiquidada(c.etapa, ctx.visita) })),
    directos: ctx.costos.filter(c => c.clase === costos.CLASE.DIRECTO),
    totales: costos.totalesDeCostos(ctx.costos),
    provision: agregado.provision,
  };
}

// Un servicio por fila para el Historial de Servicios (HU-31): márgenes y en qué punto del control está. Los márgenes y
// costos son de uso interno: este listado es solo para el trabajador y el jefe.
async function getServicios() {
  const datos = await cargarDatos();
  const resumenes = new Map(datos.filas.resumenes.map(f => [texto(f.get('visitaId')), f.toObject()]));

  return datos.filas.visitas.map(fila => {
    const ctx = contextoDeVisita(datos, texto(fila.get('visitaId')));
    const cerrado = resumenes.get(String(ctx.visita.visitaId));
    const imprevistos = imprevistosDe(ctx);

    if (!ctx.aplica) {
      return { visitaId: ctx.visita.visitaId, aplicaControl: false };
    }

    const estimado = costos.agregarEstimaciones(ctx.estimaciones);
    const totales = costos.totalesDeCostos(ctx.costos);
    return {
      visitaId: ctx.visita.visitaId,
      aplicaControl: true,
      liquidacionInstalacion: Boolean(ctx.visita.liquidacionInstalacionEn || ctx.visita.liquidacionFinalEn),
      liquidacionFinal: Boolean(ctx.visita.liquidacionFinalEn),
      costoEstimado: estimado.costoEstimado,
      margenEstimado: calcularMargen(estimado.ventaSoles, estimado.costoEstimado),
      // Lo real se conoce al cerrar el servicio
      costoReal: cerrado ? aNumeroONulo(cerrado.costoReal) : null,
      margenReal: cerrado ? aNumeroONulo(cerrado.margenReal) : null,
      desviacionCosto: cerrado ? aNumeroONulo(cerrado.desviacionCosto) : null,
      desviacionMargen: cerrado ? aNumeroONulo(cerrado.desviacionMargen) : null,
      imprevistos: {
        cantidad: imprevistos.length,
        total: totales.imprevistos,
        pendientes: totales.pendientes,
      },
    };
  });
}

module.exports = {
  cargarDatos,
  contextoDeVisita,
  cargarContexto,
  proponerLiquidacion,
  prepararLiquidacion,
  escribirLiquidacion,
  liquidarFinal,
  registrarResumen,
  registrarImprevisto,
  completarImprevisto,
  eliminarImprevisto,
  registrarAvisoDeTecnico,
  getCostosDeServicio,
  getServicios,
};
