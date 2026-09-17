// HOMOLOGACAO Interfood - categorias ativas nas telas de importacao
(function(){
  if(!/importar-cardapio-(imagem|arquivo)/.test(location.pathname)) return;
  let categorias=[];
  const norm=s=>String(s||'').trim().toLocaleLowerCase('pt-BR');
  const esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));

  async function carregar(){
    try{
      const api=window.InterfoodAuthTeste;
      if(!api) return setTimeout(carregar,150);
      const {db,auth}=await api.iniciar();
      if(!auth.currentUser) await new Promise((ok,no)=>{const off=auth.onAuthStateChanged(u=>{if(u){off();ok()}},no)});
      const q=new URLSearchParams(location.search),fid=q.get('franquia'),lojaId=q.get('loja');
      if(!fid||!lojaId) return;
      const snap=await db.collection('franquias').doc(fid).collection('estabelecimentos').doc(lojaId).collection('categoriasCardapio').get();
      categorias=[];
      snap.forEach(d=>{const x=d.data()||{};if(x.ativo===true&&String(x.nome||'').trim())categorias.push({id:d.id,...x})});
      categorias.sort((a,b)=>(Number(a.ordem)||999)-(Number(b.ordem)||999)||String(a.nome).localeCompare(String(b.nome),'pt-BR'));
      aplicar();
      const alvo=document.getElementById('linhas');
      if(alvo)new MutationObserver(()=>aplicar()).observe(alvo,{childList:true,subtree:false});
    }catch(e){console.warn('[categorias-importacao]',e)}
  }

  function aplicar(){
    const alvo=document.getElementById('linhas');
    if(!alvo||!categorias.length)return;
    [...alvo.querySelectorAll('.row')].forEach((row,idx)=>{
      const antigo=row.children[1];
      if(!antigo||antigo.tagName==='SELECT'||antigo.dataset?.categoriaIntegrada==='1')return;
      const atual=String(antigo.value||'').trim();
      const achou=categorias.find(c=>norm(c.nome)===norm(atual));
      const sel=document.createElement('select');
      sel.dataset.categoriaIntegrada='1';
      sel.style.cssText='width:100%;padding:11px;border-radius:9px;border:1px solid #344158;background:#0b1424;color:#fff;box-sizing:border-box';
      sel.innerHTML='<option value="">Selecione a categoria</option>'+categorias.map(c=>'<option value="'+esc(c.nome)+'">'+esc(c.nome)+'</option>').join('');
      sel.value=achou?String(achou.nome):'';
      try{if(typeof itens!=='undefined'&&itens[idx])itens[idx].categoria=sel.value}catch(_){}
      sel.addEventListener('change',()=>{try{if(typeof itens!=='undefined'&&itens[idx])itens[idx].categoria=sel.value}catch(_){}});
      antigo.replaceWith(sel);
    });
  }
  carregar();
})();
