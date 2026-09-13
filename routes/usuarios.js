const express = require("express");
const bcrypt = require("bcryptjs");

const db = require("../database/db");

const {
  requiereLogin,
  soloDueno,
} = require("../middleware/auth");

const router = express.Router();

// =========================================================
// LISTADO DE USUARIOS
// =========================================================

router.get(
  "/usuarios",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const usuariosResultado =
        await db.pool.query(`
          SELECT
            u.id,
            u.nombre,
            u.username AS usuario,
            u.rol,
            u.activo,
            u.ubicacion_id,

            ub.nombre AS ubicacion

          FROM usuarios u

          LEFT JOIN ubicaciones ub
            ON ub.id = u.ubicacion_id

          ORDER BY
            CASE
              WHEN u.rol = 'dueno'
              THEN 0
              ELSE 1
            END,
            u.nombre;
        `);

      const ubicacionesResultado =
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

      res.render(
        "usuarios",
        {
          usuario:
            req.session.usuario,

          usuarios:
            usuariosResultado.rows,

          ubicaciones:
            ubicacionesResultado.rows,

          mensaje:
            req.query.ok || null,

          error:
            req.query.error || null,
        }
      );
    } catch (error) {
      console.error(
        "Error cargando usuarios:",
        error
      );

      res
        .status(500)
        .send(
          "Error cargando usuarios."
        );
    }
  }
);

// =========================================================
// CREAR EMPLEADO
// =========================================================

router.post(
  "/usuarios",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const nombre =
        String(
          req.body.nombre || ""
        ).trim();

      const username =
        String(
          req.body.usuario || ""
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          req.body.password || ""
        );

      const ubicacionId =
        Number(
          req.body.ubicacion_id
        );

      // =====================================================
      // VALIDACIONES
      // =====================================================

      if (!nombre) {
        throw new Error(
          "Ingresá el nombre del empleado."
        );
      }

      if (!username) {
        throw new Error(
          "Ingresá un usuario."
        );
      }

      if (
        username.length < 3
      ) {
        throw new Error(
          "El usuario debe tener al menos 3 caracteres."
        );
      }

      if (
        password.length < 6
      ) {
        throw new Error(
          "La contraseña debe tener al menos 6 caracteres."
        );
      }

      if (!ubicacionId) {
        throw new Error(
          "Seleccioná la sucursal del empleado."
        );
      }

      // =====================================================
      // VALIDAR SUCURSAL
      // =====================================================

      const ubicacion =
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
          [ubicacionId]
        );

      if (
        ubicacion.rows.length === 0
      ) {
        throw new Error(
          "Sucursal inválida."
        );
      }

      // =====================================================
      // VALIDAR USERNAME REPETIDO
      // =====================================================

      const existe =
        await db.pool.query(
          `
            SELECT id

            FROM usuarios

            WHERE
              LOWER(username) =
              LOWER($1)

            LIMIT 1;
          `,
          [username]
        );

      if (
        existe.rows.length > 0
      ) {
        throw new Error(
          "Ese nombre de usuario ya existe."
        );
      }

      // =====================================================
      // ENCRIPTAR CONTRASEÑA
      // =====================================================

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      // =====================================================
      // CREAR EMPLEADO
      // =====================================================

      await db.pool.query(
        `
          INSERT INTO usuarios (
            nombre,
            username,
            password_hash,
            rol,
            ubicacion_id,
            activo
          )

          VALUES (
            $1,
            $2,
            $3,
            'empleado',
            $4,
            TRUE
          );
        `,
        [
          nombre,
          username,
          passwordHash,
          ubicacionId,
        ]
      );

      res.redirect(
        "/usuarios?ok=" +
        encodeURIComponent(
          `Empleado ${nombre} creado correctamente.`
        )
      );
    } catch (error) {
      console.error(
        "Error creando usuario:",
        error
      );

      res.redirect(
        "/usuarios?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo crear el usuario."
        )
      );
    }
  }
);

// =========================================================
// EDITAR USUARIO
// =========================================================

router.post(
  "/usuarios/:id/editar",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const nombre =
        String(
          req.body.nombre || ""
        ).trim();

      const username =
        String(
          req.body.usuario || ""
        )
          .trim()
          .toLowerCase();

      const ubicacionId =
        Number(
          req.body.ubicacion_id
        ) || null;

      if (!id) {
        throw new Error(
          "Usuario inválido."
        );
      }

      if (
        !nombre ||
        !username
      ) {
        throw new Error(
          "Nombre y usuario son obligatorios."
        );
      }

      if (
        username.length < 3
      ) {
        throw new Error(
          "El usuario debe tener al menos 3 caracteres."
        );
      }

      // =====================================================
      // BUSCAR USUARIO
      // =====================================================

      const usuarioResultado =
        await db.pool.query(
          `
            SELECT
              id,
              rol,
              ubicacion_id

            FROM usuarios

            WHERE id = $1

            LIMIT 1;
          `,
          [id]
        );

      if (
        usuarioResultado.rows.length ===
        0
      ) {
        throw new Error(
          "Usuario no encontrado."
        );
      }

      const usuarioEditar =
        usuarioResultado.rows[0];

      let nuevaUbicacion =
        null;

      // =====================================================
      // SI ES EMPLEADO, VALIDAR SUCURSAL
      // =====================================================

      if (
        usuarioEditar.rol ===
        "empleado"
      ) {
        if (!ubicacionId) {
          throw new Error(
            "Seleccioná la sucursal."
          );
        }

        const ubicacion =
          await db.pool.query(
            `
              SELECT id

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
            "Sucursal inválida."
          );
        }

        nuevaUbicacion =
          ubicacionId;
      }

      // =====================================================
      // EVITAR USERNAME REPETIDO
      // =====================================================

      const repetido =
        await db.pool.query(
          `
            SELECT id

            FROM usuarios

            WHERE
              LOWER(username) =
              LOWER($1)

              AND id <> $2

            LIMIT 1;
          `,
          [
            username,
            id,
          ]
        );

      if (
        repetido.rows.length > 0
      ) {
        throw new Error(
          "Ese nombre de usuario ya pertenece a otra persona."
        );
      }

      // =====================================================
      // ACTUALIZAR
      // =====================================================

      await db.pool.query(
        `
          UPDATE usuarios

          SET
            nombre = $1,
            username = $2,
            ubicacion_id = $3

          WHERE id = $4;
        `,
        [
          nombre,
          username,
          nuevaUbicacion,
          id,
        ]
      );

      // =====================================================
      // ACTUALIZAR SESIÓN SI ES EL MISMO DUEÑO
      // =====================================================

      if (
        Number(
          req.session.usuario.id
        ) === id
      ) {
        req.session.usuario.nombre =
          nombre;

        req.session.usuario.username =
          username;

        // Lo mantenemos también como "usuario"
        // por compatibilidad con el resto del sistema.
        req.session.usuario.usuario =
          username;
      }

      res.redirect(
        "/usuarios?ok=" +
        encodeURIComponent(
          "Usuario actualizado correctamente."
        )
      );
    } catch (error) {
      console.error(
        "Error editando usuario:",
        error
      );

      res.redirect(
        "/usuarios?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo actualizar el usuario."
        )
      );
    }
  }
);

// =========================================================
// CAMBIAR CONTRASEÑA
// =========================================================

router.post(
  "/usuarios/:id/password",
  requiereLogin,
  soloDueno,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const password =
        String(
          req.body.password || ""
        );

      if (!id) {
        throw new Error(
          "Usuario inválido."
        );
      }

      if (
        password.length < 6
      ) {
        throw new Error(
          "La nueva contraseña debe tener al menos 6 caracteres."
        );
      }

      // =====================================================
      // VALIDAR USUARIO
      // =====================================================

      const usuarioResultado =
        await db.pool.query(
          `
            SELECT id

            FROM usuarios

            WHERE id = $1

            LIMIT 1;
          `,
          [id]
        );

      if (
        usuarioResultado.rows.length ===
        0
      ) {
        throw new Error(
          "Usuario no encontrado."
        );
      }

      // =====================================================
      // NUEVO HASH
      // =====================================================

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      await db.pool.query(
        `
          UPDATE usuarios

          SET
            password_hash = $1

          WHERE id = $2;
        `,
        [
          passwordHash,
          id,
        ]
      );

      res.redirect(
        "/usuarios?ok=" +
        encodeURIComponent(
          "Contraseña actualizada correctamente."
        )
      );
    } catch (error) {
      console.error(
        "Error cambiando contraseña:",
        error
      );

      res.redirect(
        "/usuarios?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo cambiar la contraseña."
        )
      );
    }
  }
);

// =========================================================
// ACTIVAR / DESACTIVAR EMPLEADO
// =========================================================

router.post(
  "/usuarios/:id/estado",
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
          "Usuario inválido."
        );
      }

      // =====================================================
      // NO DESACTIVARSE A SÍ MISMO
      // =====================================================

      if (
        Number(
          req.session.usuario.id
        ) === id
      ) {
        throw new Error(
          "No podés desactivar tu propio usuario."
        );
      }

      // =====================================================
      // BUSCAR USUARIO
      // =====================================================

      const usuarioResultado =
        await db.pool.query(
          `
            SELECT
              id,
              nombre,
              rol,
              activo

            FROM usuarios

            WHERE id = $1

            LIMIT 1;
          `,
          [id]
        );

      if (
        usuarioResultado.rows.length ===
        0
      ) {
        throw new Error(
          "Usuario no encontrado."
        );
      }

      const usuarioCambiar =
        usuarioResultado.rows[0];

      // =====================================================
      // PROTEGER DUEÑO
      // =====================================================

      if (
        usuarioCambiar.rol ===
        "dueno"
      ) {
        throw new Error(
          "El usuario dueño no puede desactivarse."
        );
      }

      const nuevoEstado =
        !usuarioCambiar.activo;

      // =====================================================
      // CAMBIAR ESTADO
      // =====================================================

      await db.pool.query(
        `
          UPDATE usuarios

          SET
            activo = $1

          WHERE id = $2;
        `,
        [
          nuevoEstado,
          id,
        ]
      );

      res.redirect(
        "/usuarios?ok=" +
        encodeURIComponent(
          nuevoEstado
            ? `${usuarioCambiar.nombre} fue activado.`
            : `${usuarioCambiar.nombre} fue desactivado.`
        )
      );
    } catch (error) {
      console.error(
        "Error cambiando estado de usuario:",
        error
      );

      res.redirect(
        "/usuarios?error=" +
        encodeURIComponent(
          error.message ||
          "No se pudo cambiar el estado."
        )
      );
    }
  }
);

module.exports = router;