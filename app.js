(() => {
  'use strict';

  const menuToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? '展开导航' : '收起导航');
    mobileNav.hidden = isOpen;
  });
  mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    mobileNav.hidden = true;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', '展开导航');
  }));

  const stepContent = [
    { icon: 'i-briefcase', kicker: '我的第一个目标', title: ['把心仪岗位，', '留在工作台里。'], fields: [['目标岗位', '产品经理 · 秋招'], ['公司 / 地点', '星河科技 / 杭州'], ['投递截止', '2026 年 9 月 18 日']], confirmation: '机会已收好，下一步准备简历。' },
    { icon: 'i-file', kicker: '为这次机会，认真准备', title: ['用合适的版本，', '讲清自己的优势。'], fields: [['简历版本', '产品方向 V2'], ['关联岗位', '产品经理 · 星河科技'], ['准备重点', '用户研究 / 项目推进']], confirmation: '版本已关联，每次准备都有记录。' },
    { icon: 'i-calendar', kicker: '进展，从一件小事开始', title: ['把重要的下一步，', '安排进今天。'], fields: [['当前阶段', '一面准备'], ['面试安排', '9 月 8 日 14:00'], ['下一步', '梳理项目亮点与个人贡献']], confirmation: '日程已记下，给准备留一点余地。' }
  ];
  const stepTabs = [...document.querySelectorAll('[data-step]')];
  const flowPanel = document.getElementById('flow-panel');
  const flowCard = flowPanel.querySelector('.flow-demo-card');
  const flowSection = document.getElementById('how-it-works');
  const flowGrid = flowSection.querySelector('.flow-grid');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeStepIndex = 0;
  let scrollStoryEnabled = false;
  let motionPaused = reducedMotion.matches;
  let manualScrollUntil = 0;

  function activateStep(index, moveFocus = false) {
    if (moveFocus) stepTabs[index].focus();
    if (index === activeStepIndex) return;
    activeStepIndex = index;
    const data = stepContent[index];
    stepTabs.forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    flowPanel.setAttribute('aria-labelledby', stepTabs[index].id);
    flowCard.querySelector('.flow-demo-icon use').setAttribute('href', '#' + data.icon);
    flowCard.querySelector('.flow-demo-kicker').textContent = data.kicker;
    const title = flowCard.querySelector('h3');
    title.replaceChildren(document.createTextNode(data.title[0]), document.createElement('br'), document.createTextNode(data.title[1]));
    const fieldElements = flowCard.querySelectorAll('.flow-fields > div');
    data.fields.forEach((field, i) => {
      fieldElements[i].querySelector('span').textContent = field[0];
      fieldElements[i].querySelector('strong').textContent = field[1];
    });
    flowCard.querySelector('.flow-confirm span').textContent = data.confirmation;
    flowPanel.querySelectorAll('.flow-pagination span').forEach((dot, i) => dot.classList.toggle('active', i === index));
    flowSection.dataset.activeStep = String(index);
    flowPanel.querySelector('.scene-watermark').textContent = String(index + 1).padStart(2, '0');
    flowPanel.querySelector('.scene-label').textContent = ['从这里开始', '为机会做好准备', '让进展发生'][index];
    flowSection.querySelector('.story-count b').textContent = String(index + 1).padStart(2, '0');
    if (!scrollStoryEnabled) flowSection.style.setProperty('--flow-progress', String((index + 1) / 3));
    flowCard.classList.remove('panel-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => flowCard.classList.add('panel-enter')));
  }
  function requestStep(index, moveFocus = false) {
    activateStep(index, moveFocus);
    if (!scrollStoryEnabled) return;
    const sectionTop = flowSection.getBoundingClientRect().top + window.scrollY;
    const scrollDistance = Math.max(1, flowSection.offsetHeight - flowGrid.offsetHeight);
    manualScrollUntil = performance.now() + 1000;
    window.scrollTo({ top: sectionTop + scrollDistance * ((index + .2) / 3), behavior: motionPaused ? 'instant' : 'smooth' });
    window.setTimeout(scheduleScroll, 1050);
  }
  stepTabs.forEach((tab, index) => tab.addEventListener('click', () => requestStep(index)));

  function wireArrowKeys(tabs, activate, vertical = false) {
    tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
      const isVertical = typeof vertical === 'function' ? vertical() : vertical;
      const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
      const previousKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
      let target;
      if (event.key === nextKey) target = (index + 1) % tabs.length;
      if (event.key === previousKey) target = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target !== undefined) {
        event.preventDefault();
        activate(target, true);
      }
    }));
  }
  document.querySelector('.flow-steps').setAttribute('aria-orientation', 'vertical');
  wireArrowKeys(stepTabs, requestStep, () => !(scrollStoryEnabled && window.innerWidth <= 700));

  const motionButton = document.querySelector('.motion-toggle');
  function applyMotionPreference() {
    document.body.classList.toggle('motion-paused', motionPaused);
    motionButton.setAttribute('aria-pressed', String(motionPaused));
    motionButton.setAttribute('aria-label', motionPaused ? '开启页面动效' : '暂停页面动效');
    motionButton.querySelector('.motion-toggle-label').textContent = motionPaused ? '开启动效' : '暂停动效';
    motionButton.querySelector('.motion-toggle-symbol').textContent = motionPaused ? '▷' : 'Ⅱ';
    scheduleScroll();
  }
  motionButton.addEventListener('click', () => {
    motionPaused = !motionPaused;
    applyMotionPreference();
  });

  const pageProgress = document.createElement('div');
  pageProgress.className = 'page-progress';
  pageProgress.setAttribute('aria-hidden', 'true');
  document.body.prepend(pageProgress);
  const hero = document.querySelector('.hero');
  const heroVisual = document.querySelector('.hero-visual');
  let framePending = false;

  function renderScroll() {
    framePending = false;
    const documentTravel = document.documentElement.scrollHeight - window.innerHeight;
    const documentProgress = documentTravel > 0 ? Math.min(1, Math.max(0, window.scrollY / documentTravel)) : 0;
    pageProgress.style.setProperty('--page-progress', String(documentProgress));
    if (scrollStoryEnabled) {
      const bounds = flowSection.getBoundingClientRect();
      const travel = bounds.height - flowGrid.offsetHeight;
      const progress = Math.min(1, Math.max(0, -bounds.top / Math.max(1, travel)));
      flowSection.style.setProperty('--flow-progress', String(progress));
      if (performance.now() >= manualScrollUntil) {
        activateStep(Math.min(2, Math.floor(progress * 3)));
      }
    }
    if (!motionPaused && !reducedMotion.matches) {
      const heroBounds = hero.getBoundingClientRect();
      const shift = Math.min(22, Math.max(0, -heroBounds.top * .045));
      heroVisual.style.setProperty('--hero-shift', shift + 'px');
      heroVisual.style.setProperty('--character-shift', (-shift * .5) + 'px');
    }
  }
  function scheduleScroll() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(renderScroll);
  }
  function configureStory() {
    const sufficientSpace = window.innerHeight >= (window.innerWidth <= 700 ? 700 : 680);
    scrollStoryEnabled = !reducedMotion.matches && sufficientSpace;
    flowSection.classList.toggle('has-scroll-story', scrollStoryEnabled);
    if (scrollStoryEnabled && flowGrid.offsetHeight > window.innerHeight + 4) {
      scrollStoryEnabled = false;
      flowSection.classList.remove('has-scroll-story');
    }
    flowSection.querySelector('.flow-steps').setAttribute('aria-orientation', scrollStoryEnabled && window.innerWidth <= 700 ? 'horizontal' : 'vertical');
    flowSection.querySelector('.scroll-cue-copy').textContent = scrollStoryEnabled ? '向下滚动，看看下一步' : '点击上方步骤，看看下一步';
    if (!scrollStoryEnabled) flowSection.style.setProperty('--flow-progress', String((activeStepIndex + 1) / 3));
    scheduleScroll();
  }
  window.addEventListener('scroll', scheduleScroll, { passive: true });
  window.addEventListener('resize', configureStory, { passive: true });
  window.addEventListener('wheel', () => { manualScrollUntil = 0; }, { passive: true });
  window.addEventListener('touchstart', () => { manualScrollUntil = 0; }, { passive: true });
  reducedMotion.addEventListener('change', () => {
    motionPaused = reducedMotion.matches;
    applyMotionPreference();
    configureStory();
  });
  configureStory();
  applyMotionPreference();

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('is-pending-reveal');
        entry.target.classList.add('is-revealed');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
    document.querySelectorAll('.feature-card, .features > .section-heading, .questions-section > .section-heading, .faq-list, .closing-card').forEach((element, index) => {
      element.classList.add('reveal-item');
      if (element.classList.contains('feature-card')) element.style.setProperty('--reveal-delay', ((index % 3) * 85) + 'ms');
      if (!reducedMotion.matches) element.classList.add('is-pending-reveal');
      revealObserver.observe(element);
    });
    const characterObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.target.classList.toggle('is-in-view', entry.isIntersecting));
    }, { rootMargin: '80px' });
    document.querySelectorAll('.character-scene').forEach(scene => characterObserver.observe(scene));
  } else {
    document.querySelectorAll('.character-scene').forEach(scene => scene.classList.add('is-in-view'));
  }

  const dialog = document.getElementById('workspace-dialog');
  let lastOpener;
  document.querySelectorAll('[data-open-demo]').forEach(button => button.addEventListener('click', () => {
    window.location.assign(button.classList.contains('button-text') ? '/workspace/#/jobs' : '/workspace/');
  }));
  function closeDialog() { dialog.close(); }
  document.getElementById('close-dialog').addEventListener('click', closeDialog);
  document.getElementById('finish-demo').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = '';
    lastOpener?.focus();
  });

  const demoTabs = [...document.querySelectorAll('[data-demo-tab]')];
  function activateDemoTab(index, moveFocus = false) {
    demoTabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = i !== index;
    });
    if (moveFocus) demoTabs[index].focus();
  }
  demoTabs.forEach((tab, index) => tab.addEventListener('click', () => activateDemoTab(index)));
  wireArrowKeys(demoTabs, activateDemoTab);

  const todos = [...document.querySelectorAll('.demo-todo input')];
  todos.forEach(input => input.addEventListener('change', () => {
    const remaining = todos.filter(item => !item.checked).length;
    document.getElementById('remaining-count').textContent = String(remaining);
    document.querySelector('#demo-panel-today .demo-feedback').textContent = remaining === 0
      ? '今天的两件事都完成了。给自己一点休息的时间。'
      : remaining === 1 ? '又向前走了一步。今天还剩 1 件待办。' : '完成一项，就勾选一项。进展看得见。';
  }));
  document.querySelectorAll('.demo-job select').forEach(select => select.addEventListener('change', () => {
    const title = select.closest('.demo-job').querySelector('strong').textContent;
    document.getElementById('job-feedback').textContent = title + '的演示状态已更新为“' + select.value + '”。';
  }));
})();
