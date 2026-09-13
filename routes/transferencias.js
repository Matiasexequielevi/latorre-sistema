const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  requiereSucursal,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// LISTADO + FORMULARIO
// =========================================================

router.get(
  "/transferencias",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario = req.session.usuario;
      const ubicaciones = usuario.rol === "dueno"
        ? await db.pool.query(`SELECT id,nombre,tipo FROM ubicaciones WHERE activo=TRUE ORDER BY id`)
        : await db.pool.query(`SELECT id,nombre,tipo FROM ubicaciones WHERE activo=TRUE AND sucursal=(SELECT sucursal FROM ubicaciones WHERE id=$1) ORDER BY id`,[usuario.ubicacion_id]);

      const ultimas =
        await db.pool.query(`
          SELECT
            t.id,
            t.numero,
            t.created_at,
            t.estado,
            t.observaciones,

            origen.nombre AS origen,
            destino.nombre AS destino,

            u.nombre AS usuario,

            COALESCE(
              SUM(ti.cantidad),
              0
            ) AS unidades

          FROM transferencias t

          INNER JOIN ubicaciones origen
            ON origen.id = t.origen_id

          INNER JOIN ubicaciones destino
            ON destino.id = t.destino_id

          INNER JOIN usuarios u
            ON u.id = t.usuario_id

          LEFT JOIN transferencia_items ti
            ON ti.transferencia_id = t.id

          GROUP BY
            t.id,
            origen.nombre,
            destino.nombre,
            u.nombre

          ORDER BY
            t.created_at DESC

          LIMIT 30;
        `);

      res.render(
        "transferencias",
        {
          usuario:
            req.session.usuario,

          ubicaciones:
            ubicaciones.rows,

          transferencias:
            ultimas.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando transferencias:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando transferencias."
        );
    }
  }
);

// =========================================================
// BUSCAR PRODUCTO
// =========================================================

router.get(
  "/transferencias/api/productos",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario = req.session.usuario;
      const buscar =
        String(
          req.query.buscar || ""
        ).trim();

      const ubicacionId =
        Number(
          req.query.ubicacion_id
        );

      if (
        !buscar ||
        !ubicacionId
      ) {
        return res.json([]);
      }

      // =====================================================
      // VALIDAR UBICACIÓN
      // =====================================================

      const ubicacion =
        await db.pool.query(
          `
            SELECT id

            FROM ubicaciones

            WHERE
              id = $1
              AND activo = TRUE
              AND ($2::boolean = TRUE OR sucursal=(SELECT sucursal FROM ubicaciones WHERE id=$3))
            LIMIT 1;
          `,
          [ubicacionId, usuario.rol === "dueno", usuario.ubicacion_id]
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
              p.precio_efectivo,

              COALESCE(
                s.cantidad,
                0
              ) AS stock

            FROM productos p

            LEFT JOIN stock s
              ON s.producto_id = p.id
              AND s.ubicacion_id = $1

            WHERE
              p.activo = TRUE

              AND (
                p.descripcion ILIKE $2

                OR COALESCE(
                  p.codigo_interno,
                  ''
                ) ILIKE $2

                OR COALESCE(
                  p.codigo_barras,
                  ''
                ) ILIKE $2
              )

            ORDER BY
              CASE
                WHEN p.codigo_barras = $3
                  THEN 0

                WHEN p.codigo_interno = $3
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

            stock:
              Number(
                producto.stock
              ) || 0,

            precio_efectivo:
              Number(
                producto.precio_efectivo
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
// CREAR TRANSFERENCIA
// =========================================================

router.post(
  "/transferencias",
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

      const origenId =
        Number(
          req.body.origen_id
        );

      const destinoId =
        Number(
          req.body.destino_id
        );

      const observaciones =
        String(
          req.body.observaciones ||
          ""
        ).trim() || null;

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
            "Los productos de la transferencia no son válidos."
          );
        }
      }

      // =====================================================
      // VALIDACIONES GENERALES
      // =====================================================

      if (
        !origenId ||
        !destinoId
      ) {
        throw new Error(
          "Seleccioná origen y destino."
        );
      }

      if (
        origenId ===
        destinoId
      ) {
        throw new Error(
          "El origen y el destino no pueden ser iguales."
        );
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
      // NORMALIZAR ITEMS
      // =====================================================
      //
      // Si por algún motivo el mismo producto llega
      // dos veces desde el navegador, agrupamos cantidades.
      // Así nunca procesamos dos veces el mismo stock.
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
      // VALIDAR UBICACIONES
      // =====================================================

      const ubicaciones =
        await client.query(
          `
            SELECT
              id,
              nombre,
              tipo,
              sucursal

            FROM ubicaciones

            WHERE
              id IN ($1, $2)
              AND activo = TRUE

            FOR UPDATE;
          `,
          [
            origenId,
            destinoId,
          ]
        );

      if (
        ubicaciones.rows.length !==
        2
      ) {
        throw new Error(
          "Origen o destino inválidos."
        );
      }

      if (usuario.rol === "empleado") {
        const propia = await client.query(`SELECT sucursal FROM ubicaciones WHERE id=$1`,[usuario.ubicacion_id]);
        const sucursal = propia.rows[0] && propia.rows[0].sucursal;
        if (!sucursal || ubicaciones.rows.some(u => u.sucursal !== sucursal)) {
          throw new Error("Sólo podés transferir entre el local y depósito de tu sucursal.");
        }
      }

      // =====================================================
      // NUMERACIÓN
      // =====================================================
      //
      // Bloqueamos la tabla durante la obtención del próximo
      // número para evitar dos transferencias con el mismo
      // número si se confirman simultáneamente.
      // =====================================================

      await client.query(
        `
          LOCK TABLE transferencias
          IN SHARE ROW EXCLUSIVE MODE;
        `
      );

      const numeroResultado =
        await client.query(`
          SELECT
            COALESCE(
              MAX(numero),
              0
            ) + 1 AS numero

          FROM transferencias;
        `);

      const numero =
        Number(
          numeroResultado
            .rows[0]
            .numero
        );

      // =====================================================
      // CREAR CABECERA
      // =====================================================

      const transferencia =
        await client.query(
          `
            INSERT INTO transferencias (
              numero,
              origen_id,
              destino_id,
              usuario_id,
              observaciones
            )

            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5
            )

            RETURNING id;
          `,
          [
            numero,
            origenId,
            destinoId,
            usuario.id,
            observaciones,
          ]
        );

      const transferenciaId =
        transferencia.rows[0].id;

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
        // VALIDAR PRODUCTO
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
          producto.rows.length ===
          0
        ) {
          throw new Error(
            "Uno de los productos no existe o está inactivo."
          );
        }

        const descripcion =
          producto.rows[0]
            .descripcion;

        // ===================================================
        // GARANTIZAR STOCK ORIGEN
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
            origenId,
          ]
        );

        // ===================================================
        // GARANTIZAR STOCK DESTINO
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
            destinoId,
          ]
        );

        // ===================================================
        // BLOQUEAR STOCK
        // ===================================================
        //
        // Bloqueamos ambas filas en un orden fijo por
        // ubicacion_id para reducir riesgo de deadlocks.
        // ===================================================

        const stocks =
          await client.query(
            `
              SELECT
                ubicacion_id,
                cantidad

              FROM stock

              WHERE
                producto_id = $1

                AND ubicacion_id
                  IN ($2, $3)

              ORDER BY
                ubicacion_id

              FOR UPDATE;
            `,
            [
              productoId,
              origenId,
              destinoId,
            ]
          );

        if (
          stocks.rows.length !==
          2
        ) {
          throw new Error(
            `No se pudo consultar correctamente el stock de ${descripcion}.`
          );
        }

        const filaOrigen =
          stocks.rows.find(
            fila =>
              Number(
                fila.ubicacion_id
              ) === origenId
          );

        const filaDestino =
          stocks.rows.find(
            fila =>
              Number(
                fila.ubicacion_id
              ) === destinoId
          );

        if (
          !filaOrigen ||
          !filaDestino
        ) {
          throw new Error(
            `No se pudo determinar el stock de ${descripcion}.`
          );
        }

        const anteriorOrigen =
          Number(
            filaOrigen.cantidad
          ) || 0;

        const anteriorDestino =
          Number(
            filaDestino.cantidad
          ) || 0;

        // ===================================================
        // VALIDAR STOCK
        // ===================================================

        if (
          anteriorOrigen <
          cantidad
        ) {
          throw new Error(
            `Stock insuficiente para ${descripcion}. Disponible: ${anteriorOrigen}.`
          );
        }

        const nuevoOrigen =
          anteriorOrigen -
          cantidad;

        const nuevoDestino =
          anteriorDestino +
          cantidad;

        // ===================================================
        // RESTAR ORIGEN
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
            nuevoOrigen,
            productoId,
            origenId,
          ]
        );

        // ===================================================
        // SUMAR DESTINO
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
            nuevoDestino,
            productoId,
            destinoId,
          ]
        );

        // ===================================================
        // ITEM DE TRANSFERENCIA
        // ===================================================

        await client.query(
          `
            INSERT INTO transferencia_items (
              transferencia_id,
              producto_id,
              cantidad
            )

            VALUES (
              $1,
              $2,
              $3
            );
          `,
          [
            transferenciaId,
            productoId,
            cantidad,
          ]
        );

        // ===================================================
        // MOVIMIENTO DE SALIDA
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

              'transferencia_salida',
              $3,

              $4,
              $5,

              'transferencia',
              $6,

              $7,

              $8
            );
          `,
          [
            productoId,
            origenId,

            -cantidad,

            anteriorOrigen,
            nuevoOrigen,

            transferenciaId,

            observaciones,

            usuario.id,
          ]
        );

        // ===================================================
        // MOVIMIENTO DE ENTRADA
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

              'transferencia_entrada',
              $3,

              $4,
              $5,

              'transferencia',
              $6,

              $7,

              $8
            );
          `,
          [
            productoId,
            destinoId,

            cantidad,

            anteriorDestino,
            nuevoDestino,

            transferenciaId,

            observaciones,

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
        "/transferencias?ok=" +
        encodeURIComponent(
          `Transferencia #${numero} registrada correctamente.`
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
        "Error creando transferencia:",
        error
      );

      return res.redirect(
        "/transferencias?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo registrar la transferencia."
        )
      );
    } finally {
      client.release();
    }
  }
);

module.exports = router;