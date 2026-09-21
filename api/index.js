// Punto de entrada de Vercel: expone la misma app de Express que usa
// `node server.js` en local. Un solo backend, una sola implementacion.
//
// Antes aqui vivia una reimplementacion sobre Vercel Blob que solo cubria 8
// de las 22 rutas y se habia desincronizado de su copia en aseada-app.
module.exports = require('../server.js');
