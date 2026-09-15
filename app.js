process.env.TZ = "America/Argentina/Tucuman";

require("dotenv").config();

const express =
  require("express");

const session =
  require("express-session");

const connectPgSimple =
  require("connect-pg-simple");

const helmet =
  require("helmet");

const path =
  require("path");

const db =
  require("./database/db");

const {
  probarConexion,
} =
  require("./database/db");

const {
  inicializarBase,
} =
  require("./database/init");

const authRoutes =
  require("./routes/auth");

const dashboardRoutes =
  require("./routes/dashboard");

const productosRoutes =
  require("./routes/productos");

const stockRoutes =
  require("./routes/stock");

const transferenciasRoutes =
  require("./routes/transferencias");

const ingresosRoutes =
  require("./routes/ingresos");

const cajaRoutes =
  require("./routes/caja");

const ventasRoutes =
  require("./routes/ventas");

const tarjetasRoutes =
  require("./routes/tarjetas");

const presupuestosRoutes =
  require("./routes/presupuestos");

const movimientosRoutes =
  require("./routes/movimientos");

const reportesRoutes =
  require("./routes/reportes");

const importacionRoutes =
  require("./routes/importacion");

const usuariosRoutes =
  require("./routes/usuarios");

const cajasRoutes = require("./routes/cajas");
const documentosRoutes = require("./routes/documentos");

const app =
  express();

const PORT =
  process.env.PORT ||
  7500;

// =====================================
// PRODUCCIÓN
// =====================================

if (
  process.env.NODE_ENV ===
  "production"
) {
  app.set(
    "trust proxy",
    1
  );
}

// =====================================
// EJS
// =====================================

app.set(
  "view engine",
  "ejs"
);

app.set(
  "views",
  path.join(
    __dirname,
    "views"
  )
);

// =====================================
// SEGURIDAD
// =====================================

app.use(
  helmet({
    contentSecurityPolicy:
      false,
  })
);

// =====================================
// BODY
// =====================================

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(
  express.json()
);

// =====================================
// ARCHIVOS PÚBLICOS
// =====================================

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

// =====================================
// SESIONES POSTGRESQL
// =====================================

const PgSession =
  connectPgSimple(
    session
  );

app.use(
  session({
    store:
      new PgSession({
        pool:
          db.pool,

        tableName:
          "sesiones",

        createTableIfMissing:
          true,
      }),

    name:
      "la_torre_session",

    secret:
      process.env
        .SESSION_SECRET ||
      "la-torre-secret-desarrollo",

    resave:
      false,

    saveUninitialized:
      false,

    cookie: {
      httpOnly:
        true,

      secure:
        process.env
          .NODE_ENV ===
        "production",

      sameSite:
        "lax",

      maxAge:
        1000 *
        60 *
        60 *
        12,
    },
  })
);

// =====================================
// VARIABLES GLOBALES
// =====================================

app.use(
  (
    req,
    res,
    next
  ) => {
    res.locals.usuario =
      req.session.usuario ||
      null;

    next();
  }
);

// =====================================
// PRINCIPAL
// =====================================

app.get(
  "/",
  (
    req,
    res
  ) => {
    if (
      req.session.usuario
    ) {
      return res.redirect(
        "/dashboard"
      );
    }

    return res.redirect(
      "/login"
    );
  }
);

// =====================================
// RUTAS
// =====================================

app.use(
  authRoutes
);

app.use(
  dashboardRoutes
);

app.use(
  productosRoutes
);

app.use(
  stockRoutes
);

app.use(
  transferenciasRoutes
);

app.use(
  ingresosRoutes
);

app.use(
  cajaRoutes
);

app.use(
  ventasRoutes
);

app.use(
  presupuestosRoutes
);

app.use(
  tarjetasRoutes
);

app.use(
  movimientosRoutes
);

app.use(
  reportesRoutes
);

app.use(
  importacionRoutes
);

app.use(
  usuariosRoutes
);

app.use(cajasRoutes);
app.use(documentosRoutes);

// =====================================
// 404
// =====================================

app.use(
  (
    req,
    res
  ) => {
    res
      .status(404)
      .send(
        "Página no encontrada"
      );
  }
);

// =====================================
// INICIAR SISTEMA
// =====================================

async function iniciarSistema() {
  try {
    const conexionOk =
      await probarConexion();

    if (!conexionOk) {
      console.error(
        "No se pudo conectar a PostgreSQL."
      );

      process.exit(1);
    }

    const baseOk =
      await inicializarBase();

    if (!baseOk) {
      console.error(
        "No se pudo inicializar la base."
      );

      process.exit(1);
    }

    app.listen(
      PORT,
      () => {
        console.log("");

        console.log(
          "===================================="
        );

        console.log(
          "   SISTEMA MULTISUCURSAL LA TORRE"
        );

        console.log(
          "===================================="
        );

        console.log(
          `Servidor: http://localhost:${PORT}`
        );

        console.log(
          "Florida · Delfín Gallo · Depósito"
        );

        console.log(
          "===================================="
        );

        console.log("");
      }
    );
  } catch (error) {
    console.error(
      "Error iniciando sistema:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
}

iniciarSistema();