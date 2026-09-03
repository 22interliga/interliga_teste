// Homologação Interfood — integração de categorias no formulário principal
(function(){
  let categoriasAtivas=[];
  async function carregarCategorias(){
    if(!window.lojaRef)return;
    try{
      const snap=await lojaRef.collection('categoriasCardapio').get();
      categoriasAtivas=[];
      snap.forEach(d=>{const x=d.data();if(x.ativo===true)categoriasAtivas.push({id:d.id,...x})});
      categoriasAtivas.sort((a,b)=>(Number(a.ordem)||999)-(Number(b.ordem)||999)||String(a.nome||'').localeCompare(String(b.nome||'')));
    }catch(e){console.warn('[categorias integradas]',e)}
  }
  function aplicarSelect(){
    const antigo=document.getElementById('cat');
    if(!antigo||antigo.tagName==='SELECT')return;
    const atual=antigo.value||'';
    const sel=document.createElement('select');sel.id='cat';
    sel.innerHTML='<option value="">Selecione uma categoria</option>'+categoriasAtivas.map(c=>'<option value="'+esc(c.nome)+'">'+esc(c.nome)+'</option>').join('');
    if(atual && !categoriasAtivas.some(c=>String(c.nome).toLowerCase()===String(atual).toLowerCase())){
      const o=document.createElement('option');o.value=atual;o.textContent=atual+' (categoria antiga/inativa)';sel.appendChild(o);
    }
    sel.value=atual;antigo.replaceWith(sel);
  }
  async function preparar(){await carregarCategorias();aplicarSelect()}
  const esperar=setInterval(()=>{if(window.lojaRef){clearInterval(esperar);carregarCategorias()}},100);
  const originalNovo=window.novo;
  if(typeof originalNovo==='function')window.novo=function(p){originalNovo(p);preparar()};
  document.addEventListener('click',e=>{if(e.target&&e.target.matches('button')&&/Novo produto|Editar/.test(e.target.textContent||''))setTimeout(preparar,0)},true);
})();