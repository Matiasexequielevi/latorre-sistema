const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// PANTALLA DE INGRESOS
// =========================================================

router.get(
  "/ingresos",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const depositoResultado =
        await db.pool.query(`
          SELECT
            id,
            nombre

          FROM ubicaciones

          WHERE
            nombre = 'Depósito Florida'
            AND activo = TRUE

          LIMIT 1;
        `);

      if (
        depositoResultado.rows.length === 0
      ) {
        return res
          .status(500)
          .send(
            "No se encontró la ubicación Depósito."
          );
      }

      // =====================================================
      // ÚLTIMOS INGRESOS
      // =====================================================

      const ingresosResultado =
        await db.pool.query(`
          SELECT
            m.referencia_id AS numero,

            MIN(
              m.created_at
            ) AS fecha,

            COUNT(*) AS productos,

            SUM(
              ABS(m.cantidad)
            ) AS unidades,

            MAX(
              m.observaciones
            ) AS observaciones,

            MAX(
              us.nombre
            ) AS usuario

          FROM movimientos_stock m

          LEFT JOIN usuarios us
            ON us.id = m.usuario_id

          WHERE
            m.tipo = 'ingreso_mercaderia'

            AND m.referencia_tipo =
              'ingreso_mercaderia'

          GROUP BY
            m.referencia_id

          ORDER BY
            MIN(m.created_at) DESC

          LIMIT 30;
        `);

      return res.render(
        "ingresos",
        {
          usuario:
            req.session.usuario,

          deposito:
            depositoResultado.rows[0],

          ingresos:
            ingresosResultado.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando ingresos:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando ingreso de mercadería."
        );
    }
  }
);

// =========================================================
// BUSCAR PRODUCTOS
// =========================================================

router.get(
  "/ingresos/api/productos",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const buscar =
        String(
          req.query.buscar || ""
        ).trim();

      if (!buscar) {
        return res.json([]);
      }

      const resultado =
        await db.pool.query(
          `
            SELECT
              p.id,
              p.codigo_interno,
              p.codigo_barras,
              p.descripcion,

              c.nombre AS categoria,
              m.nombre AS marca,

              COALESCE(
                s.cantidad,
                0
              ) AS stock_deposito

            FROM productos p

            LEFT JOIN categorias c
              ON c.id = p.categoria_id

            LEFT JOIN marcas m
              ON m.id = p.marca_id

            LEFT JOIN ubicaciones u
              ON u.nombre = 'Depósito Florida'
              AND u.activo = TRUE

            LEFT JOIN stock s
              ON s.producto_id = p.id
              AND s.ubicacion_id = u.id

            WHERE
              p.activo = TRUE

              AND (
                p.descripcion ILIKE $1

                OR COALESCE(
                  p.codigo_interno,
                  ''
                ) ILIKE $1

                OR COALESCE(
                  p.codigo_barras,
                  ''
                ) ILIKE $1

                OR COALESCE(
                  c.nombre,
                  ''
                ) ILIKE $1

                OR COALESCE(
                  m.nombre,
                  ''
                ) ILIKE $1
              )

            ORDER BY
              CASE

                WHEN p.codigo_barras = $2
                  THEN 0

                WHEN p.codigo_interno = $2
                  THEN 1

                ELSE 2

              END,

              p.descripcion ASC

            LIMIT 20;
          `,
          [
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

            categoria:
              producto.categoria,

            marca:
              producto.marca,

            stock_deposito:
              Number(
                producto.stock_deposito
              ) || 0,
          })
        )
      );
    } catch (error) {
      console.error(
        "Error buscando productos:",
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
// REGISTRAR INGRESO
// =========================================================

router.post(
  "/ingresos",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    const client =
      await db.pool.connect();

    let transaccionIniciada =
      false;

    try {
      const usuario =
        req.session.usuario;

      let items =
        req.body.items;

      // =====================================================
      // PARSEAR ITEMS
      // =====================================================

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
            "Los productos del ingreso no son válidos."
          );
        }
      }

      const proveedor =
        String(
          req.body.proveedor ||
          ""
        ).trim();

      const comprobante =
        String(
          req.body.comprobante ||
          ""
        ).trim();

      const observacion =
        String(
          req.body.observaciones ||
          ""
        ).trim();

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        throw new Error(
          "Agregá al menos un producto."
        );
      }

      // =====================================================
      // NORMALIZAR ITEMS
      // =====================================================
      //
      // Si el mismo producto llega dos veces desde el
      // navegador, agrupamos las cantidades antes de tocar
      // el stock.
      // =====================================================

      const itemsAgrupados =
        new Map();

      for (
        const item of items
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
            "Hay un producto con cantidad inválida."
          );
        }

        const cantidadActual =
          itemsAgrupados.get(
            productoId
          ) || 0;

        itemsAgrupados.set(
          productoId,
          cantidadActual +
          cantidad
        );
      }

      const itemsProcesar =
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
      // INICIAR TRANSACCIÓN
      // =====================================================

      await client.query(
        "BEGIN"
      );

      transaccionIniciada =
        true;

      // =====================================================
      // DEPÓSITO
      // =====================================================

      const deposito =
        await client.query(`
          SELECT
            id,
            nombre

          FROM ubicaciones

          WHERE
            nombre = 'Depósito Florida'
            AND activo = TRUE

          LIMIT 1

          FOR UPDATE;
        `);

      if (
        deposito.rows.length === 0
      ) {
        throw new Error(
          "No se encontró el Depósito."
        );
      }

      const depositoId =
        Number(
          deposito.rows[0].id
        );

      // =====================================================
      // NÚMERO DEL INGRESO
      // =====================================================
      //
      // En este sistema los ingresos no tienen una tabla
      // cabecera propia. Por eso referencia_id funciona como
      // identificador del grupo de movimientos.
      //
      // Usamos timestamp + componente aleatorio para reducir
      // todavía más cualquier posibilidad de repetición.
      // =====================================================

      const numeroIngreso =
        Number(
          `${Date.now()}${Math.floor(
            Math.random() * 1000
          )
            .toString()
            .padStart(
              3,
              "0"
            )}`
        );

      // =====================================================
      // DESCRIPCIÓN DEL INGRESO
      // =====================================================

      const descripcionIngreso =
        [
          proveedor
            ? `Proveedor: ${proveedor}`
            : "",

          comprobante
            ? `Comprobante: ${comprobante}`
            : "",

          observacion,
        ]
          .filter(Boolean)
          .join(" | ");

      // =====================================================
      // PROCESAR PRODUCTOS
      // =====================================================

      for (
        const item
        of itemsProcesar
      ) {
        const productoId =
          item.producto_id;

        const cantidad =
          item.cantidad;

        // ===================================================
        // PRODUCTO
        // ===================================================

        const producto =
          await client.query(
            `
              SELECT
                id,
                descripcion

              FROM productos

              WHERE
                id = $1
                AND activo = TRUE

              LIMIT 1;
            `,
            [
              productoId,
            ]
          );

        if (
          producto.rows.length === 0
        ) {
          throw new Error(
            "Uno de los productos no existe o está inactivo."
          );
        }

        const descripcionProducto =
          producto.rows[0]
            .descripcion;

        // ===================================================
        // GARANTIZAR REGISTRO DE STOCK
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
            productoId,
            depositoId,
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
              productoId,
              depositoId,
            ]
          );

        if (
          stock.rows.length === 0
        ) {
          throw new Error(
            `No se pudo consultar el stock de ${descripcionProducto}.`
          );
        }

        const anterior =
          Number(
            stock.rows[0]
              .cantidad
          ) || 0;

        const nuevo =
          anterior +
          cantidad;

        // ===================================================
        // ACTUALIZAR STOCK
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
            nuevo,
            productoId,
            depositoId,
          ]
        );

        // ===================================================
        // REGISTRAR MOVIMIENTO
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

              'ingreso_mercaderia',
              $3,

              $4,
              $5,

              'ingreso_mercaderia',
              $6,

              $7,

              $8
            );
          `,
          [
            productoId,
            depositoId,

            cantidad,

            anterior,
            nuevo,

            numeroIngreso,

            descripcionIngreso ||
              "Ingreso de mercadería",

            usuario.id,
          ]
        );
      }

      // =====================================================
      // CONFIRMAR TODO
      // =====================================================

      await client.query(
        "COMMIT"
      );

      transaccionIniciada =
        false;

      return res.redirect(
        "/ingresos?ok=" +
        encodeURIComponent(
          "Mercadería ingresada correctamente al Depósito."
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
        "Error registrando ingreso:",
        error
      );

      return res.redirect(
        "/ingresos?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo registrar el ingreso."
        )
      );
    } finally {
      client.release();
    }
  }
);

module.exports = router;