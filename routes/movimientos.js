const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// HISTORIAL DE MOVIMIENTOS
// =========================================================

router.get(
  "/movimientos",
  requiereLogin,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const buscar =
        String(
          req.query.buscar || ""
        ).trim();

      const tipo =
        String(
          req.query.tipo || ""
        ).trim();

      const desde =
        String(
          req.query.desde || ""
        ).trim();

      const hasta =
        String(
          req.query.hasta || ""
        ).trim();

      const ubicacionId =
        Number(
          req.query.ubicacion_id
        ) || null;

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
          usuario.ubicacion_id
        );

        condiciones.push(
          `m.ubicacion_id = $${parametros.length}`
        );
      } else if (
        ubicacionId
      ) {
        parametros.push(
          ubicacionId
        );

        condiciones.push(
          `m.ubicacion_id = $${parametros.length}`
        );
      }

      // =====================================================
      // TIPO
      // =====================================================

      const tiposValidos = [
        "venta",
        "transferencia_entrada",
        "transferencia_salida",
        "ingreso_mercaderia",
        "ajuste_positivo",
        "ajuste_negativo",
        "devolucion",
        "anulacion_venta",
      ];

      if (
        tiposValidos.includes(
          tipo
        )
      ) {
        parametros.push(
          tipo
        );

        condiciones.push(
          `m.tipo = $${parametros.length}`
        );
      }

      // =====================================================
      // FECHA DESDE
      // =====================================================

      if (desde) {
        parametros.push(
          desde
        );

        condiciones.push(
          `m.created_at::date >= $${parametros.length}::date`
        );
      }

      // =====================================================
      // FECHA HASTA
      // =====================================================

      if (hasta) {
        parametros.push(
          hasta
        );

        condiciones.push(
          `m.created_at::date <= $${parametros.length}::date`
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
            p.descripcion ILIKE $${i}

            OR COALESCE(
              p.codigo_interno,
              ''
            ) ILIKE $${i}

            OR COALESCE(
              p.codigo_barras,
              ''
            ) ILIKE $${i}

            OR u.nombre ILIKE $${i}

            OR COALESCE(
              us.nombre,
              ''
            ) ILIKE $${i}

            OR COALESCE(
              m.observaciones,
              ''
            ) ILIKE $${i}

            OR COALESCE(
              m.referencia_tipo,
              ''
            ) ILIKE $${i}

            OR CAST(
              m.referencia_id AS TEXT
            ) ILIKE $${i}
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
              m.id,
              m.created_at,

              m.tipo,
              m.cantidad,

              m.stock_anterior,
              m.stock_nuevo,

              m.referencia_tipo,
              m.referencia_id,

              m.observaciones,

              p.id AS producto_id,
              p.descripcion AS producto,
              p.codigo_interno,
              p.codigo_barras,

              u.id AS ubicacion_id,
              u.nombre AS ubicacion,

              us.nombre AS usuario

            FROM movimientos_stock m

            INNER JOIN productos p
              ON p.id = m.producto_id

            INNER JOIN ubicaciones u
              ON u.id = m.ubicacion_id

            LEFT JOIN usuarios us
              ON us.id = m.usuario_id

            WHERE
              ${condiciones.join(
                "\n AND "
              )}

            ORDER BY
              m.created_at DESC,
              m.id DESC

            LIMIT 1000;
          `,
          parametros
        );

      // =====================================================
      // RESUMEN
      // =====================================================

      let entradas = 0;
      let salidas = 0;
      let cantidadMovimientos = 0;

      resultado.rows.forEach(
        movimiento => {
          const cantidad =
            Number(
              movimiento.cantidad
            ) || 0;

          cantidadMovimientos++;

          if (
            cantidad > 0
          ) {
            entradas +=
              cantidad;
          }

          if (
            cantidad < 0
          ) {
            salidas +=
              Math.abs(
                cantidad
              );
          }
        }
      );

      // =====================================================
      // UBICACIONES PARA FILTRO
      // =====================================================

      let ubicaciones = [];

      if (
        usuario.rol === "dueno"
      ) {
        const ubicacionesResultado =
          await db.pool.query(`
            SELECT
              id,
              nombre

            FROM ubicaciones

            WHERE activo = TRUE

            ORDER BY id;
          `);

        ubicaciones =
          ubicacionesResultado.rows;
      }

      res.render(
        "movimientos",
        {
          usuario,

          movimientos:
            resultado.rows,

          ubicaciones,

          filtros: {
            buscar,
            tipo,
            desde,
            hasta,
            ubicacionId,
          },

          resumen: {
            entradas,
            salidas,
            cantidadMovimientos,
          },
        }
      );
    } catch (error) {
      console.error(
        "Error cargando historial:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando historial."
        );
    }
  }
);

module.exports = router;