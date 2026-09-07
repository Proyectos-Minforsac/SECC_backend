const { conectar } = require('../services/sheetsService');

async function createItem({tipo, nombre, descripcion, precioUnitario}) {
  console.log('Modelo creando ítem: ', {tipo, nombre, descripcion, precioUnitario});

  const doc = await conectar();
  const hoja = doc.sheetsByTitle['items'];

  const filas = await hoja.getRows();
  const ids = filas
    .map(f => parseInt(f.get('itemId'), 10))
    .filter(n => Number.isInteger(n));
  const itemId = (ids.length ? Math.max(...ids) : 0) + 1;

  const nuevaFila = await hoja.addRow({
    itemId,
    tipo,
    nombre,
    descripcion,
    precioUnitario,
  });

  const itemCreado = nuevaFila.toObject();
  console.log('Item creado: ', itemCreado);
  return itemCreado;
}

module.exports = {
  createItem,
};