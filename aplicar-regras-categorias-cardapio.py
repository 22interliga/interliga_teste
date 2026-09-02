from pathlib import Path

src = Path('firestore-interfood-seguranca-teste.rules')
out = Path('firestore.rules')

text = src.read_text(encoding='utf-8')

func_anchor = "    function cardapioValido(){return request.resource.data.keys().hasOnly(['nome','categoria','descricao','preco','ativo','criadoEm','atualizadoEm','variacoes','gruposAdicionais'])&&request.resource.data.nome is string&&request.resource.data.nome.size()>=2&&request.resource.data.nome.size()<=160&&request.resource.data.categoria is string&&request.resource.data.categoria.size()>=2&&request.resource.data.categoria.size()<=100&&request.resource.data.descricao is string&&request.resource.data.descricao.size()<=500&&request.resource.data.preco is number&&request.resource.data.preco>=0&&request.resource.data.preco<=100000&&request.resource.data.ativo is bool&&(!request.resource.data.keys().hasAny(['variacoes'])||request.resource.data.variacoes is list)&&(!request.resource.data.keys().hasAny(['gruposAdicionais'])||request.resource.data.gruposAdicionais is list);}\n"

categoria_func = "    function categoriaCardapioValida(){return request.resource.data.keys().hasOnly(['nome','ordem','ativo','criadoEm','atualizadoEm'])&&request.resource.data.nome is string&&request.resource.data.nome.size()>=2&&request.resource.data.nome.size()<=100&&request.resource.data.ordem is int&&request.resource.data.ordem>=1&&request.resource.data.ordem<=999&&request.resource.data.ativo is bool;}\n"

if categoria_func not in text:
    if func_anchor not in text:
        raise SystemExit('ERRO: ponto de insercao da funcao de categorias nao encontrado. Nada foi alterado.')
    text = text.replace(func_anchor, func_anchor + categoria_func, 1)

match_anchor = "      match /cardapio/{produtoId}{allow read:if souDonoDaLoja(fid,lojaId)||franqueadoDaFranquia(fid)||clienteCadastrado();allow create:if souDonoDaLoja(fid,lojaId)&&cardapioValido()&&request.resource.data.criadoEm==request.time&&request.resource.data.atualizadoEm==request.time;allow update:if souDonoDaLoja(fid,lojaId)&&cardapioValido()&&request.resource.data.criadoEm==resource.data.criadoEm&&request.resource.data.atualizadoEm==request.time;allow delete:if false;}\n"

categoria_match = "      match /categoriasCardapio/{categoriaId}{allow read:if souDonoDaLoja(fid,lojaId)||franqueadoDaFranquia(fid)||clienteCadastrado();allow create:if souDonoDaLoja(fid,lojaId)&&categoriaCardapioValida()&&request.resource.data.criadoEm==request.time&&request.resource.data.atualizadoEm==request.time;allow update:if souDonoDaLoja(fid,lojaId)&&categoriaCardapioValida()&&request.resource.data.criadoEm==resource.data.criadoEm&&request.resource.data.atualizadoEm==request.time;allow delete:if false;}\n"

if categoria_match not in text:
    if match_anchor not in text:
        raise SystemExit('ERRO: ponto de insercao do match de categorias nao encontrado. Nada foi alterado.')
    text = text.replace(match_anchor, match_anchor + categoria_match, 1)

out.write_text(text, encoding='utf-8')
print('OK: firestore.rules gerado com regras de categorias preservando as regras existentes.')
