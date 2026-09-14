const bcrypt = require("bcryptjs");
const db = require("./db");

async function inicializarBase() {
  try {
    console.log("");
    console.log("Inicializando base de datos La Torre...");

    // =========================================================
    // 1. UBICACIONES
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS ubicaciones (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        tipo VARCHAR(30) NOT NULL
          CHECK (tipo IN ('local', 'deposito')),
        sucursal VARCHAR(30),
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 2. USUARIOS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        nombre VARCHAR(150) NOT NULL,
        rol VARCHAR(30) NOT NULL
          CHECK (rol IN ('dueno', 'empleado')),
        ubicacion_id INTEGER REFERENCES ubicaciones(id),
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 3. CATEGORÍAS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 4. MARCAS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS marcas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 4B. PROVEEDORES
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 5. PRODUCTOS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,

        codigo_interno VARCHAR(100) UNIQUE,
        codigo_barras VARCHAR(150) UNIQUE,

        descripcion VARCHAR(250) NOT NULL,

        categoria_id INTEGER REFERENCES categorias(id),
        marca_id INTEGER REFERENCES marcas(id),
        proveedor_id INTEGER REFERENCES proveedores(id),

        precio_compra NUMERIC(14,2) NOT NULL DEFAULT 0,
        precio_efectivo NUMERIC(14,2) NOT NULL DEFAULT 0,
        precio_tarjeta NUMERIC(14,2) NOT NULL DEFAULT 0,

        stock_minimo NUMERIC(14,3) NOT NULL DEFAULT 0,

        ubicacion_deposito VARCHAR(150),

        observaciones TEXT,

        activo BOOLEAN NOT NULL DEFAULT TRUE,

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 6. STOCK POR UBICACIÓN
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS stock (
        id SERIAL PRIMARY KEY,

        producto_id INTEGER NOT NULL
          REFERENCES productos(id)
          ON DELETE CASCADE,

        ubicacion_id INTEGER NOT NULL
          REFERENCES ubicaciones(id)
          ON DELETE CASCADE,

        cantidad NUMERIC(14,3) NOT NULL DEFAULT 0,

        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

        UNIQUE(producto_id, ubicacion_id)
      );
    `);

    // =========================================================
    // 7. MOVIMIENTOS DE STOCK
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS movimientos_stock (
        id BIGSERIAL PRIMARY KEY,

        producto_id INTEGER NOT NULL
          REFERENCES productos(id),

        ubicacion_id INTEGER NOT NULL
          REFERENCES ubicaciones(id),

        tipo VARCHAR(50) NOT NULL
          CHECK (
            tipo IN (
              'venta',
              'transferencia_entrada',
              'transferencia_salida',
              'ingreso_mercaderia',
              'ajuste_positivo',
              'ajuste_negativo',
              'devolucion',
              'anulacion_venta'
            )
          ),

        cantidad NUMERIC(14,3) NOT NULL,

        stock_anterior NUMERIC(14,3) NOT NULL,
        stock_nuevo NUMERIC(14,3) NOT NULL,

        referencia_tipo VARCHAR(50),
        referencia_id BIGINT,

        observaciones TEXT,

        usuario_id INTEGER REFERENCES usuarios(id),

        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 8. FORMAS DE PAGO
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS formas_pago (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        tipo VARCHAR(50) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 9. TARJETAS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS tarjetas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(120) NOT NULL UNIQUE,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 10. CUOTAS POR TARJETA
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS cuotas_tarjeta (
        id SERIAL PRIMARY KEY,

        tarjeta_id INTEGER NOT NULL
          REFERENCES tarjetas(id)
          ON DELETE CASCADE,

        cuotas INTEGER NOT NULL,

        recargo_porcentaje NUMERIC(8,2)
          NOT NULL DEFAULT 0,

        activo BOOLEAN NOT NULL DEFAULT TRUE,

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),

        UNIQUE(tarjeta_id, cuotas)
      );
    `);


    // =========================================================
    // 10B. CAJAS
    // =========================================================
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS cajas (
        id BIGSERIAL PRIMARY KEY,
        ubicacion_id INTEGER NOT NULL REFERENCES ubicaciones(id),
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        apertura_at TIMESTAMP NOT NULL DEFAULT NOW(),
        cierre_at TIMESTAMP,
        monto_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
        efectivo_esperado NUMERIC(14,2),
        efectivo_contado NUMERIC(14,2),
        diferencia NUMERIC(14,2),
        estado VARCHAR(20) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
        observaciones_apertura TEXT,
        observaciones_cierre TEXT
      );
    `);
    await db.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_abierta_usuario ON cajas(usuario_id) WHERE estado='abierta';`);

    // =========================================================
    // 11. VENTAS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS ventas (
        id BIGSERIAL PRIMARY KEY,

        numero BIGINT UNIQUE,

        ubicacion_id INTEGER NOT NULL
          REFERENCES ubicaciones(id),

        usuario_id INTEGER NOT NULL
          REFERENCES usuarios(id),

        cliente_nombre VARCHAR(200),
        cliente_documento VARCHAR(100),
        cliente_telefono VARCHAR(100),

        subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
        descuento NUMERIC(14,2) NOT NULL DEFAULT 0,
        recargo NUMERIC(14,2) NOT NULL DEFAULT 0,
        flete NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0,

        forma_pago_id INTEGER REFERENCES formas_pago(id),

        tarjeta_id INTEGER REFERENCES tarjetas(id),
        cuotas INTEGER,
        porcentaje_recargo NUMERIC(8,2),

        estado VARCHAR(30)
          NOT NULL DEFAULT 'confirmada'
          CHECK (
            estado IN (
              'confirmada',
              'anulada'
            )
          ),

        observaciones TEXT,

        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 12. ITEMS DE VENTA
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS venta_items (
        id BIGSERIAL PRIMARY KEY,

        venta_id BIGINT NOT NULL
          REFERENCES ventas(id)
          ON DELETE CASCADE,

        producto_id INTEGER NOT NULL
          REFERENCES productos(id),

        descripcion VARCHAR(250) NOT NULL,

        cantidad NUMERIC(14,3) NOT NULL,

        precio_lista NUMERIC(14,2),
        precio_unitario NUMERIC(14,2) NOT NULL,

        subtotal NUMERIC(14,2) NOT NULL
      );
    `);

    // =========================================================
    // 13. TRANSFERENCIAS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS transferencias (
        id BIGSERIAL PRIMARY KEY,

        numero BIGINT UNIQUE,

        origen_id INTEGER NOT NULL
          REFERENCES ubicaciones(id),

        destino_id INTEGER NOT NULL
          REFERENCES ubicaciones(id),

        usuario_id INTEGER NOT NULL
          REFERENCES usuarios(id),

        estado VARCHAR(30)
          NOT NULL DEFAULT 'confirmada'
          CHECK (
            estado IN (
              'confirmada',
              'anulada'
            )
          ),

        observaciones TEXT,

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),

        CHECK (origen_id <> destino_id)
      );
    `);

    // =========================================================
    // 14. ITEMS DE TRANSFERENCIA
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS transferencia_items (
        id BIGSERIAL PRIMARY KEY,

        transferencia_id BIGINT NOT NULL
          REFERENCES transferencias(id)
          ON DELETE CASCADE,

        producto_id INTEGER NOT NULL
          REFERENCES productos(id),

        cantidad NUMERIC(14,3) NOT NULL
      );
    `);

    // =========================================================
    // 15. PRESUPUESTOS
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS presupuestos (
        id BIGSERIAL PRIMARY KEY,

        numero BIGINT UNIQUE,

        ubicacion_id INTEGER NOT NULL
          REFERENCES ubicaciones(id),

        usuario_id INTEGER NOT NULL
          REFERENCES usuarios(id),

        cliente_nombre VARCHAR(200),
        cliente_documento VARCHAR(100),
        cliente_telefono VARCHAR(100),

        subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
        descuento NUMERIC(14,2) NOT NULL DEFAULT 0,
        recargo NUMERIC(14,2) NOT NULL DEFAULT 0,
        total NUMERIC(14,2) NOT NULL DEFAULT 0,

        estado VARCHAR(30)
          NOT NULL DEFAULT 'activo'
          CHECK (
            estado IN (
              'activo',
              'convertido',
              'cancelado',
              'vencido'
            )
          ),

        observaciones TEXT,

        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // =========================================================
    // 16. ITEMS DE PRESUPUESTO
    // =========================================================

    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS presupuesto_items (
        id BIGSERIAL PRIMARY KEY,

        presupuesto_id BIGINT NOT NULL
          REFERENCES presupuestos(id)
          ON DELETE CASCADE,

        producto_id INTEGER
          REFERENCES productos(id),

        descripcion VARCHAR(250) NOT NULL,

        cantidad NUMERIC(14,3) NOT NULL,

        precio_unitario NUMERIC(14,2) NOT NULL,

        subtotal NUMERIC(14,2) NOT NULL
      );
    `);

    // =========================================================
    // MIGRACIONES 2026 - ESTRUCTURA REAL DE LA TORRE
    // =========================================================

    await db.pool.query(`ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS sucursal VARCHAR(30);`);
    await db.pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES proveedores(id);`);
    await db.pool.query(`ALTER TABLE ventas ADD COLUMN IF NOT EXISTS flete NUMERIC(14,2) NOT NULL DEFAULT 0;`);
    await db.pool.query(`ALTER TABLE ventas ADD COLUMN IF NOT EXISTS caja_id BIGINT REFERENCES cajas(id);`);
    await db.pool.query(`ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS precio_lista NUMERIC(14,2);`);

    // Conserva IDs y stock existentes: sólo cambia el nombre de las ubicaciones.
    await db.pool.query(`UPDATE ubicaciones SET nombre='Florida Local', sucursal='florida', tipo='local' WHERE nombre='Florida';`);
    await db.pool.query(`UPDATE ubicaciones SET nombre='Delfín Gallo Local', sucursal='delfin_gallo', tipo='local' WHERE nombre='Delfín Gallo';`);
    await db.pool.query(`UPDATE ubicaciones SET nombre='Depósito Florida', sucursal='florida', tipo='deposito' WHERE nombre='Depósito';`);
    await db.pool.query(`UPDATE ubicaciones SET sucursal='florida' WHERE nombre IN ('Florida Local','Depósito Florida');`);
    await db.pool.query(`UPDATE ubicaciones SET sucursal='delfin_gallo' WHERE nombre IN ('Delfín Gallo Local','Depósito Delfín Gallo');`);

    // =========================================================
    // ÍNDICES
    // =========================================================

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_productos_descripcion
      ON productos(descripcion);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_productos_codigo_barras
      ON productos(codigo_barras);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_productos_codigo_interno
      ON productos(codigo_interno);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_producto
      ON stock(producto_id);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_ubicacion
      ON stock(ubicacion_id);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_movimientos_producto
      ON movimientos_stock(producto_id);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion
      ON movimientos_stock(ubicacion_id);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_movimientos_fecha
      ON movimientos_stock(created_at);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ventas_fecha
      ON ventas(created_at);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ventas_ubicacion
      ON ventas(ubicacion_id);
    `);

    await db.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transferencias_fecha
      ON transferencias(created_at);
    `);

    // =========================================================
    // DATOS INICIALES
    // =========================================================

    await crearDatosIniciales();

    console.log("✓ Base de datos lista");
    console.log("");

    return true;
  } catch (error) {
    console.error("");
    console.error("✗ Error al inicializar base de datos:");
    console.error(error.message);
    console.error("");

    return false;
  }
}

async function crearDatosIniciales() {
  // =========================================================
  // UBICACIONES
  // =========================================================

  await db.pool.query(`
    INSERT INTO ubicaciones (
      nombre,
      tipo
    )
    VALUES
      ('Florida Local', 'local'),
      ('Depósito Florida', 'deposito'),
      ('Delfín Gallo Local', 'local'),
      ('Depósito Delfín Gallo', 'deposito')
    ON CONFLICT (nombre) DO NOTHING;
  `);

  await db.pool.query(`
    UPDATE ubicaciones SET sucursal='florida'
    WHERE nombre IN ('Florida Local','Depósito Florida');
    UPDATE ubicaciones SET sucursal='delfin_gallo'
    WHERE nombre IN ('Delfín Gallo Local','Depósito Delfín Gallo');
  `);

  // =========================================================
  // FORMAS DE PAGO
  // =========================================================

  await db.pool.query(`
    INSERT INTO formas_pago (
      nombre,
      tipo
    )
    VALUES
      ('Efectivo', 'efectivo'),
      ('Transferencia', 'transferencia'),
      ('Débito', 'debito'),
      ('Tarjeta', 'tarjeta'),
      ('Mixto', 'mixto')
    ON CONFLICT (nombre) DO NOTHING;
  `);

  // =========================================================
  // BUSCAR SUCURSALES
  // =========================================================

  const floridaResultado = await db.pool.query(`
    SELECT id
    FROM ubicaciones
    WHERE nombre = 'Florida Local'
    LIMIT 1;
  `);

  const delfinResultado = await db.pool.query(`
    SELECT id
    FROM ubicaciones
    WHERE nombre = 'Delfín Gallo Local'
    LIMIT 1;
  `);

  const floridaId = floridaResultado.rows[0].id;
  const delfinId = delfinResultado.rows[0].id;

  // =========================================================
  // USUARIO DUEÑO
  // =========================================================

  const adminExiste = await db.pool.query(
    `
      SELECT id
      FROM usuarios
      WHERE username = $1
      LIMIT 1;
    `,
    ["admin"]
  );

  if (adminExiste.rows.length === 0) {
    const passwordHash = await bcrypt.hash(
      "admin123",
      12
    );

    await db.pool.query(
      `
        INSERT INTO usuarios (
          username,
          password_hash,
          nombre,
          rol,
          ubicacion_id
        )
        VALUES ($1, $2, $3, $4, $5);
      `,
      [
        "admin",
        passwordHash,
        "Dueño La Torre",
        "dueno",
        null
      ]
    );
  }

  // =========================================================
  // USUARIO FLORIDA
  // =========================================================

  const floridaExiste = await db.pool.query(
    `
      SELECT id
      FROM usuarios
      WHERE username = $1
      LIMIT 1;
    `,
    ["florida"]
  );

  if (floridaExiste.rows.length === 0) {
    const passwordHash = await bcrypt.hash(
      "florida123",
      12
    );

    await db.pool.query(
      `
        INSERT INTO usuarios (
          username,
          password_hash,
          nombre,
          rol,
          ubicacion_id
        )
        VALUES ($1, $2, $3, $4, $5);
      `,
      [
        "florida",
        passwordHash,
        "Empleado Florida",
        "empleado",
        floridaId
      ]
    );
  }

  // =========================================================
  // USUARIO DELFÍN GALLO
  // =========================================================

  const delfinExiste = await db.pool.query(
    `
      SELECT id
      FROM usuarios
      WHERE username = $1
      LIMIT 1;
    `,
    ["delfin"]
  );

  if (delfinExiste.rows.length === 0) {
    const passwordHash = await bcrypt.hash(
      "delfin123",
      12
    );

    await db.pool.query(
      `
        INSERT INTO usuarios (
          username,
          password_hash,
          nombre,
          rol,
          ubicacion_id
        )
        VALUES ($1, $2, $3, $4, $5);
      `,
      [
        "delfin",
        passwordHash,
        "Empleado Delfín Gallo",
        "empleado",
        delfinId
      ]
    );
  }

  console.log("✓ Datos iniciales cargados");
}

module.exports = {
  inicializarBase,
};