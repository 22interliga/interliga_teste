const base = require('./index');
const seguro = require('./pedido-coordenadas');
const fechamentos = require('./fechamentos-interfood');
const push = require('./push-interfood');
const cardapioImagem = require('./cardapio-imagem-appcheck');
module.exports = Object.assign({}, base, seguro, fechamentos, push, cardapioImagem);
