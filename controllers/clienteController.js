const clienteModel = require('../models/clienteModel');

async function getClientes(req, res) {
  console.log('Controlador: llegando a GET /clientes');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const search = req.query.search || "";

    const resultado = await clienteModel.getAllClientes(
      page,
      limit,
      search
    );

    res.status(200).json(resultado);
  } catch (error) {
    console.error('Controlador: error al obtener clientes', error);
    res.status(500).json(
      {
        message: 'Error al obtener los clientes',
        error: error.message,
      }
    );
  }
}

async function createCliente(req, res) {
  console.log('Controlador: llegando a POST /clientes');
  console.log('Body recibido:', req.body);
  try {
    const { nombre, direccion, ruc, correo_electronico, tipo_persona } = req.body;

    if (!nombre || !direccion || !ruc || !correo_electronico || !tipo_persona) {
      console.log('Controlador: faltan campos en la petición');
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }

    if (nombre.length > 256) {
      return res.status(400).json({
        message: "El nombre excede el tamaño permitido"
      });
    }

    if (direccion.length > 512) {
      return res.status(400).json({
        message: "La dirección excede el tamaño permitido"
      });
    }

    if (ruc.length != 11) {
      return res.status(400).json({
        message: "El R.U.C no tiene la cantidad requerida"
      });
    }

    if (correo_electronico.length > 256) {
      return res.status(400).json({
        message: "El correo electrónico excede el tamaño permitido"
      });
    }

    const nuevoCliente = await clienteModel.createCliente({
      nombre,
      direccion,
      ruc,
      correo_electronico,
      tipo_persona,
    });

    console.log('Controlador: cliente creado correctamente');
    res.status(201).json(nuevoCliente);
  } catch (error) {
    console.error('Controlador: error al crear cliente', error);
    res.status(500).json({ message: 'Error al crear el cliente', error: error.message });
  }
}

async function updateCliente(req, res) {
  console.log('Controlador: PUT /clientes');

  try {
    const { id } = req.params;
    const { nombre, direccion, ruc, correo_electronico, tipo_persona } = req.body;

    if (!nombre || !direccion || !ruc || !correo_electronico || !tipo_persona) {
      return res.status(400).json({
        message: 'Todos los campos son obligatorios'
      });
    }

    const clienteActualizado = await clienteModel.updateCliente(id, {
      nombre,
      direccion,
      ruc,
      correo_electronico,
      tipo_persona
    });

    if (!clienteActualizado) {
      return res.status(404).json({
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json(clienteActualizado);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Error al actualizar cliente',
      error: error.message
    });
  }
}

async function deleteCliente(req, res) {
  console.log('Controlador: DELETE /clientes');

  try {
    const { id } = req.params;

    const clienteEliminado = await clienteModel.deleteCliente(id);

    if (!clienteEliminado) {
      return res.status(404).json({
        message: 'Cliente no encontrado'
      });
    }

    res.status(200).json({
      message: 'Cliente eliminado correctamente'
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Error al eliminar cliente',
      error: error.message
    });
  }
}

module.exports = {
  getClientes,
  createCliente,
  updateCliente,
  deleteCliente,
};
