// Homologação Interfood — integração de categorias no formulário principal
(function(){
  let categoriasAtivas=[];
  function refLoja(){
    try{return typeof lojaRef!=='undefined'&&lojaRef?lojaRef:null}catch(_){return null}
  }
  async function carregarCategorias(){
    const ref=refLoja();
    if(!ref)return;
    try{
      const snap=await ref.collection('categoriasCardapio').get();
      categoriasAtivas=[];
      snap.forEach(d=>{const x=d.data()||{};if(x.ativo===true)categoriasAtivas.push({id:d.id,...x})});
      categoriasAtivas.sort((a,b)=>(Number(a.ordem)||999)-(Number(b.ordem)||999)||String(a.nome||'').localeCompare(String(b.nome||'')));
    }catch(e){console.warn('[categorias integradas]',e)}
  }
  function aplicarSelect(){
    const antigo=document.getElementById('cat');
    if(!antigo)return;
    const atual=antigo.value||'';
    if(antigo.tagName==='SELECT'){
      antigo.innerHTML='<option value="">Selecione uma categoria</option>'+categoriasAtivas.map(c=>'<option value="'+esc(c.nome)+'">'+esc(c.nome)+'</option>').join('');
      if(atual && !categoriasAtivas.some(c=>String(c.nome).toLowerCase()===String(atual).toLowerCase())){
        const o=document.createElement('option');o.value=atual;o.textContent=atual+' (categoria antiga/inativa)';antigo.appendChild(o);
      }
      antigo.value=atual;
      return;
    }
    const sel=document.createElement('select');sel.id='cat';
    sel.innerHTML='<option value="">Selecione uma categoria</option>'+categoriasAtivas.map(c=>'<option value="'+esc(c.nome)+'">'+esc(c.nome)+'</option>').join('');
    if(atual && !categoriasAtivas.some(c=>String(c.nome).toLowerCase()===String(atual).toLowerCase())){
      const o=document.createElement('option');o.value=atual;o.textContent=atual+' (categoria antiga/inativa)';sel.appendChild(o);
    }
    sel.value=atual;antigo.replaceWith(sel);
  }
  async function preparar(){await carregarCategorias();aplicarSelect()}
  const esperar=setInterval(()=>{if(refLoja()){clearInterval(esperar);carregarCategorias()}},100);
  document.addEventListener('click',e=>{if(e.target&&e.target.matches('button')&&/Novo produto|Editar/.test(e.target.textContent||''))setTimeout(preparar,0)},true);
})();