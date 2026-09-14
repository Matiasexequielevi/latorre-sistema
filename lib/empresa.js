const EMPRESA = {
  nombre: 'LA TORRE',
  rubro: 'ELECTRO · HOGAR',
  telefono: '3813450529',
  instagram: '@latorre.electro_',
  instagramUrl: 'https://www.instagram.com/latorre.electro_/',
  facebookUrl: 'https://www.facebook.com/exequiel.torres.100483/',
  logoPath: require('path').join(__dirname, '..', 'public', 'images', 'logo-la-torre.png'),
};

function direccionPorUbicacion(nombre = '') {
  if (String(nombre).toLowerCase().includes('delfín') || String(nombre).toLowerCase().includes('delfin')) {
    return 'Santiago Gallo s/n - Delfin Gallo (Caps)';
  }
  return 'Av. Torquinst 326 - Ing. La Florida';
}

module.exports = { EMPRESA, direccionPorUbicacion };
