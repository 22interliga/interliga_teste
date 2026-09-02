from pathlib import Path

p = Path('cardapio-cliente-homologacao.html')
s = p.read_text(encoding='utf-8')

old1 = "let produtos=[],carrinho=[],selecionado=null,escolhaVar=null,escolhasGrupos={};"
new1 = "let produtos=[],categoriasCardapio=[],carrinho=[],selecionado=null,escolhaVar=null,escolhasGrupos={};"
if old1 not in s:
    raise SystemExit('ERRO: bloco 1 nao encontrado; arquivo pode ter mudado.')
s = s.replace(old1, new1, 1)

old2 = "await carregarIdentidade();const snap=await lojaRef.collection('cardapio').get();produtos=[];snap.forEach(d=>{const x={id:d.id,...d.data()};if(x.ativo!==false)produtos.push(x)});produtos.sort((a,b)=>(a.categoria||'').localeCompare(b.categoria||'')||(a.nome||'').localeCompare(b.nome||''));renderProdutos()"
new2 = "await carregarIdentidade();const [snapCats,snap]=await Promise.all([lojaRef.collection('categoriasCardapio').get(),lojaRef.collection('cardapio').get()]);categoriasCardapio=[];snapCats.forEach(d=>{const x={id:d.id,...d.data()};if(x.ativo!==false)categoriasCardapio.push(x)});categoriasCardapio.sort((a,b)=>Number(a.ordem||999)-Number(b.ordem||999)||(a.nome||'').localeCompare(b.nome||''));const ordemCat=new Map(categoriasCardapio.map((c,i)=>[String(c.nome||'').toLocaleLowerCase('pt-BR'),i]));produtos=[];snap.forEach(d=>{const x={id:d.id,...d.data()},ch=String(x.categoria||'').toLocaleLowerCase('pt-BR');if(x.ativo!==false&&ordemCat.has(ch))produtos.push(x)});produtos.sort((a,b)=>(ordemCat.get(String(a.categoria||'').toLocaleLowerCase('pt-BR'))??999)-(ordemCat.get(String(b.categoria||'').toLocaleLowerCase('pt-BR'))??999)||(a.nome||'').localeCompare(b.nome||''));renderProdutos()"
if old2 not in s:
    raise SystemExit('ERRO: bloco 2 nao encontrado; arquivo pode ter mudado.')
s = s.replace(old2, new2, 1)

old3 = "const cats=[...new Set(produtos.map(p=>p.categoria||'Outros'))];$('lista').innerHTML=cats.map(c=>'<div class=\"card cat\"><h3>'+esc(c)+'</h3>'+produtos.filter(p=>(p.categoria||'Outros')===c).map(p=>{"
new3 = "const cats=categoriasCardapio.filter(c=>produtos.some(p=>String(p.categoria||'').toLocaleLowerCase('pt-BR')===String(c.nome||'').toLocaleLowerCase('pt-BR')));$('lista').innerHTML=cats.map(c=>'<div class=\"card cat\"><h3>'+esc(c.nome)+'</h3>'+produtos.filter(p=>String(p.categoria||'').toLocaleLowerCase('pt-BR')===String(c.nome||'').toLocaleLowerCase('pt-BR')).map(p=>{"
if old3 not in s:
    raise SystemExit('ERRO: bloco 3 nao encontrado; arquivo pode ter mudado.')
s = s.replace(old3, new3, 1)

p.write_text(s, encoding='utf-8')
print('OK: cardapio do cliente agora respeita ordem, categorias ativas e produtos vinculados.')
