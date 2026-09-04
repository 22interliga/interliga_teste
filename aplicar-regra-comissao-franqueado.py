from pathlib import Path

ARQ = Path('firestore-interfood-seguranca-teste.rules')
OUT = Path('firestore.rules')

texto = ARQ.read_text(encoding='utf-8')

funcao = """    function franqueadoPodeConfigurarComissao(fid){return franqueadoDaFranquia(fid)&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['taxaComissaoInterfood','taxaComissaoInterfoodAtualizadaEm','taxaComissaoInterfoodAtualizadaPor'])&&request.resource.data.taxaComissaoInterfood is number&&request.resource.data.taxaComissaoInterfood>=0&&request.resource.data.taxaComissaoInterfood<=100&&request.resource.data.taxaComissaoInterfoodAtualizadaEm==request.time&&request.resource.data.taxaComissaoInterfoodAtualizadaPor==request.auth.uid;}\n"""

if 'function franqueadoPodeConfigurarComissao(fid)' not in texto:
    ancora = '    function franqueadoPodeAlternarAcessoEstabelecimento()'
    if ancora not in texto:
        raise SystemExit('ERRO: ponto de insercao da funcao nao encontrado. Nada foi alterado.')
    texto = texto.replace(ancora, funcao + ancora, 1)

antigo = "allow update:if configuracaoOperacionalLojaValida(fid,lojaId);"
novo = "allow update:if configuracaoOperacionalLojaValida(fid,lojaId)||franqueadoPodeConfigurarComissao(fid);"

if novo not in texto:
    if antigo not in texto:
        raise SystemExit('ERRO: regra de update do estabelecimento nao encontrada. Nada foi alterado.')
    texto = texto.replace(antigo, novo, 1)

ARQ.write_text(texto, encoding='utf-8')
OUT.write_text(texto, encoding='utf-8')
print('OK: regra de comissao do franqueado aplicada e firestore.rules atualizado.')
