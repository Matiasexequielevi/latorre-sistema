const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
  requiereSucursal,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// FUNCIÓN AUXILIAR
// =========================================================

async function obtenerOCrearId(
  client,
  tabla,
  nombre
) {
  const valor =
    String(
      nombre || ""
    ).trim();

  if (!valor) {
    return null;
  }

  // Sólo permitimos estas tablas.
  // Evitamos utilizar un nombre de tabla arbitrario.
  const tablasPermitidas = [
    "categorias",
    "marcas",
    "proveedores",
  ];

  if (
    !tablasPermitidas.includes(
      tabla
    )
  ) {
    throw new Error(
      "Tabla auxiliar inválida."
    );
  }

  const existente =
    await client.query(
      `
        SELECT id

        FROM ${tabla}

        WHERE
          LOWER(nombre) =
          LOWER($1)

        LIMIT 1;
      `,
      [valor]
    );

  if (
    existente.rows.length > 0
  ) {
    return existente.rows[0].id;
  }

  const nuevo =
    await client.query(
      `
        INSERT INTO ${tabla} (
          nombre
        )

        VALUES ($1)

        RETURNING id;
      `,
      [valor]
    );

  return nuevo.rows[0].id;
}

// =========================================================
// LISTADO DE PRODUCTOS
// =========================================================

router.get(
  "/productos",
  requiereLogin,
  requiereSucursal,
  async (req, res) => {
    try {
      const usuario = req.session.usuario;
      const buscar = String(req.query.buscar || "").trim();
      const estado = req.query.estado === "inactivos" ? "inactivos" : "activos";
      const activo = estado === "activos";
      const marca = String(req.query.marca || "").trim();
      const proveedor = String(req.query.proveedor || "").trim();
      const categoria = String(req.query.categoria || "").trim();

      const parametros = [activo, `%${buscar}%`, marca, proveedor, categoria];
      let filtroSucursal = "";

      if (usuario.rol === "empleado") {
        parametros.push(Number(usuario.ubicacion_id));
        filtroSucursal = `AND u.sucursal = (SELECT sucursal FROM ubicaciones WHERE id = $${parametros.length})`;
      }

      const resultado = await db.pool.query(`
        SELECT
          p.id, p.codigo_interno, p.codigo_barras, p.descripcion,
          c.nombre AS categoria, m.nombre AS marca, pr.nombre AS proveedor,
          p.precio_compra, p.precio_efectivo, p.precio_tarjeta,
          p.stock_minimo, p.ubicacion_deposito, p.activo,
          COALESCE(SUM(CASE WHEN u.nombre='Florida Local' THEN s.cantidad ELSE 0 END),0) AS stock_florida,
          COALESCE(SUM(CASE WHEN u.nombre='Depósito Florida' THEN s.cantidad ELSE 0 END),0) AS stock_deposito_florida,
          COALESCE(SUM(CASE WHEN u.nombre='Delfín Gallo Local' THEN s.cantidad ELSE 0 END),0) AS stock_delfin,
          COALESCE(SUM(CASE WHEN u.nombre='Depósito Delfín Gallo' THEN s.cantidad ELSE 0 END),0) AS stock_deposito_delfin,
          COALESCE(SUM(CASE WHEN u.activo=TRUE ${filtroSucursal} THEN s.cantidad ELSE 0 END),0) AS stock_total
        FROM productos p
        LEFT JOIN categorias c ON c.id=p.categoria_id
        LEFT JOIN marcas m ON m.id=p.marca_id
        LEFT JOIN proveedores pr ON pr.id=p.proveedor_id
        LEFT JOIN stock s ON s.producto_id=p.id
        LEFT JOIN ubicaciones u ON u.id=s.ubicacion_id
        WHERE p.activo=$1
          AND ($2='%%' OR p.descripcion ILIKE $2 OR COALESCE(p.codigo_interno,'') ILIKE $2 OR COALESCE(p.codigo_barras,'') ILIKE $2 OR COALESCE(c.nombre,'') ILIKE $2 OR COALESCE(m.nombre,'') ILIKE $2 OR COALESCE(pr.nombre,'') ILIKE $2)
          AND ($3='' OR m.nombre=$3)
          AND ($4='' OR pr.nombre=$4)
          AND ($5='' OR c.nombre=$5)
        GROUP BY p.id,c.nombre,m.nombre,pr.nombre
        ORDER BY p.descripcion;
      `, parametros);

      const filtros = await db.pool.query(`
        SELECT
          ARRAY(SELECT nombre FROM marcas WHERE activo=TRUE ORDER BY nombre) AS marcas,
          ARRAY(SELECT nombre FROM proveedores WHERE activo=TRUE ORDER BY nombre) AS proveedores,
          ARRAY(SELECT nombre FROM categorias WHERE activo=TRUE ORDER BY nombre) AS categorias;
      `);

      return res.render("productos", {
        usuario, productos: resultado.rows, buscar, estado,
        marca, proveedor, categoria,
        filtros: filtros.rows[0]
      });
    } catch (error) {
      console.error("Error cargando productos:", error);
      return res.status(500).send("Error cargando productos.");
    }
  }
);

// =========================================================
// EDICIÓN RÁPIDA DE UN PRECIO (ENTER)
// =========================================================

router.post("/productos/:id/precio-rapido", requiereLogin, soloDueno, async (req,res) => {
  try {
    const id=Number(req.params.id);
    const campo=String(req.body.campo||"");
    const valor=Number(req.body.valor);
    const permitidos=["precio_compra","precio_efectivo","precio_tarjeta"];
    if(!id || !permitidos.includes(campo) || !Number.isFinite(valor) || valor<0) {
      return res.status(400).json({ok:false,error:"Precio inválido."});
    }
    await db.pool.query(`UPDATE productos SET ${campo}=$1, updated_at=NOW() WHERE id=$2`,[valor,id]);
    return res.json({ok:true,valor});
  } catch(error) {
    console.error("Error precio rápido:",error);
    return res.status(500).json({ok:false,error:"No se pudo actualizar el precio."});
  }
});

// =========================================================
// ACTUALIZACIÓN MASIVA DE PRECIOS
// =========================================================

router.post("/productos/precios-masivos", requiereLogin, soloDueno, async (req,res) => {
  try {
    const ids=Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const campo=String(req.body.campo||"");
    const operacion=String(req.body.operacion||"");
    const valor=Number(req.body.valor);
    const permitidos=["precio_compra","precio_efectivo","precio_tarjeta"];
    if(!ids.length || !permitidos.includes(campo) || !["porcentaje","sumar","fijar"].includes(operacion) || !Number.isFinite(valor)) {
      return res.status(400).json({ok:false,error:"Datos inválidos."});
    }
    let expresion;
    if(operacion==="porcentaje") expresion=`GREATEST(0, ROUND(${campo} * (1 + $1 / 100.0), 2))`;
    if(operacion==="sumar") expresion=`GREATEST(0, ${campo} + $1)`;
    if(operacion==="fijar") expresion=`GREATEST(0, $1)`;
    const r=await db.pool.query(`UPDATE productos SET ${campo}=${expresion}, updated_at=NOW() WHERE id=ANY($2::int[]) RETURNING id`,[valor,ids]);
    return res.json({ok:true,cantidad:r.rowCount});
  } catch(error) {
    console.error("Error actualización masiva:",error);
    return res.status(500).json({ok:false,error:"No se pudieron actualizar los precios."});
  }
});

// =========================================================
// NUEVO PRODUCTO
// =========================================================

router.get(
  "/productos/nuevo",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const categorias =
        await db.pool.query(`
          SELECT nombre

          FROM categorias

          WHERE activo = TRUE

          ORDER BY nombre;
        `);

      const marcas =
        await db.pool.query(`
          SELECT nombre

          FROM marcas

          WHERE activo = TRUE

          ORDER BY nombre;
        `);

      const proveedores = await db.pool.query(`SELECT nombre FROM proveedores WHERE activo=TRUE ORDER BY nombre;`);

      return res.render(
        "producto-nuevo",
        {
          usuario:
            req.session.usuario,

          error:
            null,

          categorias:
            categorias.rows,

          marcas:
            marcas.rows,

          proveedores: proveedores.rows,

          datos:
            {},
        }
      );
    } catch (error) {
      console.error(
        "Error cargando nuevo producto:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando formulario."
        );
    }
  }
);

// =========================================================
// GUARDAR PRODUCTO
// =========================================================

router.post(
  "/productos/nuevo",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    const client =
      await db.pool.connect();

    let transaccionIniciada =
      false;

    try {
      const descripcion =
        String(
          req.body.descripcion ||
          ""
        ).trim();

      const codigoInterno =
        String(
          req.body.codigo_interno ||
          ""
        ).trim() || null;

      const codigoBarras =
        String(
          req.body.codigo_barras ||
          ""
        ).trim() || null;

      const categoria =
        String(
          req.body.categoria ||
          ""
        ).trim();

      const marca =
        String(
          req.body.marca ||
          ""
        ).trim();

      const proveedor = String(req.body.proveedor || "").trim();

      const precioCompra =
        Number(
          req.body.precio_compra
        ) || 0;

      const precioEfectivo =
        Number(
          req.body.precio_efectivo
        ) || 0;

      const precioTarjeta =
        Number(
          req.body.precio_tarjeta
        ) || 0;

      const stockMinimo =
        Number(
          req.body.stock_minimo
        ) || 0;

      const ubicacionDeposito =
        String(
          req.body
            .ubicacion_deposito ||
          ""
        ).trim() || null;

      const observaciones =
        String(
          req.body.observaciones ||
          ""
        ).trim() || null;

      // =====================================================
      // VALIDACIONES
      // =====================================================

      if (!descripcion) {
        throw new Error(
          "La descripción es obligatoria."
        );
      }

      if (
        !Number.isFinite(
          precioCompra
        ) ||
        precioCompra < 0
      ) {
        throw new Error(
          "El precio de compra es inválido."
        );
      }

      if (
        !Number.isFinite(
          precioEfectivo
        ) ||
        precioEfectivo < 0
      ) {
        throw new Error(
          "El precio efectivo es inválido."
        );
      }

      if (
        !Number.isFinite(
          precioTarjeta
        ) ||
        precioTarjeta < 0
      ) {
        throw new Error(
          "El precio de tarjeta es inválido."
        );
      }

      if (
        !Number.isFinite(
          stockMinimo
        ) ||
        stockMinimo < 0
      ) {
        throw new Error(
          "El stock mínimo es inválido."
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
      // CATEGORÍA Y MARCA
      // =====================================================

      const categoriaId =
        await obtenerOCrearId(
          client,
          "categorias",
          categoria
        );

      const marcaId =
        await obtenerOCrearId(client, "marcas", marca);

      const proveedorId =
        await obtenerOCrearId(client, "proveedores", proveedor);

      // =====================================================
      // CREAR PRODUCTO
      // =====================================================

      const producto =
        await client.query(
          `
            INSERT INTO productos (
              codigo_interno,
              codigo_barras,
              descripcion,

              categoria_id,
              marca_id,
              proveedor_id,

              precio_compra,
              precio_efectivo,
              precio_tarjeta,

              stock_minimo,

              ubicacion_deposito,
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
              $12
            )

            RETURNING id;
          `,
          [
            codigoInterno,
            codigoBarras,
            descripcion,

            categoriaId,
            marcaId,
            proveedorId,

            precioCompra,
            precioEfectivo,
            precioTarjeta,

            stockMinimo,

            ubicacionDeposito,
            observaciones,
          ]
        );

      const productoId =
        producto.rows[0].id;

      // =====================================================
      // CREAR STOCK EN TODAS LAS UBICACIONES
      // =====================================================

      await client.query(
        `
          INSERT INTO stock (
            producto_id,
            ubicacion_id,
            cantidad
          )

          SELECT
            $1,
            id,
            0

          FROM ubicaciones

          WHERE activo = TRUE

          ON CONFLICT (
            producto_id,
            ubicacion_id
          )

          DO NOTHING;
        `,
        [
          productoId,
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
        "/productos"
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
        "Error creando producto:",
        error
      );

      let mensaje =
        error.message ||
        "No se pudo crear el producto.";

      if (
        error.code === "23505"
      ) {
        mensaje =
          "El código interno o código de barras ya pertenece a otro producto.";
      }

      try {
        const categorias =
          await db.pool.query(`
            SELECT nombre

            FROM categorias

            WHERE activo = TRUE

            ORDER BY nombre;
          `);

        const marcas =
          await db.pool.query(`
            SELECT nombre

            FROM marcas

            WHERE activo = TRUE

            ORDER BY nombre;
          `);

        return res
          .status(400)
          .render(
            "producto-nuevo",
            {
              usuario:
                req.session.usuario,

              error:
                mensaje,

              categorias:
                categorias.rows,

              marcas:
                marcas.rows,

              datos:
                req.body,
            }
          );
      } catch (
        errorFormulario
      ) {
        console.error(
          "Error recargando formulario:",
          errorFormulario
        );

        return res
          .status(500)
          .send(
            mensaje
          );
      }
    } finally {
      client.release();
    }
  }
);

// =========================================================
// EDITAR PRODUCTO
// =========================================================

router.get(
  "/productos/:id/editar",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (!id) {
        return res
          .status(400)
          .send(
            "Producto inválido."
          );
      }

      const producto =
        await db.pool.query(
          `
            SELECT
              p.*,

              c.nombre AS categoria,
              m.nombre AS marca,
              pr.nombre AS proveedor

            FROM productos p

            LEFT JOIN categorias c
              ON c.id =
                p.categoria_id

            LEFT JOIN marcas m
              ON m.id = p.marca_id
            LEFT JOIN proveedores pr
              ON pr.id = p.proveedor_id

            WHERE
              p.id = $1

            LIMIT 1;
          `,
          [
            id,
          ]
        );

      if (
        producto.rows.length ===
        0
      ) {
        return res
          .status(404)
          .send(
            "Producto no encontrado."
          );
      }

      const categorias =
        await db.pool.query(`
          SELECT nombre

          FROM categorias

          WHERE activo = TRUE

          ORDER BY nombre;
        `);

      const marcas =
        await db.pool.query(`
          SELECT nombre

          FROM marcas

          WHERE activo = TRUE

          ORDER BY nombre;
        `);

      const proveedores = await db.pool.query(`SELECT nombre FROM proveedores WHERE activo=TRUE ORDER BY nombre;`);

      return res.render(
        "producto-editar",
        {
          usuario:
            req.session.usuario,

          producto:
            producto.rows[0],

          categorias:
            categorias.rows,

          marcas:
            marcas.rows,

          proveedores: proveedores.rows,

          error:
            null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando producto:",
        error
      );

      return res
        .status(500)
        .send(
          "Error cargando producto."
        );
    }
  }
);

// =========================================================
// ACTUALIZAR PRODUCTO
// =========================================================

router.post(
  "/productos/:id/editar",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    const client =
      await db.pool.connect();

    let transaccionIniciada =
      false;

    try {
      const id =
        Number(
          req.params.id
        );

      if (!id) {
        throw new Error(
          "Producto inválido."
        );
      }

      const descripcion =
        String(
          req.body.descripcion ||
          ""
        ).trim();

      const codigoInterno =
        String(
          req.body.codigo_interno ||
          ""
        ).trim() || null;

      const codigoBarras =
        String(
          req.body.codigo_barras ||
          ""
        ).trim() || null;

      const categoria =
        String(
          req.body.categoria ||
          ""
        ).trim();

      const marca =
        String(
          req.body.marca ||
          ""
        ).trim();

      const proveedor = String(req.body.proveedor || "").trim();

      const precioCompra =
        Number(
          req.body.precio_compra
        ) || 0;

      const precioEfectivo =
        Number(
          req.body.precio_efectivo
        ) || 0;

      const precioTarjeta =
        Number(
          req.body.precio_tarjeta
        ) || 0;

      const stockMinimo =
        Number(
          req.body.stock_minimo
        ) || 0;

      const ubicacionDeposito =
        String(
          req.body
            .ubicacion_deposito ||
          ""
        ).trim() || null;

      const observaciones =
        String(
          req.body.observaciones ||
          ""
        ).trim() || null;

      // =====================================================
      // VALIDACIONES
      // =====================================================

      if (!descripcion) {
        throw new Error(
          "La descripción es obligatoria."
        );
      }

      if (
        !Number.isFinite(
          precioCompra
        ) ||
        precioCompra < 0
      ) {
        throw new Error(
          "El precio de compra es inválido."
        );
      }

      if (
        !Number.isFinite(
          precioEfectivo
        ) ||
        precioEfectivo < 0
      ) {
        throw new Error(
          "El precio efectivo es inválido."
        );
      }

      if (
        !Number.isFinite(
          precioTarjeta
        ) ||
        precioTarjeta < 0
      ) {
        throw new Error(
          "El precio de tarjeta es inválido."
        );
      }

      if (
        !Number.isFinite(
          stockMinimo
        ) ||
        stockMinimo < 0
      ) {
        throw new Error(
          "El stock mínimo es inválido."
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

      const categoriaId =
        await obtenerOCrearId(
          client,
          "categorias",
          categoria
        );

      const marcaId =
        await obtenerOCrearId(
          client,
          "marcas",
          marca
        );

            const proveedorId = await obtenerOCrearId(client, "proveedores", proveedor);

// =====================================================
      // ACTUALIZAR
      // =====================================================

      const actualizado =
        await client.query(
          `
            UPDATE productos

            SET
              codigo_interno = $1,
              codigo_barras = $2,
              descripcion = $3,

              categoria_id = $4,
              marca_id = $5,
              proveedor_id = $6,

              precio_compra = $7,
              precio_efectivo = $8,
              precio_tarjeta = $9,

              stock_minimo = $10,

              ubicacion_deposito = $11,
              observaciones = $12,

              updated_at = NOW()

            WHERE
              id = $13

            RETURNING id;
          `,
          [
            codigoInterno,
            codigoBarras,
            descripcion,

            categoriaId,
            marcaId,
            proveedorId,

            precioCompra,
            precioEfectivo,
            precioTarjeta,

            stockMinimo,

            ubicacionDeposito,
            observaciones,

            id,
          ]
        );

      if (
        actualizado.rows.length ===
        0
      ) {
        throw new Error(
          "Producto no encontrado."
        );
      }

      // =====================================================
      // GARANTIZAR STOCK EN UBICACIONES
      // =====================================================

      await client.query(
        `
          INSERT INTO stock (
            producto_id,
            ubicacion_id,
            cantidad
          )

          SELECT
            $1,
            id,
            0

          FROM ubicaciones

          WHERE activo = TRUE

          ON CONFLICT (
            producto_id,
            ubicacion_id
          )

          DO NOTHING;
        `,
        [
          id,
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
        "/productos"
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
        "Error actualizando producto:",
        error
      );

      let mensaje =
        error.message ||
        "No se pudo actualizar el producto.";

      if (
        error.code === "23505"
      ) {
        mensaje =
          "El código interno o código de barras ya pertenece a otro producto.";
      }

      try {
        const categorias =
          await db.pool.query(`
            SELECT nombre

            FROM categorias

            WHERE activo = TRUE

            ORDER BY nombre;
          `);

        const marcas =
          await db.pool.query(`
            SELECT nombre

            FROM marcas

            WHERE activo = TRUE

            ORDER BY nombre;
          `);

        const producto = {
          id:
            req.params.id,

          ...req.body,
        };

        return res
          .status(400)
          .render(
            "producto-editar",
            {
              usuario:
                req.session.usuario,

              producto,

              categorias:
                categorias.rows,

              marcas:
                marcas.rows,

              error:
                mensaje,
            }
          );
      } catch (
        errorFormulario
      ) {
        console.error(
          "Error recargando edición:",
          errorFormulario
        );

        return res
          .status(500)
          .send(
            mensaje
          );
      }
    } finally {
      client.release();
    }
  }
);

// =========================================================
// ACTIVAR / DESACTIVAR
// =========================================================

router.post(
  "/productos/:id/estado",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (!id) {
        return res
          .status(400)
          .send(
            "Producto inválido."
          );
      }

      const resultado =
        await db.pool.query(
          `
            UPDATE productos

            SET
              activo = NOT activo,
              updated_at = NOW()

            WHERE
              id = $1

            RETURNING
              activo;
          `,
          [
            id,
          ]
        );

      if (
        resultado.rows.length ===
        0
      ) {
        return res
          .status(404)
          .send(
            "Producto no encontrado."
          );
      }

      if (
        resultado.rows[0].activo
      ) {
        return res.redirect(
          "/productos?estado=activos"
        );
      }

      return res.redirect(
        "/productos?estado=inactivos"
      );
    } catch (error) {
      console.error(
        "Error cambiando estado del producto:",
        error
      );

      return res
        .status(500)
        .send(
          "No se pudo cambiar el estado."
        );
    }
  }
);

module.exports = router;