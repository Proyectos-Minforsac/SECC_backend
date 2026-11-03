const { conectar } = require('../services/sheetsService');
const { texto, mismoId } = require('../services/hojasUtils');
const { redondear } = require('../services/calculoCostos');
const { normalizar } = require('../services/analoga');
const rentabilidad = require('../services/rentabilidad');
const parametroCostoModel = require('./parametroCostoModel');
const resumenModel = require('./resumenModel');

// Servicios cancelados porque el cliente rechazó la cotización: el diagnóstico ya se pagó y no se recuperó (HU-37).
// Cuenta lo que costó la oferta aceptada del técnico. Los filtros del tablero se aplican igual que a los servicios cerrados.
async function getCancelados({ tipoServicio, anio, origen }) {
  const vacio = { cantidad: 0, costoDiagnosticos: 0, servicios: [] };
  // Los cancelados son siempre del sistema: no existen en el histórico
  if (origen === 'HISTORICO') return vacio;

  const doc = await conectar();
  const hojas = ['visitasTecnicas', 'solicitudes', 'ofertas', 'clientes'].map(nombre => doc.sheetsByTitle[nombre]);
  if (hojas.some(hoja => !hoja)) return vacio;

  const [visitas, solicitudes, ofertas, clientes] = await Promise.all(hojas.map(hoja => hoja.getRows()));

  const servicios = visitas
    .filter(f => texto(f.get('estado')) === 'CANCELADA')
    .map(f => {
      const solicitudId = texto(f.get('solicitudId'));
      const solicitud = solicitudes.find(s => mismoId(s.get('solicitudId'), solicitudId));
      const cliente = clientes.find(c => mismoId(c.get('clienteId'), solicitud?.get('clienteId')));
      const oferta = ofertas.find(o => mismoId(o.get('solicitudId'), solicitudId) && texto(o.get('estado')) === 'ACEPTADA');
      return {
        visitaId: Number(texto(f.get('visitaId'))),
        clienteNombre: texto(cliente?.get('nombre')),
        tipoServicio: texto(solicitud?.get('tipoServicio')),
        monto: redondear(Number(texto(oferta?.get('montoVisita'))) || 0),
        motivo: texto(f.get('motivoCancelacion')),
        canceladaEn: texto(f.get('canceladaEn')),
      };
    })
    .filter(
      servicio =>
        servicio.monto > 0 &&
        (normalizar(tipoServicio) === '' || normalizar(servicio.tipoServicio) === normalizar(tipoServicio)) &&
        (texto(anio) === '' || servicio.canceladaEn.slice(0, 4) === texto(anio))
    )
    .sort((a, b) => b.canceladaEn.localeCompare(a.canceladaEn));

  return {
    cantidad: servicios.length,
    costoDiagnosticos: redondear(servicios.reduce((total, servicio) => total + servicio.monto, 0)),
    servicios,
  };
}

const distintos = valores => [...new Set(valores.filter(valor => valor !== ''))];

// Todo lo que muestra el tablero de rentabilidad con los filtros elegidos: resumen, agrupaciones, comparación de métodos,
// los servicios con su semáforo y los cancelados. Una sola respuesta, así todas las cifras corresponden al mismo corte.
async function getRentabilidad(filtros = {}) {
  const [casos, valores, cancelados] = await Promise.all([
    resumenModel.getCasos(),
    parametroCostoModel.getValores(),
    getCancelados(filtros),
  ]);

  const margenMinimo = valores.MARGEN_MINIMO ?? null;
  const tolerancia = valores.TOLERANCIA_DESVIACION ?? null;
  const filtrados = rentabilidad.filtrar(casos, filtros);

  return {
    parametros: { margenMinimo, tolerancia, minCasos: valores.MIN_CASOS_ANALOGA },
    // Lo que se puede elegir en los filtros: sale de todos los servicios, no de los ya filtrados
    filtros: {
      tipos: distintos(casos.map(caso => caso.tipoServicio)).sort(),
      anios: distintos(casos.map(rentabilidad.anioDe)).sort().reverse(),
      origenes: rentabilidad.ORIGENES.filter(origen => casos.some(caso => caso.origen === origen)),
    },
    resumen: rentabilidad.resumir(filtrados),
    porTipo: rentabilidad.agruparPor(filtrados, caso => caso.tipoServicio || 'Sin tipo'),
    porPeriodo: rentabilidad.agruparPor(filtrados, caso => rentabilidad.periodoDe(caso) || 'Sin fecha'),
    comparacion: rentabilidad.compararMetodos(filtrados, tolerancia),
    servicios: rentabilidad
      .marcarServicios(filtrados, { margenMinimo, tolerancia })
      .sort((a, b) => b.cerradoEn.localeCompare(a.cerradoEn)),
    cancelados,
  };
}

module.exports = { getRentabilidad, getCancelados };
