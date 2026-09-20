// Decorative UI only. Resume documents and their exported styles stay independent.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const copy = {
  jobs: ['下一站，心仪的 Offer', 'wave'], templates: ['把好经历，写成好简历', 'work'],
  resumes: ['认真准备的你，很棒', 'work'], overview: ['今天，也向前一步', 'wave'],
  applications: ['每一次出发，都算数', 'wave'], calendar: ['把重要的日子，记下来', 'work'],
};
function scene(kind = 'wave', caption = '', compact = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'delight-scene ' + (compact ? 'scene-compact ' : '') + 'scene-' + kind;
  wrapper.setAttribute('aria-hidden','true');
  wrapper.innerHTML = `<span class="scene-orbit"></span><span class="scene-spark spark-a">✦</span><span class="scene-spark spark-b">✧</span><span class="scene-note note-a">${kind==='work'?'CV':'↗'}</span><span class="scene-note note-b">✓</span><span class="buddy-sprite buddy-${kind}"></span><span class="scene-shadow"></span>${caption?'<span class="scene-caption"></span>':''}`;
  if (caption) wrapper.querySelector('.scene-caption').textContent = caption;
  return wrapper;
}

export function initDelight(root) {
  let preferred = true, viewFrame = 0, pointerFrame = 0, request = null;
  try { preferred = localStorage.getItem('offerbiu:workspace-motion') !== 'off'; } catch {}
  const active = () => preferred && !reduced.matches;
  const animations = new Set();
  const seen = new WeakSet();
  const lastCounts = new Map();
  const toggle = document.createElement('button');
  toggle.type='button';toggle.className='motion-toggle';
  document.querySelector('.topbar-right')?.prepend(toggle);
  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for(const entry of entries) if(entry.isIntersecting) {
      entry.target.classList.add('view-visible');revealObserver.unobserve(entry.target);
    }
  },{threshold:.06}) : null;
  const characterObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for(const entry of entries) entry.target.classList.toggle('sticker-visible',entry.isIntersecting);
  },{rootMargin:'40px'}) : null;

  function updatePreference() {
    document.body.classList.toggle('delight-paused',!active());
    document.documentElement.classList.toggle('workspace-motion-off',!active());
    toggle.innerHTML = `<span aria-hidden="true">${active()?'✦':'◌'}</span><span>${reduced.matches?'减少动态':active()?'动效开启':'动效暂停'}</span>`;
    toggle.setAttribute('aria-pressed',String(active()));
    toggle.setAttribute('aria-label',reduced.matches?'已遵循系统的减少动态效果设置':active()?'暂停页面动效':'开启页面动效');
    toggle.disabled=reduced.matches;
    if(!active()) {
      for(const finish of [...animations]) finish();
      root.querySelectorAll('.view-reveal').forEach(el=>el.classList.add('view-visible'));
    }
  }
  toggle.addEventListener('click',()=>{preferred=!preferred;try{localStorage.setItem('offerbiu:workspace-motion',preferred?'on':'off');}catch{}updatePreference();});
  reduced.addEventListener('change',updatePreference);
  document.addEventListener('visibilitychange',()=>document.body.classList.toggle('delight-background',document.hidden));

  function countUp(el) {
    const final=el.textContent;
    if(!active() || !/^\d+$/.test(final)) return;
    const target=Number(final);if(target<2 || target>100000) return;
    const start=performance.now();let id=0;
    el.setAttribute('aria-label',final);
    const finish=()=>{cancelAnimationFrame(id);if(el.isConnected) el.textContent=final;animations.delete(finish);};
    animations.add(finish);
    const tick=now=>{
      if(!el.isConnected || !active() || document.hidden) return finish();
      const progress=Math.min(1,(now-start)/650);
      el.textContent=String(Math.round(target*(1-Math.pow(1-progress,3)))).padStart(final.startsWith('0')?final.length:1,'0');
      if(progress<1) id=requestAnimationFrame(tick);else finish();
    };id=requestAnimationFrame(tick);
  }
  function decorate() {
    const route=location.hash.replace(/^#\/?/,'').split('/')[0] || 'overview';
    document.body.dataset.workspacePage=route;
    if(root.querySelector('.loading-view')) return;
    const heading=root.querySelector('.page-heading');
    if(heading && copy[route] && !heading.querySelector('.delight-scene')) {
      heading.classList.add('heading-illustrated');heading.append(scene(copy[route][1],copy[route][0]));
    }
    const welcome=root.querySelector('.welcome-panel');
    if(welcome && !welcome.querySelector('.delight-scene')) {
      welcome.querySelector('.welcome-art')?.remove();welcome.append(scene('wave','出发吧，一起加油'));welcome.classList.add('welcome-illustrated');
    }
    const banner=root.querySelector('.dashboard-banner');
    if(banner && !banner.querySelector('.delight-scene')) {
      banner.querySelector('.banner-decoration')?.remove();banner.append(scene('wave','准备好，迎接下一步'));banner.classList.add('dashboard-illustrated');
    }
    const studio=root.querySelector('.studio-banner');
    if(studio && !studio.querySelector('.delight-scene')) {
      studio.classList.add('studio-illustrated');studio.append(scene('work','',true));
    }
    const empty=root.querySelector('.empty-state');
    if(empty && !empty.querySelector('.delight-scene')) {empty.querySelector('.empty-icon')?.remove();empty.prepend(scene('work','',true));}
    revealObserver?.disconnect();characterObserver?.disconnect();
    root.querySelectorAll('.delight-scene').forEach(el=>{if(characterObserver)characterObserver.observe(el);else el.classList.add('sticker-visible');});
    const cards=root.querySelectorAll('.page-heading,.welcome-panel,.dashboard-banner,.stat-card,.job-card,.template-card,.resume-card,.intro-grid>article,.dashboard-columns>.panel,.studio-banner,.recruit-summary');
    cards.forEach((el,index)=>{
      if(seen.has(el)) { if(active() && !el.classList.contains('view-visible')) revealObserver?.observe(el); return; }seen.add(el);
      el.classList.add('view-reveal');el.style.setProperty('--enter-delay',Math.min(index%6,4)*45+'ms');
      if(active() && revealObserver) revealObserver.observe(el);else el.classList.add('view-visible');
    });
    root.querySelectorAll('.stat-card strong,.recruit-summary>div>strong').forEach((el,index)=>{
      if(el.dataset.counted)return;el.dataset.counted='true';
      const key=route+':'+index,value=el.textContent;
      if(lastCounts.get(key)!==value){lastCounts.set(key,value);countUp(el);}
    });
  }
  const observer=new MutationObserver(()=>{cancelAnimationFrame(viewFrame);viewFrame=requestAnimationFrame(decorate);});
  observer.observe(root,{childList:true});
  root.addEventListener('pointermove',event=>{
    if(!active() || event.pointerType==='touch') return;
    const card=event.target.closest('.job-card,.template-card');if(!card)return;
    request={card,x:event.clientX,y:event.clientY};
    if(pointerFrame)return;
    pointerFrame=requestAnimationFrame(()=>{
      pointerFrame=0;if(!request?.card.isConnected)return;
      const {card,x,y}=request,rect=card.getBoundingClientRect();
      card.style.setProperty('--glow-x',(x-rect.left)+'px');card.style.setProperty('--glow-y',(y-rect.top)+'px');
    });
  });
  window.addEventListener('offerbiu:feedback',event=>{
    if(!active() || document.hidden || event.detail?.error || !/已保存|已收下|已存入|已采纳|已恢复/.test(event.detail?.message || ''))return;
    const previous=document.querySelector('.delight-confetti');previous?.remove();
    const burst=document.createElement('div');burst.className='delight-confetti';burst.setAttribute('aria-hidden','true');
    for(let i=0;i<12;i++){const piece=document.createElement('i');piece.style.setProperty('--burst-x',((i-5.5)*19)+'px');piece.style.setProperty('--burst-y',(-35-(i%4)*17)+'px');piece.style.setProperty('--burst-r',((i-5)*34)+'deg');piece.style.setProperty('--burst-color',['#597cfa','#b4a1ec','#f6c879','#84c9b6'][i%4]);burst.append(piece);}
    document.body.append(burst);setTimeout(()=>burst.remove(),900);
  });
  updatePreference();decorate();
}
