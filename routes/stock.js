const express = require("express");

const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
  requiereSucursal,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// LISTADO GENERAL DE STOCK
// =========================================================

router.get(
  "/stock",
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

      const soloBajo =
        req.query.bajo === "1";

      let parametros = [];
      let filtroUbicacion = "";

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

        filtroUbicacion = `
          AND u.sucursal = (SELECT sucursal FROM ubicaciones WHERE id = $${parametros.length})
        `;
      }

      // =====================================================
      // BÚSQUEDA
      // =====================================================

      parametros.push(
        `%${buscar}%`
      );

      const indiceBuscar =
        parametros.length;

      // =====================================================
      // CONSULTA DE STOCK
      // =====================================================

      const resultado =
        await db.pool.query(
          `
            SELECT
              p.id AS producto_id,

              p.codigo_interno,
              p.codigo_barras,
              p.descripcion,

              p.stock_minimo,

              c.nombre AS categoria,
              m.nombre AS marca,

              u.id AS ubicacion_id,
              u.nombre AS ubicacion,

              COALESCE(
                s.cantidad,
                0
              ) AS cantidad,

              CASE
                WHEN
                  p.stock_minimo > 0

                  AND COALESCE(
                    s.cantidad,
                    0
                  ) <= p.stock_minimo

                THEN TRUE

                ELSE FALSE
              END AS stock_bajo

            FROM productos p

            CROSS JOIN ubicaciones u

            LEFT JOIN stock s
              ON s.producto_id = p.id
              AND s.ubicacion_id = u.id

            LEFT JOIN categorias c
              ON c.id = p.categoria_id

            LEFT JOIN marcas m
              ON m.id = p.marca_id

            WHERE
              p.activo = TRUE

              AND u.activo = TRUE

              ${filtroUbicacion}

              AND (
                $${indiceBuscar} = '%%'

                OR p.descripcion
                  ILIKE $${indiceBuscar}

                OR COALESCE(
                  p.codigo_interno,
                  ''
                )
                  ILIKE $${indiceBuscar}

                OR COALESCE(
                  p.codigo_barras,
                  ''
                )
                  ILIKE $${indiceBuscar}

                OR COALESCE(
                  c.nombre,
                  ''
                )
                  ILIKE $${indiceBuscar}

                OR COALESCE(
                  m.nombre,
                  ''
                )
                  ILIKE $${indiceBuscar}
              )

              ${
                soloBajo
                  ? `
                    AND
                      p.stock_minimo > 0

                    AND
                      COALESCE(
                        s.cantidad,
                        0
                      ) <= p.stock_minimo
                  `
                  : ""
              }

            ORDER BY
              p.descripcion,
              u.id;
          `,
          parametros
        );

      // =====================================================
      // AGRUPAR RESULTADOS POR PRODUCTO
      // =====================================================

      const productosMap =
        new Map();

      for (
        const fila
        of resultado.rows
      ) {
        if (
          !productosMap.has(
            fila.producto_id
          )
        ) {
          productosMap.set(
            fila.producto_id,
            {
              producto_id:
                fila.producto_id,

              codigo_interno:
                fila.codigo_interno,

              codigo_barras:
                fila.codigo_barras,

              descripcion:
                fila.descripcion,

              categoria:
                fila.categoria,

              marca:
                fila.marca,

              stock_minimo:
                Number(
                  fila.stock_minimo
                ) || 0,

              ubicaciones: [],
            }
          );
        }

        productosMap
          .get(
            fila.producto_id
          )
          .ubicaciones
          .push({
            ubicacion_id:
              fila.ubicacion_id,

            ubicacion:
              fila.ubicacion,

            cantidad:
              Number(
                fila.cantidad
              ) || 0,

            stock_bajo:
              Boolean(
                fila.stock_bajo
              ),
          });
      }

      const productos =
        Array.from(
          productosMap.values()
        );

      // =====================================================
      // RESUMEN DE STOCK
      // =====================================================
      //
      // Importante:
      // sólo contamos stock perteneciente a productos activos.
      // =====================================================

      let resumenQuery = `
        SELECT
          u.id,
          u.nombre,

          COALESCE(
            SUM(
              CASE
                WHEN p.activo = TRUE
                  THEN s.cantidad
                ELSE 0
              END
            ),
            0
          ) AS cantidad

        FROM ubicaciones u

        LEFT JOIN stock s
          ON s.ubicacion_id = u.id

        LEFT JOIN productos p
          ON p.id = s.producto_id

        WHERE
          u.activo = TRUE
      `;

      const resumenParams = [];

      // =====================================================
      // EMPLEADO: RESUMEN SÓLO DE SU LOCAL
      // =====================================================

      if (
        usuario.rol ===
        "empleado"
      ) {
        resumenParams.push(
          Number(
            usuario.ubicacion_id
          )
        );

        resumenQuery += `
          AND u.sucursal = (SELECT sucursal FROM ubicaciones WHERE id = $1)
        `;
      }

      resumenQuery += `
        GROUP BY
          u.id,
          u.nombre

        ORDER BY
          u.id;
      `;

      const resumenResultado =
        await db.pool.query(
          resumenQuery,
          resumenParams
        );

      // =====================================================
      // OBJETO DE RESUMEN
      // =====================================================

      const resumen = {
        "Florida Local": 0,
        "Depósito Florida": 0,
        "Delfín Gallo Local": 0,
        "Depósito Delfín Gallo": 0,
        total: 0,
      };

      for (
        const fila
        of resumenResultado.rows
      ) {
        const cantidad =
          Number(
            fila.cantidad
          ) || 0;

        resumen[
          fila.nombre
        ] = cantidad;

        resumen.total +=
          cantidad;
      }

      // =====================================================
      // UBICACIONES PARA AJUSTE MANUAL
      // =====================================================
      //
      // Sólo el dueño recibe esta lista.
      // =====================================================

      let ubicaciones = [];

      if (
        usuario.rol === "dueno"
      ) {
        const ubicacionesResultado =
          await db.pool.query(`
            SELECT
              id,
              nombre,
              tipo

            FROM ubicaciones

            WHERE
              activo = TRUE

            ORDER BY
              id;
          `);

        ubicaciones =
          ubicacionesResultado.rows;
      }

      // =====================================================
      // RENDER
      // =====================================================

      return res.render(
        "stock",
        {
          usuario,

          productos,

          resumen,

          ubicaciones,

          buscar,

          soloBajo,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando stock:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando stock."
        );
    }
  }
);

// =========================================================
// AJUSTE MANUAL DE STOCK
// =========================================================

router.post(
  "/stock/ajustar",
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

      const productoId =
        Number(
          req.body.producto_id
        );

      const ubicacionId =
        Number(
          req.body.ubicacion_id
        );

      const nuevaCantidad =
        Number(
          req.body.cantidad
        );

      const motivo =
        String(
          req.body.motivo || ""
        ).trim();

      // =====================================================
      // VALIDACIONES
      // =====================================================

      if (
        !productoId ||
        !ubicacionId
      ) {
        throw new Error(
          "Producto o ubicación inválidos."
        );
      }

      if (
        !Number.isFinite(
          nuevaCantidad
        ) ||
        nuevaCantidad < 0
      ) {
        throw new Error(
          "La cantidad debe ser igual o mayor a cero."
        );
      }

      if (!motivo) {
        throw new Error(
          "Debés indicar el motivo del ajuste."
        );
      }

      // =====================================================
      // INICIAR TRANSACCIÓN
      // =====================================================

      await client.query(
        "BEGIN"
      );

      transaccionIniciada =
        true;

      // =====================================================
      // VALIDAR PRODUCTO
      // =====================================================

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
        producto.rows.length ===
        0
      ) {
        throw new Error(
          "Producto no encontrado o inactivo."
        );
      }

      // =====================================================
      // VALIDAR UBICACIÓN
      // =====================================================

      const ubicacion =
        await client.query(
          `
            SELECT
              id,
              nombre,
              tipo

            FROM ubicaciones

            WHERE
              id = $1
              AND activo = TRUE

            LIMIT 1;
          `,
          [
            ubicacionId,
          ]
        );

      if (
        ubicacion.rows.length ===
        0
      ) {
        throw new Error(
          "Ubicación no encontrada."
        );
      }

      // =====================================================
      // GARANTIZAR REGISTRO DE STOCK
      // =====================================================

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
          ubicacionId,
        ]
      );

      // =====================================================
      // BLOQUEAR STOCK
      // =====================================================

      const stockActual =
        await client.query(
          `
            SELECT
              id,
              cantidad

            FROM stock

            WHERE
              producto_id = $1
              AND ubicacion_id = $2

            FOR UPDATE;
          `,
          [
            productoId,
            ubicacionId,
          ]
        );

      if (
        stockActual.rows.length ===
        0
      ) {
        throw new Error(
          "No se pudo obtener el stock actual."
        );
      }

      const cantidadAnterior =
        Number(
          stockActual.rows[0]
            .cantidad
        ) || 0;

      const diferencia =
        nuevaCantidad -
        cantidadAnterior;

      // =====================================================
      // SIN CAMBIOS
      // =====================================================

      if (
        diferencia === 0
      ) {
        await client.query(
          "COMMIT"
        );

        transaccionIniciada =
          false;

        return res.redirect(
          "/stock?ok=" +
          encodeURIComponent(
            "El stock ya tenía esa cantidad."
          )
        );
      }

      // =====================================================
      // ACTUALIZAR STOCK
      // =====================================================

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
          nuevaCantidad,
          productoId,
          ubicacionId,
        ]
      );

      // =====================================================
      // TIPO DE MOVIMIENTO
      // =====================================================

      const tipo =
        diferencia > 0
          ? "ajuste_positivo"
          : "ajuste_negativo";

      // =====================================================
      // REGISTRAR MOVIMIENTO
      // =====================================================

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

            $3,
            $4,

            $5,
            $6,

            'ajuste_manual',
            NULL,

            $7,

            $8
          );
        `,
        [
          productoId,
          ubicacionId,

          tipo,
          diferencia,

          cantidadAnterior,
          nuevaCantidad,

          motivo,

          usuario.id,
        ]
      );

      // =====================================================
      // CONFIRMAR
      // =====================================================

      await client.query(
        "COMMIT"
      );

      transaccionIniciada =
        false;

      return res.redirect(
        "/stock?ok=" +
        encodeURIComponent(
          `Stock de ${producto.rows[0].descripcion} actualizado correctamente.`
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
        "Error ajustando stock:",
        error
      );

      return res.redirect(
        "/stock?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo ajustar el stock."
        )
      );
    } finally {
      client.release();
    }
  }
);

module.exports = router;