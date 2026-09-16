const tecnicoModel = require('../models/tecnicoModel');

// Valida y normaliza los precios de aire. Devuelve { error } o { precios }.
// Un precio en 0 no se registra: solo se conservan los mayores a 0.
function normalizarPreciosAire(servicio, precios) {
  if (servicio !== 'Aire Condicionado') {
    return { precios: [] };
  }

  const entrada = Array.isArray(precios) ? precios : [];

  const invalido = entrada.some(
    p => !p.tipoAire || Number.isNaN(Number(p.precio)) || Number(p.precio) < 0
  );
  if (invalido) {
    return { error: 'Los precios de aire condicionado no son válidos' };
  }

  const normalizados = entrada
    .map(p => ({ tipoAire: p.tipoAire, precio: Number(p.precio) }))
    .filter(p => p.precio > 0);

  if (normalizados.length === 0) {
    return { error: 'Debe indicar al menos un precio de aire condicionado mayor a 0' };
  }

  return { precios: normalizados };
}

function validarCamposTecnico({ nombre, tipoDocumento, numeroDocumento, telefono, ubicacion, servicio, area, calificacion }) {
  if (!nombre || !tipoDocumento || !numeroDocumento || !telefono || !ubicacion || !servicio || !area || !calificacion) {
    return 'Todos los campos son obligatorios';
  }
  if (nombre.length > 256) return 'El nombre excede el tamaño permitido';
  if (ubicacion.length > 256) return 'La ubicación excede el tamaño permitido';
  if (String(telefono).length !== 9) return 'El teléfono debe tener 9 dígitos';
  return null;
}

async function getTecnicos(req, res) {
  console.log('Controlador: llegando a GET /tecnicos');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const search = req.query.search || "";
    const ubicacion = req.query.ubicacion || "";

    const resultado = await tecnicoModel.getAllTecnicos(
      page,
      limit,
      search,
      ubicacion
    );

    res.status(200).json(resultado);
  } catch (error) {
    console.error('Controlador: error al obtener técnicos', error);
    res.status(500).json(
      {
        message: 'Error al obtener los técnicos',
        error: error.message,
      }
    );
  }
}

async function createTecnico(req, res) {
  console.log('Controlador: llegando a POST /tecnicos');
  console.log('Body recibido:', req.body);

  try {
    const {
      nombre, tipoDocumento, numeroDocumento, telefono,
      ubicacion, servicio, area, calificacion, precios,
    } = req.body;

    const errorCampos = validarCamposTecnico({
      nombre, tipoDocumento, numeroDocumento, telefono, ubicacion, servicio, area, calificacion,
    });
    if (errorCampos) {
      console.log('Controlador: datos inválidos en la petición');
      return res.status(400).json({ message: errorCampos });
    }

    const { error: errorPrecios, precios: preciosNormalizados } = normalizarPreciosAire(servicio, precios);
    if (errorPrecios) {
      return res.status(400).json({ message: errorPrecios });
    }

    const nuevoTecnico = await tecnicoModel.createTecnico({
      nombre,
      tipoDocumento,
      numeroDocumento,
      telefono,
      ubicacion,
      servicio,
      area,
      calificacion,
      precios: preciosNormalizados,
    });

    console.log('Controlador: técnico creado correctamente');
    res.status(201).json(nuevoTecnico);
  } catch (error) {
    console.error('Controlador: error al crear técnico', error);
    res.status(500).json({ message: 'Error al crear el técnico', error: error.message });
  }
}

async function updateTecnico(req, res) {
  console.log('Controlador: PUT /tecnicos');

  try {
    const { id } = req.params;
    const {
      nombre, tipoDocumento, numeroDocumento, telefono,
      ubicacion, servicio, area, calificacion, precios,
    } = req.body;

    const errorCampos = validarCamposTecnico({
      nombre, tipoDocumento, numeroDocumento, telefono, ubicacion, servicio, area, calificacion,
    });
    if (errorCampos) {
      return res.status(400).json({ message: errorCampos });
    }

    const { error: errorPrecios, precios: preciosNormalizados } = normalizarPreciosAire(servicio, precios);
    if (errorPrecios) {
      return res.status(400).json({ message: errorPrecios });
    }

    const tecnicoActualizado = await tecnicoModel.updateTecnico(id, {
      nombre,
      tipoDocumento,
      numeroDocumento,
      telefono,
      ubicacion,
      servicio,
      area,
      calificacion,
      precios: preciosNormalizados,
    });

    if (!tecnicoActualizado) {
      return res.status(404).json({ message: 'Técnico no encontrado' });
    }

    res.status(200).json(tecnicoActualizado);
  } catch (error){
    console.error(error);
    res.status(500).json({
      message: 'Error al actualizar técnico',
      error: error.message
    });
  }
}

async function deleteTecnico(req, res) {
  console.log('Controlador: DELETE /tecnicos');

  try {
    const { id } = req.params;

    const tecnicoEliminado = await tecnicoModel.deleteTecnico(id);

    if (!tecnicoEliminado) {
      return res.status(404).json({ message: 'Técnico no encontrado' });
    }

    res.status(200).json({ message: 'Técnico eliminado correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Error al eliminar técnico',
      error: error.message
    });
  }
}


module.exports = {
  getTecnicos,
  createTecnico,
  updateTecnico,
  deleteTecnico,
};
