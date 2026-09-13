const express = require("express");
const multer = require("multer");
const ExcelJS = require("exceljs");

const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// MULTER EN MEMORIA
// =========================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const nombre =
      String(file.originalname || "")
        .toLowerCase();

    if (
      nombre.endsWith(".xlsx") ||
      nombre.endsWith(".xlsm")
    ) {
      return cb(null, true);
    }

    cb(
      new Error(
        "El archivo debe ser Excel .xlsx"
      )
    );
  },
});

// =========================================================
// NORMALIZADORES
// =========================================================

function texto(valor) {
  if (
    valor === null ||
    valor === undefined
  ) {
    return "";
  }

  // ExcelJS puede devolver objetos
  // para algunos tipos de celdas.

  if (
    typeof valor === "object"
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        valor,
        "text"
      )
    ) {
      valor = valor.text;
    } else if (
      Object.prototype.hasOwnProperty.call(
        valor,
        "result"
      )
    ) {
      valor = valor.result;
    } else if (
      Array.isArray(
        valor.richText
      )
    ) {
      valor =
        valor.richText
          .map(
            parte =>
              parte.text || ""
          )
          .join("");
    }
  }

  return String(valor).trim();
}

function numero(valor) {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (
    typeof valor === "object" &&
    valor !== null
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        valor,
        "result"
      )
    ) {
      valor = valor.result;
    }
  }

  if (
    typeof valor === "number"
  ) {
    return Number.isFinite(valor)
      ? valor
      : 0;
  }

  const limpio =
    String(valor)
      .trim()
      .replace(/\$/g, "")
      .replace(/\s/g, "");

  // Si viene con formato argentino
  // 150.000,00
  if (
    limpio.includes(",") &&
    limpio.includes(".")
  ) {
    const normalizado =
      limpio
        .replace(/\./g, "")
        .replace(",", ".");

    const convertido =
      Number(normalizado);

    return Number.isFinite(
      convertido
    )
      ? convertido
      : 0;
  }

  if (
    limpio.includes(",")
  ) {
    const convertido =
      Number(
        limpio.replace(",", ".")
      );

    return Number.isFinite(
      convertido
    )
      ? convertido
      : 0;
  }

  const convertido =
    Number(limpio);

  return Number.isFinite(
    convertido
  )
    ? convertido
    : 0;
}

function enteroStock(valor) {
  const n =
    numero(valor);

  if (
    !Number.isFinite(n) ||
    n < 0
  ) {
    return 0;
  }

  return n;
}

function limpiarCodigo(valor) {
  const resultado =
    texto(valor);

  if (
    !resultado ||
    resultado === "1" ||
    resultado === "0" ||
    resultado.toLowerCase() ===
      "null"
  ) {
    return null;
  }

  return resultado;
}

function limpiarMarca(valor) {
  const resultado =
    texto(valor);

  if (
    !resultado ||
    resultado === "1" ||
    resultado === "0" ||
    resultado === "-"
  ) {
    return null;
  }

  return resultado;
}

function normalizarNombre(valor) {
  return texto(valor)
    .replace(/\s+/g, " ")
    .trim();
}

// =========================================================
// OBTENER / CREAR CATEGORÍA O MARCA
// =========================================================

async function obtenerOCrear(
  client,
  tabla,
  nombre
) {
  if (!nombre) {
    return null;
  }

  const existente =
    await client.query(
      `
        SELECT id

        FROM ${tabla}

        WHERE
          LOWER(
            TRIM(nombre)
          ) =
          LOWER(
            TRIM($1)
          )

        LIMIT 1;
      `,
      [nombre]
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
      [nombre]
    );

  return nuevo.rows[0].id;
}

// =========================================================
// BUSCAR PRODUCTO EXISTENTE
// =========================================================

async function buscarProductoExistente(
  client,
  codigo,
  descripcion
) {
  if (codigo) {
    const porCodigo =
      await client.query(
        `
          SELECT id

          FROM productos

          WHERE
            codigo_interno = $1
            OR codigo_barras = $1

          LIMIT 1;
        `,
        [codigo]
      );

    if (
      porCodigo.rows.length > 0
    ) {
      return porCodigo.rows[0].id;
    }
  }

  const porDescripcion =
    await client.query(
      `
        SELECT id

        FROM productos

        WHERE
          LOWER(
            TRIM(descripcion)
          ) =
          LOWER(
            TRIM($1)
          )

        LIMIT 1;
      `,
      [descripcion]
    );

  if (
    porDescripcion.rows.length > 0
  ) {
    return porDescripcion.rows[0].id;
  }

  return null;
}

// =========================================================
// PÁGINA IMPORTACIÓN
// =========================================================

router.get(
  "/importacion",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const productos =
        await db.pool.query(`
          SELECT
            COUNT(*) AS cantidad

          FROM productos;
        `);

      const movimientos =
        await db.pool.query(`
          SELECT
            COUNT(*) AS cantidad

          FROM movimientos_stock;
        `);

      const ventas =
        await db.pool.query(`
          SELECT
            COUNT(*) AS cantidad

          FROM ventas;
        `);

      res.render(
        "importacion",
        {
          usuario:
            req.session.usuario,

          resumen: {
            productos:
              Number(
                productos.rows[0]
                  .cantidad
              ) || 0,

            movimientos:
              Number(
                movimientos.rows[0]
                  .cantidad
              ) || 0,

            ventas:
              Number(
                ventas.rows[0]
                  .cantidad
              ) || 0,
          },

          resultado: null,

          error:
            req.query.error ||
            null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando importación:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando importación."
        );
    }
  }
);

// =========================================================
// IMPORTAR EXCEL
// =========================================================

router.post(
  "/importacion/excel",
  requiereLogin,
  soloDueno,
  upload.single("archivo"),
  async (req, res) => {
    const client =
      await db.pool.connect();

    try {
      if (!req.file) {
        throw new Error(
          "Seleccioná el archivo Excel."
        );
      }

      // =====================================================
      // SEGURIDAD
      // =====================================================

      // La importación de stock inicial no debe ejecutarse
      // una vez que el sistema ya comenzó a operar.

      const movimientosExistentes =
        await client.query(`
          SELECT
            COUNT(*) AS cantidad

          FROM movimientos_stock;
        `);

      const ventasExistentes =
        await client.query(`
          SELECT
            COUNT(*) AS cantidad

          FROM ventas;
        `);

      const cantidadMovimientos =
        Number(
          movimientosExistentes
            .rows[0]
            .cantidad
        ) || 0;

      const cantidadVentas =
        Number(
          ventasExistentes
            .rows[0]
            .cantidad
        ) || 0;

      if (
        cantidadMovimientos > 0 ||
        cantidadVentas > 0
      ) {
        throw new Error(
          "La importación inicial está bloqueada porque el sistema ya tiene movimientos o ventas. Esto evita sobrescribir stock real."
        );
      }

      // =====================================================
      // ABRIR EXCEL
      // =====================================================

      const workbook =
        new ExcelJS.Workbook();

      await workbook.xlsx.load(
        req.file.buffer
      );

      const hojaLocal =
        workbook.getWorksheet(
          "Local"
        );

      if (!hojaLocal) {
        throw new Error(
          'El Excel no contiene la hoja "Local".'
        );
      }

      const hojaCuotas =
        workbook.getWorksheet(
          "CONFIG_CUOTAS"
        );

      await client.query(
        "BEGIN"
      );

      // =====================================================
      // UBICACIONES
      // =====================================================

      const ubicacionesResultado =
        await client.query(`
          SELECT
            id,
            nombre

          FROM ubicaciones

          WHERE activo = TRUE;
        `);

      const mapaUbicaciones =
        {};

      ubicacionesResultado.rows.forEach(
        ubicacion => {
          mapaUbicaciones[
            ubicacion.nombre
          ] =
            ubicacion.id;
        }
      );

      const floridaId =
        mapaUbicaciones[
          "Florida Local"
        ];

      const delfinId =
        mapaUbicaciones[
          "Delfín Gallo Local"
        ];

      const depositoId =
        mapaUbicaciones[
          "Depósito Florida"
        ];

      if (
        !floridaId ||
        !delfinId ||
        !depositoId
      ) {
        throw new Error(
          "No se encontraron Florida, Delfín Gallo y Depósito en la base de datos."
        );
      }

      // =====================================================
      // CONTADORES
      // =====================================================

      let productosCreados = 0;
      let productosActualizados = 0;
      let filasIgnoradas = 0;

      let stockFloridaTotal = 0;
      let stockDepositoTotal = 0;

      const advertencias = [];

      // Un mismo archivo debe compartir una referencia
      // de importación.

      const referenciaImportacion =
        Date.now();

      // =====================================================
      // RECORRER HOJA LOCAL
      // =====================================================

      // Fila 1 = encabezados.
      // Datos reales desde fila 2.

      for (
        let fila = 2;
        fila <= hojaLocal.rowCount;
        fila++
      ) {
        const row =
          hojaLocal.getRow(fila);

        // E = Descripción
        const descripcion =
          normalizarNombre(
            row.getCell(5).value
          );

        if (!descripcion) {
          filasIgnoradas++;
          continue;
        }

        // B = Depósito
        // C = Local → Florida
        // D = Tipo
        // F = Precio Efectivo
        // G = Tarjeta
        // I = Marca
        // J = Código

        const stockDeposito =
          enteroStock(
            row.getCell(2).value
          );

        const stockFlorida =
          enteroStock(
            row.getCell(3).value
          );

        const categoria =
          normalizarNombre(
            row.getCell(4).value
          ) || null;

        const precioEfectivo =
          Math.max(
            0,
            numero(
              row.getCell(6).value
            )
          );

        const precioTarjeta =
          Math.max(
            0,
            numero(
              row.getCell(7).value
            )
          );

        const marca =
          limpiarMarca(
            row.getCell(9).value
          );

        const codigo =
          limpiarCodigo(
            row.getCell(10).value
          );

        // ===============================================
        // CATEGORÍA / MARCA
        // ===============================================

        const categoriaId =
          await obtenerOCrear(
            client,
            "categorias",
            categoria
          );

        const marcaId =
          await obtenerOCrear(
            client,
            "marcas",
            marca
          );

        // ===============================================
        // PRODUCTO
        // ===============================================

        let productoId =
          await buscarProductoExistente(
            client,
            codigo,
            descripcion
          );

        if (productoId) {
          // Evitamos meter códigos ficticios
          // como "1".

          await client.query(
            `
              UPDATE productos

              SET
                descripcion = $1,
                categoria_id = $2,
                marca_id = $3,

                codigo_interno =
                  CASE
                    WHEN $4::text IS NULL
                    THEN codigo_interno
                    ELSE $4
                  END,

                precio_efectivo = $5,
                precio_tarjeta = $6,

                activo = TRUE,
                updated_at = NOW()

              WHERE id = $7;
            `,
            [
              descripcion,
              categoriaId,
              marcaId,
              codigo,
              precioEfectivo,
              precioTarjeta,
              productoId,
            ]
          );

          productosActualizados++;
        } else {
          try {
            const nuevo =
              await client.query(
                `
                  INSERT INTO productos (
                    codigo_interno,
                    codigo_barras,

                    descripcion,

                    categoria_id,
                    marca_id,

                    precio_compra,
                    precio_efectivo,
                    precio_tarjeta,

                    stock_minimo,

                    activo
                  )

                  VALUES (
                    $1,
                    NULL,

                    $2,

                    $3,
                    $4,

                    0,
                    $5,
                    $6,

                    0,

                    TRUE
                  )

                  RETURNING id;
                `,
                [
                  codigo,
                  descripcion,
                  categoriaId,
                  marcaId,
                  precioEfectivo,
                  precioTarjeta,
                ]
              );

            productoId =
              nuevo.rows[0].id;

            productosCreados++;
          } catch (error) {
            // Si un código real está repetido en el Excel,
            // no abortamos toda la importación:
            // intentamos identificar por descripción.

            if (
              error.code === "23505"
            ) {
              const existente =
                await buscarProductoExistente(
                  client,
                  null,
                  descripcion
                );

              if (existente) {
                productoId =
                  existente;

                productosActualizados++;

                advertencias.push(
                  `Fila ${fila}: código duplicado "${codigo}". Se utilizó el producto "${descripcion}".`
                );
              } else {
                throw error;
              }
            } else {
              throw error;
            }
          }
        }

        // ===============================================
        // CREAR LOS TRES REGISTROS DE STOCK
        // ===============================================

        await client.query(
          `
            INSERT INTO stock (
              producto_id,
              ubicacion_id,
              cantidad
            )

            VALUES
              ($1, $2, 0),
              ($1, $3, 0),
              ($1, $4, 0)

            ON CONFLICT (
              producto_id,
              ubicacion_id
            )

            DO NOTHING;
          `,
          [
            productoId,
            floridaId,
            delfinId,
            depositoId,
          ]
        );

        // ===============================================
        // STOCK INICIAL FLORIDA
        // ===============================================

        if (
          stockFlorida > 0
        ) {
          const stockAnterior =
            await client.query(
              `
                SELECT cantidad

                FROM stock

                WHERE
                  producto_id = $1
                  AND ubicacion_id = $2

                FOR UPDATE;
              `,
              [
                productoId,
                floridaId,
              ]
            );

          const anterior =
            Number(
              stockAnterior
                .rows[0]
                .cantidad
            ) || 0;

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
              stockFlorida,
              productoId,
              floridaId,
            ]
          );

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

                'ajuste_positivo',
                $3,

                $4,
                $5,

                'importacion_inicial',
                $6,

                $7,
                $8
              );
            `,
            [
              productoId,
              floridaId,

              stockFlorida -
                anterior,

              anterior,
              stockFlorida,

              referenciaImportacion,

              "Importación inicial desde Excel · Hoja Local · Stock Local = Florida",

              req.session.usuario.id,
            ]
          );

          stockFloridaTotal +=
            stockFlorida;
        }

        // ===============================================
        // STOCK INICIAL DEPÓSITO
        // ===============================================

        if (
          stockDeposito > 0
        ) {
          const stockAnterior =
            await client.query(
              `
                SELECT cantidad

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

          const anterior =
            Number(
              stockAnterior
                .rows[0]
                .cantidad
            ) || 0;

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
              stockDeposito,
              productoId,
              depositoId,
            ]
          );

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

                'ajuste_positivo',
                $3,

                $4,
                $5,

                'importacion_inicial',
                $6,

                $7,
                $8
              );
            `,
            [
              productoId,
              depositoId,

              stockDeposito -
                anterior,

              anterior,
              stockDeposito,

              referenciaImportacion,

              "Importación inicial desde Excel · Stock Depósito",

              req.session.usuario.id,
            ]
          );

          stockDepositoTotal +=
            stockDeposito;
        }

        // Delfín Gallo queda correctamente en 0.
      }

      // =====================================================
      // IMPORTAR TARJETAS Y CUOTAS
      // =====================================================

      let tarjetasCreadas = 0;
      let cuotasImportadas = 0;

      if (hojaCuotas) {
        for (
          let fila = 2;
          fila <= hojaCuotas.rowCount;
          fila++
        ) {
          const row =
            hojaCuotas.getRow(fila);

          const tarjetaNombre =
            normalizarNombre(
              row.getCell(1).value
            );

          const cantidadCuotas =
            Math.trunc(
              numero(
                row.getCell(2).value
              )
            );

          let interes =
            numero(
              row.getCell(3).value
            );

          if (
            !tarjetaNombre ||
            cantidadCuotas <= 0
          ) {
            continue;
          }

          // Excel:
          // 0.20 = 20 %
          // 0.25 = 25 %
          // etc.

          if (
            interes > 0 &&
            interes <= 1
          ) {
            interes *= 100;
          }

          const tarjetaExistente =
            await client.query(
              `
                SELECT id

                FROM tarjetas

                WHERE
                  LOWER(
                    TRIM(nombre)
                  ) =
                  LOWER(
                    TRIM($1)
                  )

                LIMIT 1;
              `,
              [
                tarjetaNombre
              ]
            );

          let tarjetaId;

          if (
            tarjetaExistente.rows
              .length > 0
          ) {
            tarjetaId =
              tarjetaExistente
                .rows[0]
                .id;

            await client.query(
              `
                UPDATE tarjetas

                SET activo = TRUE

                WHERE id = $1;
              `,
              [
                tarjetaId
              ]
            );
          } else {
            const nuevaTarjeta =
              await client.query(
                `
                  INSERT INTO tarjetas (
                    nombre,
                    activo
                  )

                  VALUES (
                    $1,
                    TRUE
                  )

                  RETURNING id;
                `,
                [
                  tarjetaNombre
                ]
              );

            tarjetaId =
              nuevaTarjeta
                .rows[0]
                .id;

            tarjetasCreadas++;
          }

          await client.query(
            `
              INSERT INTO cuotas_tarjeta (
                tarjeta_id,
                cuotas,
                recargo_porcentaje,
                activo
              )

              VALUES (
                $1,
                $2,
                $3,
                TRUE
              )

              ON CONFLICT (
                tarjeta_id,
                cuotas
              )

              DO UPDATE SET
                recargo_porcentaje =
                  EXCLUDED.recargo_porcentaje,

                activo = TRUE;
            `,
            [
              tarjetaId,
              cantidadCuotas,
              interes,
            ]
          );

          cuotasImportadas++;
        }
      }

      await client.query(
        "COMMIT"
      );

      // =====================================================
      // RENDER RESULTADO
      // =====================================================

      res.render(
        "importacion",
        {
          usuario:
            req.session.usuario,

          resumen: {
            productos:
              productosCreados +
              productosActualizados,

            movimientos:
              0,

            ventas:
              0,
          },

          error: null,

          resultado: {
            productosCreados,
            productosActualizados,
            filasIgnoradas,

            stockFloridaTotal,
            stockDepositoTotal,

            stockDelfinTotal: 0,

            tarjetasCreadas,
            cuotasImportadas,

            advertencias:
              advertencias.slice(
                0,
                30
              ),
          },
        }
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {
        // Sin acción.
      }

      console.error(
        "ERROR IMPORTANDO EXCEL:",
        error
      );

      res
        .status(400)
        .render(
          "importacion",
          {
            usuario:
              req.session.usuario,

            resumen: {
              productos: 0,
              movimientos: 0,
              ventas: 0,
            },

            resultado: null,

            error:
              error.message ||
              "No se pudo importar el Excel.",
          }
        );
    } finally {
      client.release();
    }
  }
);

module.exports = router;