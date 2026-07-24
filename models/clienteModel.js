const db = require('../config/database');

async function getAllClientes() {
  console.log('Modelo: solicitando todos los clientes');
  const result = await db.query(
    `SELECT cliente_id, nombre, direccion, correo_electronico, tipo_persona
     FROM "clientes"
     ORDER BY cliente_id ASC`
  );

  console.log('Modelo: clientes obtenidos:', result.rows.length);
  return result.rows;
}

async function createCliente({ nombre, direccion, correo_electronico, tipo_persona }) {
  console.log('Modelo: creando cliente:', { nombre, direccion, correo_electronico, tipo_persona });
  const result = await db.query(
    `INSERT INTO "clientes" (nombre, direccion, correo_electronico, tipo_persona)
     VALUES ($1, $2, $3, $4)
     RETURNING cliente_id, nombre, direccion, correo_electronico, tipo_persona`,
    [nombre, direccion, correo_electronico, tipo_persona]
  );

  console.log('Modelo: cliente creado:', result.rows[0]);
  return result.rows[0];
}

async function updateCliente(cliente_id, { nombre, direccion, correo_electronico, tipo_persona }) {
  console.log('Modelo: actualizando cliente', cliente_id);

  const result = await db.query(
    `UPDATE "clientes"
     SET nombre = $1,
         direccion = $2,
         correo_electronico = $3,
         tipo_persona = $4
     WHERE cliente_id = $5
     RETURNING cliente_id, nombre, direccion, correo_electronico, tipo_persona`,
    [nombre, direccion, correo_electronico, tipo_persona, cliente_id]
  );

  return result.rows[0];
}

async function deleteCliente(cliente_id) {
  console.log('Modelo: eliminando cliente', cliente_id);

  const result = await db.query(
    `DELETE FROM "clientes"
     WHERE cliente_id = $1
     RETURNING cliente_id`,
    [cliente_id]
  );

  return result.rows[0];
}

module.exports = {
  getAllClientes,
  createCliente,
  updateCliente,
  deleteCliente,
};
