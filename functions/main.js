const base = require('./index');
const seguro = require('./pedido-coordenadas-adapter');
module.exports = Object.assign({}, base, seguro);
