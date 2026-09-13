const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  requiereSucursal,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// LISTADO
// =========================================================

router.get(
  "/presupuestos",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const buscar =
        String(
          req.query.buscar || ""
        ).trim();

      const estado =
        String(
          req.query.estado || ""
        ).trim();

      const desde =
        String(
          req.query.desde || ""
        ).trim();

      const hasta =
        String(
          req.query.hasta || ""
        ).trim();

      const parametros = [];
      const condiciones = [
        "1 = 1",
      ];

      // =====================================================
      // EMPLEADO: SOLO SU SUCURSAL
      // =====================================================

      if (
        usuario.rol === "empleado"
      ) {
        parametros.push(
          Number(
            usuario.ubicacion_id
          )
        );

        condiciones.push(
          `p.ubicacion_id = $${parametros.length}`
        );
      }

      // =====================================================
      // ESTADO
      // =====================================================

      if (
        [
          "activo",
          "convertido",
          "cancelado",
          "vencido",
        ].includes(estado)
      ) {
        parametros.push(
          estado
        );

        condiciones.push(
          `p.estado = $${parametros.length}`
        );
      }

      // =====================================================
      // DESDE
      // =====================================================

      if (desde) {
        parametros.push(
          desde
        );

        condiciones.push(
          `p.created_at::date >= $${parametros.length}::date`
        );
      }

      // =====================================================
      // HASTA
      // =====================================================

      if (hasta) {
        parametros.push(
          hasta
        );

        condiciones.push(
          `p.created_at::date <= $${parametros.length}::date`
        );
      }

      // =====================================================
      // BUSCADOR
      // =====================================================

      if (buscar) {
        parametros.push(
          `%${buscar}%`
        );

        const i =
          parametros.length;

        condiciones.push(`
          (
            CAST(
              p.numero AS TEXT
            ) ILIKE $${i}

            OR COALESCE(
              p.cliente_nombre,
              ''
            ) ILIKE $${i}

            OR COALESCE(
              p.cliente_documento,
              ''
            ) ILIKE $${i}

            OR COALESCE(
              p.cliente_telefono,
              ''
            ) ILIKE $${i}

            OR u.nombre
              ILIKE $${i}

            OR us.nombre
              ILIKE $${i}
          )
        `);
      }

      // =====================================================
      // CONSULTA
      // =====================================================

      const resultado =
        await db.pool.query(
          `
            SELECT
              p.id,
              p.numero,
              p.created_at,

              p.cliente_nombre,
              p.cliente_documento,
              p.cliente_telefono,

              p.subtotal,
              p.descuento,
              p.recargo,
              p.total,

              p.estado,

              u.nombre AS ubicacion,
              us.nombre AS vendedor,

              COUNT(
                pi.id
              ) AS items

            FROM presupuestos p

            INNER JOIN ubicaciones u
              ON u.id =
                p.ubicacion_id

            INNER JOIN usuarios us
              ON us.id =
                p.usuario_id

            LEFT JOIN presupuesto_items pi
              ON pi.presupuesto_id =
                p.id

            WHERE
              ${condiciones.join(
                "\n AND "
              )}

            GROUP BY
              p.id,
              u.nombre,
              us.nombre

            ORDER BY
              p.created_at DESC

            LIMIT 500;
          `,
          parametros
        );

      // =====================================================
      // RESUMEN
      // =====================================================

      let activos = 0;
      let convertidos = 0;
      let totalActivos = 0;

      for (
        const presupuesto
        of resultado.rows
      ) {
        if (
          presupuesto.estado ===
          "activo"
        ) {
          activos++;

          totalActivos +=
            Number(
              presupuesto.total
            ) || 0;
        }

        if (
          presupuesto.estado ===
          "convertido"
        ) {
          convertidos++;
        }
      }

      return res.render(
        "presupuestos",
        {
          usuario,

          presupuestos:
            resultado.rows,

          filtros: {
            buscar,
            estado,
            desde,
            hasta,
          },

          resumen: {
            activos,
            convertidos,
            totalActivos,
          },

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando presupuestos:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando presupuestos."
        );
    }
  }
);

// =========================================================
// NUEVO PRESUPUESTO
// =========================================================

router.get(
  "/presupuestos/nuevo",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      let ubicaciones = [];

      if (
        usuario.rol === "dueno"
      ) {
        const resultado =
          await db.pool.query(`
            SELECT
              id,
              nombre

            FROM ubicaciones

            WHERE
              activo = TRUE
              AND tipo = 'local'

            ORDER BY id;
          `);

        ubicaciones =
          resultado.rows;
      }

      return res.render(
        "presupuesto-nuevo",
        {
          usuario,
          ubicaciones,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando nuevo presupuesto:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando nuevo presupuesto."
        );
    }
  }
);

// =========================================================
// API PRODUCTOS
// =========================================================

router.get(
  "/presupuestos/api/productos",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const buscar =
        String(
          req.query.buscar || ""
        ).trim();

      let ubicacionId;

      // =====================================================
      // EMPLEADO: FORZAR SU SUCURSAL
      // =====================================================

      if (
        usuario.rol === "empleado"
      ) {
        ubicacionId =
          Number(
            usuario.ubicacion_id
          );
      } else {
        ubicacionId =
          Number(
            req.query.ubicacion_id
          );
      }

      if (
        !buscar ||
        !ubicacionId
      ) {
        return res.json([]);
      }

      // =====================================================
      // VALIDAR SUCURSAL
      // =====================================================

      const ubicacion =
        await db.pool.query(
          `
            SELECT id

            FROM ubicaciones

            WHERE
              id = $1
              AND activo = TRUE
              AND tipo = 'local'

            LIMIT 1;
          `,
          [
            ubicacionId,
          ]
        );

      if (
        ubicacion.rows.length === 0
      ) {
        return res.json([]);
      }

      // =====================================================
      // PRODUCTOS
      // =====================================================

      const resultado =
        await db.pool.query(
          `
            SELECT
              p.id,

              p.codigo_interno,
              p.codigo_barras,

              p.descripcion,

              m.nombre AS marca,
              c.nombre AS categoria,

              p.precio_efectivo,
              p.precio_tarjeta,

              COALESCE(
                s.cantidad,
                0
              ) AS stock

            FROM productos p

            LEFT JOIN marcas m
              ON m.id =
                p.marca_id

            LEFT JOIN categorias c
              ON c.id =
                p.categoria_id

            LEFT JOIN stock s
              ON s.producto_id =
                p.id

              AND s.ubicacion_id =
                $1

            WHERE
              p.activo = TRUE

              AND (
                p.descripcion
                  ILIKE $2

                OR COALESCE(
                  p.codigo_interno,
                  ''
                ) ILIKE $2

                OR COALESCE(
                  p.codigo_barras,
                  ''
                ) ILIKE $2

                OR COALESCE(
                  m.nombre,
                  ''
                ) ILIKE $2

                OR COALESCE(
                  c.nombre,
                  ''
                ) ILIKE $2
              )

            ORDER BY
              CASE
                WHEN
                  p.codigo_barras = $3
                THEN 0

                WHEN
                  p.codigo_interno = $3
                THEN 1

                ELSE 2
              END,

              p.descripcion

            LIMIT 20;
          `,
          [
            ubicacionId,
            `%${buscar}%`,
            buscar,
          ]
        );

      return res.json(
        resultado.rows.map(
          producto => ({
            id:
              producto.id,

            codigo_interno:
              producto.codigo_interno,

            codigo_barras:
              producto.codigo_barras,

            descripcion:
              producto.descripcion,

            marca:
              producto.marca,

            categoria:
              producto.categoria,

            precio_efectivo:
              Number(
                producto.precio_efectivo
              ) || 0,

            precio_tarjeta:
              Number(
                producto.precio_tarjeta
              ) || 0,

            stock:
              Number(
                producto.stock
              ) || 0,
          })
        )
      );
    } catch (error) {
      console.error(
        "Error buscando productos para presupuesto:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Error buscando productos.",
        });
    }
  }
);

// =========================================================
// GUARDAR PRESUPUESTO
// =========================================================

router.post(
  "/presupuestos",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    const client =
      await db.pool.connect();

    let transaccionIniciada =
      false;

    try {
      const usuario =
        req.session.usuario;

      let ubicacionId;

      if (
        usuario.rol === "empleado"
      ) {
        ubicacionId =
          Number(
            usuario.ubicacion_id
          );
      } else {
        ubicacionId =
          Number(
            req.body.ubicacion_id
          );
      }

      if (!ubicacionId) {
        throw new Error(
          "Seleccioná una sucursal."
        );
      }

      // =====================================================
      // ITEMS
      // =====================================================

      let items =
        req.body.items;

      if (
        typeof items === "string"
      ) {
        try {
          items =
            JSON.parse(
              items
            );
        } catch {
          throw new Error(
            "Los productos del presupuesto no son válidos."
          );
        }
      }

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        throw new Error(
          "Agregá al menos un producto."
        );
      }

      // =====================================================
      // CLIENTE
      // =====================================================

      const clienteNombre =
        String(
          req.body.cliente_nombre ||
          ""
        ).trim();

      const clienteDocumento =
        String(
          req.body.cliente_documento ||
          ""
        ).trim() || null;

      const clienteTelefono =
        String(
          req.body.cliente_telefono ||
          ""
        ).trim() || null;

      const observaciones =
        String(
          req.body.observaciones ||
          ""
        ).trim() || null;

      if (!clienteNombre) {
        throw new Error(
          "Ingresá el nombre del cliente."
        );
      }

      // =====================================================
      // DESCUENTO / RECARGO
      // =====================================================

      const descuentoPorcentaje =
        Number(
          req.body.descuento_porcentaje
        ) || 0;

      const recargoPorcentaje =
        Number(
          req.body.recargo_porcentaje
        ) || 0;

      if (
        !Number.isFinite(
          descuentoPorcentaje
        ) ||
        descuentoPorcentaje < 0 ||
        descuentoPorcentaje > 100
      ) {
        throw new Error(
          "Descuento inválido."
        );
      }

      if (
        !Number.isFinite(
          recargoPorcentaje
        ) ||
        recargoPorcentaje < 0
      ) {
        throw new Error(
          "Recargo inválido."
        );
      }

      // =====================================================
      // AGRUPAR PRODUCTOS REPETIDOS
      // =====================================================

      const itemsAgrupados =
        new Map();

      for (
        const item
        of items
      ) {
        const productoId =
          Number(
            item.producto_id
          );

        const cantidad =
          Number(
            item.cantidad
          );

        if (
          !productoId ||
          !Number.isFinite(
            cantidad
          ) ||
          cantidad <= 0
        ) {
          throw new Error(
            "Hay una cantidad inválida."
          );
        }

        const actual =
          itemsAgrupados.get(
            productoId
          ) || 0;

        itemsAgrupados.set(
          productoId,
          actual + cantidad
        );
      }

      const itemsNormalizados =
        Array.from(
          itemsAgrupados.entries()
        ).map(
          ([
            productoId,
            cantidad,
          ]) => ({
            producto_id:
              productoId,

            cantidad,
          })
        );

      // =====================================================
      // TRANSACCIÓN
      // =====================================================

      await client.query(
        "BEGIN"
      );

      transaccionIniciada =
        true;

      // =====================================================
      // VALIDAR SUCURSAL
      // =====================================================

      const ubicacion =
        await client.query(
          `
            SELECT
              id,
              nombre

            FROM ubicaciones

            WHERE
              id = $1
              AND tipo = 'local'
              AND activo = TRUE

            LIMIT 1;
          `,
          [
            ubicacionId,
          ]
        );

      if (
        ubicacion.rows.length === 0
      ) {
        throw new Error(
          "Sucursal inválida."
        );
      }

      // =====================================================
      // PROCESAR PRODUCTOS
      // =====================================================

      let subtotal = 0;

      const itemsProcesados = [];

      for (
        const item
        of itemsNormalizados
      ) {
        const producto =
          await client.query(
            `
              SELECT
                id,
                descripcion,
                precio_efectivo

              FROM productos

              WHERE
                id = $1
                AND activo = TRUE

              LIMIT 1;
            `,
            [
              item.producto_id,
            ]
          );

        if (
          producto.rows.length ===
          0
        ) {
          throw new Error(
            "Uno de los productos no existe o está inactivo."
          );
        }

        const precio =
          Number(
            producto.rows[0]
              .precio_efectivo
          ) || 0;

        const itemSubtotal =
          precio *
          item.cantidad;

        subtotal +=
          itemSubtotal;

        itemsProcesados.push({
          producto_id:
            item.producto_id,

          descripcion:
            producto.rows[0]
              .descripcion,

          cantidad:
            item.cantidad,

          precio_unitario:
            precio,

          subtotal:
            itemSubtotal,
        });
      }

      // =====================================================
      // TOTALES
      // =====================================================

      const descuento =
        subtotal *
        (
          descuentoPorcentaje /
          100
        );

      const base =
        subtotal -
        descuento;

      const recargo =
        base *
        (
          recargoPorcentaje /
          100
        );

      const total =
        base +
        recargo;

      // =====================================================
      // NÚMERO PRESUPUESTO
      // =====================================================
      //
      // Evita que Florida y Delfín Gallo creen simultáneamente
      // el mismo número de presupuesto.
      // =====================================================

      await client.query(`
        LOCK TABLE presupuestos
        IN SHARE ROW EXCLUSIVE MODE;
      `);

      const numeroResultado =
        await client.query(`
          SELECT
            COALESCE(
              MAX(numero),
              0
            ) + 1 AS numero

          FROM presupuestos;
        `);

      const numero =
        Number(
          numeroResultado
            .rows[0]
            .numero
        );

      // =====================================================
      // CABECERA
      // =====================================================

      const presupuesto =
        await client.query(
          `
            INSERT INTO presupuestos (
              numero,
              ubicacion_id,
              usuario_id,

              cliente_nombre,
              cliente_documento,
              cliente_telefono,

              subtotal,
              descuento,
              recargo,
              total,

              estado,
              observaciones
            )

            VALUES (
              $1,
              $2,
              $3,

              $4,
              $5,
              $6,

              $7,
              $8,
              $9,
              $10,

              'activo',
              $11
            )

            RETURNING id;
          `,
          [
            numero,
            ubicacionId,
            usuario.id,

            clienteNombre,
            clienteDocumento,
            clienteTelefono,

            subtotal,
            descuento,
            recargo,
            total,

            observaciones,
          ]
        );

      const presupuestoId =
        presupuesto.rows[0].id;

      // =====================================================
      // ITEMS
      // =====================================================

      for (
        const item
        of itemsProcesados
      ) {
        await client.query(
          `
            INSERT INTO presupuesto_items (
              presupuesto_id,
              producto_id,
              descripcion,
              cantidad,
              precio_unitario,
              subtotal
            )

            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6
            );
          `,
          [
            presupuestoId,
            item.producto_id,
            item.descripcion,
            item.cantidad,
            item.precio_unitario,
            item.subtotal,
          ]
        );
      }

      // =====================================================
      // COMMIT
      // =====================================================

      await client.query(
        "COMMIT"
      );

      transaccionIniciada =
        false;

      return res.redirect(
        `/presupuestos/${presupuestoId}?ok=` +
        encodeURIComponent(
          `Presupuesto #${numero} creado correctamente.`
        )
      );
    } catch (error) {
      if (
        transaccionIniciada
      ) {
        try {
          await client.query(
            "ROLLBACK"
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "Error haciendo rollback:",
            rollbackError
          );
        }
      }

      console.error(
        "Error creando presupuesto:",
        error
      );

      return res.redirect(
        "/presupuestos/nuevo?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo crear el presupuesto."
        )
      );
    } finally {
      client.release();
    }
  }
);

// =========================================================
// DETALLE
// =========================================================

router.get(
  "/presupuestos/:id",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const id =
        Number(
          req.params.id
        );

      if (!id) {
        return res
          .status(404)
          .send(
            "Presupuesto no encontrado."
          );
      }

      const parametros = [
        id,
      ];

      let filtro = "";

      // =====================================================
      // EMPLEADO: SOLO SU SUCURSAL
      // =====================================================

      if (
        usuario.rol === "empleado"
      ) {
        parametros.push(
          Number(
            usuario.ubicacion_id
          )
        );

        filtro = `
          AND p.ubicacion_id =
            $${parametros.length}
        `;
      }

      const presupuesto =
        await db.pool.query(
          `
            SELECT
              p.*,

              u.nombre AS ubicacion,
              us.nombre AS vendedor

            FROM presupuestos p

            INNER JOIN ubicaciones u
              ON u.id =
                p.ubicacion_id

            INNER JOIN usuarios us
              ON us.id =
                p.usuario_id

            WHERE
              p.id = $1

              ${filtro}

            LIMIT 1;
          `,
          parametros
        );

      if (
        presupuesto.rows.length ===
        0
      ) {
        return res
          .status(404)
          .send(
            "Presupuesto no encontrado."
          );
      }

      // =====================================================
      // ITEMS
      // =====================================================

      const items =
        await db.pool.query(
          `
            SELECT
              pi.*,

              prod.codigo_interno,
              prod.codigo_barras

            FROM presupuesto_items pi

            LEFT JOIN productos prod
              ON prod.id =
                pi.producto_id

            WHERE
              pi.presupuesto_id = $1

            ORDER BY
              pi.id;
          `,
          [
            id,
          ]
        );

      // =====================================================
      // FORMAS DE PAGO
      // =====================================================

      const formasPago =
        await db.pool.query(`
          SELECT
            id,
            nombre,
            tipo

          FROM formas_pago

          WHERE
            activo = TRUE

          ORDER BY id;
        `);

      // =====================================================
      // TARJETAS
      // =====================================================

      const tarjetas =
        await db.pool.query(`
          SELECT
            id,
            nombre

          FROM tarjetas

          WHERE
            activo = TRUE

          ORDER BY nombre;
        `);

      return res.render(
        "presupuesto-detalle",
        {
          usuario,

          presupuesto:
            presupuesto.rows[0],

          items:
            items.rows,

          formasPago:
            formasPago.rows,

          tarjetas:
            tarjetas.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando presupuesto:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando presupuesto."
        );
    }
  }
);

// =========================================================
// CANCELAR
// =========================================================

router.post(
  "/presupuestos/:id/cancelar",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const id =
        Number(
          req.params.id
        );

      if (!id) {
        throw new Error(
          "Presupuesto inválido."
        );
      }

      const parametros = [
        id,
      ];

      let filtro = "";

      if (
        usuario.rol === "empleado"
      ) {
        parametros.push(
          Number(
            usuario.ubicacion_id
          )
        );

        filtro = `
          AND ubicacion_id =
            $${parametros.length}
        `;
      }

      const resultado =
        await db.pool.query(
          `
            UPDATE presupuestos

            SET
              estado =
                'cancelado'

            WHERE
              id = $1

              ${filtro}

              AND estado =
                'activo'

            RETURNING
              numero;
          `,
          parametros
        );

      if (
        resultado.rows.length ===
        0
      ) {
        throw new Error(
          "El presupuesto no puede cancelarse."
        );
      }

      return res.redirect(
        `/presupuestos/${id}?ok=` +
        encodeURIComponent(
          "Presupuesto cancelado."
        )
      );
    } catch (error) {
      console.error(
        "Error cancelando presupuesto:",
        error
      );

      return res.redirect(
        `/presupuestos/${req.params.id}?error=` +
        encodeURIComponent(
          error.message ||
          "No se pudo cancelar el presupuesto."
        )
      );
    }
  }
);

// =========================================================
// CUOTAS TARJETA
// =========================================================

router.get(
  "/presupuestos/api/tarjetas/:id/cuotas",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const tarjetaId =
        Number(
          req.params.id
        );

      if (!tarjetaId) {
        return res.json([]);
      }

      // =====================================================
      // TARJETA ACTIVA
      // =====================================================

      const tarjeta =
        await db.pool.query(
          `
            SELECT id

            FROM tarjetas

            WHERE
              id = $1
              AND activo = TRUE

            LIMIT 1;
          `,
          [
            tarjetaId,
          ]
        );

      if (
        tarjeta.rows.length ===
        0
      ) {
        return res.json([]);
      }

      const resultado =
        await db.pool.query(
          `
            SELECT
              cuotas,
              recargo_porcentaje

            FROM cuotas_tarjeta

            WHERE
              tarjeta_id = $1
              AND activo = TRUE

            ORDER BY cuotas;
          `,
          [
            tarjetaId,
          ]
        );

      return res.json(
        resultado.rows.map(
          fila => ({
            cuotas:
              Number(
                fila.cuotas
              ),

            recargo_porcentaje:
              Number(
                fila.recargo_porcentaje
              ) || 0,
          })
        )
      );
    } catch (error) {
      console.error(
        "Error cargando cuotas:",
        error
      );

      return res
        .status(500)
        .json([]);
    }
  }
);

// =========================================================
// CONVERTIR PRESUPUESTO EN VENTA
// =========================================================

router.post(
  "/presupuestos/:id/convertir",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    const client =
      await db.pool.connect();

    let transaccionIniciada =
      false;

    try {
      const presupuestoId =
        Number(
          req.params.id
        );

      const usuario =
        req.session.usuario;

      const formaPagoId =
        Number(
          req.body.forma_pago_id
        );

      let tarjetaId = null;
      let cuotas = null;
      let porcentajeRecargo = 0;

      if (!presupuestoId) {
        throw new Error(
          "Presupuesto inválido."
        );
      }

      if (!formaPagoId) {
        throw new Error(
          "Seleccioná una forma de pago."
        );
      }

      // =====================================================
      // TRANSACCIÓN
      // =====================================================

      await client.query(
        "BEGIN"
      );

      transaccionIniciada =
        true;

      // =====================================================
      // PRESUPUESTO
      // =====================================================

      const presupuestoResultado =
        await client.query(
          `
            SELECT
              *

            FROM presupuestos

            WHERE
              id = $1

            FOR UPDATE;
          `,
          [
            presupuestoId,
          ]
        );

      if (
        presupuestoResultado.rows.length ===
        0
      ) {
        throw new Error(
          "Presupuesto no encontrado."
        );
      }

      const presupuesto =
        presupuestoResultado.rows[0];

      if (
        presupuesto.estado !==
        "activo"
      ) {
        throw new Error(
          "Este presupuesto ya no está activo."
        );
      }

      // =====================================================
      // SEGURIDAD DE SUCURSAL
      // =====================================================

      if (
        usuario.rol === "empleado" &&
        Number(
          presupuesto.ubicacion_id
        ) !==
          Number(
            usuario.ubicacion_id
          )
      ) {
        throw new Error(
          "No tenés permiso para convertir este presupuesto."
        );
      }

      // =====================================================
      // VALIDAR UBICACIÓN DEL PRESUPUESTO
      // =====================================================

      const ubicacion =
        await client.query(
          `
            SELECT
              id,
              nombre

            FROM ubicaciones

            WHERE
              id = $1
              AND activo = TRUE
              AND tipo = 'local'

            LIMIT 1;
          `,
          [
            presupuesto.ubicacion_id,
          ]
        );

      if (
        ubicacion.rows.length ===
        0
      ) {
        throw new Error(
          "La sucursal del presupuesto ya no está disponible."
        );
      }

      // =====================================================
      // FORMA DE PAGO
      // =====================================================

      const formaPago =
        await client.query(
          `
            SELECT
              id,
              tipo,
              nombre

            FROM formas_pago

            WHERE
              id = $1
              AND activo = TRUE

            LIMIT 1;
          `,
          [
            formaPagoId,
          ]
        );

      if (
        formaPago.rows.length ===
        0
      ) {
        throw new Error(
          "Forma de pago inválida."
        );
      }

      const tipoPago =
        formaPago.rows[0].tipo;

      // =====================================================
      // TARJETA
      // =====================================================

      if (
        tipoPago === "tarjeta"
      ) {
        tarjetaId =
          Number(
            req.body.tarjeta_id
          );

        cuotas =
          Number(
            req.body.cuotas
          );

        if (
          !tarjetaId ||
          !cuotas
        ) {
          throw new Error(
            "Seleccioná tarjeta y cuotas."
          );
        }

        // ===================================================
        // VALIDAR TARJETA
        // ===================================================

        const tarjeta =
          await client.query(
            `
              SELECT
                id,
                nombre

              FROM tarjetas

              WHERE
                id = $1
                AND activo = TRUE

              LIMIT 1;
            `,
            [
              tarjetaId,
            ]
          );

        if (
          tarjeta.rows.length ===
          0
        ) {
          throw new Error(
            "Tarjeta inválida."
          );
        }

        // ===================================================
        // CONFIGURACIÓN DE CUOTAS
        // ===================================================

        const configuracion =
          await client.query(
            `
              SELECT
                recargo_porcentaje

              FROM cuotas_tarjeta

              WHERE
                tarjeta_id = $1
                AND cuotas = $2
                AND activo = TRUE

              LIMIT 1;
            `,
            [
              tarjetaId,
              cuotas,
            ]
          );

        if (
          configuracion.rows.length ===
          0
        ) {
          throw new Error(
            "La financiación seleccionada no está disponible."
          );
        }

        porcentajeRecargo =
          Number(
            configuracion.rows[0]
              .recargo_porcentaje
          ) || 0;
      }

      // =====================================================
      // ITEMS DEL PRESUPUESTO
      // =====================================================

      const itemsResultado =
        await client.query(
          `
            SELECT
              pi.producto_id,
              pi.descripcion,

              SUM(
                pi.cantidad
              ) AS cantidad

            FROM presupuesto_items pi

            WHERE
              pi.presupuesto_id =
                $1

            GROUP BY
              pi.producto_id,
              pi.descripcion

            ORDER BY
              pi.producto_id;
          `,
          [
            presupuestoId,
          ]
        );

      if (
        itemsResultado.rows.length ===
        0
      ) {
        throw new Error(
          "El presupuesto no tiene productos."
        );
      }

      let subtotal = 0;

      const itemsVenta = [];

      // =====================================================
      // VALIDAR STOCK + PRECIOS ACTUALES
      // =====================================================

      for (
        const item
        of itemsResultado.rows
      ) {
        const producto =
          await client.query(
            `
              SELECT
                id,
                descripcion,
                precio_efectivo,
                precio_tarjeta

              FROM productos

              WHERE
                id = $1
                AND activo = TRUE

              LIMIT 1;
            `,
            [
              item.producto_id,
            ]
          );

        if (
          producto.rows.length ===
          0
        ) {
          throw new Error(
            `El producto ${item.descripcion} ya no está activo.`
          );
        }

        const p =
          producto.rows[0];

        const cantidad =
          Number(
            item.cantidad
          );

        if (
          !Number.isFinite(
            cantidad
          ) ||
          cantidad <= 0
        ) {
          throw new Error(
            `Cantidad inválida para ${p.descripcion}.`
          );
        }

        // ===================================================
        // PRECIO ACTUAL
        // ===================================================

        let precio =
          Number(
            p.precio_efectivo
          ) || 0;

        if (
          tipoPago === "tarjeta" &&
          Number(
            p.precio_tarjeta
          ) > 0
        ) {
          precio =
            Number(
              p.precio_tarjeta
            );
        }

        // ===================================================
        // GARANTIZAR STOCK
        // ===================================================

        await client.query(
          `
            INSERT INTO stock (
              producto_id,
              ubicacion_id,
              cantidad
            )

            VALUES (
              $1,
              $2,
              0
            )

            ON CONFLICT (
              producto_id,
              ubicacion_id
            )

            DO NOTHING;
          `,
          [
            p.id,
            presupuesto.ubicacion_id,
          ]
        );

        // ===================================================
        // BLOQUEAR STOCK
        // ===================================================

        const stock =
          await client.query(
            `
              SELECT
                cantidad

              FROM stock

              WHERE
                producto_id = $1
                AND ubicacion_id = $2

              FOR UPDATE;
            `,
            [
              p.id,
              presupuesto.ubicacion_id,
            ]
          );

        if (
          stock.rows.length ===
          0
        ) {
          throw new Error(
            `No se pudo consultar el stock de ${p.descripcion}.`
          );
        }

        const stockAnterior =
          Number(
            stock.rows[0]
              .cantidad
          ) || 0;

        if (
          stockAnterior <
          cantidad
        ) {
          throw new Error(
            `Stock insuficiente para ${p.descripcion}. Disponible: ${stockAnterior}.`
          );
        }

        const itemSubtotal =
          precio *
          cantidad;

        subtotal +=
          itemSubtotal;

        itemsVenta.push({
          producto_id:
            p.id,

          descripcion:
            p.descripcion,

          cantidad,

          precio_unitario:
            precio,

          subtotal:
            itemSubtotal,

          stock_anterior:
            stockAnterior,

          stock_nuevo:
            stockAnterior -
            cantidad,
        });
      }

      // =====================================================
      // CONSERVAR DESCUENTO DEL PRESUPUESTO
      // =====================================================

      let porcentajeDescuento = 0;

      if (
        Number(
          presupuesto.subtotal
        ) > 0
      ) {
        porcentajeDescuento =
          (
            Number(
              presupuesto.descuento
            ) /
            Number(
              presupuesto.subtotal
            )
          ) *
          100;
      }

      const descuento =
        subtotal *
        (
          porcentajeDescuento /
          100
        );

      const base =
        subtotal -
        descuento;

      // =====================================================
      // RECARGO
      // =====================================================

      let recargo = 0;

      if (
        tipoPago === "tarjeta"
      ) {
        recargo =
          base *
          (
            porcentajeRecargo /
            100
          );
      } else {
        const basePresupuesto =
          Number(
            presupuesto.subtotal
          ) -
          Number(
            presupuesto.descuento
          );

        const porcentajePresupuesto =
          basePresupuesto > 0
            ? (
                Number(
                  presupuesto.recargo
                ) /
                basePresupuesto
              ) *
              100
            : 0;

        recargo =
          base *
          (
            porcentajePresupuesto /
            100
          );
      }

      const total =
        base +
        recargo;

      // =====================================================
      // NÚMERO DE VENTA
      // =====================================================
      //
      // Muy importante en un sistema multisucursal:
      // Florida y Delfín Gallo pueden vender al mismo tiempo.
      // Bloqueamos la numeración para evitar duplicados.
      // =====================================================

      await client.query(`
        LOCK TABLE ventas
        IN SHARE ROW EXCLUSIVE MODE;
      `);

      const numeroResultado =
        await client.query(`
          SELECT
            COALESCE(
              MAX(numero),
              0
            ) + 1 AS numero

          FROM ventas;
        `);

      const numeroVenta =
        Number(
          numeroResultado
            .rows[0]
            .numero
        );

      // =====================================================
      // CREAR VENTA
      // =====================================================

      const venta =
        await client.query(
          `
            INSERT INTO ventas (
              numero,

              ubicacion_id,
              usuario_id,

              cliente_nombre,
              cliente_documento,
              cliente_telefono,

              subtotal,
              descuento,
              recargo,
              total,

              forma_pago_id,

              tarjeta_id,
              cuotas,
              porcentaje_recargo,

              estado,
              observaciones
            )

            VALUES (
              $1,
              $2,
              $3,

              $4,
              $5,
              $6,

              $7,
              $8,
              $9,
              $10,

              $11,

              $12,
              $13,
              $14,

              'confirmada',
              $15
            )

            RETURNING id;
          `,
          [
            numeroVenta,

            presupuesto.ubicacion_id,
            usuario.id,

            presupuesto.cliente_nombre,
            presupuesto.cliente_documento,
            presupuesto.cliente_telefono,

            subtotal,
            descuento,
            recargo,
            total,

            formaPagoId,

            tarjetaId,
            cuotas,
            porcentajeRecargo,

            `Convertida desde presupuesto #${presupuesto.numero}`,
          ]
        );

      const ventaId =
        venta.rows[0].id;

      // =====================================================
      // ITEMS + STOCK + MOVIMIENTOS
      // =====================================================

      for (
        const item
        of itemsVenta
      ) {
        // ===================================================
        // ITEM
        // ===================================================

        await client.query(
          `
            INSERT INTO venta_items (
              venta_id,
              producto_id,
              descripcion,
              cantidad,
              precio_unitario,
              subtotal
            )

            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6
            );
          `,
          [
            ventaId,
            item.producto_id,
            item.descripcion,
            item.cantidad,
            item.precio_unitario,
            item.subtotal,
          ]
        );

        // ===================================================
        // DESCONTAR STOCK
        // ===================================================

        await client.query(
          `
            UPDATE stock

            SET
              cantidad = $1,
              updated_at = NOW()

            WHERE
              producto_id = $2
              AND ubicacion_id = $3;
          `,
          [
            item.stock_nuevo,
            item.producto_id,
            presupuesto.ubicacion_id,
          ]
        );

        // ===================================================
        // MOVIMIENTO
        // ===================================================

        await client.query(
          `
            INSERT INTO movimientos_stock (
              producto_id,
              ubicacion_id,

              tipo,
              cantidad,

              stock_anterior,
              stock_nuevo,

              referencia_tipo,
              referencia_id,

              observaciones,
              usuario_id
            )

            VALUES (
              $1,
              $2,

              'venta',
              $3,

              $4,
              $5,

              'venta',
              $6,

              $7,
              $8
            );
          `,
          [
            item.producto_id,
            presupuesto.ubicacion_id,

            -item.cantidad,

            item.stock_anterior,
            item.stock_nuevo,

            ventaId,

            `Venta #${numeroVenta} · Presupuesto #${presupuesto.numero}`,

            usuario.id,
          ]
        );
      }

      // =====================================================
      // MARCAR PRESUPUESTO COMO CONVERTIDO
      // =====================================================

      await client.query(
        `
          UPDATE presupuestos

          SET
            estado = 'convertido',

            observaciones =
              CASE
                WHEN
                  observaciones IS NULL
                  OR observaciones = ''

                THEN $1

                ELSE
                  observaciones ||
                  E'\\n' ||
                  $1
              END

          WHERE
            id = $2;
        `,
        [
          `Convertido en venta #${numeroVenta}`,
          presupuestoId,
        ]
      );

      // =====================================================
      // COMMIT
      // =====================================================

      await client.query(
        "COMMIT"
      );

      transaccionIniciada =
        false;

      return res.redirect(
        `/ventas/${ventaId}`
      );
    } catch (error) {
      if (
        transaccionIniciada
      ) {
        try {
          await client.query(
            "ROLLBACK"
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "Error haciendo rollback:",
            rollbackError
          );
        }
      }

      console.error(
        "Error convirtiendo presupuesto:",
        error
      );

      return res.redirect(
        `/presupuestos/${req.params.id}?error=` +
        encodeURIComponent(
          error.message ||
          "No se pudo convertir el presupuesto."
        )
      );
    } finally {
      client.release();
    }
  }
);

module.exports = router;