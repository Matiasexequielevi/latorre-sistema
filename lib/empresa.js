const path = require("path");

const EMPRESA = {
  nombre: "LA TORRE",
  rubro: "ELECTRO · HOGAR",

  telefono: "3813450529",

  instagram: "@latorre.electro_",
  instagramUrl:
    "https://www.instagram.com/latorre.electro_/",

  facebookUrl:
    "https://www.facebook.com/exequiel.torres.100483/",

  // Logo oficial del sistema.
  // Guardar el archivo exactamente en:
  // public/images/logo-la-torre.png
  logoPath: path.join(
    __dirname,
    "..",
    "public",
    "images",
    "logo-la-torre.png"
  ),
};

// =========================================================
// DIRECCIÓN SEGÚN SUCURSAL
// =========================================================

function direccionPorUbicacion(
  nombre = ""
) {
  const ubicacion =
    String(nombre)
      .toLowerCase()
      .trim();

  if (
    ubicacion.includes(
      "delfín"
    ) ||
    ubicacion.includes(
      "delfin"
    )
  ) {
    return "Santiago Gallo s/n - Delfin Gallo (Caps)";
  }

  if (
    ubicacion.includes(
      "florida"
    )
  ) {
    return "Av. Torquinst 326 - Ing. La Florida";
  }

  // Valor por defecto.
  return "Av. Torquinst 326 - Ing. La Florida";
}

module.exports = {
  EMPRESA,
  direccionPorUbicacion,
};