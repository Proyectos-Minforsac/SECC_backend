// Indicador «Margen de rentabilidad por proceso» (sin acceso al Excel, para poder probarlo): resúmenes, agrupaciones y la
// comparación de exactitud de los tres métodos de estimación contra el costo real.
//
// Un «caso» es un servicio cerrado (fila de resumenProceso, del sistema o cargada del histórico) con los números ya leídos:
//   { origen, referencia, tipoServicio, destino, cerradoEn, ventaSoles, costoParametrico, costoAnalogo, costoEstimado,
//     costoReal, imprevistosProvision, imprevistosReal, margenEstimado, margenReal, desviacionMargen }
// Los márgenes se calculan con la venta sin IGV, en soles (RN-01). null significa que el dato no existe.

const { texto } = require('./hojasUtils');
const { redondear, calcularMargen } = require('./calculoCostos');
const { normalizar } = require('./analoga');

const ORIGENES = ['SISTEMA', 'HISTORICO'];

// Los tres métodos del modelo híbrido y la columna de resumenProceso con el costo que estimó cada uno.
const METODOS = [
  { clave: 'PARAMETRICO', etiqueta: 'Paramétrico', campo: 'costoParametrico' },
  { clave: 'ANALOGO', etiqueta: 'Análogo', campo: 'costoAnalogo' },
  { clave: 'FINAL', etiqueta: 'Final (validado por el jefe)', campo: 'costoEstimado' },
];

const esNumero = valor => typeof valor === 'number' && Number.isFinite(valor);
const positivo = valor => esNumero(valor) && valor > 0;
const suma = (casos, campo) => casos.reduce((total, caso) => total + (esNumero(caso[campo]) ? caso[campo] : 0), 0);
const promedio = valores => (valores.length > 0 ? redondear(valores.reduce((total, v) => total + v, 0) / valores.length) : null);

// «2026-11» y «2026» a partir de la fecha de cierre (ISO, con o sin hora)
const periodoDe = caso => texto(caso.cerradoEn).slice(0, 7);
const anioDe = caso => texto(caso.cerradoEn).slice(0, 4);

// Aplica los filtros del tablero: tipo de servicio, año y origen (sistema o histórico). Un filtro vacío no filtra.
function filtrar(casos, { tipoServicio = '', anio = '', origen = '' } = {}) {
  return casos.filter(
    caso =>
      (normalizar(tipoServicio) === '' || normalizar(caso.tipoServicio) === normalizar(tipoServicio)) &&
      (texto(anio) === '' || anioDe(caso) === texto(anio)) &&
      (texto(origen) === '' || caso.origen === origen)
  );
}

// Resumen de un conjunto de servicios. Los márgenes son ponderados (sobre el total vendido y el total gastado), no el
// promedio de los márgenes de cada servicio, para que un servicio grande pese más que uno chico.
function resumir(casos) {
  const vendidos = casos.filter(caso => positivo(caso.ventaSoles) && positivo(caso.costoReal));
  const ventaSoles = redondear(suma(vendidos, 'ventaSoles'));
  const costoReal = redondear(suma(vendidos, 'costoReal'));

  // Solo los servicios que tienen el costo con el que se estimaron permiten comparar lo estimado con lo real
  const comparables = vendidos.filter(caso => positivo(caso.costoEstimado));
  const ventaComparable = suma(comparables, 'ventaSoles');
  const margenEstimado = comparables.length > 0 ? calcularMargen(ventaComparable, suma(comparables, 'costoEstimado')) : null;
  const margenRealComparable = comparables.length > 0 ? calcularMargen(ventaComparable, suma(comparables, 'costoReal')) : null;
  const costoEstimadoComparable = suma(comparables, 'costoEstimado');

  // Imprevistos: cuánto pesaron sobre los costos directos, y cuánto se había provisionado
  const conImprevistos = casos.filter(caso => esNumero(caso.imprevistosReal) && positivo(caso.costoReal));
  const imprevistosReal = redondear(suma(conImprevistos, 'imprevistosReal'));
  const directos = redondear(suma(conImprevistos, 'costoReal') - imprevistosReal);
  const conProvision = casos.filter(caso => esNumero(caso.imprevistosProvision) && esNumero(caso.imprevistosReal));

  return {
    servicios: casos.length,
    sistema: casos.filter(caso => caso.origen === 'SISTEMA').length,
    historicos: casos.filter(caso => caso.origen === 'HISTORICO').length,
    ventaSoles,
    costoReal,
    margenReal: calcularMargen(ventaSoles, costoReal),
    comparables: comparables.length,
    margenEstimado,
    margenRealComparable,
    desviacionMargen: margenEstimado !== null && margenRealComparable !== null ? redondear(margenRealComparable - margenEstimado) : null,
    desviacionCostoPorcentaje: costoEstimadoComparable > 0
      ? redondear(((suma(comparables, 'costoReal') - costoEstimadoComparable) / costoEstimadoComparable) * 100)
      : null,
    imprevistos: {
      real: imprevistosReal,
      porcentajeDeDirectos: conImprevistos.length > 0 && directos > 0 ? redondear((imprevistosReal / directos) * 100) : null,
      provision: redondear(suma(conProvision, 'imprevistosProvision')),
      realConProvision: redondear(suma(conProvision, 'imprevistosReal')),
      serviciosConProvision: conProvision.length,
    },
  };
}

// Un renglón por valor de `clave` (tipo de servicio, periodo...), en orden.
function agruparPor(casos, clave) {
  const grupos = new Map();
  for (const caso of casos) {
    const valor = clave(caso);
    if (!grupos.has(valor)) grupos.set(valor, []);
    grupos.get(valor).push(caso);
  }

  return [...grupos.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([valor, delGrupo]) => {
      const r = resumir(delGrupo);
      return {
        clave: valor,
        servicios: r.servicios,
        ventaSoles: r.ventaSoles,
        costoReal: r.costoReal,
        margenReal: r.margenReal,
        comparables: r.comparables,
        margenEstimado: r.margenEstimado,
        desviacionMargen: r.desviacionMargen,
      };
    });
}

// Cada servicio con su semáforo: si el margen real llega al mínimo del jefe y si el costo quedó dentro de la tolerancia.
// null cuando falta el dato o el jefe aún no definió el parámetro.
function marcarServicios(casos, { margenMinimo, tolerancia }) {
  return casos.map(caso => {
    const desviacion = positivo(caso.costoEstimado) && positivo(caso.costoReal)
      ? redondear(((caso.costoReal - caso.costoEstimado) / caso.costoEstimado) * 100)
      : null;
    return {
      ...caso,
      desviacionCostoPorcentaje: desviacion,
      cumpleMargenMinimo: esNumero(margenMinimo) && esNumero(caso.margenReal) ? caso.margenReal >= margenMinimo : null,
      dentroTolerancia: esNumero(tolerancia) && desviacion !== null ? Math.abs(desviacion) <= tolerancia : null,
    };
  });
}

// Exactitud de un método sobre sus servicios: cuánto se equivocó en promedio (en soles y en %) y hacia dónde.
//   filas: [{ error, porcentaje }] con error = estimado − real y porcentaje = error / real × 100
function metricas(filas, tolerancia) {
  if (filas.length === 0) {
    return { n: 0, errorMedioAbsoluto: null, errorPorcentualMedio: null, sesgoPorcentual: null, dentroTolerancia: null };
  }
  return {
    n: filas.length,
    errorMedioAbsoluto: promedio(filas.map(f => Math.abs(f.error))),
    errorPorcentualMedio: promedio(filas.map(f => Math.abs(f.porcentaje))),
    // Positivo: el método tiende a estimar de más; negativo: de menos
    sesgoPorcentual: promedio(filas.map(f => f.porcentaje)),
    dentroTolerancia: esNumero(tolerancia)
      ? redondear((filas.filter(f => Math.abs(f.porcentaje) <= tolerancia).length / filas.length) * 100)
      : null,
  };
}

const filasDe = (casos, campo) =>
  casos
    .filter(caso => positivo(caso[campo]) && positivo(caso.costoReal))
    .map(caso => ({ error: caso[campo] - caso.costoReal, porcentaje: ((caso[campo] - caso.costoReal) / caso.costoReal) * 100 }));

// Compara el paramétrico, el análogo y el final contra el costo real (HU-38). Cada método se mide con los servicios que lo
// tienen; como no todos los tienen, la comparación justa es sobre los servicios que traen los tres, y de ahí sale `mejor`.
function compararMetodos(casos, tolerancia = null) {
  const metodos = METODOS.map(metodo => ({
    clave: metodo.clave,
    etiqueta: metodo.etiqueta,
    ...metricas(filasDe(casos, metodo.campo), tolerancia),
  }));

  const conLosTres = casos.filter(caso => METODOS.every(metodo => positivo(caso[metodo.campo])) && positivo(caso.costoReal));
  const comunes = METODOS.map(metodo => ({
    clave: metodo.clave,
    etiqueta: metodo.etiqueta,
    ...metricas(filasDe(conLosTres, metodo.campo), tolerancia),
  }));

  const masExacto = lista => {
    const conDatos = lista.filter(m => m.n > 0);
    if (conDatos.length < 2) return null;
    return conDatos.reduce((mejor, m) => (m.errorPorcentualMedio < mejor.errorPorcentualMedio ? m : mejor)).clave;
  };

  const mejorEnComunes = masExacto(comunes);
  return {
    metodos,
    comunes: { n: conLosTres.length, metodos: comunes },
    mejor: mejorEnComunes ?? masExacto(metodos),
    basadoEn: mejorEnComunes ? 'COMUNES' : masExacto(metodos) ? 'PROPIOS' : null,
  };
}

module.exports = { ORIGENES, METODOS, periodoDe, anioDe, filtrar, resumir, agruparPor, marcarServicios, metricas, compararMetodos };
