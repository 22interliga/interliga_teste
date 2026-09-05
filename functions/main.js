const base = require('./index');
const seguro = require('./pedido-coordenadas');
const fechamentos = require('./fechamentos-interfood');
const push = require('./push-interfood');
module.exports = Object.assign({}, base, seguro, fechamentos, push);
