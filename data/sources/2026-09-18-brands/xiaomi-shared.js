// City validation gate
// ;(async function cityGate() {
//     const isProd = location.origin === 'https://hr.xiaomi.com'
//     if (!isProd) return;
//     // 根路径 https://hr.xiaomi.com 不需要请求在php已经处理，/website 路径需要校验
//     if (!location.pathname.startsWith('/website')) return;
//     const apiBase = 'https://portal.hr.mioffice.cn';
//     const fallback = 'https://hr.xiaomi.com';
//     try {
//       const res = await fetch(apiBase + '/api/hrportal/oversea/validate-city');
//       const data = await res.json();
//       if (data.data !== true) location.href = fallback;
//     } catch (_) {
//       location.href = fallback;
//     }
// })();

// Nav scroll state
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
});

// Hash scroll: ensure anchor targets scroll into view on page load
window.addEventListener('DOMContentLoaded', () => {
  if (location.hash) {
    const id = location.hash.replace('#', '').split('&')[0].split('=')[0];
    const el = document.getElementById(id);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 300);
  }
});

// Reveal on scroll
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) {
      en.target.classList.add('visible');
      if (en.target.id === 'stats') animateCounters();
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal, .reveal-stagger').forEach((el) => revealObserver.observe(el));

// Stats counters — 进入视口时滚动一次，hover 时可再次触发
// 每个 .stat-number 自带 runToken：新一轮启动时 token++，旧 RAF 检查到 token 不匹配立即退出，避免并发重入
function animateCounters() {
  document.querySelectorAll('.stat-number').forEach((el) => {
    const target = parseInt(el.dataset.target, 10);
    const unitHtml = el.querySelector('.unit')?.outerHTML || '';
    const duration = 2000;
    const start = performance.now();
    const runToken = (el._runToken || 0) + 1;
    el._runToken = runToken;
    el.innerHTML = '0' + unitHtml;
    function update(now) {
      if (el._runToken !== runToken) return;
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.innerHTML = Math.round(target * eased) + unitHtml;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  });
}

// hover stats 区域时再次播放滚动
(function () {
  const stats = document.getElementById('stats');
  if (!stats) return;
  const bar = stats.closest('.stats-bar') || stats;
  bar.addEventListener('mouseenter', animateCounters);
})();

// Mobile nav toggle
document.querySelectorAll('.nav-mobile-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const navLinks = document.querySelector('.nav-links');
    const isOpen = navLinks.classList.toggle('open');
    btn.textContent = isOpen ? '✕' : '☰';
  });
});
// Mobile sub-menu toggle
document.querySelectorAll('.nav-has-sub > a').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      e.preventDefault();
      a.closest('.nav-has-sub').classList.toggle('open');
    }
  });
});

// Language toggle placeholder — en version not yet built
document.querySelectorAll('[data-lang-toggle]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const current = el.dataset.langToggle;
    const next = current === 'zh' ? 'en' : 'zh';
    alert(next === 'en' ? 'English site coming soon.' : '中文站点即将上线。');
  });
});

// Sticky search bar: appear when scrolled past hero 60%
(function () {
  const sticky = document.getElementById('stickySearch');
  const hero = document.querySelector('.hero');
  if (!sticky || !hero) return;

  function onScroll() {
    const threshold = hero.offsetHeight * 0.6;
    sticky.classList.toggle('visible', window.scrollY > threshold);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const form = sticky.querySelector('form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const city = form.elements.city?.value || '';
      const category = form.elements.category?.value || '';
      const q = form.elements.q?.value || '';
      const params = new URLSearchParams();
      if (city && city !== 'all') params.set('city', city);
      if (category && category !== 'all') params.set('category', category);
      if (q) params.set('q', q);
      const qs = params.toString();
      window.location.href = 'opportunities.html' + (qs ? '?' + qs : '');
    });
  }
})();

// Generic carousel — 铺满容器宽度 + 触摸滑动支持 + 自动播放（循环）
function initCarousel(trackId, prevId, nextId, dotsId, opts = {}) {
  const track = document.getElementById(trackId);
  if (!track) return;
  const prev = document.getElementById(prevId);
  const next = document.getElementById(nextId);
  const dotsEl = document.getElementById(dotsId);
  const wrap = track.parentElement;
  const autoplay = opts.autoplay !== false;
  const interval = opts.interval || 5000;

  function getCards() { return Array.from(track.children); }
  let cards = getCards();
  let current = 0;

  const desktopVisible = opts.visibleCount || 4;
  function visibleCount() {
    if (window.innerWidth <= 640) return 1;
    if (window.innerWidth <= 1024) return 2;
    return desktopVisible;
  }

  // 让每张卡片宽度恰好铺满容器 / visibleCount，gap 内嵌到计算里
  const GAP = 20;
  function visibleCards() { return cards.filter(c => c.style.display !== 'none' && !c.hidden); }
  function layout() {
    cards = getCards();
    const vis = visibleCount();
    const style = getComputedStyle(wrap);
    const wrapW = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!cards.length || wrapW <= 0) return;
    const cardW = (wrapW - GAP * (vis - 1)) / vis;
    const aspectRatio = opts.aspectRatio || 0;
    cards.forEach(c => { c.style.flex = `0 0 ${cardW}px`; if (aspectRatio) c.style.height = `${cardW / aspectRatio}px`; });
    track.style.gap = GAP + 'px';
    const needNav = visibleCards().length > vis;
    if (prev) prev.style.display = needNav ? '' : 'none';
    if (next) next.style.display = needNav ? '' : 'none';
    if (current > maxIndex()) current = maxIndex();
    goTo(current, false);
  }

  function maxIndex() { return Math.max(0, visibleCards().length - visibleCount()); }

  function goTo(idx, animate = true) {
    const max = maxIndex();
    if (idx < 0) current = 0;
    else if (idx > max && max > 0) current = max;
    else current = idx;
    if (!animate) track.style.transition = 'none';
    else track.style.transition = 'transform 0.5s cubic-bezier(0.4,0,0.2,1)';
    const vc = visibleCards();
    if (!vc.length) return;
    const cardW = vc[0].getBoundingClientRect().width + GAP;
    const style = getComputedStyle(wrap);
    const contentW = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const totalTrackW = vc.length * cardW - GAP;
    const maxOffset = Math.max(0, totalTrackW - contentW);
    let offset = current * cardW;
    if (offset > maxOffset) offset = maxOffset;
    if (offset < 0) offset = 0;
    track.style.transform = `translateX(-${offset}px)`;
    if (!animate) requestAnimationFrame(() => { track.style.transition = ''; });
    if (prev) prev.style.opacity = current <= 0 ? '0.3' : '1';
    if (next) next.style.opacity = current >= max ? '0.3' : '1';
    if (dotsEl) {
      const dots = dotsEl.querySelectorAll('.carousel-dot');
      if (dots.length) {
        const step = Math.ceil(cards.length / dots.length);
        dots.forEach((d, i) => d.classList.toggle('active', Math.floor(current / step) === i));
      }
    }
  }

  // 自动播放（hover / 触摸时暂停）
  let timer = null;
  function startAuto() {
    if (!autoplay || timer) return;
    const total = visibleCards().length;
    if (total <= 1) return;
    timer = setInterval(() => { if (current >= maxIndex()) goTo(0); else goTo(current + 1); }, interval);
  }
  function stopAuto() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function restartAuto() { stopAuto(); startAuto(); }

  if (autoplay) {
    wrap.addEventListener('mouseenter', stopAuto);
    wrap.addEventListener('mouseleave', startAuto);
    wrap.addEventListener('touchstart', stopAuto, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAuto(); else startAuto();
    });
  }

  if (prev) prev.addEventListener('click', () => { goTo(current - 1); restartAuto(); });
  if (next) next.addEventListener('click', () => { goTo(current + 1); restartAuto(); });
  if (dotsEl) {
    dotsEl.querySelectorAll('.carousel-dot').forEach((d, i) => {
      d.addEventListener('click', () => {
        const step = Math.ceil(cards.length / dotsEl.querySelectorAll('.carousel-dot').length);
        goTo(i * step);
        restartAuto();
      });
    });
  }

  // 触摸滑动
  let touchStartX = 0, touchStartY = 0, dragging = false;
  wrap.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    dragging = false;
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (!dragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { dragging = true; }
    if (dragging) e.preventDefault();
  }, { passive: false });
  wrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dragging && Math.abs(dx) > 40) {
      goTo(dx < 0 ? current + 1 : current - 1);
    }
    dragging = false;
    restartAuto();
  });

  // 鼠标拖拽（桌面端）
  let mouseStartX = 0, mouseDown = false;
  wrap.addEventListener('mousedown', e => { mouseDown = true; mouseStartX = e.clientX; });
  window.addEventListener('mousemove', e => { if (!mouseDown) return; });
  window.addEventListener('mouseup', e => {
    if (!mouseDown) return;
    const dx = e.clientX - mouseStartX;
    if (Math.abs(dx) > 40) goTo(dx < 0 ? current + 1 : current - 1);
    mouseDown = false;
    restartAuto();
  });

  window.addEventListener('resize', layout);
  // 监听 track 内容变化（API 异步填充后重新 layout）
  new MutationObserver(() => { layout(); restartAuto(); }).observe(track, { childList: true });
  // 等字体/图片加载后再 layout
  if (document.readyState === 'complete') { layout(); startAuto(); }
  else { window.addEventListener('load', () => { layout(); startAuto(); }); }
}

// Init carousels
initCarousel('newsTrack', 'newsPrev', 'newsNext', 'newsDots', { visibleCount: 3, interval: 4000, aspectRatio: 2 });
initCarousel('campusNewsTrack', 'campusNewsPrevBtn', 'campusNewsNextBtn');
initCarousel('gradTrack', 'gradPrev', 'gradNext', 'gradDots');
initCarousel('voiceTrack', 'voicePrevBtn', 'voiceNextBtn', null, { interval: 4000, visibleCount: 3 });

// Opportunities page: read query params and preselect filters + search input
(function () {
  if (document.body.dataset.page !== 'opportunities') return;
  const params = new URLSearchParams(window.location.search);
  const city = params.get('city');
  const category = params.get('category');
  const project = params.get('project');
  const q = params.get('q');

  if (city) {
    document.querySelectorAll('[data-filter="city"] .filter-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === city);
    });
  }
  if (project) {
    document.querySelectorAll('[data-filter="project"] .filter-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === project);
    });
  } else if (category) {
    document.querySelectorAll('[data-filter="project"] .filter-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === category);
    });
  }
  const qInput = document.querySelector('[data-hero-search]');
  const jobsSearchInput = document.querySelector('.jobs-search-input');
  if (q) {
    if (qInput) qInput.value = q;
    if (jobsSearchInput) jobsSearchInput.value = q;
  }
})();

(function () {
  const lazyBgEls = document.querySelectorAll('[data-lazy-bg]');
  if (!lazyBgEls.length) return;

  function loadBg(el) {
    const url = el.dataset.lazyBg;
    if (!url) return;
    if (el.classList.contains('loc-pcard')) {
      el.style.setProperty('--loc-bg', `url("${url}")`);
      delete el.dataset.lazyBg;
      return;
    }
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    delete el.dataset.lazyBg;
  }

  if (!('IntersectionObserver' in window)) {
    lazyBgEls.forEach(loadBg);
    return;
  }

  const obs = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      loadBg(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '200px' });

  lazyBgEls.forEach((el) => obs.observe(el));
})();

(function () {
  const video = document.querySelector('.hero-video');
  if (!video) return;

  const conn = navigator.connection;
  const skipVideo = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || (conn && (conn.saveData || /^(2g|3g)$/.test(conn.effectiveType || '')));

  if (skipVideo) {
    video.remove();
    return;
  }

  function activateVideo() {
    if (video.dataset.loaded) return;
    video.dataset.loaded = '1';
    video.querySelectorAll('source[data-src]').forEach((s) => {
      s.src = s.dataset.src;
      s.removeAttribute('data-src');
    });
    video.load();
    video.play().catch(() => {});
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(activateVideo, { timeout: 3000 });
  } else {
    window.addEventListener('load', () => setTimeout(activateVideo, 500));
  }
})();
