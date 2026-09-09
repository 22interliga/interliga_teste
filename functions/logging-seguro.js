'use strict';

// Redução defensiva de dados pessoais/técnicos enviados ao Cloud Logging.
// Atua apenas nos argumentos de console; não altera dados de negócio no Firestore.

const original = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

const CHAVES_SENSIVEIS = /^(token|authorization|auth|idtoken|appcheck|x-firebase-appcheck|imagebase64|imagem|endereco|enderecovalidado|telefon(e|eloja)?|cep|latitude|longitude|lat|lon|consulta(usada)?|tentativas)$/i;

function limparValor(valor, profundidade = 0) {
  if (profundidade > 4) return '[omitido]';
  if (valor instanceof Error) {
    return {
      name: String(valor.name || 'Error').slice(0, 80),
      message: String(valor.message || '').slice(0, 240),
      status: Number.isFinite(Number(valor.status)) ? Number(valor.status) : undefined
    };
  }
  if (Array.isArray(valor)) return {tipo: 'array', quantidade: valor.length};
  if (valor && typeof valor === 'object') {
    const saida = {};
    for (const [chave, conteudo] of Object.entries(valor)) {
      saida[chave] = CHAVES_SENSIVEIS.test(String(chave)) ? '[redigido]' : limparValor(conteudo, profundidade + 1);
    }
    return saida;
  }
  if (typeof valor === 'string') {
    if (valor.length > 500) return valor.slice(0, 120) + '…[truncado]';
    return valor;
  }
  return valor;
}

function tratarRotulo(rotulo, args) {
  const nome = String(rotulo || '');
  if (nome === 'Falha de rede no geocodificador') {
    return [nome, {origem: String(args[0] || ''), erro: limparValor(args[2] || args[1])}];
  }
  if (nome === 'Endereco nao localizado') {
    const x = args[0] && typeof args[0] === 'object' ? args[0] : {};
    return [nome, {
      origem: String(x.origem || ''),
      temCep: Boolean(x.cep),
      quantidadeTentativas: Array.isArray(x.tentativas) ? x.tentativas.length : 0,
      ultimoStatus: x.ultimoStatus ?? null
    }];
  }
  if (nome === 'ViaCEP indisponivel') {
    const x = args[0] && typeof args[0] === 'object' ? args[0] : {};
    return [nome, {erro: String(x.erro || '').slice(0, 240)}];
  }
  return [rotulo, ...args.map(x => limparValor(x))];
}

function instalar(nivel) {
  console[nivel] = (...args) => {
    try {
      if (!args.length) return original[nivel]();
      const [primeiro, ...resto] = args;
      return original[nivel](...tratarRotulo(primeiro, resto));
    } catch (_) {
      return original[nivel]('LOG_SANITIZADO_FALHOU');
    }
  };
}

instalar('log');
instalar('warn');
instalar('error');

module.exports = {limparValor};
