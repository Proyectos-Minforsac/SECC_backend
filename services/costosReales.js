// Control de los costos reales de un servicio (RN-09), sin acceso al Excel para poder probarlo.
//
// Los costos reales se registran por etapa y rubro y se confirman en dos liquidaciones:
//   INSTALACION: al finalizar la instalación. Liquida el diagnóstico y la instalación.
//   FINAL:       al cerrar el servicio. Liquida el mantenimiento y el soporte (y, si faltó, también lo anterior).
// Entre una y otra se pueden registrar imprevistos (doble pasaje, material faltante...), que suman al costo real.
//
// Al cerrar el servicio se compara lo real con lo estimado y validado:
//   ΔC = Creal − Cest        ΔM = Mreal − Mest (en puntos de margen)

const { errorHttp, texto } = require('./hojasUtils');
const { RUBROS, CAMPOS, redondear, calcularMargen, unidadesDe } = require('./calculoCostos');
const { aNumeroONulo, leerTexto } = require('./validacion');

const ETAPAS = ['DIAGNOSTICO', 'INSTALACION', 'MANTENIMIENTO', 'SOPORTE'];

const NOMBRE_ETAPA = {
  DIAGNOSTICO: 'Diagnóstico inicial',
  INSTALACION: 'Instalación',
  MANTENIMIENTO: 'Mantenimiento preventivo',
  SOPORTE: 'Soporte técnico',
};

const ETAPAS_DE_FASE = {
  INSTALACION: ['DIAGNOSTICO', 'INSTALACION'],
  FINAL: ['MANTENIMIENTO', 'SOPORTE'],
};
const FASES = Object.keys(ETAPAS_DE_FASE);

const CLASE = { DIRECTO: 'DIRECTO', IMPREVISTO: 'IMPREVISTO' };

// Un imprevisto que avisó el técnico queda PENDIENTE hasta que el trabajador le pone el monto.
const ESTADO_COSTO = { REGISTRADO: 'REGISTRADO', PENDIENTE: 'PENDIENTE' };

// Imprevistos logísticos que mencionó el jefe, y el rubro al que suman.
const CONCEPTOS_IMPREVISTO = {
  DOBLE_PASAJE: { etiqueta: 'Doble pasaje', rubro: 'TRANSPORTE' },
  TRASLADO_MATERIAL: { etiqueta: 'Traslado de material', rubro: 'TRANSPORTE' },
  MATERIAL_FALTANTE: { etiqueta: 'Material faltante', rubro: 'MATERIALES' },
  OTRO: { etiqueta: 'Otro', rubro: 'OTROS' },
};

const ETIQUETA_RUBRO = {
  TRANSPORTE: 'Transporte',
  HOSPEDAJE: 'Hospedaje',
  ALIMENTACION: 'Alimentación',
  MANO_OBRA: 'Mano de obra',
  MATERIALES: 'Materiales',
  DIAGNOSTICO: 'Diagnóstico',
  OTROS: 'Otros',
};

const MONTO_MAXIMO = 10000000;

const numero = valor => aNumeroONulo(valor) ?? 0;

// Etapas que se liquidan en cada paso. Al cerrar, si la instalación se finalizó antes de que existiera este control (o sin
// liquidar), esa liquidación pendiente se completa junto con la final.
function etapasPorLiquidar(fase, instalacionLiquidada) {
  if (!FASES.includes(fase)) throw errorHttp(400, 'Fase de liquidación inválida');
  return fase === 'FINAL' && !instalacionLiquidada
    ? [...ETAPAS_DE_FASE.INSTALACION, ...ETAPAS_DE_FASE.FINAL]
    : ETAPAS_DE_FASE[fase];
}

// ¿Esa etapa ya tiene sus costos reales confirmados? La liquidación final también confirma lo anterior.
function etapaLiquidada(etapa, { liquidacionInstalacionEn, liquidacionFinalEn }) {
  const final = texto(liquidacionFinalEn) !== '';
  if (etapa === 'DIAGNOSTICO' || etapa === 'INSTALACION') return final || texto(liquidacionInstalacionEn) !== '';
  return final;
}

// Lo que ya pasó en cada etapa: visitas completadas y días distintos en los que hubo visita.
//   programadas: [{ tipo, fecha, completada }]
function ejecutadoDe(programadas) {
  const resultado = Object.fromEntries(ETAPAS.map(etapa => [etapa, { visitas: 0, dias: 0 }]));
  const fechas = Object.fromEntries(ETAPAS.map(etapa => [etapa, new Set()]));

  for (const visita of programadas) {
    if (!visita.completada || !resultado[visita.tipo]) continue;
    resultado[visita.tipo].visitas += 1;
    fechas[visita.tipo].add(texto(visita.fecha));
  }
  for (const etapa of ETAPAS) resultado[etapa].dias = fechas[etapa].size;
  return resultado;
}

// Lo planificado, sumando las estimaciones validadas de las cotizaciones aceptadas del servicio.
//   lineas: filas de inductoresCosto { estimacionId, etapa, categoria, nTecnicos, dias, noches, viajes, cantidad, costoUnitario, subtotal }
//   estimaciones: { estimacionId, costoMateriales, costoDiagnostico }
function construirPlan(lineas, estimaciones) {
  const plan = {};
  const grupos = new Map(); // estimación + etapa -> sus técnicos, días, noches y viajes (se repiten en las 4 líneas)

  for (const etapa of ['INSTALACION', 'MANTENIMIENTO', 'SOPORTE']) {
    plan[etapa] = { activa: false, entradas: null, rubros: {}, subtotal: 0 };
  }

  for (const linea of lineas) {
    const etapa = texto(linea.etapa);
    if (!plan[etapa]) continue;

    const clave = `${texto(linea.estimacionId)}|${etapa}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        etapa,
        nTecnicos: numero(linea.nTecnicos),
        dias: numero(linea.dias),
        noches: numero(linea.noches),
        viajes: numero(linea.viajes),
      });
    }

    const categoria = texto(linea.categoria);
    const rubro = plan[etapa].rubros[categoria] ?? { cantidad: 0, costoUnitario: numero(linea.costoUnitario), subtotal: 0 };
    rubro.cantidad += numero(linea.cantidad);
    rubro.subtotal = redondear(rubro.subtotal + numero(linea.subtotal));
    plan[etapa].rubros[categoria] = rubro;
  }

  for (const grupo of grupos.values()) {
    const actual = plan[grupo.etapa].entradas;
    plan[grupo.etapa].activa = true;
    plan[grupo.etapa].entradas = actual
      ? {
          nTecnicos: Math.max(actual.nTecnicos, grupo.nTecnicos),
          dias: actual.dias + grupo.dias,
          noches: actual.noches + grupo.noches,
          viajes: actual.viajes + grupo.viajes,
        }
      : { nTecnicos: grupo.nTecnicos, dias: grupo.dias, noches: grupo.noches, viajes: grupo.viajes };
  }

  for (const etapa of ['INSTALACION', 'MANTENIMIENTO', 'SOPORTE']) {
    for (const rubro of Object.values(plan[etapa].rubros)) {
      if (rubro.cantidad > 0) rubro.costoUnitario = redondear(rubro.subtotal / rubro.cantidad);
    }
  }

  plan.materiales = redondear(estimaciones.reduce((total, e) => total + numero(e.costoMateriales), 0));
  // El mismo diagnóstico está en la estimación de cada cotización: se cuenta una sola vez
  plan.diagnostico = redondear(Math.max(0, ...estimaciones.map(e => numero(e.costoDiagnostico))));

  for (const etapa of ['INSTALACION', 'MANTENIMIENTO', 'SOPORTE']) {
    plan[etapa].subtotal = redondear(
      Object.values(plan[etapa].rubros).reduce((total, rubro) => total + rubro.subtotal, 0) +
        (etapa === 'INSTALACION' ? plan.materiales : 0)
    );
  }
  return plan;
}

// Técnicos, días, noches y viajes con los que arranca la tabla de una etapa: lo planificado, corregido con lo ejecutado
// (visitas completadas y días en que hubo visita). El trabajador los ajusta.
function proponerEntradas(etapa, planDeEtapa, ejecutado) {
  const plan = planDeEtapa?.entradas;
  const nTecnicos = plan?.nTecnicos || 1;

  if (etapa === 'INSTALACION') {
    // Los viajes no se pueden ver en las visitas (una instalación de varios días suele ser un solo viaje): se parte del plan
    const dias = ejecutado.dias || plan?.dias || 0;
    return { nTecnicos, dias, noches: Math.min(plan?.noches ?? 0, dias), viajes: plan?.viajes ?? 1 };
  }

  // En mantenimiento y soporte cada visita es un viaje
  const viajes = ejecutado.visitas;
  const nochesPorViaje = plan && plan.viajes > 0 ? plan.noches / plan.viajes : 0;
  const dias = ejecutado.dias;
  return { nTecnicos, dias, noches: Math.min(dias, Math.round(nochesPorViaje * viajes)), viajes };
}

// Precio por unidad de cada rubro con el que arranca la tabla: el que se usó al estimar, o la tarifa vigente.
//   tarifas: { PASAJE: monto, NOCHE: monto, ... }
function proponerPrecios(planDeEtapa, tarifas) {
  return Object.fromEntries(
    RUBROS.map(rubro => [
      rubro.categoria,
      planDeEtapa?.rubros?.[rubro.categoria]?.costoUnitario ?? tarifas?.[rubro.inductor] ?? 0,
    ])
  );
}

// Las filas de costo real de una etapa a partir de lo que se confirmó.
//   entrada: { nTecnicos, dias, noches, viajes, precios: { TRANSPORTE: ..., ... }, materiales }
function lineasDeEtapa(etapa, entrada, diagnostico) {
  if (etapa === 'DIAGNOSTICO') {
    return [{ etapa, rubro: 'DIAGNOSTICO', concepto: ETIQUETA_RUBRO.DIAGNOSTICO, cantidad: 1, costoUnitario: diagnostico, subtotal: diagnostico }];
  }

  const lineas = RUBROS.map(rubro => {
    const cantidad = unidadesDe(rubro.campo, entrada);
    const costoUnitario = redondear(entrada.precios[rubro.categoria] ?? 0);
    return {
      etapa,
      rubro: rubro.categoria,
      concepto: ETIQUETA_RUBRO[rubro.categoria],
      cantidad,
      costoUnitario,
      subtotal: redondear(cantidad * costoUnitario),
    };
  });

  if (etapa === 'INSTALACION') {
    const materiales = redondear(entrada.materiales ?? 0);
    lineas.push({ etapa, rubro: 'MATERIALES', concepto: ETIQUETA_RUBRO.MATERIALES, cantidad: 1, costoUnitario: materiales, subtotal: materiales });
  }
  return lineas;
}

// Lee lo que envió el navegador para una etapa; los problemas se acumulan en `problemas`.
function leerEntradas(etapa, enviada, problemas) {
  const nombre = NOMBRE_ETAPA[etapa];

  const entero = campo => {
    const valor = enviada[campo];
    if (valor === undefined || valor === null || valor === '') return 0;
    const n = Number(valor);
    if (!(Number.isInteger(n) && n >= 0 && n <= CAMPOS[campo].max)) {
      problemas.push(`${nombre}: ${CAMPOS[campo].etiqueta} debe ser un número entero entre 0 y ${CAMPOS[campo].max}`);
      return 0;
    }
    return n;
  };

  const entrada = {
    nTecnicos: entero('nTecnicos'),
    dias: entero('dias'),
    noches: entero('noches'),
    viajes: entero('viajes'),
    precios: {},
    materiales: 0,
  };
  if (entrada.noches > entrada.dias) problemas.push(`${nombre}: las noches no pueden ser más que los días`);

  const monto = (valor, descripcion, obligatorio) => {
    if (valor === undefined || valor === null || valor === '') {
      if (obligatorio) problemas.push(`${nombre}: ingresa ${descripcion}`);
      return 0;
    }
    const n = Number(valor);
    if (!(Number.isFinite(n) && n >= 0 && n <= MONTO_MAXIMO)) {
      problemas.push(`${nombre}: ${descripcion} no es válido`);
      return 0;
    }
    return n;
  };

  for (const rubro of RUBROS) {
    // Sin unidades en ese rubro el precio no importa
    const obligatorio = unidadesDe(rubro.campo, entrada) > 0;
    entrada.precios[rubro.categoria] = monto(enviada.precios?.[rubro.categoria], `el precio de ${rubro.tarifa}`, obligatorio);
  }
  if (etapa === 'INSTALACION') entrada.materiales = monto(enviada.materiales, 'el costo real de los materiales', true);

  return entrada;
}

// Comprueba la liquidación que envió el navegador y la convierte en las filas de costo real. Nada de lo que viene en
// la petición se da por bueno: las cantidades y subtotales se calculan aquí. El diagnóstico es un hecho (lo que costó la
// oferta aceptada) y no se acepta del navegador.
//   esperadas: etapas que se liquidan en este paso
function validarLiquidacion(esperadas, enviadas, diagnostico) {
  if (!Array.isArray(enviadas)) throw errorHttp(400, 'Falta la liquidación de costos reales');

  const porEtapa = new Map();
  for (const enviada of enviadas) {
    if (!enviada || !ETAPAS.includes(enviada.etapa)) throw errorHttp(400, 'La liquidación trae una etapa desconocida');
    if (!esperadas.includes(enviada.etapa)) {
      throw errorHttp(400, `La etapa «${NOMBRE_ETAPA[enviada.etapa]}» no se liquida en este paso`);
    }
    if (porEtapa.has(enviada.etapa)) throw errorHttp(400, `La etapa «${NOMBRE_ETAPA[enviada.etapa]}» viene repetida`);
    porEtapa.set(enviada.etapa, enviada);
  }

  const lineas = [];
  for (const etapa of esperadas) {
    if (etapa === 'DIAGNOSTICO') {
      lineas.push(...lineasDeEtapa(etapa, null, diagnostico));
      continue;
    }

    const enviada = porEtapa.get(etapa);
    if (!enviada) throw errorHttp(400, `Falta la liquidación de «${NOMBRE_ETAPA[etapa]}»`);

    const problemas = [];
    const entrada = leerEntradas(etapa, enviada, problemas);
    if (problemas.length > 0) throw errorHttp(400, problemas.join('. '));
    lineas.push(...lineasDeEtapa(etapa, entrada, diagnostico));
  }
  return lineas;
}

// --- Imprevistos -----------------------------------------------------------------------------------------

function validarMonto(valor) {
  const n = Number(texto(valor));
  if (texto(valor) === '' || !Number.isFinite(n) || n <= 0 || n > MONTO_MAXIMO) {
    throw errorHttp(400, 'Ingresa el monto del imprevisto (un monto mayor que cero)');
  }
  return redondear(n);
}

function validarConcepto(concepto) {
  if (!CONCEPTOS_IMPREVISTO[concepto]) throw errorHttp(400, 'Elige qué tipo de imprevisto ocurrió');
  return concepto;
}

// Un imprevisto que registra el trabajador: etapa, tipo, monto y motivo.
function validarImprevisto({ etapa, concepto, monto, motivo }) {
  if (!ETAPAS.includes(etapa)) throw errorHttp(400, 'Elige la etapa del imprevisto');
  return {
    etapa,
    concepto: validarConcepto(concepto),
    monto: validarMonto(monto),
    motivo: leerTexto(motivo, 'Motivo del imprevisto', { obligatorio: true }),
  };
}

// El aviso del técnico: qué pasó, sin monto.
function validarAviso({ concepto, descripcion }) {
  return {
    concepto: validarConcepto(concepto),
    descripcion: leerTexto(descripcion, 'Descripción del imprevisto', { obligatorio: true }),
  };
}

// --- Totales y resumen ------------------------------------------------------------------------------------

// Suma las filas de costo real. Un imprevisto pendiente (sin monto) no suma.
//   filas: [{ clase, estado, subtotal }]
function totalesDeCostos(filas) {
  let directos = 0;
  let imprevistos = 0;
  let pendientes = 0;

  for (const fila of filas) {
    if (texto(fila.estado) === ESTADO_COSTO.PENDIENTE) {
      pendientes += 1;
      continue;
    }
    if (texto(fila.clase) === CLASE.IMPREVISTO) imprevistos += numero(fila.subtotal);
    else directos += numero(fila.subtotal);
  }
  return { directos: redondear(directos), imprevistos: redondear(imprevistos), pendientes };
}

// Venta y costo estimado de un servicio con varias cotizaciones aceptadas: se suma todo, salvo el diagnóstico, que está
// en la estimación de cada una y se cuenta una sola vez.
function agregarEstimaciones(estimaciones) {
  const diagnostico = Math.max(0, ...estimaciones.map(e => numero(e.costoDiagnostico)));
  const sinDiagnostico = campo => estimaciones.reduce((total, e) => total + numero(e[campo]) - numero(e.costoDiagnostico), 0);

  // El costo análogo solo se conoce si todas las cotizaciones lo tenían (hacía falta un mínimo de servicios similares)
  const conAnalogo = estimaciones.length > 0 && estimaciones.every(e => numero(e.costoAnalogo) > 0);

  return {
    ventaSoles: redondear(estimaciones.reduce((total, e) => total + numero(e.ventaSoles), 0)),
    costoParametrico: redondear(sinDiagnostico('costoParametrico') + diagnostico),
    costoAnalogo: conAnalogo ? redondear(sinDiagnostico('costoAnalogo') + diagnostico) : null,
    costoEstimado: redondear(sinDiagnostico('costoFinal') + diagnostico),
    provision: redondear(estimaciones.reduce((total, e) => total + numero(e.costoImprevistos), 0)),
  };
}

// Márgenes y desviaciones del servicio cerrado. La desviación de margen es en puntos de margen.
function calcularResumen({ ventaSoles, costoEstimado, costoReal }) {
  const margenEstimado = calcularMargen(ventaSoles, costoEstimado);
  const margenReal = calcularMargen(ventaSoles, costoReal);
  return {
    margenEstimado,
    margenReal,
    desviacionCosto: redondear(costoReal - costoEstimado),
    desviacionMargen: margenEstimado !== null && margenReal !== null ? redondear(margenReal - margenEstimado) : null,
  };
}

module.exports = {
  ETAPAS,
  NOMBRE_ETAPA,
  FASES,
  CLASE,
  ESTADO_COSTO,
  CONCEPTOS_IMPREVISTO,
  ETIQUETA_RUBRO,
  MONTO_MAXIMO,
  etapasPorLiquidar,
  etapaLiquidada,
  ejecutadoDe,
  construirPlan,
  proponerEntradas,
  proponerPrecios,
  lineasDeEtapa,
  validarLiquidacion,
  validarImprevisto,
  validarAviso,
  validarMonto,
  totalesDeCostos,
  agregarEstimaciones,
  calcularResumen,
};
