const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
  requiereSucursal,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// LISTADO DE VENTAS
// =========================================================

router.get(
  "/ventas",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const desde =
        String(
          req.query.desde || ""
        ).trim();

      const hasta =
        String(
          req.query.hasta || ""
        ).trim();

      const buscar =
        String(
          req.query.buscar || ""
        ).trim();

      const sucursalId =
        Number(
          req.query.sucursal_id
        ) || null;

      const estado =
        String(
          req.query.estado || ""
        ).trim();

      const parametros = [];
      const condiciones = [
        "1 = 1",
      ];

      // =====================================================
      // RESTRICCIÓN POR EMPLEADO
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
          `v.ubicacion_id = $${parametros.length}`
        );
      } else if (
        sucursalId
      ) {
        parametros.push(
          sucursalId
        );

        condiciones.push(
          `v.ubicacion_id = $${parametros.length}`
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
          `v.created_at::date >= $${parametros.length}::date`
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
          `v.created_at::date <= $${parametros.length}::date`
        );
      }

      // =====================================================
      // ESTADO
      // =====================================================

      if (
        estado === "confirmada" ||
        estado === "anulada"
      ) {
        parametros.push(
          estado
        );

        condiciones.push(
          `v.estado = $${parametros.length}`
        );
      }

      // =====================================================
      // BUSCADOR
      // =====================================================

      if (buscar) {
        parametros.push(
          `%${buscar}%`
        );

        const indice =
          parametros.length;

        condiciones.push(`
          (
            CAST(
              v.numero AS TEXT
            ) ILIKE $${indice}

            OR COALESCE(
              v.cliente_nombre,
              ''
            ) ILIKE $${indice}

            OR COALESCE(
              v.cliente_documento,
              ''
            ) ILIKE $${indice}

            OR COALESCE(
              v.cliente_telefono,
              ''
            ) ILIKE $${indice}

            OR u.nombre
              ILIKE $${indice}

            OR us.nombre
              ILIKE $${indice}
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
              v.id,
              v.numero,
              v.created_at,

              v.cliente_nombre,

              v.subtotal,
              v.descuento,
              v.recargo,
              v.total,

              v.estado,

              u.nombre AS ubicacion,
              us.nombre AS vendedor,

              fp.nombre AS forma_pago,

              t.nombre AS tarjeta,

              v.cuotas

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

            LEFT JOIN tarjetas t
              ON t.id =
                v.tarjeta_id

            WHERE
              ${condiciones.join(
                "\n AND "
              )}

            ORDER BY
              v.created_at DESC

            LIMIT 500;
          `,
          parametros
        );

      // =====================================================
      // RESUMEN
      // =====================================================

      let totalConfirmadas = 0;
      let cantidadConfirmadas = 0;
      let cantidadAnuladas = 0;

      for (
        const venta
        of resultado.rows
      ) {
        if (
          venta.estado ===
          "confirmada"
        ) {
          totalConfirmadas +=
            Number(
              venta.total
            ) || 0;

          cantidadConfirmadas +=
            1;
        }

        if (
          venta.estado ===
          "anulada"
        ) {
          cantidadAnuladas +=
            1;
        }
      }

      // =====================================================
      // SUCURSALES PARA FILTRO
      // =====================================================

      let sucursales = [];

      if (
        usuario.rol === "dueno"
      ) {
        const resultadoSucursales =
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

        sucursales =
          resultadoSucursales.rows;
      }

      // =====================================================
      // RENDER
      // =====================================================

      return res.render(
        "ventas",
        {
          usuario,

          ventas:
            resultado.rows,

          sucursales,

          filtros: {
            desde,
            hasta,
            buscar,
            sucursalId,
            estado,
          },

          resumen: {
            totalConfirmadas,
            cantidadConfirmadas,
            cantidadAnuladas,
          },

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando ventas:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando ventas."
        );
    }
  }
);

// =========================================================
// DETALLE DE VENTA
// =========================================================

router.get(
  "/ventas/:id",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      const ventaId =
        Number(
          req.params.id
        );

      if (!ventaId) {
        return res
          .status(404)
          .send(
            "Venta no encontrada."
          );
      }

      const parametros = [
        ventaId,
      ];

      let filtroEmpleado = "";

      // =====================================================
      // EMPLEADO: SOLAMENTE SU SUCURSAL
      // =====================================================

      if (
        usuario.rol ===
        "empleado"
      ) {
        parametros.push(
          Number(
            usuario.ubicacion_id
          )
        );

        filtroEmpleado = `
          AND v.ubicacion_id =
            $${parametros.length}
        `;
      }

      // =====================================================
      // VENTA
      // =====================================================

      const ventaResultado =
        await db.pool.query(
          `
            SELECT
              v.*,

              ub.nombre AS ubicacion,

              us.nombre AS vendedor,

              fp.nombre AS forma_pago,
              fp.tipo AS tipo_pago,

              t.nombre AS tarjeta

            FROM ventas v

            INNER JOIN ubicaciones ub
              ON ub.id =
                v.ubicacion_id

            INNER JOIN usuarios us
              ON us.id =
                v.usuario_id

            LEFT JOIN formas_pago fp
              ON fp.id =
                v.forma_pago_id

            LEFT JOIN tarjetas t
              ON t.id =
                v.tarjeta_id

            WHERE
              v.id = $1

              ${filtroEmpleado}

            LIMIT 1;
          `,
          parametros
        );

      if (
        ventaResultado.rows.length ===
        0
      ) {
        // No revelamos si existe en otra sucursal.
        return res
          .status(404)
          .send(
            "Venta no encontrada."
          );
      }

      // =====================================================
      // ITEMS
      // =====================================================

      const itemsResultado =
        await db.pool.query(
          `
            SELECT
              vi.id,
              vi.producto_id,
              vi.descripcion,
              vi.cantidad,
              vi.precio_unitario,
              vi.subtotal,

              p.codigo_interno,
              p.codigo_barras

            FROM venta_items vi

            LEFT JOIN productos p
              ON p.id =
                vi.producto_id

            WHERE
              vi.venta_id = $1

            ORDER BY
              vi.id;
          `,
          [
            ventaId,
          ]
        );

      return res.render(
        "venta-detalle",
        {
          usuario,

          venta:
            ventaResultado.rows[0],

          items:
            itemsResultado.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando venta:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando detalle de venta."
        );
    }
  }
);

// =========================================================
// ANULAR VENTA
// =========================================================

router.post(
  "/ventas/:id/anular",
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

      const ventaId =
        Number(
          req.params.id
        );

      const motivo =
        String(
          req.body.motivo || ""
        ).trim();

      // =====================================================
      // VALIDACIONES
      // =====================================================

      if (!ventaId) {
        throw new Error(
          "Venta inválida."
        );
      }

      if (!motivo) {
        throw new Error(
          "Debés indicar el motivo de la anulación."
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
      // BLOQUEAR VENTA
      // =====================================================

      const ventaResultado =
        await client.query(
          `
            SELECT
              id,
              numero,
              ubicacion_id,
              estado

            FROM ventas

            WHERE
              id = $1

            FOR UPDATE;
          `,
          [
            ventaId,
          ]
        );

      if (
        ventaResultado.rows.length ===
        0
      ) {
        throw new Error(
          "Venta no encontrada."
        );
      }

      const venta =
        ventaResultado.rows[0];

      if (
        venta.estado ===
        "anulada"
      ) {
        throw new Error(
          "La venta ya está anulada."
        );
      }

      if (
        venta.estado !==
        "confirmada"
      ) {
        throw new Error(
          "La venta no se encuentra confirmada."
        );
      }

      // =====================================================
      // VALIDAR SUCURSAL
      // =====================================================

      const ubicacionResultado =
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
            venta.ubicacion_id,
          ]
        );

      if (
        ubicacionResultado.rows.length ===
        0
      ) {
        throw new Error(
          "La sucursal de la venta no es válida."
        );
      }

      // =====================================================
      // ITEMS
      // =====================================================

      const itemsResultado =
        await client.query(
          `
            SELECT
              producto_id,
              descripcion,
              cantidad

            FROM venta_items

            WHERE
              venta_id = $1

            ORDER BY
              producto_id;
          `,
          [
            ventaId,
          ]
        );

      if (
        itemsResultado.rows.length ===
        0
      ) {
        throw new Error(
          "La venta no tiene productos."
        );
      }

      // =====================================================
      // DEVOLVER STOCK
      // =====================================================

      for (
        const item
        of itemsResultado.rows
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
            "La venta contiene un producto inválido."
          );
        }

        // ===================================================
        // GARANTIZAR REGISTRO
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
            venta.ubicacion_id,
          ]
        );

        // ===================================================
        // BLOQUEAR STOCK
        // ===================================================

        const stockResultado =
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
              venta.ubicacion_id,
            ]
          );

        if (
          stockResultado.rows.length ===
          0
        ) {
          throw new Error(
            `No se pudo consultar el stock de ${item.descripcion}.`
          );
        }

        const stockAnterior =
          Number(
            stockResultado
              .rows[0]
              .cantidad
          ) || 0;

        const stockNuevo =
          stockAnterior +
          cantidad;

        // ===================================================
        // DEVOLVER EXISTENCIA
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
            stockNuevo,
            productoId,
            venta.ubicacion_id,
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

              'anulacion_venta',
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
            productoId,
            venta.ubicacion_id,

            cantidad,

            stockAnterior,
            stockNuevo,

            ventaId,

            `Anulación venta #${venta.numero} · ${motivo}`,

            usuario.id,
          ]
        );
      }

      // =====================================================
      // MARCAR VENTA COMO ANULADA
      // =====================================================

      await client.query(
        `
          UPDATE ventas

          SET
            estado = 'anulada',

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
          `ANULADA: ${motivo}`,
          ventaId,
        ]
      );

      // =====================================================
      // CONFIRMAR TODO
      // =====================================================

      await client.query(
        "COMMIT"
      );

      transaccionIniciada =
        false;

      return res.redirect(
        `/ventas/${ventaId}?ok=` +
        encodeURIComponent(
          `Venta #${venta.numero} anulada correctamente. El stock fue devuelto.`
        )
      );
    } catch (error) {
      // =====================================================
      // ROLLBACK SEGURO
      // =====================================================

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
        "Error anulando venta:",
        error
      );

      return res.redirect(
        `/ventas/${req.params.id}?error=` +
        encodeURIComponent(
          error.message ||
          "No se pudo anular la venta."
        )
      );
    } finally {
      client.release();
    }
  }
);

module.exports = router;