from pathlib import Path

ARQ = Path('firestore-interfood-seguranca-teste.rules')
texto = ARQ.read_text(encoding='utf-8')

antiga = "function transicaoEntregadorValida(){return (resource.data.status=='Pronto'&&request.resource.data.status=='Entregador aceitou'&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','entregador','aceitoEm'])&&entregadorEhOAutenticado())||(resource.data.status=='Entregador aceitou'&&request.resource.data.status=='Coletado'&&pedidoJaEhMeu()&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','coletadoEm']))||(resource.data.status=='Coletado'&&request.resource.data.status=='Saiu para entrega'&&pedidoJaEhMeu()&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','saiuEntregaEm']))||(resource.data.status=='Saiu para entrega'&&request.resource.data.status=='Concluído'&&pedidoJaEhMeu()&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','concluidoEm']));}"

nova = antiga + "\n    function desistirEntregaValido(){return resource.data.status=='Entregador aceitou'&&pedidoJaEhMeu()&&request.resource.data.status=='Pronto'&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','entregador','motivoDesistenciaEntrega','desistiuEntregaEm'])&&!request.resource.data.keys().hasAny(['entregador'])&&request.resource.data.motivoDesistenciaEntrega is string&&request.resource.data.motivoDesistenciaEntrega.size()>=3&&request.resource.data.motivoDesistenciaEntrega.size()<=300&&request.resource.data.desistiuEntregaEm==request.time;}\n    function incidenteEntregaValido(){return pedidoJaEhMeu()&&(resource.data.status=='Coletado'||resource.data.status=='Saiu para entrega')&&request.resource.data.status==resource.data.status&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(['incidenteEntrega','incidenteEntregaEm'])&&request.resource.data.incidenteEntrega.uid==request.auth.uid&&request.resource.data.incidenteEntrega.nome is string&&request.resource.data.incidenteEntrega.motivo is string&&request.resource.data.incidenteEntrega.motivo.size()>=3&&request.resource.data.incidenteEntrega.motivo.size()<=300&&request.resource.data.incidenteEntrega.statusNoMomento==resource.data.status&&request.resource.data.incidenteEntregaEm==request.time;}"

if 'function desistirEntregaValido()' not in texto:
    if antiga not in texto:
        raise SystemExit('ERRO: função transicaoEntregadorValida não encontrada. Nada foi alterado.')
    texto = texto.replace(antiga, nova, 1)

alvo = "||(entregadorDaFranquia(fid)&&transicaoEntregadorValida())||cancelamentoClienteValido();"
sub = "||(entregadorDaFranquia(fid)&&(transicaoEntregadorValida()||desistirEntregaValido()||incidenteEntregaValido()))||cancelamentoClienteValido();"
if sub not in texto:
    if alvo not in texto:
        raise SystemExit('ERRO: regra de update dos pedidos não encontrada. Nada foi salvo.')
    texto = texto.replace(alvo, sub, 1)

ARQ.write_text(texto, encoding='utf-8')
Path('firestore.rules').write_text(texto, encoding='utf-8')
print('OK: regras de exceções do entregador aplicadas em homologação.')
print('Arquivos atualizados: firestore-interfood-seguranca-teste.rules e firestore.rules')
