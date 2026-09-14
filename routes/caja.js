const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  requiereSucursal,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// CAJA
// =========================================================

router.get(
  "/caja",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario =
        req.session.usuario;

      let ubicaciones = [];

      // =====================================================
      // DUEÑO: PUEDE ELEGIR LOCAL
      // EMPLEADO: QUEDA FIJO A SU SUCURSAL
      // =====================================================

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

          WHERE activo = TRUE

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

          WHERE activo = TRUE

          ORDER BY nombre;
        `);

      const cajaResultado = await db.pool.query(`
        SELECT c.id, c.apertura_at, c.monto_inicial, ub.nombre AS ubicacion
        FROM cajas c JOIN ubicaciones ub ON ub.id=c.ubicacion_id
        WHERE c.usuario_id=$1 AND c.estado='abierta'
        ORDER BY c.apertura_at DESC LIMIT 1
      `,[usuario.id]);
      const cajaAbierta = cajaResultado.rows[0] || null;

      res.render(
        "caja",
        {
          usuario,

          ubicaciones,

          formasPago:
            formasPago.rows,

          tarjetas:
            tarjetas.rows,

          cajaAbierta,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando caja:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando Caja."
        );
    }
  }
);

// =========================================================
// BUSCAR PRODUCTO
// =========================================================

router.get(
  "/caja/api/productos",
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
      // UBICACIÓN SEGURA
      // =====================================================

      if (
        usuario.rol === "empleado"
      ) {
        // IMPORTANTE:
        // La sucursal sale de la sesión.
        // No confiamos en la URL ni en el navegador.

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
      // VALIDAR QUE SEA LOCAL ACTIVO
      // =====================================================

      const ubicacion =
        await db.pool.query(
          `
            SELECT
              id

            FROM ubicaciones

            WHERE
              id = $1
              AND tipo = 'local'
              AND activo = TRUE

            LIMIT 1;
          `,
          [ubicacionId]
        );

      if (
        ubicacion.rows.length ===
        0
      ) {
        return res.json([]);
      }

      // =====================================================
      // BUSCAR PRODUCTOS
      // =====================================================

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

              p.precio_efectivo,
              p.precio_tarjeta,

              COALESCE(
                s.cantidad,
                0
              ) AS stock

            FROM productos p

            LEFT JOIN categorias c
              ON c.id = p.categoria_id

            LEFT JOIN marcas m
              ON m.id = p.marca_id

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

                OR COALESCE(
                  c.nombre,
                  ''
                ) ILIKE $2

                OR COALESCE(
                  m.nombre,
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

            categoria:
              producto.categoria,

            marca:
              producto.marca,

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
        "Error buscando producto en caja:",
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
// OBTENER CUOTAS DE TARJETA
// =========================================================

router.get(
  "/caja/api/tarjetas/:id/cuotas",
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

      const resultado =
        await db.pool.query(
          `
            SELECT
              ct.id,
              ct.cuotas,
              ct.recargo_porcentaje

            FROM cuotas_tarjeta ct

            INNER JOIN tarjetas t
              ON t.id = ct.tarjeta_id

            WHERE
              ct.tarjeta_id = $1
              AND ct.activo = TRUE
              AND t.activo = TRUE

            ORDER BY ct.cuotas;
          `,
          [tarjetaId]
        );

      return res.json(
        resultado.rows.map(
          fila => ({
            id:
              fila.id,

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
        "Error obteniendo cuotas:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Error obteniendo cuotas.",
        });
    }
  }
);

// =========================================================
// CONFIRMAR VENTA
// =========================================================

router.post(
  "/caja/venta",
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

      // =====================================================
      // UBICACIÓN REAL DE VENTA
      // =====================================================

      let ubicacionId;

      if (
        usuario.rol === "empleado"
      ) {
        // ===================================================
        // SEGURIDAD
        // ===================================================
        // Para empleados IGNORAMOS cualquier ubicacion_id
        // enviada desde el navegador.
        //
        // La venta se registra obligatoriamente en la
        // sucursal asignada al usuario.
        // ===================================================

        ubicacionId =
          Number(
            usuario.ubicacion_id
          );
      } else {
        // El dueño sí puede seleccionar Florida
        // o Delfín Gallo.

        ubicacionId =
          Number(
            req.body.ubicacion_id
          );
      }

      if (!ubicacionId) {
        throw new Error(
          "Seleccioná el local de venta."
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
              nombre

            FROM ubicaciones

            WHERE
              id = $1
              AND tipo = 'local'
              AND activo = TRUE

            LIMIT 1;
          `,
          [ubicacionId]
        );

      if (
        ubicacion.rows.length ===
        0
      ) {
        throw new Error(
          "La sucursal seleccionada no es válida."
        );
      }

      // =====================================================
      // CAJA ABIERTA (empleados)
      // =====================================================
      let cajaId = null;
      if (usuario.rol === "empleado") {
        const caja = await client.query(`SELECT id, ubicacion_id FROM cajas WHERE usuario_id=$1 AND estado='abierta' ORDER BY apertura_at DESC LIMIT 1`,[usuario.id]);
        if (!caja.rows.length) throw new Error("Debés abrir caja antes de registrar ventas.");
        if (Number(caja.rows[0].ubicacion_id) !== Number(ubicacionId)) throw new Error("La caja abierta no corresponde a tu local.");
        cajaId = Number(caja.rows[0].id);
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
            "Los productos de la venta no son válidos."
          );
        }
      }

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        throw new Error(
          "La venta no tiene productos."
        );
      }

      // =====================================================
      // DATOS DEL CLIENTE
      // =====================================================

      const clienteNombre =
        String(
          req.body.cliente_nombre ||
          ""
        ).trim() || null;

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

      // =====================================================
      // FORMA DE PAGO
      // =====================================================

      const formaPagoId =
        Number(
          req.body.forma_pago_id
        );

      if (!formaPagoId) {
        throw new Error(
          "Seleccioná una forma de pago."
        );
      }

      const formaPago =
        await client.query(
          `
            SELECT
              id,
              nombre,
              tipo

            FROM formas_pago

            WHERE
              id = $1
              AND activo = TRUE

            LIMIT 1;
          `,
          [formaPagoId]
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

      let tarjetaId =
        null;

      let cuotas =
        null;

      let porcentajeRecargo =
        0;

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
            "Seleccioná tarjeta y cantidad de cuotas."
          );
        }

        // ===================================================
        // VALIDAR TARJETA + CUOTAS
        // ===================================================

        const cuotaResultado =
          await client.query(
            `
              SELECT
                ct.recargo_porcentaje

              FROM cuotas_tarjeta ct

              INNER JOIN tarjetas t
                ON t.id = ct.tarjeta_id

              WHERE
                ct.tarjeta_id = $1
                AND ct.cuotas = $2
                AND ct.activo = TRUE
                AND t.activo = TRUE

              LIMIT 1;
            `,
            [
              tarjetaId,
              cuotas,
            ]
          );

        if (
          cuotaResultado.rows.length ===
          0
        ) {
          throw new Error(
            "La financiación seleccionada no está configurada."
          );
        }

        porcentajeRecargo =
          Number(
            cuotaResultado
              .rows[0]
              .recargo_porcentaje
          ) || 0;
      }

      // =====================================================
      // DESCUENTO MANUAL
      // =====================================================

      const descuentoPorcentaje =
        Number(
          req.body
            .descuento_porcentaje
        ) || 0;

      if (
        !Number.isFinite(
          descuentoPorcentaje
        ) ||
        descuentoPorcentaje < 0 ||
        descuentoPorcentaje > 100
      ) {
        throw new Error(
          "El descuento es inválido."
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

      let subtotal =
        0;

      const itemsProcesados =
        [];

      // =====================================================
      // VALIDAR PRODUCTOS
      // =====================================================

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

        // ===================================================
        // PRODUCTO Y PRECIOS REALES
        // ===================================================

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
            [productoId]
          );

        if (
          producto.rows.length ===
          0
        ) {
          throw new Error(
            "Uno de los productos ya no está disponible."
          );
        }

        const p =
          producto.rows[0];

        // Precio de lista según forma de pago. El operador puede modificar
        // el precio final antes de facturar; guardamos ambos para auditoría.
        let precioLista = Number(p.precio_efectivo) || 0;
        if (tipoPago === "tarjeta" && Number(p.precio_tarjeta) > 0) {
          precioLista = Number(p.precio_tarjeta);
        }
        const precioEnviado = Number(item.precio_unitario);
        let precioUnitario = Number.isFinite(precioEnviado) && precioEnviado >= 0
          ? precioEnviado
          : precioLista;

        if (
          !Number.isFinite(
            precioUnitario
          ) ||
          precioUnitario < 0
        ) {
          throw new Error(
            `Precio inválido para ${p.descripcion}.`
          );
        }

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
            ubicacionId,
          ]
        );

        // ===================================================
        // BLOQUEAR STOCK
        // ===================================================
        // FOR UPDATE evita que dos ventas simultáneas
        // consuman el mismo stock.
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
              ubicacionId,
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
          precioUnitario *
          cantidad;

        subtotal +=
          itemSubtotal;

        itemsProcesados.push({
          producto_id:
            productoId,

          descripcion:
            p.descripcion,

          cantidad,

          precio_lista:
            precioLista,

          precio_unitario:
            precioUnitario,

          subtotal:
            itemSubtotal,

          stock_anterior:
            stockAnterior,

          stock_nuevo:
            stockAnterior -
            cantidad,
        });
      }

      const flete = req.body.incluir_flete === "1"
        ? Math.max(0, Number(req.body.flete) || 0)
        : 0;

      // =====================================================
      // TOTALES
      // =====================================================

      const descuento =
        subtotal *
        (
          descuentoPorcentaje /
          100
        );

      const baseConDescuento =
        subtotal -
        descuento;

      const recargo =
        baseConDescuento *
        (
          porcentajeRecargo /
          100
        );

      const total =
        baseConDescuento +
        recargo +
        flete;

      // =====================================================
      // NUMERACIÓN
      // =====================================================

      const numeroResultado =
        await client.query(`
          SELECT
            COALESCE(
              MAX(numero),
              0
            ) + 1 AS numero

          FROM ventas;
        `);

      const numero =
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
              flete,
              total,

              forma_pago_id,

              tarjeta_id,
              cuotas,
              porcentaje_recargo,
              caja_id,

              estado
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
              $15,

              'confirmada'
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
            flete,
            total,

            formaPagoId,

            tarjetaId,
            cuotas,
            porcentajeRecargo,
            cajaId,
          ]
        );

      const ventaId =
        venta.rows[0].id;

      // =====================================================
      // ITEMS + STOCK + MOVIMIENTOS
      // =====================================================

      for (
        const item
        of itemsProcesados
      ) {
        // ===================================================
        // DETALLE DE VENTA
        // ===================================================

        await client.query(
          `
            INSERT INTO venta_items (
              venta_id,
              producto_id,
              descripcion,
              cantidad,
              precio_lista,
              precio_unitario,
              subtotal
            )

            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            );
          `,
          [
            ventaId,
            item.producto_id,
            item.descripcion,
            item.cantidad,
            item.precio_lista,
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
            ubicacionId,
          ]
        );

        // ===================================================
        // HISTORIAL DE STOCK
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
            ubicacionId,

            -item.cantidad,

            item.stock_anterior,
            item.stock_nuevo,

            ventaId,

            `Venta #${numero}`,

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
        `/ventas/${ventaId}?ok=` +
        encodeURIComponent(
          `Venta #${numero} registrada correctamente por $${total.toLocaleString("es-AR", {minimumFractionDigits:2, maximumFractionDigits:2})}. Ya podés imprimir ticket, A4 o compartir el PDF.`
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
        "Error registrando venta:",
        error
      );

      return res.redirect(
        "/caja?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo registrar la venta."
        )
      );
    } finally {
      client.release();
    }
  }
);

module.exports = router;