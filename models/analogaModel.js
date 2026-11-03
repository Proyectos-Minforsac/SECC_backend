const { texto } = require('../services/hojasUtils');
const { calcularAnaloga } = require('../services/analoga');
const resumenModel = require('./resumenModel');
const estimacionModel = require('./estimacionModel');
const parametroCostoModel = require('./parametroCostoModel');

// Los parámetros de un servicio cerrado por el sistema, tal como se estimaron en su cotización: sirven para copiarlos a otra
// parecida (HU-36). Los del histórico no los tienen.
function entradasDe(caso, vigentes) {
  if (caso.origen !== 'SISTEMA') return null;
  const primera = texto(caso.cotizaciones).split(',')[0];
  return primera ? vigentes.get(primera)?.entradas ?? null : null;
}

// Servicios parecidos a una cotización (mismo tipo y, si alcanzan, mismo destino) con sus promedios, la desviación histórica
// del cálculo paramétrico y los más recientes. El mínimo de casos lo fija el jefe.
async function getAnaloga({ tipoServicio, destino }) {
  const [casos, vigentes, valores] = await Promise.all([
    resumenModel.getCasos(),
    estimacionModel.getVigentes(),
    parametroCostoModel.getValores(),
  ]);

  return calcularAnaloga(
    casos.map(caso => ({ ...caso, entradas: entradasDe(caso, vigentes) })),
    { tipoServicio, destino, minCasos: valores.MIN_CASOS_ANALOGA }
  );
}

module.exports = { getAnaloga };
