// Estimación por analogía (RN-10), sin acceso al Excel para poder probarla.
//
// Se parte de los servicios ya cerrados (hoja resumenProceso, del sistema o cargados del histórico) y se buscan los
// parecidos: mismo tipo de servicio y, si hay suficientes, el mismo destino. De ellos salen:
//   - cuánto costó y qué margen dejó un servicio así en la realidad (promedio y rango), y
//   - cuánto se equivocó el cálculo paramétrico en promedio (desviación relativa del costo).
// La sugerencia corrige el costo paramétrico con esa desviación: costo × (1 + desviación). Por debajo del mínimo de
// casos que fija el jefe no se promedia ni se sugiere nada: «sin datos suficientes».

const { texto } = require('./hojasUtils');
const { redondear, calcularMargen } = require('./calculoCostos');

const CASOS_RECIENTES = 5;
const CRITERIO = { TIPO_Y_DESTINO: 'TIPO_Y_DESTINO', TIPO: 'TIPO' };

// Sin mayúsculas, tildes ni espacios sobrantes: «Aire  Acondicionado» y «aire acondicionado» son el mismo tipo.
const normalizar = valor =>
  texto(valor)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

const esNumero = valor => typeof valor === 'number' && Number.isFinite(valor);

const promedio = valores => (valores.length > 0 ? redondear(valores.reduce((total, v) => total + v, 0) / valores.length) : null);

function estadisticas(valores) {
  if (valores.length === 0) return { promedio: null, min: null, max: null };
  return { promedio: promedio(valores), min: Math.min(...valores), max: Math.max(...valores) };
}

// El costo con el que se calculó el servicio: el paramétrico o, en los históricos que no lo tienen, el estimado que
// se había dado. Sin él (o sin costo real) el servicio no sirve para medir la desviación.
const baseDeEstimacion = caso => (esNumero(caso.costoParametrico) && caso.costoParametrico > 0 ? caso.costoParametrico : caso.costoEstimado);

const sirveParaDesviacion = caso => esNumero(baseDeEstimacion(caso)) && baseDeEstimacion(caso) > 0 && esNumero(caso.costoReal) && caso.costoReal > 0;

// Servicios similares al que se está cotizando. El destino cuenta solo si alcanza el mínimo de casos (RN-10); si no, se
// usan todos los del mismo tipo.
function seleccionarSimilares(casos, tipoServicio, destino, minCasos) {
  if (normalizar(tipoServicio) === '') return { criterio: null, similares: [] };

  const delTipo = casos.filter(caso => normalizar(caso.tipoServicio) === normalizar(tipoServicio));
  if (delTipo.length === 0) return { criterio: null, similares: [] };

  if (normalizar(destino) !== '') {
    const delDestino = delTipo.filter(caso => normalizar(caso.destino) === normalizar(destino));
    if (delDestino.length >= minCasos) return { criterio: CRITERIO.TIPO_Y_DESTINO, similares: delDestino };
  }
  return { criterio: CRITERIO.TIPO, similares: delTipo };
}

// Lo que se sabe de los servicios similares.
//   casos: [{ origen, referencia, tipoServicio, destino, cerradoEn, ventaSoles, costoParametrico, costoEstimado,
//             costoReal, margenReal, entradas? }] (números como números, null si no hay dato)
function calcularAnaloga(casos, { tipoServicio, destino, minCasos }) {
  const { criterio, similares } = seleccionarSimilares(casos, tipoServicio, destino, minCasos);
  const n = similares.length;
  const suficiente = n >= minCasos;

  const conDesviacion = similares.filter(sirveParaDesviacion);
  const relativas = conDesviacion.map(caso => ((caso.costoReal - baseDeEstimacion(caso)) / baseDeEstimacion(caso)) * 100);
  const absolutas = conDesviacion.map(caso => caso.costoReal - baseDeEstimacion(caso));
  const margenes = conDesviacion
    .filter(caso => esNumero(caso.margenReal) && esNumero(caso.ventaSoles) && caso.ventaSoles > 0)
    .map(caso => caso.margenReal - calcularMargen(caso.ventaSoles, baseDeEstimacion(caso)));
  const sugerible = suficiente && conDesviacion.length >= minCasos;

  let motivo = '';
  if (normalizar(tipoServicio) === '') motivo = 'La cotización no tiene tipo de servicio: no hay con qué compararla.';
  else if (n === 0) motivo = 'Todavía no hay servicios cerrados de este tipo.';
  else if (!suficiente) motivo = `Hay ${n} servicio${n === 1 ? '' : 's'} similar${n === 1 ? '' : 'es'} y se necesitan al menos ${minCasos}.`;
  else if (!sugerible) {
    motivo = `Solo ${conDesviacion.length} de ${n} servicios traen el costo con el que se estimaron: se necesitan ${minCasos} para medir la desviación.`;
  }

  const recientes = [...similares]
    .sort((a, b) => texto(b.cerradoEn).localeCompare(texto(a.cerradoEn)))
    .slice(0, CASOS_RECIENTES)
    .map(caso => ({
      origen: caso.origen,
      referencia: caso.referencia,
      tipoServicio: caso.tipoServicio,
      destino: caso.destino,
      cerradoEn: caso.cerradoEn,
      ventaSoles: caso.ventaSoles,
      costoReal: caso.costoReal,
      margenReal: caso.margenReal,
      entradas: caso.entradas ?? null,
    }));

  return {
    tipoServicio: texto(tipoServicio),
    destino: texto(destino),
    minCasos,
    criterio,
    n,
    suficiente,
    // Con pocos servicios el promedio no dice nada: no se muestra
    costoReal: suficiente ? estadisticas(similares.filter(c => esNumero(c.costoReal)).map(c => c.costoReal)) : estadisticas([]),
    margenReal: suficiente ? estadisticas(similares.filter(c => esNumero(c.margenReal)).map(c => c.margenReal)) : estadisticas([]),
    desviacion: {
      casos: conDesviacion.length,
      relativaPromedio: suficiente ? promedio(relativas) : null,
      costoPromedio: suficiente ? promedio(absolutas) : null,
      margenPromedio: suficiente ? promedio(margenes) : null,
    },
    sugerible,
    motivo,
    recientes,
  };
}

// Costo ajustado sugerido: el paramétrico corregido con la desviación histórica. null si no hay datos suficientes.
function sugerir(analoga, { costoParametrico, ventaSoles }) {
  if (!analoga?.sugerible || !(costoParametrico > 0)) return null;

  const factor = analoga.desviacion.relativaPromedio;
  const costo = redondear(costoParametrico * (1 + factor / 100));
  return {
    costo,
    margen: ventaSoles > 0 ? calcularMargen(ventaSoles, costo) : null,
    casos: analoga.desviacion.casos,
    desviacionPorcentaje: factor,
  };
}

module.exports = { CRITERIO, CASOS_RECIENTES, normalizar, seleccionarSimilares, calcularAnaloga, sugerir };
