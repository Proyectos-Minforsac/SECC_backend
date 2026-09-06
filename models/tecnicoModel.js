const { conectar } = require('../services/sheetsService');
const { v4: uuidv4 } = require('uuid');

async function getAllTecnicos(page, limit, search) {
  const doc = await conectar();
  const hojaTecnicos = doc.sheetsByTitle['tecnicos'];
  const hojaPrecios = doc.sheetsByTitle['preciosAire'];

  const [filasTecnicos, filasPrecios] = await Promise.all([
    hojaTecnicos.getRows(),
    hojaPrecios.getRows(),
  ]);

  const tecnicos = filasTecnicos
                    .map(f => f.toObject())
                    .sort((a, b) => b.tecnicoId - a.tecnicoId);
  const precios = filasPrecios.map(f => ({
    ...f.toObject(),
    precio: Number(f.get('precio')),
  }));

  const preciosPorTecnico = precios.reduce((acc, p) => {
    if (!acc[p.tecnicoId]) acc[p.tecnicoId] = [];
    acc[p.tecnicoId].push(p);
    return acc;
  }, {});

  const busqueda = (search || '').trim().toLowerCase();
  const filtrados = busqueda
    ? tecnicos.filter(c => (c.nombre || '').toLowerCase().includes(busqueda))
    : tecnicos;

  const total = filtrados.length;
  const offset = (page - 1) * limit;
  const paginados = filtrados.slice(offset, offset + limit);

  const tecnicosConPrecios = paginados.map(t => ({
    ...t,
    precios: (preciosPorTecnico[t.tecnicoId] || []).sort((a, b) => (a.tipoAire || '').localeCompare(b.tipoAire || '')
    ),
  }));

  return {
    tecnicos: tecnicosConPrecios,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  }
}

async function createTecnico({ nombre, tipoDocumento, numeroDocumento, telefono, ubicacion, servicio, area, calificacion, precios = [] }) {
  console.log('Modelo: creando técnico: ', {
    nombre, tipoDocumento, numeroDocumento, telefono, ubicacion, servicio, area, calificacion, precios
  });

  const doc = await conectar();
  const hojaTecnicos = doc.sheetsByTitle['tecnicos'];
  const hojaPrecios = doc.sheetsByTitle['preciosAire'];

  const [filasTecnicos, filasPrecios] = await Promise.all([
    hojaTecnicos.getRows(),
    hojaPrecios.getRows(),
  ]);

  const idsTecnicos = filasTecnicos
    .map(f => parseInt(f.get('tecnicoId'), 10))
    .filter(n => Number.isInteger(n));
  const tecnicoId = (idsTecnicos.length ? Math.max(...idsTecnicos) : 0) + 1;

  const idsPrecios = filasPrecios
    .map(f => parseInt(f.get('precioAireId'), 10))
    .filter(n => Number.isInteger(n));
  let siguientePrecioId = (idsPrecios.length ? Math.max(...idsPrecios) : 0) + 1;

  const nuevaFilaTecnico = await hojaTecnicos.addRow({
    tecnicoId,
    nombre,
    tipoDocumento,
    numeroDocumento,
    telefono,
    ubicacion,
    servicio,
    area,
    calificacion,
  });

  const preciosCreados = [];
  for (const { tipoAire, precio } of precios) {
    const precioAireId = siguientePrecioId++;
    await hojaPrecios.addRow({
      precioAireId,
      tecnicoId,
      tipoAire,
      precio,
    });
    preciosCreados.push({ precioAireId, tecnicoId, tipoAire, precio: Number(precio) });
  }

  const tecnicoCreado = {
    ...nuevaFilaTecnico.toObject(),
    precios: preciosCreados,
  };
  console.log('Técnico creado: ', tecnicoCreado);
  return tecnicoCreado;
}

async function updateTecnico(tecnicoId, {
  nombre, tipoDocumento, numeroDocumento, telefono, ubicacion, servicio, area, calificacion, precios = [] }) {
  console.log('Modelo actualizando técnico', tecnicoId);

  const doc = await conectar();
  const hojaTecnicos = doc.sheetsByTitle['tecnicos'];
  const hojaPrecios = doc.sheetsByTitle['preciosAire'];

  const [filasTecnicos, filasPrecios] = await Promise.all([
    hojaTecnicos.getRows(),
    hojaPrecios.getRows(),
  ]);

  const fila = filasTecnicos.find(f => String(f.get('tecnicoId')) === String(tecnicoId));

  if (!fila) {
    console.log('Modelo: Técnico no encontrado', tecnicoId);
    return null;
  }

  fila.set('nombre', nombre);
  fila.set('tipoDocumento', tipoDocumento);
  fila.set('numeroDocumento', numeroDocumento);
  fila.set('telefono', telefono);
  fila.set('ubicacion', ubicacion);
  fila.set('servicio', servicio);
  fila.set('area', area);
  fila.set('calificacion', calificacion);

  await fila.save();

  // Se rehacen los precios de aire: se borran los actuales y se reinsertan los nuevos (>0).
  const filasPreciosTecnico = filasPrecios
    .filter(f => String(f.get('tecnicoId')) === String(tecnicoId))
    .sort((a, b) => b.rowNumber - a.rowNumber);
  for (const f of filasPreciosTecnico) {
    await f.delete();
  }

  const idsPrecios = filasPrecios
    .map(f => parseInt(f.get('precioAireId'), 10))
    .filter(n => Number.isInteger(n));
  let siguientePrecioId = (idsPrecios.length ? Math.max(...idsPrecios) : 0) + 1;

  const preciosActualizados = [];
  for (const { tipoAire, precio } of precios) {
    const precioAireId = siguientePrecioId++;
    await hojaPrecios.addRow({ precioAireId, tecnicoId, tipoAire, precio });
    preciosActualizados.push({ precioAireId, tecnicoId, tipoAire, precio: Number(precio) });
  }

  const tecnicoActualizado = {
    ...fila.toObject(),
    precios: preciosActualizados,
  };
  console.log('Técnico actualizado', tecnicoActualizado);
  return tecnicoActualizado;
}

async function deleteTecnico(tecnicoId) {
  console.log('Modelo: eliminando técnico', tecnicoId);

  const doc = await conectar();
  const hojaTecnicos = doc.sheetsByTitle['tecnicos'];
  const hojaPrecios = doc.sheetsByTitle['preciosAire'];

  const [filasTecnicos, filasPrecios] = await Promise.all([
    hojaTecnicos.getRows(),
    hojaPrecios.getRows(),
  ]);

  const fila = filasTecnicos.find(f => String(f.get('tecnicoId')) === String(tecnicoId));

  if (!fila) {
    console.log('Modelo: Técnico no encontrado', tecnicoId);
    return null;
  }

  // Se eliminan en cascada los precios de aire del técnico (de abajo hacia arriba
  // para que no se corran los índices de fila).
  const filasPreciosTecnico = filasPrecios
    .filter(f => String(f.get('tecnicoId')) === String(tecnicoId))
    .sort((a, b) => b.rowNumber - a.rowNumber);
  for (const f of filasPreciosTecnico) {
    await f.delete();
  }

  await fila.delete();

  console.log('Técnico eliminado', tecnicoId);
  return { tecnicoId };
}

module.exports = {
  getAllTecnicos,
  createTecnico,
  updateTecnico,
  deleteTecnico,
};
