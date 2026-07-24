const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

console.log('Configurando conexión a la base de datos...');
console.log('DATABASE_URL presente:', Boolean(process.env.DATABASE_URL));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('No se encontró DATABASE_URL en las variables de entorno');
}

// Configuración recomendada para la librería 'pg'
const pool = new Pool({
  connectionString: connectionString,
  // Activa SSL ignorando la verificación estricta de certificados autofirmados (requerido para Supabase/Neon/Render/etc.)
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: async (text, params) => {
    console.log('Ejecutando consulta SQL:', text);
    const result = await pool.query(text, params);
    console.log('Consulta ejecutada correctamente');
    return result;
  },
  pool,
};