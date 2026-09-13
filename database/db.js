const { Pool } = require("pg");

// =====================================
// CONFIGURACIÓN POSTGRESQL
// =====================================

const esProduccion =
  process.env.NODE_ENV === "production";

const tieneDatabaseUrl =
  Boolean(process.env.DATABASE_URL);

let configuracion;

// =====================================
// PRODUCCIÓN / BASE ONLINE
// =====================================

if (tieneDatabaseUrl) {
  configuracion = {
    connectionString:
      process.env.DATABASE_URL,

    ssl: esProduccion
      ? {
          rejectUnauthorized: false,
        }
      : false,

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000,
  };
}

// =====================================
// DESARROLLO / POSTGRESQL LOCAL
// =====================================

else {
  configuracion = {
    host:
      process.env.DB_HOST ||
      "localhost",

    port:
      Number(
        process.env.DB_PORT ||
        5432
      ),

    database:
      process.env.DB_NAME,

    user:
      process.env.DB_USER,

    password:
      process.env.DB_PASSWORD,

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000,
  };
}

// =====================================
// POOL
// =====================================

const pool =
  new Pool(configuracion);

// =====================================
// ERRORES INESPERADOS DEL POOL
// =====================================

pool.on(
  "error",
  (error) => {
    console.error(
      "✗ Error inesperado en PostgreSQL:"
    );

    console.error(
      error.message
    );
  }
);

// =====================================
// PROBAR CONEXIÓN
// =====================================

async function probarConexion() {
  try {
    const resultado =
      await pool.query(`
        SELECT
          NOW() AS fecha,
          current_database() AS base;
      `);

    console.log(
      "✓ PostgreSQL conectado correctamente"
    );

    console.log(
      "Base:",
      resultado.rows[0].base
    );

    console.log(
      "Fecha de la base:",
      resultado.rows[0].fecha
    );

    console.log(
      "Modo:",
      tieneDatabaseUrl
        ? "Base online"
        : "Base local"
    );

    return true;
  } catch (error) {
    console.error(
      "✗ Error al conectar con PostgreSQL"
    );

    console.error(
      error.message
    );

    return false;
  }
}

// =====================================
// CERRAR CONEXIONES
// =====================================

async function cerrarConexion() {
  try {
    await pool.end();

    console.log(
      "✓ Conexiones PostgreSQL cerradas"
    );
  } catch (error) {
    console.error(
      "✗ Error cerrando PostgreSQL:"
    );

    console.error(
      error.message
    );
  }
}

// =====================================
// EXPORTAR
// =====================================

module.exports = {
  pool,
  probarConexion,
  cerrarConexion,
};