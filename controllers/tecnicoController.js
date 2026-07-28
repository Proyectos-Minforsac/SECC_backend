const tecnicoModel = require('../models/tecnicoModel');

async function getTecnicos(req, res) {
  console.log('Controlador: llegando a GET /tecnicos');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const search = req.query.search || "";

    const resultado = await tecnicoModel.getAllTecnicos(
      page,
      limit,
      search
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

  try{
    // Datos
  } catch (error) {
    console.error('Controlador: error al crear técnico', error);
    res.status(500).json({ message: 'Error al crear el técnico', error: error.message });
  }
}

async function updateTecnico(req, res) {
  console.log('Controlador: PUT /tecnicos');

  try {
    // Datos
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
    // Datos
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
