let _aboutLoad=null,_detailsLoad=null;
function loadScriptOnce(url,ready){if(ready())return Promise.resolve();return new Promise((res,rej)=>{const s=document.createElement("script");s.src=url;s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
function coverImgFallback(img){const f=(img.dataset.fb||"").split("|").filter(Boolean),i=+(img.dataset.tried||0);if(i<f.length){img.dataset.tried=i+1;img.src=f[i];}else{const icon=img.dataset.icon||"🎮";img.outerHTML=`<span class="cover-fallback-icon">${icon}</span>`;}}
function ensureSteamAboutCache(){if(typeof STEAM_ABOUT_CACHE!=="undefined")return Promise.resolve();if(!_aboutLoad)_aboutLoad=loadScriptOnce("js/steam-about-cache.js",()=>typeof STEAM_ABOUT_CACHE!=="undefined");return _aboutLoad;}
function ensureSteamDetailsCache(){if(typeof STEAM_DETAILS_CACHE!=="undefined")return Promise.resolve();if(!_detailsLoad)_detailsLoad=loadScriptOnce("js/steam-details-cache.js",()=>typeof STEAM_DETAILS_CACHE!=="undefined");return _detailsLoad;}
function getSteamDetails(g){const sid=g.steamId?String(g.steamId):"";if(sid&&typeof STEAM_DETAILS_CACHE!=="undefined"&&STEAM_DETAILS_CACHE[sid])return STEAM_DETAILS_CACHE[sid];if(g.steamDetails)return g.steamDetails;return null;}

const payMethods = [
  {id:"transfer",  name:"Transferencia", icon:"🏦", pct:-30, note:"Recomendado · 30% OFF", noteClass:"green", cuotas:0},
  {id:"cripto",    name:"Cripto",        icon:"₿",  pct:-30, note:"Recomendado · 30% OFF", noteClass:"green", cuotas:0},
  {id:"debito",    name:"Débito",        icon:"💳", pct:0,   note:"Precio base",       noteClass:"muted", cuotas:0},
  {id:"credito3",  name:"3 cuotas",      icon:"💰", pct:0,   note:"Sin interés",       noteClass:"green", cuotas:3},
  {id:"credito6",  name:"6 cuotas",      icon:"💰", pct:0,   note:"Sin interés",       noteClass:"green", cuotas:6},
];
const MODAL_BG_PATH="assets/modal-bg.jpg";
function resolveModalBgUrl(){const s=document.querySelector('script[src*="app.js"]');if(s&&s.src){try{return new URL(MODAL_BG_PATH,s.src).href;}catch(e){}}try{return new URL(MODAL_BG_PATH,document.baseURI||window.location.href).href;}catch(e){return MODAL_BG_PATH;}}
function applyModalBg(){const layer=document.getElementById("modalBgLayer");if(!layer)return;const url=resolveModalBgUrl();layer.style.backgroundImage=`url("${url}")`;layer.style.backgroundSize="cover";layer.style.backgroundPosition="center";layer.style.backgroundRepeat="no-repeat";}
function fmt(n){return "$"+Math.round(n).toLocaleString("es-AR");}
function priceCuotas(v){return v.priceCuotas??v.basePrice;}
function priceTransfer(v){return v.priceTransfer??Math.round(priceCuotas(v)*0.7);}
function priceLista(cuotas){return Math.round(cuotas*1.3);}
function visibleVersions(g){return(g.versions||[]).filter(v=>!v.hidden);}
function publishedGames(){return catalog.filter(g=>!g.hidden&&visibleVersions(g).length>0);}
function minGamePricing(g){let best=null;visibleVersions(g).forEach(v=>{const c=priceCuotas(v);if(!best||c<best.cuotas)best={cuotas:c,transfer:priceTransfer(v)};});return best;}
function priceCardHtml(cuotas,transfer){const c6=Math.round(cuotas/6);return`<span class="price-old">${fmt(priceLista(cuotas))}</span><span class="price-new">${fmt(cuotas)}</span><div class="transfer-shine"><span class="transfer-shine-text">Transferencia · 30% OFF</span><span class="transfer-shine-val">${fmt(transfer)}</span></div><div class="cuotas-shine"><span class="cuotas-shine-text">6 cuotas sin interés de</span><span class="cuotas-shine-val">${fmt(c6)}</span></div>`;}
function versionsForDelivery(g,delId){return visibleVersions(g).filter(v=>!v.deliveryType||v.deliveryType===delId);}
const RELEVANCE_PRIORITY=[48,39,7,12,37,5,6,41,25,18,16,14,13,11,10,9,8,4,3,2,1];
function relevanceScore(g){const pi=RELEVANCE_PRIORITY.indexOf(g.id);let s=pi>=0?10000-pi:0;if(g.tags.includes("masvendidos"))s+=500;if(g.tags.includes("nuevos"))s+=200;if(g.tags.includes("ofertas"))s+=50;return s;}
function sortByRelevance(list){return list.sort((a,b)=>{const d=relevanceScore(b)-relevanceScore(a);return d||a._order-b._order;});}
function normalizeCatalog(){catalog.forEach((g,i)=>{g._order=i;g.delivery.forEach(d=>{if(d.id==="code"){d.name="CD Key";d.desc="Activás en la plataforma indicada en cada edición (Steam, Rockstar, EA, Ubisoft…).";}if(d.id==="account"){d.name="Cuenta";d.desc="Cuenta lista con el juego en la plataforma de esa edición.";}});if(!g.icon||g.icon==="game")g.icon="🎮";if(/Red Dead Redemption 2/i.test(g.name)){g.platform="Rockstar / Steam - PC";g.description="Clave Ultimate: activación en Rockstar Games Launcher (no Steam). Cuentas: Steam.";const cd=g.delivery.find(x=>x.id==="code");if(cd)cd.desc="Clave para Rockstar Games Launcher / Social Club. No es código de Steam.";}});}
function deliveryOptionsForGame(g){return g.delivery.filter(d=>versionsForDelivery(g,d.id).length>0);}
function gameIcon(g){return(!g.icon||g.icon==="game")?"🎮":g.icon;}
function gameCardCover(g){return g.img||(g.steamId?"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_600x900_2x.jpg":"");}
function gameHeroCover(g){return g.heroImg||g.img||(g.steamId?"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_hero_2x.jpg":"");}
function coverImgMarkup(g){const src=gameCardCover(g);const icon=gameIcon(g);if(!src)return `<span class="cover-fallback-icon">${icon}</span>`;const alt=g.name.replace(/"/g,"&quot;");const parts=[];if(g.heroImg&&g.heroImg!==src)parts.push(g.heroImg);if(g.steamId){const sid=g.steamId;parts.push("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+sid+"/library_600x900_2x.jpg");parts.push("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/"+sid+"/library_600x900_2x.jpg");}const fb=parts.filter((u,i,a)=>u!==src&&a.indexOf(u)===i).join("|");return `<img class="cover-img" src="${src}"${fb?` data-fb="${fb.replace(/"/g,"&quot;")}"`:""} data-icon="${icon}" alt="${alt}" width="600" height="900" loading="lazy" decoding="async" onerror="coverImgFallback(this)">`;}

function calcPrice(base,payId,transferPrice){if((payId==="transfer"||payId==="cripto")&&transferPrice!=null)return transferPrice;const m=payMethods.find(p=>p.id===payId);return base*(1+(m?m.pct/100:0));}
function stripHtml(h){const d=document.createElement("div");d.innerHTML=h||"";return(d.textContent||"").replace(/\s+/g," ").trim();}
function editionSummaryText(g){if(g.versions.length<=1)return"";const codeMap=new Map(),accMap=new Map();g.versions.forEach(v=>{const isCode=(v.deliveryType||"account")==="code";const plat=platformFromVersionName(v.name);const platShort={steam:"Steam",rockstar:"Rockstar",ubisoft:"Ubisoft",ea:"EA App"}[plat]||"Steam";const map=isCode?codeMap:accMap;map.set(platShort,(map.get(platShort)||0)+1);});const fmtGroup=(label,map)=>{if(!map.size)return"";const items=[];map.forEach((n,plat)=>items.push(n+" ed."+(n>1?"s":"")+" "+plat));return label+": "+items.join(", ");};const parts=[];const ck=fmtGroup("CD Key",codeMap);const cu=fmtGroup("Cuenta",accMap);if(ck)parts.push(ck);if(cu)parts.push(cu);return parts.join(" · ");}
function deliveryOptionDesc(g,d){if(d.id==="account"&&state.delivery==="account")return "Te entregamos la cuenta con acceso al juego y al correo asociado para que puedas cambiar los datos y conservarla de forma permanente.";return d.desc;}


let state={game:null,delivery:null,version:null,payment:null,step:0,infoTab:"desc"};
let cart=JSON.parse(sessionStorage.getItem("cjd_cart")||"[]");

const GUIDE_CODE=`<div class="guide-box guide-code"><div class="guide-title">📋 Guía — Código de activación</div><div class="guide-steps"><div class="guide-step"><span class="gs-n">1</span><div>Abrí <strong>Steam</strong> e iniciá sesión con tu cuenta personal.</div></div><div class="guide-step"><span class="gs-n">2</span><div>Hacé clic en <strong>Juegos → Activar un producto en Steam</strong>.</div></div><div class="guide-step"><span class="gs-n">3</span><div>Ingresá el código recibido por email exactamente como aparece.</div></div><div class="guide-step"><span class="gs-n">4</span><div>¡Listo! El juego queda en tu biblioteca para siempre.</div></div></div><div class="guide-ok">✅ Queda en <strong>tu cuenta</strong> de forma permanente · Compatible con logros, guardados en la nube y multijugador.</div></div>`;

const GUIDE_ROCKSTAR=`<div class="guide-box guide-code guide-rockstar"><div class="guide-title">📋 Clave digital — Rockstar Games</div><div class="guide-warn" style="margin-bottom:10px">⚠️ <strong>No es Steam.</strong> Esta clave se activa solo en <strong>Rockstar Games Launcher</strong> (Social Club).</div><div class="guide-steps"><div class="guide-step"><span class="gs-n">1</span><div>Instalá <strong>Rockstar Games Launcher</strong> desde rockstargames.com.</div></div><div class="guide-step"><span class="gs-n">2</span><div>Iniciá sesión con tu cuenta de <strong>Rockstar Social Club</strong>.</div></div><div class="guide-step"><span class="gs-n">3</span><div>Menú <strong>Canjear código</strong> / Redeem → pegá la clave que te enviamos.</div></div><div class="guide-step"><span class="gs-n">4</span><div>Descargá el juego desde tu biblioteca de Rockstar.</div></div></div><div class="guide-ok">✅ PC · No intentes activarlo en Steam</div></div>`;

const GUIDE_ACCOUNT=`<div class="guide-box guide-account"><div class="guide-title">📋 Guía — Cuenta Steam</div><div class="guide-steps"><div class="guide-step warn"><span class="gs-n warn">!</span><div>Verificá edición correcta, sin horas jugadas y acceso completo.</div></div><div class="guide-step"><span class="gs-n">1</span><div><strong>🔐 Iniciá sesión</strong> con las credenciales recibidas.</div></div><div class="guide-step"><span class="gs-n">2</span><div><strong>✉️ Cambiá el correo</strong> por uno tuyo desde Configuración.</div></div><div class="guide-step"><span class="gs-n">3</span><div><strong>🔑 Cambiá la contraseña</strong> por una segura.</div></div><div class="guide-step"><span class="gs-n">4</span><div><strong>🛡️ Activá Steam Guard (2FA)</strong> para máxima protección.</div></div></div><div class="guide-warn">📌 <strong>Restricciones:</strong> puede no unirse a Familia Steam existente · No usar como cuenta principal.<br><br>⚠️ <strong>Generan bloqueos permanentes sin reembolso:</strong> agregar métodos de pago · cambiar región/país · realizar compras no autorizadas.</div></div>`;

function platformFromVersionName(name){const n=(name||"").toLowerCase();if(n.includes("rockstar"))return"rockstar";if(n.includes("ubisoft"))return"ubisoft";if(n.includes("ea app")||n.includes("ea)"))return"ea";return"steam";}
function platformFromGame(g){const n=(g.platform||"").toLowerCase();if(n.includes("rockstar"))return"rockstar";if(n.includes("ubisoft"))return"ubisoft";if(n.includes("steam"))return"steam";if(n.includes("ea app")||n.includes("electronic arts"))return"ea";return"steam";}
function inferGamePlatform(g){if(g.versions&&g.versions.length){const plats=[...new Set(g.versions.map(v=>platformFromVersionName(v.name)))];if(plats.length===1)return plats[0];}return platformFromGame(g);}
function platformLabel(p){return{rockstar:"Rockstar Games Launcher (no es Steam)",steam:"Steam",ubisoft:"Ubisoft Connect",ea:"EA App"}[p]||"la plataforma indicada";}
function platformColor(p){return p==="rockstar"?"var(--orange)":p==="ubisoft"?"var(--pink)":p==="ea"?"var(--gold)":"var(--cyan)";}
function platformLogoSvg(p){const logos={steam:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#c7d5e0" d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658a2.18 2.18 0 0 1 2.1-.584l2.861-4.142V8.4a4.522 4.522 0 0 1 4.522-4.522 4.522 4.522 0 0 1 4.522 4.522 4.522 4.522 0 0 1-4.522 4.522h-.105l-4.031 2.911a1.328 1.328 0 0 1-.026.159 3.39 3.39 0 0 1-3.39 3.396 3.448 3.448 0 0 1-3.331-2.727L.436 15.27C1.798 20.435 6.729 24 11.979 24 18.606 24 24 18.627 24 12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61a2.26 2.26 0 0 0 1.279 1.258l.194-.648zm5.883-7.89a1.393 1.393 0 1 0 0 2.786 1.393 1.393 0 0 0 0-2.786z"/></svg>',rockstar:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#000"/><text x="2.5" y="17.5" font-family="Arial Black,Arial,sans-serif" font-size="15" font-weight="900" fill="#fcaf17">R</text><path fill="#fcaf17" d="M13.8 5.2l.9 2.7h2.9l-2.4 1.8.9 2.7-2.4-1.8-2.4 1.8.9-2.7-2.4-1.8h2.9z"/></svg>',ubisoft:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff"/><path fill="#0070ff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3.2c2.9 3.1 5.1 5.4 5.1 8.3a5.1 5.1 0 11-10.2 0c0-2.9 2.2-5.2 5.1-8.3z"/></svg>',ea:'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#ff4747"/><text x="12" y="16.5" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="9.5" font-weight="900" fill="#fff">EA</text></svg>'};return logos[p]||logos.steam;}
function platformLogoHtml(p){return`<span class="plat-logo plat-logo-${p}" title="${platformLabel(p)}">${platformLogoSvg(p)}</span>`;}
function platformRowHtml(p,labelHtml){return`<div class="plat-row opt-platform" style="color:${platformColor(p)}"><span class="plat-row-txt">${labelHtml}</span>${platformLogoHtml(p)}</div>`;}
function inferCodePlatform(g,delId){const vers=versionsForDelivery(g,delId).filter(v=>!v.deliveryType||v.deliveryType==="code");const plats=[...new Set(vers.map(v=>platformFromVersionName(v.name)))];if(plats.length===1)return plats[0];if(g.id===37)return"rockstar";return"steam";}
function getActivationGuide(g,delId,version){if(delId==="account")return GUIDE_ACCOUNT;if(version&&platformFromVersionName(version.name)==="rockstar")return GUIDE_ROCKSTAR;if(delId==="code"&&inferCodePlatform(g,delId)==="rockstar")return GUIDE_ROCKSTAR;return GUIDE_CODE;}
function versionPlatformHtml(v){const p=platformFromVersionName(v.name);return platformRowHtml(p,`Plataforma: <strong>${platformLabel(p)}</strong>`);}
function renderGamePlatformEl(g){const p=state.version?platformFromVersionName((g.versions.find(x=>x.id===state.version)||{}).name):inferGamePlatform(g);const txt=state.version?`${platformLabel(p)} · PC`:g.platform||"PC";return platformRowHtml(p,txt);}
function minPricingForDelivery(g,delId){const vers=versionsForDelivery(g,delId);let best=null;vers.forEach(v=>{const c=priceCuotas(v);if(!best||c<best.cuotas)best={cuotas:c,transfer:priceTransfer(v)};});return best||minGamePricing(g);}
function renderModalPricing(g){const p=state.delivery?minPricingForDelivery(g,state.delivery):minGamePricing(g);document.getElementById("mPriceFrom").innerHTML=`<div class="mpf-lbl">Desde</div><div class="mpf-row"><span class="modal-price-common">${fmt(p.cuotas)}</span><span class="modal-price-transfer">Transferencia ${fmt(p.transfer)}</span></div>`;}
function renderDeliveryOptions(g){const available=deliveryOptionsForGame(g);const needPulse=!state.delivery;const multi=available.length>1;const pulseCls=d=>needPulse&&multi?(d.id==="code"?" opt-pulse-code":d.id==="account"?" opt-pulse-account":""):"";const opts=available.map(d=>`<div class="opt opt-delivery ${state.delivery===d.id?"sel":""}${pulseCls(d)}" onclick="selD('${d.id}')"><div class="opt-t">${d.name}</div></div>`).join("");document.getElementById("mDelivery").innerHTML=opts;document.getElementById("mDelivery").className="modal-delivery-opts"+(needPulse?(multi?" has-both-pulse":" has-single-pulse"):"");const sec=document.querySelector(".modal-delivery-section");if(sec){sec.classList.toggle("needs-choice",!state.delivery);const old=sec.querySelector(".delivery-account-note");if(old)old.remove();if(state.delivery==="account")sec.insertAdjacentHTML("beforeend",`<div class="delivery-account-note"><strong>Recibís:</strong> mail de la cuenta, contraseña del mail, usuario y contraseña de la cuenta.</div>`);}}
function renderPlatformHint(g){const el=document.getElementById("mPlatformInfo");document.getElementById("mPlat").innerHTML=renderGamePlatformEl(g);el.style.display="none";}
function cleanDescText(s){return String(s||"").replace(/\[(\/)?[^\]]+\]/g,"").replace(/\s+/g," ").trim();}
function pickDescText(...sources){for(const s of sources){const t=cleanDescText(s);if(t&&!/[\uFFFD]|/.test(t))return t;}return cleanDescText(sources.find(s=>s)||"");}
function descShotHtml(url,game){return`<img src="${url}" alt="Captura de ${game}" class="desc-gameplay-shot" loading="lazy" onerror="this.remove()">`;}
function parseSteamRequirements(raw){if(!raw)return[];let t=String(raw).replace(/^Mínimo:\s*/i,"").replace(/^Recomendado:\s*/i,"").replace(/^Requiere un procesador y un sistema operativo de 64 bits\s*/i,"").trim();const re=/\b(SO\s*(?:\*)?|Procesador|Memoria|Gráficos|DirectX|Red|Almacenamiento|Tarjeta de sonido|Notas adicionales|Compatibilidad con RV)\s*:/gi;const ms=[...t.matchAll(re)];if(!ms.length)return t?[{label:"",value:t}]:[];const map={"so":"SO","procesador":"PROCESADOR","memoria":"MEMORIA","gráficos":"GRÁFICOS","directx":"DIRECTX","red":"RED","almacenamiento":"ALMACENAMIENTO","tarjeta de sonido":"TARJETA DE SONIDO","notas adicionales":"NOTAS ADICIONALES","compatibilidad con rv":"VR"};return ms.map((m,i)=>{const k=m[1].toLowerCase().replace(/\s*\*$/,"").trim();const label=map[k]||m[1].toUpperCase();const val=t.slice(m.index+m[0].length,i+1<ms.length?ms[i+1].index:t.length).trim();return{label,value:val};}).filter(x=>x.value);}
function renderRequirementsCol(title,raw,esc){const rows=parseSteamRequirements(raw);if(!rows.length)return"";const body=rows.map(r=>r.label?`<div class="req-row"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`:`<div class="req-row req-row-full"><dd>${esc(r.value)}</dd></div>`).join("");return`<div class="req-col"><div class="req-col-h">${title}</div><dl class="req-specs">${body}</dl></div>`;}
function renderImagesHtml(g){const sid=g.steamId?String(g.steamId):"";const cacheReady=typeof STEAM_ABOUT_CACHE!=="undefined";if(sid&&!cacheReady)return"<p class=\"modal-hint\">Cargando imágenes…</p>";const about=sid&&cacheReady?STEAM_ABOUT_CACHE[sid]:null;let shots=about?.screenshots?[...about.screenshots]:[];if(!shots.length)return"<p style=\"color:var(--muted)\">Sin capturas de gameplay disponibles.</p>";return`<div class="desc-images-grid">${shots.map(url=>descShotHtml(url,g.name)).join("")}</div>`;}
function renderInfoTabs(g){const tabs=[{id:"desc",label:"Imágenes"},{id:"req",label:"Requisitos"},{id:"guide",label:"Guía"}];document.getElementById("mInfoTabs").innerHTML=tabs.map(t=>`<button type="button" class="info-tab ${state.infoTab===t.id?"active":""}" onclick="selInfoTab('${t.id}')">${t.label}</button>`).join("");const panel=document.getElementById("mInfoPanel");if(!state.infoTab){panel.innerHTML="<p class=\"modal-hint\">Tocá <strong>Imágenes</strong>, <strong>Requisitos</strong> o <strong>Guía</strong>.</p>";return;}const sd=getSteamDetails(g);const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");if(state.infoTab==="desc"){panel.innerHTML=renderImagesHtml(g);}else if(state.infoTab==="req"){if(!sd&&typeof STEAM_DETAILS_CACHE==="undefined"){panel.innerHTML="<p class=\"modal-hint\">Cargando requisitos…</p>";return;}const r=sd?{min:sd.min,rec:sd.rec}:{};if(!r.min&&!r.rec)panel.innerHTML="<p class=\"modal-hint\">Sin requisitos cargados.</p>";else panel.innerHTML=`<div class="req-grid">${renderRequirementsCol("Mínimos",r.min,esc)}${renderRequirementsCol("Recomendados",r.rec,esc)}</div>`;}else{if(!state.delivery)panel.innerHTML="<p class=\"modal-hint\">Elegí <strong>CD Key</strong> o <strong>Cuenta</strong> arriba.</p>";else{const selV=state.version?g.versions.find(x=>x.id===state.version):null;panel.innerHTML=getActivationGuide(g,state.delivery,selV);}}}
function selInfoTab(id){state.infoTab=id;const g=catalog.find(x=>x.id===state.game);const done=()=>renderInfoTabs(g);if(id==="desc"){if(g.steamId&&typeof STEAM_ABOUT_CACHE==="undefined"){const panel=document.getElementById("mInfoPanel");if(panel)panel.innerHTML="<p class=\"modal-hint\">Cargando imágenes…</p>";ensureSteamAboutCache().then(done).catch(()=>{const p=document.getElementById("mInfoPanel");if(p)p.innerHTML="<p class=\"modal-hint\">No se pudieron cargar las imágenes.</p>";});}else done();}else if(id==="req"){if(getSteamDetails(g))done();else ensureSteamDetailsCache().then(done).catch(()=>{const panel=document.getElementById("mInfoPanel");if(panel)panel.innerHTML="<p class=\"modal-hint\">No se pudieron cargar los requisitos.</p>";});}else done();}
function renderModalHeader(g){const imgSrc=gameCardCover(g)||gameHeroCover(g);document.getElementById("mCover").innerHTML=imgSrc?`<img src="${imgSrc}" alt="${g.name}" onerror="this.style.display='none'">`:`<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:60px">${gameIcon(g)}</div>`;document.getElementById("mTitle").textContent=g.name;document.getElementById("mPlat").innerHTML=renderGamePlatformEl(g);renderModalPricing(g);renderDeliveryOptions(g);renderPlatformHint(g);renderInfoTabs(g);}
function modalSteps(){return["Versión","Pago","Resumen"];}
function openModal(id){const g=catalog.find(x=>x.id===id);state={game:id,delivery:null,version:null,payment:null,step:0,infoTab:null};if(g.steamId)ensureSteamAboutCache();renderModalHeader(g);renderModal();applyModalBg();document.getElementById("modalOverlay").classList.add("open");document.body.style.overflow="hidden";}
function closeModal(){document.getElementById("modalOverlay").classList.remove("open");document.body.style.overflow="";}
function handleModalBg(e){if(e.target===document.getElementById("modalOverlay"))closeModal();}
function scrollToPayment(){requestAnimationFrame(()=>{setTimeout(()=>{const el=document.getElementById("sP");if(el)el.scrollIntoView({behavior:"smooth",block:"start"});},120);});}
function goToSummary(){if(!state.payment||!state.version)return;state.step=2;renderModal();requestAnimationFrame(()=>{setTimeout(()=>{const el=document.getElementById("sS");if(el)el.scrollIntoView({behavior:"smooth",block:"start"});},120);});}
function renderModal(){const g=catalog.find(x=>x.id===state.game);renderDeliveryOptions(g);renderPlatformHint(g);renderModalPricing(g);if(state.infoTab==="guide")renderInfoTabs(g);document.getElementById("progress").innerHTML="";let chips="";if(state.delivery){const d=g.delivery.find(x=>x.id===state.delivery);if(d)chips+=`<span class="sel-chip">${d.name}</span>`;}if(state.version){const v=g.versions.find(x=>x.id===state.version);chips+=`<span class="sel-chip" onclick="selV(null)">${v.name}<span style="opacity:.6;font-size:10px"> ✕</span></span>`;}document.getElementById("selBar").innerHTML=chips;const sV=document.getElementById("sV"),sP=document.getElementById("sP"),sS=document.getElementById("sS");[sV,sP,sS].forEach(s=>s.classList.remove("active"));if(state.step===0){renderVersion(g);sV.classList.add("active");if(state.version){renderPayment(g,true);sP.classList.add("active");}else{sP.innerHTML="";}}else if(state.step===1){renderPayment(g,false);sP.classList.add("active");}else{renderSummary(g);sS.classList.add("active");}}
function goStep(s,reset){if(reset){state.payment=null;state.version=null;}state.step=s;renderModal();}
function renderVersion(g){if(!state.delivery){document.getElementById("sV").innerHTML=`<p class="modal-hint">Elegí <strong>CD Key</strong> o <strong>Cuenta</strong> arriba</p>`;return;}const vers=versionsForDelivery(g,state.delivery);const hint=state.version?"":`<p class="version-pick-hint">👆 Tocá la edición que querés</p>`;document.getElementById("sV").innerHTML=`<div class="modal-section-title">Versión</div>${hint}<div class="opts opts-versions">${vers.map((v,i)=>{const c=priceCuotas(v),t=priceTransfer(v),sel=state.version===v.id;return`<div class="opt opt-version ${sel?"sel":""}" onclick="selV('${v.id}')"><div class="opt-version-badge">${sel?"✓":i+1}</div><div class="opt-version-inner"><div class="opt-t">${v.name}</div><div class="opt-version-prices"><div class="opt-price-big">${fmt(c)}</div><div class="transfer-shine pay-shine-compact"><span class="transfer-shine-text">Transferencia · recomendado</span><span class="transfer-shine-val">${fmt(t)}</span></div><div class="cuotas-shine pay-shine-compact"><span class="cuotas-shine-text">6 cuotas sin interés</span><span class="cuotas-shine-val">${fmt(Math.round(c/6))}</span></div></div></div></div>`;}).join("")}</div>`;}
function payOptHtml(p,cuotas,transfer){const fp=calcPrice(cuotas,p.id,transfer),sel=state.payment===p.id,lbl={transfer:"Transferencia",cripto:"Cripto",debito:"Débito",credito3:"3 cuotas",credito6:"6 cuotas"};if(p.id==="transfer"||p.id==="cripto")return`<div class="pay-opt pay-opt-rec ${sel?"sel":""}" onclick="selP('${p.id}')"><span class="pay-rec-badge">Recomendado</span><span class="pi">${p.icon}</span><div class="pn">${lbl[p.id]}</div><div class="pay-opt-price-big pay-opt-price-green">${fmt(fp)}</div><div class="pay-opt-sub">Pagás <strong>${fmt(fp)}</strong> · 30% OFF</div></div>`;if(p.cuotas>1){const cu=Math.round(fp/p.cuotas);return`<div class="pay-opt pay-opt-cuotas ${sel?"sel":""}" onclick="selP('${p.id}')"><span class="pi pay-ico-card">💳</span><div class="pn">${p.cuotas} cuotas</div><div class="pay-opt-price-big">${fmt(cu)}<span class="pay-opt-per"> c/u</span></div><div class="pay-opt-sub">Total <strong>${fmt(fp)}</strong> · sin interés</div></div>`;}return`<div class="pay-opt ${sel?"sel":""}" onclick="selP('${p.id}')"><span class="pi">${p.icon}</span><div class="pn">${lbl[p.id]}</div><div class="pay-opt-price-big">${fmt(fp)}</div><div class="pay-opt-sub">Pagás <strong>${fmt(fp)}</strong> · un pago</div></div>`;}
function renderPayment(g,inline){const v=g.versions.find(x=>x.id===state.version);if(!v){document.getElementById("sP").innerHTML="";return;}const cuotas=priceCuotas(v),transfer=priceTransfer(v);const backBtn=inline?"":`<button class="btn-back" onclick="prevStep()">← Volver</button>`;const nextFn=inline?"goToSummary()":"nextStep()";const btnCls=state.payment?"btn-action btn-action-pulse":"btn-action";const btnTxt=state.payment?"Continuar al resumen →":"Elegí un método de pago";document.getElementById("sP").innerHTML=`${backBtn}<div class="pay-section-glass"><div class="modal-section-title">Pago</div><p class="pay-section-hint">El <strong>precio final</strong> está en cada tarjeta. Verde = más barato.</p><div class="pay-opts">${payMethods.map(p=>payOptHtml(p,cuotas,transfer)).join("")}</div><button class="${btnCls}" ${!state.payment?"disabled":""} onclick="${nextFn}">${btnTxt}</button></div>`;}
function renderSummary(g){const v=g.versions.find(x=>x.id===state.version);const p=payMethods.find(x=>x.id===state.payment);const d=g.delivery.find(x=>x.id===state.delivery)||g.delivery[0];const cuotas=priceCuotas(v),transfer=priceTransfer(v);const fp=calcPrice(cuotas,p.id,transfer);const cs=p.cuotas>1?`${p.cuotas}× ${fmt(fp/p.cuotas)}`:"";document.getElementById("sS").innerHTML=`<button class="btn-back" onclick="prevStep()">← Volver</button><div class="modal-section-title">Resumen</div><div class="ps-box"><div class="psr"><span class="psl">Juego</span><span class="psv">${g.name}</span></div><div class="psr"><span class="psl">Entrega</span><span class="psv">${d.name}</span></div><div class="psr"><span class="psl">Versión</span><span class="psv">${v.name}</span></div><div class="psr"><span class="psl">Pago</span><span class="psv">${p.name}</span></div><hr class="ps-div"><div class="psr"><span class="ps-tl">Total</span><span class="ps-tv">${fmt(fp)}</span></div>${cs?`<div class="ps-cuotas">${cs} sin interés</div>`:""}</div><div class="summary-actions"><button type="button" class="btn-wsp-confirm" onclick="confirmOrderWsp()">Comprar por WhatsApp</button><button type="button" class="btn-action-secondary" onclick="addToCart()">Agregar al carrito</button><button type="button" class="btn-link-muted" onclick="closeModal()">Seguir viendo</button></div>`;}
function selD(id){state.delivery=id;state.version=null;state.payment=null;const g=catalog.find(x=>x.id===state.game);renderModalPricing(g);renderPlatformHint(g);if(state.infoTab==="guide")renderInfoTabs(g);renderModal();}
function selV(id){state.version=id||null;if(id)state.payment=null;const g=catalog.find(x=>x.id===state.game);renderPlatformHint(g);if(state.infoTab==="guide")renderInfoTabs(g);renderModal();if(id)scrollToPayment();}
function selP(id){state.payment=id;renderModal();requestAnimationFrame(()=>{setTimeout(()=>{const btn=document.querySelector("#sP .btn-action-pulse");if(btn)btn.scrollIntoView({behavior:"smooth",block:"nearest"});},80);});}
function nextStep(){if(state.step===0&&(!state.delivery||!state.version))return;if(state.step===1&&!state.payment)return;state.step++;renderModal();}
function prevStep(){state.step=Math.max(0,state.step-1);renderModal();}
function confirmOrderWsp(){const g=catalog.find(x=>x.id===state.game);if(!state.delivery||!state.version||!state.payment)return;const v=g.versions.find(x=>x.id===state.version);const p=payMethods.find(x=>x.id===state.payment);const d=g.delivery.find(x=>x.id===state.delivery)||g.delivery[0];const fp=calcPrice(priceCuotas(v),p.id,priceTransfer(v));const item={gameName:g.name,versionName:v.name,deliveryName:d.name,paymentName:p.name,cuotas:p.cuotas,finalPrice:fp};window.open("https://wa.me/"+WHATSAPP+"?text="+encodeURIComponent(buildOrderMsg([item])),"_blank");}

function addToCart(){
  const g=catalog.find(x=>x.id===state.game);
  const v=g.versions.find(x=>x.id===state.version);
  const p=payMethods.find(x=>x.id===state.payment);
  const d=g.delivery.find(x=>x.id===state.delivery)||g.delivery[0];
  const fp=calcPrice(priceCuotas(v),p.id,priceTransfer(v));
  cart.push({id:Date.now(),gameId:g.id,gameName:g.name,gameIcon:g.icon,gameImg:gameCardCover(g)||"",versionName:v.name,deliveryName:d.name,paymentName:p.name,cuotas:p.cuotas,finalPrice:fp});
  saveCart();closeModal();showNotif("✅ "+g.name+" en el carrito · -30% con transferencia");
}
function saveCart(){sessionStorage.setItem("cjd_cart",JSON.stringify(cart));updateCartUI();}
function updateCartUI(){
  const n=cart.length;
  document.querySelectorAll(".cart-count").forEach(el=>el.textContent=n);
  const bw=document.getElementById("btnWsp");if(bw)bw.disabled=!n;
  const el=document.getElementById("cartItems");if(!el)return;
  if(!n){el.innerHTML="<div class='cart-empty'>Tu carrito está vacío</div>";document.getElementById("cartTotal").textContent="$0";const nt=document.getElementById("cartTotalNote");if(nt)nt.textContent="";return;}
  const total=cart.reduce((s,i)=>s+i.finalPrice,0);
  el.innerHTML=cart.map(item=>{
    const img=item.gameImg?`<img class="ci-img" src="${item.gameImg}" onerror="this.style.display='none'" alt="">`:` <span class="ci-icon">${item.gameIcon}</span>`;
    const cs=item.cuotas>1?` · ${item.cuotas}x ${fmt(item.finalPrice/item.cuotas)}`:"";
    return `<div class="cart-item">${img}<div class="ci-info"><div class="ci-name">${item.gameName}</div><div class="ci-det">${item.versionName} · ${item.deliveryName}</div><div class="ci-det">${item.paymentName}${cs}</div><div class="ci-price">${fmt(item.finalPrice)}</div></div><button class="ci-rm" onclick="removeItem(${item.id})">✕</button></div>`;
  }).join("");
  document.getElementById("cartTotal").textContent=fmt(total);
  const nt=document.getElementById("cartTotalNote");if(nt&&n>1)nt.textContent=n+" productos";
}
function removeItem(id){cart=cart.filter(i=>i.id!==id);saveCart();}
function toggleCart(){document.getElementById("cartOverlay").classList.toggle("open");document.body.style.overflow=document.getElementById("cartOverlay").classList.contains("open")?"hidden":"";}
function cartBg(e){if(e.target===document.getElementById("cartOverlay"))toggleCart();}
function buildOrderMsg(items){const total=items.reduce((s,i)=>s+i.finalPrice,0);let msg="¡Hola! Quiero *confirmar mi compra* en Casa Juegos Digitales:\n\n";items.forEach((item,i)=>{const cs=item.cuotas>1?`\n   📅 ${item.cuotas} cuotas de ${fmt(item.finalPrice/item.cuotas)} sin interés`:"";msg+=`${i+1}. 🎮 *${item.gameName}*\n   📦 ${item.versionName}\n   🚚 ${item.deliveryName}\n   💳 ${item.paymentName}\n   💰 ${fmt(item.finalPrice)}${cs}\n\n`;});msg+="━━━━━━━━━━━━━━━━━━\n💵 *TOTAL: "+fmt(total)+"*\n━━━━━━━━━━━━━━━━━━\n\nConfirmo los datos del pedido. Coordinemos pago y entrega del juego. ¡Gracias!";return msg;}
function sendWsp(){if(!cart.length)return;window.open("https://wa.me/"+WHATSAPP+"?text="+encodeURIComponent(buildOrderMsg(cart)),"_blank");}
function updateTrustStats(){const n=typeof catalog!=="undefined"?publishedGames().length:68;const label=n>=60?"60+":String(n)+"+";document.querySelectorAll("[data-trust-count]").forEach(el=>{el.textContent=label;});}
function showNotif(msg){const el=document.getElementById("notif");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600);}
function setNavCats(active){
  const cats=[
    {label:"Inicio",href:"index.html",id:"inicio"},
    {label:"Catálogo",href:"catalogo.html",id:"catalogo"},
    {label:"Preguntas",href:"preguntas.html",id:"preguntas"},
  ];
  document.getElementById("navCats").innerHTML=cats.map(c=>`<a class="nav-cat ${c.id===active?"active":""}" href="${c.href}">${c.label}</a>`).join("");
}
function scrollToHash(){const h=location.hash;if(!h)return;const el=document.querySelector(h);if(el)setTimeout(()=>el.scrollIntoView({behavior:"smooth",block:"start"}),250);}
function handleSearch(q){
  const res=document.getElementById("searchResults");
  if(!q.trim()){res.classList.remove("show");return;}
  const ms=publishedGames().filter(g=>g.name.toLowerCase().includes(q.toLowerCase())).slice(0,6);
  if(!ms.length){res.innerHTML=`<div style="padding:14px;font-size:13px;color:var(--muted);text-align:center">Sin resultados</div>`;res.classList.add("show");return;}
  res.innerHTML=ms.map(g=>`<div class="sr-item" onclick="openModal(${g.id});clearSearch()">${gameCardCover(g)?`<img class="sr-img cover-img" src="${gameCardCover(g)}" onerror="this.outerHTML='<span style=font-size:18px;width:44px;text-align:center>${g.icon}</span>'" alt="">`:`<span style="font-size:18px;width:44px;text-align:center;flex-shrink:0">${g.icon}</span>`}<div><div class="sr-name">${g.name}</div><div class="sr-plat">${g.platform}</div></div></div>`).join("");
  res.classList.add("show");
}
function clearSearch(){document.getElementById("searchInput").value="";document.getElementById("searchResults").classList.remove("show");}
document.addEventListener("click",e=>{if(!e.target.closest(".nav-search-wrap"))clearSearch();});


function makeCard(g){
  const p=minGamePricing(g);
  if(!p)return "";
  return `<div class="product-card" onclick="openModal(${g.id})">
    <div class="product-img">
      ${coverImgMarkup(g)}
      <div class="product-img-ov"></div>
      ${g.badge?`<span class="badge badge-${g.badgeType}">${g.badge}</span>`:""}
    </div>
    <div class="product-info">
      <div class="product-name">${g.name}</div>
      <div class="product-plat">${g.platform}</div>
      ${priceCardHtml(p.cuotas,p.transfer)}
      <button class="btn-buy" onclick="event.stopPropagation();openModal(${g.id})">Comprar</button>
    </div>
  </div>`;
}

const CATALOG_PAGE_SIZE=24;
let catalogPage=1,filteredCatalog=[];
function renderCatalogPager(){
  const el=document.getElementById("catPager");
  if(!el)return;
  const pages=Math.max(1,Math.ceil(filteredCatalog.length/CATALOG_PAGE_SIZE));
  if(pages<=1){el.innerHTML="";return;}
  el.innerHTML='<button type="button" '+(catalogPage<=1?"disabled":"")+' onclick="goCatalogPage('+(catalogPage-1)+')">&larr; Anterior</button><span class="pg-info">Pagina '+catalogPage+' de '+pages+'</span><button type="button" '+(catalogPage>=pages?"disabled":"")+' onclick="goCatalogPage('+(catalogPage+1)+')">Siguiente &rarr;</button>';
}
function goCatalogPage(p){catalogPage=p;renderCatalogPage();const g=document.getElementById("catGrid");if(g)g.scrollIntoView({behavior:"smooth",block:"start"});}
function renderCatalogPage(){
  const grid=document.getElementById("catGrid");
  if(!grid)return;
  const start=(catalogPage-1)*CATALOG_PAGE_SIZE;
  const slice=filteredCatalog.slice(start,start+CATALOG_PAGE_SIZE);
  grid.innerHTML=slice.length?slice.map(makeCard).filter(Boolean).join(""):'<div style="text-align:center;padding:5rem 2rem;color:var(--muted)"><div style="font-size:52px;margin-bottom:1rem;opacity:.4">&#128269;</div><p>No encontramos juegos con ese filtro.</p></div>';
  renderCatalogPager();
  const ri=document.getElementById("resultsInfo");
  if(ri)ri.textContent=filteredCatalog.length+" de "+catalog.length+" juegos";
}

let activeTag="all",sortMode="default";
function setSort(s){sortMode=s;document.querySelectorAll(".sort-btn").forEach(b=>b.classList.toggle("active",b.dataset.sort===s));applyFilters();}
function applyFilters(){
  let r=publishedGames().filter(g=>activeTag==="all"||g.tags.includes(activeTag));
  if(sortMode==="price-asc")r.sort((a,b)=>minGamePricing(a).cuotas-minGamePricing(b).cuotas);
  else if(sortMode==="price-desc")r.sort((a,b)=>minGamePricing(b).cuotas-minGamePricing(a).cuotas);
  else r.sort((a,b)=>a.name.localeCompare(b.name,"es",{sensitivity:"base"}));
  filteredCatalog=r;catalogPage=1;renderCatalogPage();
}

function preloadSteamCaches(){const run=()=>ensureSteamAboutCache().catch(()=>{});if("requestIdleCallback" in window)requestIdleCallback(run,{timeout:4000});else setTimeout(run,1500);}

function syncCatalogSticky(){const nav=document.querySelector("nav");const fw=document.querySelector(".filters-wrap");if(nav)document.documentElement.style.setProperty("--nav-stack-h",nav.offsetHeight+"px");if(fw)document.documentElement.style.setProperty("--filters-h",fw.offsetHeight+"px");}

const HERO_SPOTLIGHT_COUNT=4;
const HERO_NUEVOS_PRIORITY=[102,101,100,62,53,15,78,52,36,26,11];
function pickHeroSpotlightGames(){
  const pub=publishedGames().filter(g=>g.tags.includes("nuevos"));
  const byId=new Map(pub.map(g=>[g.id,g]));
  const picked=[];
  for(const id of HERO_NUEVOS_PRIORITY){
    if(byId.has(id)&&picked.length<HERO_SPOTLIGHT_COUNT)picked.push(byId.get(id));
  }
  if(picked.length<HERO_SPOTLIGHT_COUNT){
    pub.sort((a,b)=>b.id-a.id).forEach(g=>{
      if(picked.length<HERO_SPOTLIGHT_COUNT&&!picked.some(x=>x.id===g.id))picked.push(g);
    });
  }
  return picked;
}
function initHeroSpotlight(){
  const el=document.getElementById("heroSpotlight");
  if(!el)return;
  el.innerHTML=pickHeroSpotlightGames().map((g,i)=>{
    const title=g.name;
    const img=gameCardCover(g);
    const safe=title.replace(/"/g,"&quot;");
    const eager=i===0;
    return '<a class="hero-promo-card" href="#" onclick="event.preventDefault();openModal('+g.id+')" aria-label="'+safe+'"><div class="hero-promo-cover">'+(img?'<img class="cover-img" src="'+img+'" sizes="(max-width:700px) 45vw, 300px" alt="'+safe+'" width="600" height="900" loading="'+(eager?"eager":"lazy")+'"'+(eager?' fetchpriority="high"':'')+' decoding="async">':'<span class="cover-fallback-icon">'+gameIcon(g)+'</span>')+'</div></a>';
  }).join("");
}
function initHomeGrids(){
  const pick=(tag,n)=>publishedGames().filter(g=>g.tags.includes(tag)).slice(0,n);
  const mas=document.getElementById("masGrid");if(mas)mas.innerHTML=pick("masvendidos",8).map(makeCard).filter(Boolean).join("")||"<p style='color:var(--muted);grid-column:1/-1'>Proximamente mas juegos.</p>";
  const nuev=document.getElementById("nuevGrid");if(nuev)nuev.innerHTML=pick("nuevos",8).map(makeCard).filter(Boolean).join("");
  const of=document.getElementById("ofGrid");if(of)of.innerHTML=pick("ofertas",8).map(makeCard).filter(Boolean).join("");
}
function toggleFaq(el){const item=el.parentElement;const isOpen=item.classList.contains("open");document.querySelectorAll(".faq-item.open").forEach(i=>i.classList.remove("open"));if(!isOpen)item.classList.add("open");}
function initIndexPage(){normalizeCatalog();preloadSteamCaches();initHeroSpotlight();initHomeGrids();updateTrustStats();scrollToHash();setNavCats("inicio");updateCartUI();if(typeof syncNavHeight==="function")syncNavHeight();document.querySelectorAll("a[href^='#']").forEach(a=>{a.addEventListener("click",e=>{const t=document.querySelector(a.getAttribute("href"));if(t){e.preventDefault();t.scrollIntoView({behavior:"smooth",block:"start"});}});});}
function initCatalogPage(){normalizeCatalog();preloadSteamCaches();setNavCats("catalogo");updateCartUI();updateTrustStats();const urlTag=new URLSearchParams(window.location.search).get("filter");const tags=["all","accion","rpg","aventura","fps","deportes"];const startTag=urlTag&&tags.indexOf(urlTag)>=0?urlTag:"all";const chip=document.querySelector('[data-tag="'+startTag+'"]');if(chip){document.querySelectorAll(".fc").forEach(c=>c.classList.remove("active"));chip.classList.add("active");activeTag=startTag;}document.querySelectorAll(".fc").forEach(chip=>{if(!chip._bound){chip._bound=true;chip.addEventListener("click",function(){document.querySelectorAll(".fc").forEach(c=>c.classList.remove("active"));chip.classList.add("active");activeTag=chip.dataset.tag;applyFilters();});}});applyFilters();syncCatalogSticky();scrollToHash();window.addEventListener("resize",syncCatalogSticky,{passive:true});}
function initPreguntasPage(){normalizeCatalog();preloadSteamCaches();setNavCats("preguntas");updateCartUI();updateTrustStats();}
