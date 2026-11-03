const usuarioModel = require('../models/usuarioModel');

async function login(req, res) {
  console.log('Controlador: llegando a POST /login');

  try {
    const { nombre, contrasena } = req.body || {};

    if (!nombre || !contrasena) {
      return res.status(400).json({ message: 'Ingrese usuario y contraseña' });
    }

    const usuario = await usuarioModel.buscarUsuario(nombre, contrasena);

    if (!usuario) {
      return res.status(401).json({ message: 'Usuario o contraseña incorrectos' });
    }

    const rol = usuarioModel.normalizarRol(usuario.rol);
    if (!rol) {
      console.error('Controlador: rol no reconocido en la hoja usuarios:', usuario.rol);
      return res.status(403).json({ message: 'El usuario no tiene un rol válido' });
    }

    res.status(200).json({ usuarioId: usuario.usuarioId, nombre: usuario.nombre, rol });
  } catch (error) {
    console.error('Controlador: error al iniciar sesión', error);
    res.status(500).json({ message: 'Error al iniciar sesión', error: error.message });
  }
}

module.exports = { login };
