const express = require("express");
const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// LISTADO
// =========================================================

router.get(
  "/tarjetas",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const tarjetasResultado =
        await db.pool.query(`
          SELECT
            t.id,
            t.nombre,
            t.activo,

            COUNT(ct.id) AS configuraciones

          FROM tarjetas t

          LEFT JOIN cuotas_tarjeta ct
            ON ct.tarjeta_id = t.id
            AND ct.activo = TRUE

          GROUP BY
            t.id,
            t.nombre,
            t.activo

          ORDER BY
            t.nombre;
        `);

      const cuotasResultado =
        await db.pool.query(`
          SELECT
            ct.id,
            ct.tarjeta_id,
            ct.cuotas,
            ct.recargo_porcentaje,
            ct.activo,

            t.nombre AS tarjeta

          FROM cuotas_tarjeta ct

          INNER JOIN tarjetas t
            ON t.id = ct.tarjeta_id

          ORDER BY
            t.nombre,
            ct.cuotas;
        `);

      res.render(
        "tarjetas",
        {
          usuario:
            req.session.usuario,

          tarjetas:
            tarjetasResultado.rows,

          cuotas:
            cuotasResultado.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando tarjetas:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando configuración de tarjetas."
        );
    }
  }
);

// =========================================================
// CREAR TARJETA
// =========================================================

router.post(
  "/tarjetas",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const nombre =
        String(
          req.body.nombre || ""
        ).trim();

      if (!nombre) {
        throw new Error(
          "Ingresá el nombre de la tarjeta."
        );
      }

      await db.pool.query(
        `
          INSERT INTO tarjetas (
            nombre
          )

          VALUES (
            $1
          )

          ON CONFLICT (nombre)
          DO UPDATE SET
            activo = TRUE;
        `,
        [nombre]
      );

      res.redirect(
        "/tarjetas?ok=" +
          encodeURIComponent(
            "Tarjeta guardada correctamente."
          )
      );
    } catch (error) {
      console.error(
        "Error creando tarjeta:",
        error
      );

      res.redirect(
        "/tarjetas?error=" +
          encodeURIComponent(
            error.message ||
              "No se pudo guardar la tarjeta."
          )
      );
    }
  }
);

// =========================================================
// ACTIVAR / DESACTIVAR TARJETA
// =========================================================

router.post(
  "/tarjetas/:id/estado",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (!id) {
        throw new Error(
          "Tarjeta inválida."
        );
      }

      const resultado =
        await db.pool.query(
          `
            UPDATE tarjetas

            SET
              activo = NOT activo

            WHERE id = $1

            RETURNING activo;
          `,
          [id]
        );

      if (
        resultado.rows.length === 0
      ) {
        throw new Error(
          "Tarjeta no encontrada."
        );
      }

      res.redirect(
        "/tarjetas?ok=" +
          encodeURIComponent(
            "Estado de la tarjeta actualizado."
          )
      );
    } catch (error) {
      console.error(
        error
      );

      res.redirect(
        "/tarjetas?error=" +
          encodeURIComponent(
            error.message ||
              "No se pudo cambiar el estado."
          )
      );
    }
  }
);

// =========================================================
// GUARDAR CUOTAS
// =========================================================

router.post(
  "/tarjetas/:id/cuotas",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const tarjetaId =
        Number(
          req.params.id
        );

      const cuotas =
        Number(
          req.body.cuotas
        );

      const recargo =
        Number(
          req.body.recargo_porcentaje
        );

      if (!tarjetaId) {
        throw new Error(
          "Tarjeta inválida."
        );
      }

      if (
        !Number.isInteger(
          cuotas
        ) ||
        cuotas <= 0
      ) {
        throw new Error(
          "La cantidad de cuotas es inválida."
        );
      }

      if (
        !Number.isFinite(
          recargo
        ) ||
        recargo < 0
      ) {
        throw new Error(
          "El recargo es inválido."
        );
      }

      const tarjeta =
        await db.pool.query(
          `
            SELECT id
            FROM tarjetas
            WHERE id = $1
            LIMIT 1;
          `,
          [tarjetaId]
        );

      if (
        tarjeta.rows.length === 0
      ) {
        throw new Error(
          "Tarjeta no encontrada."
        );
      }

      await db.pool.query(
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
          cuotas,
          recargo,
        ]
      );

      res.redirect(
        "/tarjetas?ok=" +
          encodeURIComponent(
            "Configuración de cuotas guardada."
          )
      );
    } catch (error) {
      console.error(
        "Error guardando cuotas:",
        error
      );

      res.redirect(
        "/tarjetas?error=" +
          encodeURIComponent(
            error.message ||
              "No se pudo guardar la configuración."
          )
      );
    }
  }
);

// =========================================================
// ACTIVAR / DESACTIVAR CUOTA
// =========================================================

router.post(
  "/tarjetas/cuotas/:id/estado",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (!id) {
        throw new Error(
          "Configuración inválida."
        );
      }

      const resultado =
        await db.pool.query(
          `
            UPDATE cuotas_tarjeta

            SET
              activo = NOT activo

            WHERE id = $1

            RETURNING activo;
          `,
          [id]
        );

      if (
        resultado.rows.length === 0
      ) {
        throw new Error(
          "Configuración no encontrada."
        );
      }

      res.redirect(
        "/tarjetas?ok=" +
          encodeURIComponent(
            "Estado actualizado."
          )
      );
    } catch (error) {
      console.error(
        error
      );

      res.redirect(
        "/tarjetas?error=" +
          encodeURIComponent(
            error.message ||
              "No se pudo actualizar."
          )
      );
    }
  }
);

module.exports = router;