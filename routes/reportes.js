const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// REPORTES
// =========================================================

router.get(
  "/reportes",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const desde =
        String(
          req.query.desde || ""
        ).trim();

      const hasta =
        String(
          req.query.hasta || ""
        ).trim();

      let sucursalId =
        Number(
          req.query.sucursal_id
        ) || null;

      // =====================================================
      // VALIDAR RANGO DE FECHAS
      // =====================================================

      if (
        desde &&
        hasta &&
        desde > hasta
      ) {
        return res.redirect(
          "/reportes?error=" +
          encodeURIComponent(
            "La fecha desde no puede ser posterior a la fecha hasta."
          )
        );
      }

      // =====================================================
      // VALIDAR SUCURSAL
      // =====================================================

      if (sucursalId) {
        const sucursalResultado =
          await db.pool.query(
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
            [sucursalId]
          );

        if (
          sucursalResultado.rows.length ===
          0
        ) {
          sucursalId =
            null;
        }
      }

      // =====================================================
      // CONDICIONES DE VENTAS
      // =====================================================

      const parametros = [];

      const condiciones = [
        "v.estado = 'confirmada'",
      ];

      // =====================================================
      // FILTRO SUCURSAL
      // =====================================================

      if (sucursalId) {
        parametros.push(
          sucursalId
        );

        condiciones.push(
          `v.ubicacion_id = $${parametros.length}`
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
          `v.created_at::date >= $${parametros.length}::date`
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
          `v.created_at::date <= $${parametros.length}::date`
        );
      }

      const whereVentas =
        condiciones.join(
          "\n AND "
        );

      // =====================================================
      // RESUMEN GENERAL
      // =====================================================

      const resumenResultado =
        await db.pool.query(
          `
            SELECT
              COUNT(*) AS cantidad_ventas,

              COALESCE(
                SUM(v.subtotal),
                0
              ) AS subtotal,

              COALESCE(
                SUM(v.descuento),
                0
              ) AS descuentos,

              COALESCE(
                SUM(v.recargo),
                0
              ) AS recargos,

              COALESCE(
                SUM(v.total),
                0
              ) AS facturacion

            FROM ventas v

            WHERE
              ${whereVentas};
          `,
          parametros
        );

      const resumenBase =
        resumenResultado.rows[0];

      // =====================================================
      // COSTO ESTIMADO
      // =====================================================

      const costoResultado =
        await db.pool.query(
          `
            SELECT
              COALESCE(
                SUM(
                  vi.cantidad *
                  COALESCE(
                    p.precio_compra,
                    0
                  )
                ),
                0
              ) AS costo_estimado

            FROM ventas v

            INNER JOIN venta_items vi
              ON vi.venta_id = v.id

            LEFT JOIN productos p
              ON p.id = vi.producto_id

            WHERE
              ${whereVentas};
          `,
          parametros
        );

      const costoEstimado =
        Number(
          costoResultado
            .rows[0]
            .costo_estimado
        ) || 0;

      const facturacion =
        Number(
          resumenBase.facturacion
        ) || 0;

      const gananciaEstimada =
        facturacion -
        costoEstimado;

      // =====================================================
      // VENTAS POR SUCURSAL
      // =====================================================

      const porSucursal =
        await db.pool.query(
          `
            SELECT
              u.nombre AS sucursal,

              COUNT(
                v.id
              ) AS cantidad_ventas,

              COALESCE(
                SUM(v.total),
                0
              ) AS total

            FROM ventas v

            INNER JOIN ubicaciones u
              ON u.id =
                v.ubicacion_id

            WHERE
              ${whereVentas}

            GROUP BY
              u.id,
              u.nombre

            ORDER BY
              total DESC;
          `,
          parametros
        );

      // =====================================================
      // FORMAS DE PAGO
      // =====================================================

      const formasPago =
        await db.pool.query(
          `
            SELECT
              COALESCE(
                fp.nombre,
                'Sin especificar'
              ) AS forma_pago,

              COUNT(
                v.id
              ) AS cantidad,

              COALESCE(
                SUM(v.total),
                0
              ) AS total

            FROM ventas v

            LEFT JOIN formas_pago fp
              ON fp.id =
                v.forma_pago_id

            WHERE
              ${whereVentas}

            GROUP BY
              fp.id,
              fp.nombre

            ORDER BY
              total DESC;
          `,
          parametros
        );

      // =====================================================
      // PRODUCTOS MÁS VENDIDOS
      // =====================================================

      const productosVendidos =
        await db.pool.query(
          `
            SELECT
              p.id,
              p.descripcion,
              p.codigo_interno,

              COALESCE(
                SUM(
                  vi.cantidad
                ),
                0
              ) AS cantidad_vendida,

              COALESCE(
                SUM(
                  vi.subtotal
                ),
                0
              ) AS facturacion

            FROM ventas v

            INNER JOIN venta_items vi
              ON vi.venta_id =
                v.id

            LEFT JOIN productos p
              ON p.id =
                vi.producto_id

            WHERE
              ${whereVentas}

            GROUP BY
              p.id,
              p.descripcion,
              p.codigo_interno

            ORDER BY
              cantidad_vendida DESC,
              facturacion DESC

            LIMIT 20;
          `,
          parametros
        );

      // =====================================================
      // STOCK VALORIZADO
      // =====================================================
      //
      // Este resumen siempre es global porque es un reporte
      // administrativo del dueño.
      // =====================================================

      const stockValorizado =
        await db.pool.query(`
          SELECT
            u.nombre AS ubicacion,

            COALESCE(
              SUM(
                CASE
                  WHEN p.activo = TRUE
                  THEN s.cantidad
                  ELSE 0
                END
              ),
              0
            ) AS unidades,

            COALESCE(
              SUM(
                CASE
                  WHEN p.activo = TRUE
                  THEN
                    s.cantidad *
                    COALESCE(
                      p.precio_compra,
                      0
                    )

                  ELSE 0
                END
              ),
              0
            ) AS valor_costo,

            COALESCE(
              SUM(
                CASE
                  WHEN p.activo = TRUE
                  THEN
                    s.cantidad *
                    COALESCE(
                      p.precio_efectivo,
                      0
                    )

                  ELSE 0
                END
              ),
              0
            ) AS valor_venta

          FROM ubicaciones u

          LEFT JOIN stock s
            ON s.ubicacion_id =
              u.id

          LEFT JOIN productos p
            ON p.id =
              s.producto_id

          WHERE
            u.activo = TRUE

          GROUP BY
            u.id,
            u.nombre

          ORDER BY
            u.id;
        `);

      // =====================================================
      // SUCURSALES PARA FILTRO
      // =====================================================

      const sucursalesResultado =
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

      // =====================================================
      // ÚLTIMAS VENTAS DEL PERÍODO
      // =====================================================

      const ultimasVentas =
        await db.pool.query(
          `
            SELECT
              v.id,
              v.numero,
              v.created_at,
              v.total,

              u.nombre AS sucursal,

              us.nombre AS vendedor,

              COALESCE(
                v.cliente_nombre,
                'Consumidor final'
              ) AS cliente

            FROM ventas v

            INNER JOIN ubicaciones u
              ON u.id =
                v.ubicacion_id

            INNER JOIN usuarios us
              ON us.id =
                v.usuario_id

            WHERE
              ${whereVentas}

            ORDER BY
              v.created_at DESC

            LIMIT 15;
          `,
          parametros
        );

      // =====================================================
      // RENDER
      // =====================================================

      return res.render(
        "reportes",
        {
          usuario:
            req.session.usuario,

          filtros: {
            desde,
            hasta,
            sucursalId,
          },

          sucursales:
            sucursalesResultado.rows,

          resumen: {
            cantidadVentas:
              Number(
                resumenBase
                  .cantidad_ventas
              ) || 0,

            subtotal:
              Number(
                resumenBase.subtotal
              ) || 0,

            descuentos:
              Number(
                resumenBase.descuentos
              ) || 0,

            recargos:
              Number(
                resumenBase.recargos
              ) || 0,

            facturacion,

            costoEstimado,

            gananciaEstimada,
          },

          porSucursal:
            porSucursal.rows,

          formasPago:
            formasPago.rows,

          productosVendidos:
            productosVendidos.rows,

          stockValorizado:
            stockValorizado.rows,

          ultimasVentas:
            ultimasVentas.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando reportes:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando reportes."
        );
    }
  }
);

module.exports = router;