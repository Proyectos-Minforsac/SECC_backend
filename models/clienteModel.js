const db = require('../config/database');

async function getAllClientes(page, limit, search) {
  console.log('Modelo: solicitando todos los clientes');

  const offset = (page - 1) * limit;

  const clientes = await db.query(`
    SELECT *
    FROM "clientes"
    WHERE nombre ILIKE '%' || $3 || '%'
    ORDER BY cliente_id ASC
    LIMIT $1 OFFSET $2
  `, [limit, offset, search]);

  const total = await db.query(`
    SELECT COUNT(*) AS total
    FROM "clientes"
    WHERE nombre ILIKE '%' || $1 || '%'
  `, [search]);

  return {
    clientes: clientes.rows,
    total: Number(total.rows[0].total),
    page,
    limit,
    totalPages: Math.ceil(total.rows[0].total / limit)
  };
}

async function createCliente({ nombre, direccion, correo_electronico, tipo_persona }) {
  console.log('Modelo: creando cliente:', { nombre, direccion, correo_electronico, tipo_persona });
  const result = await db.query(
    `INSERT INTO "clientes" (nombre, direccion, correo_electronico, tipo_persona, ruc)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING cliente_id, nombre, direccion, correo_electronico, tipo_persona, ruc`,
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
         tipo_persona = $4,
         ruc = $5
     WHERE cliente_id = $6
     RETURNING cliente_id, nombre, direccion, correo_electronico, tipo_persona, ruc`,
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
