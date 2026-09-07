const { conectar } = require('../services/sheetsService');

async function createCotizacion({clienteId, numeroCotizacion, fecha, solicitante, moneda = 'SOLES', estado}) {
  console.log('Modelo creando ítem: ', {clienteId, numeroCotizacion, fecha, solicitante, moneda, estado});

  const doc = await conectar();
  const hoja = doc.sheetsByTitle['cotizaciones'];

  const filas = await hoja.getRows();
  const ids = filas
    .map(f => parseInt(f.get('cotizacionId'), 10))
    .filter(n => Number.isInteger(n));
  const cotizacionId = (ids.length ? Math.max(...ids) : 0) + 1;

  const nuevaFila = await hoja.addRow({
    cotizacionId,
    clienteId,
    numeroCotizacion,
    fecha,
    solicitante,
    moneda,
    estado,
  });

  const cotizacionCreada = nuevaFila.toObject();
  console.log('Cotización creada: ', cotizacionCreada);
  return cotizacionCreada;
}

module.exports = {
  createCotizacion,
};