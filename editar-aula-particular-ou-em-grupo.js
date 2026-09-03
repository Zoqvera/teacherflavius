(function(){
  "use strict";

  const PAGE_KEY="aula-particular-ou-em-grupo";
  const TABLE_NAME="page_content_overrides";
  const LOGIN_PATH="/login/";
  const AUTH_MAX_ATTEMPTS=50;
  const AUTH_RETRY_DELAY_MS=120;

  const FIELD_GROUPS=Object.freeze([
    {title:"Abertura da página",fields:[
      ["hero_eyebrow","Categoria acima do título","short"],
      ["hero_title","Título principal","short"],
      ["hero_intro","Parágrafo de abertura","long"],
      ["short_answer_label","Rótulo da resposta curta","short"],
      ["short_answer_text","Resposta curta","long"]
    ]},
    {title:"Aula particular",fields:[
      ["private_title","Título da seção","short"],
      ["private_p1","Primeiro parágrafo","long"],
      ["private_p2","Segundo parágrafo","long"]
    ]},
    {title:"Aula em grupo",fields:[
      ["group_title","Título da seção","short"],
      ["group_p1","Primeiro parágrafo","long"],
      ["group_p2","Segundo parágrafo","long"]
    ]},
    {title:"Comparação por critério",fields:[
      ["comparison_title","Título da seção","short"],
      ["comparison_label_1","Rótulo 1","short"],["comparison_text_1","Texto 1","short"],
      ["comparison_label_2","Rótulo 2","short"],["comparison_text_2","Texto 2","short"],
      ["comparison_label_3","Rótulo 3","short"],["comparison_text_3","Texto 3","short"],
      ["comparison_label_4","Rótulo 4","short"],["comparison_text_4","Texto 4","short"],
      ["comparison_label_5","Rótulo 5","short"],["comparison_text_5","Texto 5","short"],
      ["comparison_label_6","Rótulo 6","short"],["comparison_text_6","Texto 6","short"]
    ]},
    {title:"Iniciantes",fields:[
      ["beginner_title","Título da seção","short"],
      ["beginner_p1","Primeiro parágrafo","long"],
      ["beginner_p2","Segundo parágrafo","long"]
    ]},
    {title:"Conversação",fields:[
      ["conversation_title","Título da seção","short"],
      ["conversation_p1","Primeiro parágrafo","long"],
      ["conversation_p2","Segundo parágrafo","long"]
    ]},
    {title:"Regra prática",fields:[
      ["rule_title","Título da seção","short"],
      ["rule_p1","Parágrafo","long"]
    ]},
    {title:"Leituras relacionadas",fields:[
      ["related_title","Título da seção","short"],
      ["related_link_1","Texto do primeiro link","short"],
      ["related_link_2","Texto do segundo link","short"]
    ]},
    {title:"Chamada final",fields:[
      ["cta_title","Título","short"],
      ["cta_text","Parágrafo","long"],
      ["cta_button","Texto do botão","short"]
    ]}
  ]);

  const status=document.getElementById("editorStatus");
  const form=document.getElementById("contentEditor");
  const fieldsRoot=document.getElementById("editorFields");
  const saveButton=document.getElementById("saveButton");
  const saveStatus=document.getElementById("saveStatus");
  let currentSession=null;

  function setStatus(target,message,state){
    target.textContent=message;
    target.className=(target===status?"status":"save-status")+(state?" is-"+state:"");
  }

  function sleep(milliseconds){
    return new Promise(function(resolve){window.setTimeout(resolve,milliseconds);});
  }

  function authIsReady(){
    try{
      return Boolean(window.Auth&&typeof window.Auth.getSession==="function"&&typeof window.Auth.getClient==="function"&&window.SUPABASE_CONFIG&&window.Auth.isConfigured());
    }catch(error){return false;}
  }

  async function waitForAuth(){
    for(let attempt=0;attempt<AUTH_MAX_ATTEMPTS;attempt+=1){
      if(authIsReady())return true;
      await sleep(AUTH_RETRY_DELAY_MS);
    }
    return false;
  }

  function redirectToLogin(){
    let nextPath=window.location.pathname;
    if(window.Auth&&typeof window.Auth.normalizeNextPath==="function"){
      nextPath=window.Auth.normalizeNextPath(window.location.pathname,window.location.pathname);
    }
    window.location.href=LOGIN_PATH+"?next="+encodeURIComponent(nextPath);
  }

  function createField(fieldConfig){
    const key=fieldConfig[0];
    const labelText=fieldConfig[1];
    const size=fieldConfig[2];
    const row=document.createElement("div");
    const label=document.createElement("label");
    const textarea=document.createElement("textarea");

    row.className="field-row";
    label.htmlFor="field-"+key;
    label.textContent=labelText;
    textarea.id="field-"+key;
    textarea.name=key;
    textarea.dataset.contentField=key;
    textarea.dataset.size=size;
    textarea.spellcheck=true;
    row.append(label,textarea);
    return row;
  }

  function renderFields(){
    const fragment=document.createDocumentFragment();
    FIELD_GROUPS.forEach(function(groupConfig){
      const section=document.createElement("section");
      const title=document.createElement("h2");
      section.className="field-group";
      title.textContent=groupConfig.title;
      section.appendChild(title);
      groupConfig.fields.forEach(function(fieldConfig){section.appendChild(createField(fieldConfig));});
      fragment.appendChild(section);
    });
    fieldsRoot.replaceChildren(fragment);
  }

  function populateFields(content){
    document.querySelectorAll("[data-content-field]").forEach(function(textarea){
      const value=content[textarea.dataset.contentField];
      textarea.value=typeof value==="string"?value:"";
    });
  }

  function collectContent(){
    const content={};
    document.querySelectorAll("[data-content-field]").forEach(function(textarea){content[textarea.dataset.contentField]=textarea.value.trim();});
    return content;
  }

  async function loadContent(client){
    const response=await client.from(TABLE_NAME).select("content").eq("page_key",PAGE_KEY).maybeSingle();
    if(response.error)throw response.error;
    if(!response.data||!response.data.content)throw new Error("O conteúdo editável desta página não foi encontrado.");
    populateFields(response.data.content);
  }

  async function guardAdmin(){
    if(!(await waitForAuth())){
      setStatus(status,"Não foi possível carregar a autenticação administrativa.","error");
      document.body.classList.remove("auth-checking");
      return;
    }

    currentSession=await window.Auth.getSession();
    if(!currentSession||!currentSession.user){redirectToLogin();return;}

    const client=window.Auth.getClient();
    const adminResponse=await client.rpc("is_teacher_admin");
    if(adminResponse.error)throw adminResponse.error;
    if(adminResponse.data!==true){
      setStatus(status,"Acesso negado. Este editor é exclusivo da conta administrativa.","error");
      document.body.classList.remove("auth-checking");
      return;
    }

    renderFields();
    await loadContent(client);
    form.hidden=false;
    document.body.classList.remove("auth-checking");
    setStatus(status,"Editor carregado. As alterações só são publicadas pelo botão no fim da página.","success");
  }

  async function saveContent(event){
    event.preventDefault();
    if(!currentSession||!currentSession.user)return;

    const client=window.Auth.getClient();
    const payload={page_key:PAGE_KEY,content:collectContent(),updated_at:new Date().toISOString(),updated_by:currentSession.user.id};
    saveButton.disabled=true;
    setStatus(saveStatus,"Salvando e publicando os novos textos...","");

    try{
      const response=await client.from(TABLE_NAME).upsert(payload,{onConflict:"page_key"}).select("updated_at").single();
      if(response.error)throw response.error;
      setStatus(saveStatus,"Versão publicada. Recarregue a página pública para conferir os textos atualizados.","success");
    }catch(error){
      console.error("Falha ao publicar o conteúdo editado.",error);
      setStatus(saveStatus,"Não foi possível publicar. Nenhuma alteração parcial foi aplicada.","error");
    }finally{saveButton.disabled=false;}
  }

  form.addEventListener("submit",saveContent);
  guardAdmin().catch(function(error){
    console.error("Falha ao inicializar o editor temporário.",error);
    setStatus(status,"Não foi possível abrir o editor. Verifique sua sessão administrativa e tente novamente.","error");
    document.body.classList.remove("auth-checking");
  });
})();