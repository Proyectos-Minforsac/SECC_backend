const { conectar } = require('../services/sheetsService');

async function getAllClientes(page, limit, search) {
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['clientes'];
  const filas = await hoja.getRows();
  const clientes = filas
                    .map(f => f.toObject())
                    .sort((a, b) => b.clienteId - a.clienteId);

  const busqueda = (search || '').trim().toLowerCase();
  const filtrados = busqueda
    ? clientes.filter(c => (c.nombre || '').toLowerCase().includes(busqueda))
    : clientes;

  const total = filtrados.length;
  const offset = (page - 1) * limit;
  const paginados = filtrados.slice(offset, offset + limit);

  return {
    clientes: paginados,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

async function getClienteById(clienteId) {
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['clientes'];
  const filas = await hoja.getRows();
  const fila = filas.find(f => f.get('clienteId') === clienteId);

  return fila ? fila.toObject() : null;
}

async function createCliente({ nombre, direccion, correoElectronico, tipoPersona, ruc }) {
  console.log('Modelo creando cliente:', { nombre, direccion, correoElectronico, tipoPersona, ruc });

  const doc = await conectar();
  const hoja = doc.sheetsByTitle['clientes'];

  const filas = await hoja.getRows();
  const ids = filas
    .map(f => parseInt(f.get('clienteId'), 10))
    .filter(n => Number.isInteger(n));
  const clienteId = (ids.length ? Math.max(...ids) : 0) + 1;

  const nuevaFila = await hoja.addRow({
    clienteId,
    nombre,
    direccion,
    correoElectronico,
    tipoPersona,
    ruc,
  });

  const clienteCreado = nuevaFila.toObject();
  console.log('Cliente creado: ', clienteCreado);
  return clienteCreado;
}

async function updateCliente(clienteId, {nombre, direccion, correoElectronico, tipoPersona, ruc}) {
  console.log('Modelo actualizando cliente', clienteId);

  const doc = await conectar();
  const hoja = doc.sheetsByTitle['clientes'];

  const filas = await hoja.getRows();
  const fila = filas.find(f => f.get('clienteId') === clienteId);

  if (!fila) {
    console.log('Modelo: Cliente no encontrado', clienteId);
    return null;
  }

  fila.set('nombre', nombre);
  fila.set('direccion', direccion);
  fila.set('correoElectronico', correoElectronico);
  fila.set('tipoPersona', tipoPersona);
  fila.set('ruc', ruc);

  await fila.save();

  const clienteActualizado = fila.toObject();
  console.log('Cliente actualizado', clienteActualizado);
  return clienteActualizado;
}

async function deleteCliente(clienteId) {
  console.log('Eliminando cliente', clienteId);
  
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['clientes'];

  const filas = await hoja.getRows();
  const fila = filas.find(f => f.get('clienteId') === clienteId);

  if (!fila) {
    console.log('Modelo: Cliente no encontrado', clienteId);
    return null;
  }
  
  await fila.delete();

  console.log('Cliente eliminado', clienteId);
  return { clienteId };
}

module.exports = {
  getAllClientes,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
};