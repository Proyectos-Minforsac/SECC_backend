// Control de acceso por rol. El navegador manda "Authorization: Usuario <usuarioId>" con el id que devolvió el
// inicio de sesión. No es un token: identifica al usuario pero no lo prueba, así que es un control suave
// (impide el uso accidental, no un ataque). Los tokens firmados quedan como mejora futura.

// "Usuario 12" -> 12; cualquier otra cosa -> null.
function leerUsuarioId(req) {
  const coincidencia = String(req.headers?.authorization ?? '').match(/^Usuario\s+(\d+)$/i);
  return coincidencia ? Number(coincidencia[1]) : null;
}

// `buscarUsuarioPorId` se recibe como parámetro para poder probar el control sin tocar el Excel.
function crearExigirRol(buscarUsuarioPorId) {
  return (...rolesPermitidos) => async (req, res, next) => {
    try {
      const usuarioId = leerUsuarioId(req);
      const usuario = usuarioId && await buscarUsuarioPorId(usuarioId);
      if (!usuario) return res.status(401).json({ message: 'Inicia sesión para continuar' });

      if (!rolesPermitidos.includes(usuario.rol)) {
        return res.status(403).json({ message: 'No tienes permiso para esta acción' });
      }

      req.usuario = usuario;
      next();
    } catch (error) {
      console.error('Autorización: no se pudo verificar al usuario', error);
      res.status(500).json({ message: 'No se pudo verificar al usuario', error: error.message });
    }
  };
}

// El modelo se carga recién al verificar, para que importar este archivo no abra la conexión al Excel.
const exigirRol = crearExigirRol(usuarioId => require('../models/usuarioModel').buscarUsuarioPorId(usuarioId));

module.exports = { leerUsuarioId, crearExigirRol, exigirRol };
