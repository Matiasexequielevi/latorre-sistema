// =====================================
// VALIDAR SESIÓN
// =====================================

function requiereLogin(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.usuario
  ) {
    return res.redirect(
      "/login"
    );
  }

  next();
}

// =====================================
// SOLO DUEÑO
// =====================================

function soloDueno(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.usuario
  ) {
    return res.redirect(
      "/login"
    );
  }

  if (
    req.session.usuario.rol !==
    "dueno"
  ) {
    return res
      .status(403)
      .send(
        "No tenés permiso para acceder."
      );
  }

  next();
}

// =====================================
// SOLO EMPLEADO
// =====================================

function soloEmpleado(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.usuario
  ) {
    return res.redirect(
      "/login"
    );
  }

  if (
    req.session.usuario.rol !==
    "empleado"
  ) {
    return res
      .status(403)
      .send(
        "No tenés permiso para acceder."
      );
  }

  next();
}

// =====================================
// VALIDAR USUARIO ACTIVO
// =====================================

function usuarioActivo(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.usuario
  ) {
    return res.redirect(
      "/login"
    );
  }

  if (
    req.session.usuario.activo ===
    false
  ) {
    req.session.destroy(
      () => {
        return res.redirect(
          "/login"
        );
      }
    );

    return;
  }

  next();
}

// =====================================
// EMPLEADO DEBE TENER SUCURSAL
// =====================================

function requiereSucursal(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.usuario
  ) {
    return res.redirect(
      "/login"
    );
  }

  const usuario =
    req.session.usuario;

  // El dueño trabaja con todas
  // las ubicaciones.
  if (
    usuario.rol ===
    "dueno"
  ) {
    return next();
  }

  if (
    usuario.rol ===
      "empleado" &&
    !usuario.ubicacion_id
  ) {
    return res
      .status(403)
      .send(
        "Tu usuario no tiene una sucursal asignada."
      );
  }

  next();
}

// =====================================
// VALIDAR ACCESO A UNA UBICACIÓN
// =====================================
//
// Se utiliza en operaciones donde llega
// una ubicacion_id por body, params o query.
//
// Dueño:
// puede trabajar con cualquier ubicación.
//
// Empleado:
// solamente puede trabajar con su
// ubicación asignada.
// =====================================

function validarUbicacion(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.usuario
  ) {
    return res.redirect(
      "/login"
    );
  }

  const usuario =
    req.session.usuario;

  if (
    usuario.rol ===
    "dueno"
  ) {
    return next();
  }

  const ubicacionSolicitada =
    Number(
      req.body.ubicacion_id ||
      req.params.ubicacion_id ||
      req.query.ubicacion_id
    );

  if (
    !ubicacionSolicitada
  ) {
    return res
      .status(400)
      .send(
        "No se indicó una ubicación válida."
      );
  }

  if (
    Number(
      usuario.ubicacion_id
    ) !==
    ubicacionSolicitada
  ) {
    return res
      .status(403)
      .send(
        "No tenés permiso para operar sobre otra sucursal."
      );
  }

  next();
}

// =====================================
// EXPORTAR
// =====================================

module.exports = {
  requiereLogin,
  soloDueno,
  soloEmpleado,
  usuarioActivo,
  requiereSucursal,
  validarUbicacion,
};