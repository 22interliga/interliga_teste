from pathlib import Path

ARQUIVO = Path('firestore-interfood-seguranca-teste.rules')
texto = ARQUIVO.read_text(encoding='utf-8')

inicio = texto.find('    function gestaoOcorrenciaFranqueadoValida(fid){')
if inicio < 0:
    raise SystemExit('ERRO: funcao gestaoOcorrenciaFranqueadoValida nao encontrada. Nada foi alterado.')
fim = texto.find('\n    function franqueadoPodeAlternarAcessoEstabelecimento()', inicio)
if fim < 0:
    raise SystemExit('ERRO: limite da funcao nao encontrado. Nada foi alterado.')

nova = """    function gestaoOcorrenciaFranqueadoValida(fid){
      return franqueadoDaFranquia(fid)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['gestaoOcorrencia','gestaoOcorrenciaAtualizadaEm'])
        && request.resource.data.gestaoOcorrencia is map
        && request.resource.data.gestaoOcorrencia.keys().hasOnly(['status','providencia','franqueadoUid'])
        && request.resource.data.gestaoOcorrencia.status is string
        && (request.resource.data.gestaoOcorrencia.status=='Em análise'||request.resource.data.gestaoOcorrencia.status=='Resolvida')
        && request.resource.data.gestaoOcorrencia.providencia is string
        && request.resource.data.gestaoOcorrencia.providencia.size()>=3
        && request.resource.data.gestaoOcorrencia.providencia.size()<=500
        && request.resource.data.gestaoOcorrencia.franqueadoUid==request.auth.uid
        && request.resource.data.gestaoOcorrenciaAtualizadaEm==request.time;
    }
"""

texto = texto[:inicio] + nova + texto[fim:]
ARQUIVO.write_text(texto, encoding='utf-8')
Path('firestore.rules').write_text(texto, encoding='utf-8')
print('OK: regra de gestao de ocorrencias corrigida e firestore.rules atualizado.')
