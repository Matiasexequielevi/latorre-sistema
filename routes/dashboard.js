const express = require("express");

const db = require("../database/db");

const {
  requiereLogin,
} = require("../middleware/auth");

const router = express.Router();

// =====================================
// DASHBOARD
// =====================================

router.get(
  "/dashboard",
  requiereLogin,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      let ventasHoy = 0;
      let cantidadVentasHoy = 0;

      let stockFlorida = 0;
      let stockDelfin = 0;
      let stockDeposito = 0;

      let cantidadProductos = 0;
      let cantidadStockBajo = 0;

      // =====================================
      // PRODUCTOS ACTIVOS
      // =====================================

      const productosResultado =
        await db.pool.query(`
          SELECT
            COUNT(*) AS cantidad

          FROM productos

          WHERE activo = TRUE;
        `);

      cantidadProductos =
        Number(
          productosResultado.rows[0]
            .cantidad
        ) || 0;

      // =====================================
      // STOCK GENERAL
      // =====================================

      const stockResultado =
        await db.pool.query(`
          SELECT
            u.id,
            u.nombre AS ubicacion,

            COALESCE(
              SUM(s.cantidad),
              0
            ) AS cantidad

          FROM ubicaciones u

          LEFT JOIN stock s
            ON s.ubicacion_id = u.id

          WHERE
            u.activo = TRUE

          GROUP BY
            u.id,
            u.nombre

          ORDER BY u.id;
        `);

      stockResultado.rows.forEach(
        fila => {
          const cantidad =
            Number(
              fila.cantidad
            ) || 0;

          if (
            fila.ubicacion ===
            "Florida Local"
          ) {
            stockFlorida =
              cantidad;
          }

          if (
            fila.ubicacion ===
            "Delfín Gallo Local"
          ) {
            stockDelfin =
              cantidad;
          }

          if (
            fila.ubicacion ===
            "Depósito"
          ) {
            stockDeposito =
              cantidad;
          }
        }
      );

      // =====================================
      // VENTAS DEL DÍA
      // =====================================

      if (
        usuario.rol === "dueno"
      ) {
        const ventasResultado =
          await db.pool.query(`
            SELECT
              COALESCE(
                SUM(total),
                0
              ) AS total,

              COUNT(*) AS cantidad

            FROM ventas

            WHERE
              estado = 'confirmada'

              AND created_at::date =
                CURRENT_DATE;
          `);

        ventasHoy =
          Number(
            ventasResultado.rows[0]
              .total
          ) || 0;

        cantidadVentasHoy =
          Number(
            ventasResultado.rows[0]
              .cantidad
          ) || 0;
      } else {
        const ventasResultado =
          await db.pool.query(
            `
              SELECT
                COALESCE(
                  SUM(total),
                  0
                ) AS total,

                COUNT(*) AS cantidad

              FROM ventas

              WHERE
                estado = 'confirmada'

                AND ubicacion_id = $1

                AND created_at::date =
                  CURRENT_DATE;
            `,
            [
              usuario.ubicacion_id,
            ]
          );

        ventasHoy =
          Number(
            ventasResultado.rows[0]
              .total
          ) || 0;

        cantidadVentasHoy =
          Number(
            ventasResultado.rows[0]
              .cantidad
          ) || 0;
      }

      // =====================================
      // STOCK BAJO
      // =====================================

      let stockBajoResultado;

      if (
        usuario.rol === "dueno"
      ) {
        stockBajoResultado =
          await db.pool.query(`
            SELECT
              p.id,
              p.descripcion,
              p.codigo_interno,
              p.stock_minimo,

              u.nombre AS ubicacion,

              COALESCE(
                s.cantidad,
                0
              ) AS cantidad

            FROM productos p

            CROSS JOIN ubicaciones u

            LEFT JOIN stock s
              ON s.producto_id = p.id
              AND s.ubicacion_id = u.id

            WHERE
              p.activo = TRUE

              AND u.activo = TRUE

              AND p.stock_minimo > 0

              AND COALESCE(
                s.cantidad,
                0
              ) <= p.stock_minimo

            ORDER BY
              COALESCE(
                s.cantidad,
                0
              ) ASC,
              p.descripcion ASC

            LIMIT 10;
          `);
      } else {
        stockBajoResultado =
          await db.pool.query(
            `
              SELECT
                p.id,
                p.descripcion,
                p.codigo_interno,
                p.stock_minimo,

                u.nombre AS ubicacion,

                COALESCE(
                  s.cantidad,
                  0
                ) AS cantidad

              FROM productos p

              INNER JOIN ubicaciones u
                ON u.id = $1

              LEFT JOIN stock s
                ON s.producto_id = p.id
                AND s.ubicacion_id = u.id

              WHERE
                p.activo = TRUE

                AND p.stock_minimo > 0

                AND COALESCE(
                  s.cantidad,
                  0
                ) <= p.stock_minimo

              ORDER BY
                COALESCE(
                  s.cantidad,
                  0
                ) ASC,
                p.descripcion ASC

              LIMIT 10;
            `,
            [
              usuario.ubicacion_id,
            ]
          );
      }

      // =====================================
      // CANTIDAD TOTAL DE STOCK BAJO
      // =====================================

      let cantidadStockBajoResultado;

      if (
        usuario.rol === "dueno"
      ) {
        cantidadStockBajoResultado =
          await db.pool.query(`
            SELECT
              COUNT(*) AS cantidad

            FROM productos p

            CROSS JOIN ubicaciones u

            LEFT JOIN stock s
              ON s.producto_id = p.id
              AND s.ubicacion_id = u.id

            WHERE
              p.activo = TRUE

              AND u.activo = TRUE

              AND p.stock_minimo > 0

              AND COALESCE(
                s.cantidad,
                0
              ) <= p.stock_minimo;
          `);
      } else {
        cantidadStockBajoResultado =
          await db.pool.query(
            `
              SELECT
                COUNT(*) AS cantidad

              FROM productos p

              LEFT JOIN stock s
                ON s.producto_id = p.id
                AND s.ubicacion_id = $1

              WHERE
                p.activo = TRUE

                AND p.stock_minimo > 0

                AND COALESCE(
                  s.cantidad,
                  0
                ) <= p.stock_minimo;
            `,
            [
              usuario.ubicacion_id,
            ]
          );
      }

      cantidadStockBajo =
        Number(
          cantidadStockBajoResultado
            .rows[0]
            .cantidad
        ) || 0;

      // =====================================
      // ÚLTIMAS VENTAS
      // =====================================

      let ultimasVentas;

      if (
        usuario.rol === "dueno"
      ) {
        ultimasVentas =
          await db.pool.query(`
            SELECT
              v.id,
              v.numero,
              v.total,
              v.created_at,

              COALESCE(
                v.cliente_nombre,
                'Consumidor final'
              ) AS cliente,

              u.nombre AS ubicacion,

              us.nombre AS vendedor,

              fp.nombre AS forma_pago

            FROM ventas v

            INNER JOIN ubicaciones u
              ON u.id =
                v.ubicacion_id

            INNER JOIN usuarios us
              ON us.id =
                v.usuario_id

            LEFT JOIN formas_pago fp
              ON fp.id =
                v.forma_pago_id

            WHERE
              v.estado = 'confirmada'

            ORDER BY
              v.created_at DESC

            LIMIT 8;
          `);
      } else {
        ultimasVentas =
          await db.pool.query(
            `
              SELECT
                v.id,
                v.numero,
                v.total,
                v.created_at,

                COALESCE(
                  v.cliente_nombre,
                  'Consumidor final'
                ) AS cliente,

                u.nombre AS ubicacion,

                us.nombre AS vendedor,

                fp.nombre AS forma_pago

              FROM ventas v

              INNER JOIN ubicaciones u
                ON u.id =
                  v.ubicacion_id

              INNER JOIN usuarios us
                ON us.id =
                  v.usuario_id

              LEFT JOIN formas_pago fp
                ON fp.id =
                  v.forma_pago_id

              WHERE
                v.estado = 'confirmada'

                AND v.ubicacion_id = $1

              ORDER BY
                v.created_at DESC

              LIMIT 8;
            `,
            [
              usuario.ubicacion_id,
            ]
          );
      }

      // =====================================
      // ÚLTIMOS MOVIMIENTOS DE STOCK
      // =====================================

      let ultimosMovimientos;

      if (
        usuario.rol === "dueno"
      ) {
        ultimosMovimientos =
          await db.pool.query(`
            SELECT
              m.id,
              m.created_at,
              m.tipo,
              m.cantidad,
              m.stock_anterior,
              m.stock_nuevo,
              m.observaciones,

              p.descripcion AS producto,
              p.codigo_interno,

              u.nombre AS ubicacion,

              us.nombre AS usuario

            FROM movimientos_stock m

            INNER JOIN productos p
              ON p.id =
                m.producto_id

            INNER JOIN ubicaciones u
              ON u.id =
                m.ubicacion_id

            LEFT JOIN usuarios us
              ON us.id =
                m.usuario_id

            ORDER BY
              m.created_at DESC,
              m.id DESC

            LIMIT 8;
          `);
      } else {
        ultimosMovimientos =
          await db.pool.query(
            `
              SELECT
                m.id,
                m.created_at,
                m.tipo,
                m.cantidad,
                m.stock_anterior,
                m.stock_nuevo,
                m.observaciones,

                p.descripcion AS producto,
                p.codigo_interno,

                u.nombre AS ubicacion,

                us.nombre AS usuario

              FROM movimientos_stock m

              INNER JOIN productos p
                ON p.id =
                  m.producto_id

              INNER JOIN ubicaciones u
                ON u.id =
                  m.ubicacion_id

              LEFT JOIN usuarios us
                ON us.id =
                  m.usuario_id

              WHERE
                m.ubicacion_id = $1

              ORDER BY
                m.created_at DESC,
                m.id DESC

              LIMIT 8;
            `,
            [
              usuario.ubicacion_id,
            ]
          );
      }

      // =====================================
      // RESPUESTA
      // =====================================

      res.render(
        "dashboard",
        {
          usuario,

          resumen: {
            ventasHoy,
            cantidadVentasHoy,
            cantidadProductos,

            stockFlorida,
            stockDelfin,
            stockDeposito,

            stockTotal:
              stockFlorida +
              stockDelfin +
              stockDeposito,

            cantidadStockBajo,
          },

          ultimasVentas:
            ultimasVentas.rows,

          stockBajo:
            stockBajoResultado.rows,

          ultimosMovimientos:
            ultimosMovimientos.rows,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando dashboard:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando el panel principal."
        );
    }
  }
);

module.exports = router;