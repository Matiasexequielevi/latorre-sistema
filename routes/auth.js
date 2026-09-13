const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../database/db");

const router = express.Router();

// =====================================
// MOSTRAR LOGIN
// =====================================

router.get("/login", (req, res) => {
  if (req.session.usuario) {
    return res.redirect("/dashboard");
  }

  res.render("login", {
    error: null,
  });
});

// =====================================
// PROCESAR LOGIN
// =====================================

router.post("/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.render("login", {
        error: "Ingresá usuario y contraseña.",
      });
    }

    const resultado = await db.pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.password_hash,
          u.nombre,
          u.rol,
          u.activo,
          u.ubicacion_id,
          ub.nombre AS ubicacion
        FROM usuarios u

        LEFT JOIN ubicaciones ub
          ON ub.id = u.ubicacion_id

        WHERE LOWER(u.username) = LOWER($1)

        LIMIT 1;
      `,
      [username]
    );

    if (resultado.rows.length === 0) {
      return res.render("login", {
        error: "Usuario o contraseña incorrectos.",
      });
    }

    const usuario = resultado.rows[0];

    if (!usuario.activo) {
      return res.render("login", {
        error: "El usuario está deshabilitado.",
      });
    }

    const passwordCorrecta = await bcrypt.compare(
      password,
      usuario.password_hash
    );

    if (!passwordCorrecta) {
      return res.render("login", {
        error: "Usuario o contraseña incorrectos.",
      });
    }

    req.session.usuario = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre,
      rol: usuario.rol,
      ubicacion_id: usuario.ubicacion_id,
      ubicacion: usuario.ubicacion,
    };

    req.session.save((error) => {
      if (error) {
        console.error("Error guardando sesión:", error);

        return res.render("login", {
          error: "No se pudo iniciar sesión.",
        });
      }

      return res.redirect("/dashboard");
    });
  } catch (error) {
    console.error("Error en login:", error);

    res.render("login", {
      error: "Ocurrió un error al iniciar sesión.",
    });
  }
});

// =====================================
// CERRAR SESIÓN
// =====================================

router.post("/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Error cerrando sesión:", error);
    }

    res.clearCookie("la_torre_session");

    res.redirect("/login");
  });
});

module.exports = router;