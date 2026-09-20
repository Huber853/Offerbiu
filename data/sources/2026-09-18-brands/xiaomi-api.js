/**
 * 小米招聘官网 - 后台 API 数据加载器
 * 从 portal 后台管理系统实时获取配置数据，替换页面硬编码内容
 * 后台地址可通过 window.ADMIN_API 配置，默认指向 portal 后端
 */
(function () {
  const API_BASE = window.ADMIN_API || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '' : '/website');

  function resolveUrl(url) {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('assets/')) return url;
    return API_BASE + url;
  }

  // 路径映射：官网模块名 → portal 后端接口（/cli/ 前缀免鉴权）
  const PATH_MAP = {
    'news': '/cli/api/hrportal/domestic/news/list',
    'voices': '/cli/api/hrportal/domestic/voices/list',
    'campus-news': '/cli/api/hrportal/domestic/campusNews/list',
    'research': '/cli/api/hrportal/domestic/research/list',
    'programs': '/cli/api/hrportal/domestic/programs/list',
    'schedule': '/cli/api/hrportal/domestic/schedule/list',
    'talent-cards': '/cli/api/hrportal/domestic/talentCards/list',
    'research-domain': '/cli/api/hrportal/domestic/researchDomain/list',
  };

  async function fetchData(path) {
    try {
      const apiPath = PATH_MAP[path] || ('/api/hrportal/domestic/' + path + '/list');
      const res = await fetch(API_BASE + apiPath);
      console.log({res});
      
      if (!res.ok) throw new Error('API error');
      const json = await res.json();
      // portal 后端返回 { success, data, paging }，官网只需要 data 数组
      return json.data || json;
    } catch (e) {
      // API 不可用时 fallback 到静态 JSON
      try {
        const staticPath = 'assets/data/' + path.split('/')[0] + '.json';
        const res = await fetch(staticPath);
        if (!res.ok) return null;
        return await res.json();
      } catch (e) { return null; }
    }
  }

  // --- 小米动态（首页全屏轮播）---
  async function loadNews() {
    const container = document.getElementById('newsTrack');
    if (!container) return;
    const data = await fetchData('news');
    if (!data || !data.length) return;
    container.innerHTML = data.map(item => `
      <a class="news-card" href="${item.linkUrl || item.link_url || '#'}" target="_blank" rel="noopener">
        <img class="news-cover-img" src="${resolveUrl(item.coverUrl || item.cover_url)}" alt="${item.title}" loading="lazy">
        <div class="news-overlay">
          <div class="news-title">${item.title}</div>
          <div class="news-excerpt">${item.excerpt || ''}</div>
        </div>
      </a>
    `).join('');
    window.dispatchEvent(new Event('resize'));
  }

  // --- 员工心声（life.html）---
  async function loadVoices() {
    const container = document.getElementById('voiceTrack');
    if (!container) return;
    const data = await fetchData('voices');
    if (!data || !data.length) return;
    container.innerHTML = data.map(v => `
      <div class="voice">
        <div class="voice-head">
          <div class="voice-avatar">${(v.avatarUrl || v.avatar_url) ? '<img src="' + resolveUrl(v.avatarUrl || v.avatar_url) + '" alt="' + v.nickname + '" loading="lazy" decoding="async">' : '<span>' + v.nickname[0] + '</span>'}</div>
          <div class="voice-who"><div class="nick">${v.nickname}</div><div class="role">${v.department} · ${v.role}</div></div>
        </div>
        <blockquote class="voice-quote">${v.content}</blockquote>
      </div>
    `).join('');
    window.dispatchEvent(new Event('resize'));
  }

  // --- 招聘动态（campus.html）---
  async function loadCampusNews() {
    const container = document.getElementById('campusNewsTrack');
    if (!container) return;
    const data = await fetchData('campus-news');
    if (!data || !data.length) return;
    container.innerHTML = data.map(item => {
      const href = `campus-notice.html#id=${item.id}`;
      return `<a class="cn-card" href="${href}" data-tag="${item.tag || ''}">
        <div class="cn-card-meta"><span class="tag" ${item.tag ? '' : 'style="visibility:hidden"'}>${item.tag || '占位'}</span></div>
        <h4>${item.title}</h4>
        <p>${item.description || ''}</p>
        <span class="cn-card-link">查看详情</span>
      </a>`;
    }).join('');
    window.dispatchEvent(new Event('resize'));
  }

  // --- 前沿研究课题（top-talent-o.html）---
  async function loadResearch() {
    const container = document.getElementById('rtGrid');
    if (!container) return;
    // 动态加载领域 tab
    const sidebar = container.closest('.rt-layout')?.querySelector('.rt-sidebar');
    if (sidebar) {
      const domains = await fetchData('research-domain');
      if (domains && domains.length) {
        sidebar.innerHTML = domains.map((d, i) => `<button class="rt-filter${i === 0 ? ' active' : ''}" data-domain="${d.code}">${d.name}</button>`).join('');
      }
    }
    const data = await fetchData('research');
    if (!data || !data.length) return;
    // 按 domain+title 分组，合并相同课题不同地点
    const grouped = {};
    data.forEach(item => {
      const key = item.domain + '||' + item.title;
      if (!grouped[key]) {
        grouped[key] = { domain: item.domain, title: item.title, isStarred: item.isStarred || item.is_starred, locations: [] };
      }
      const loc = item.location || '';
      const url = item.linkUrl || item.link_url || '';
      if (loc) grouped[key].locations.push({ name: loc, url });
      else if (url && !grouped[key].locations.length) grouped[key].locations.push({ name: '', url });
    });
    container.innerHTML = Object.values(grouped).map(item => {
      const multiLoc = item.locations.filter(l => l.name).length > 1;
      const singleUrl = item.locations.length === 1 ? item.locations[0].url : (item.locations.length === 0 ? '' : '');
      const firstUrl = item.locations[0]?.url || '';
      // 多地点：hover 显示地点标签；单地点或无地点：整卡片可点击
      if (multiLoc) {
        const locationsHtml = `<div class="rt-card-locations">${item.locations.map(l =>
          l.url ? `<a class="rt-loc-tag" href="${l.url}" target="_blank" rel="noopener">${l.name}</a>`
                 : `<span class="rt-loc-tag">${l.name}</span>`
        ).join('')}</div>`;
        return `
        <div class="rt-card" data-domain="${item.domain}">
          <div class="rt-card-head">
            <span class="rt-card-title">${item.title}</span>
            <button class="rt-card-star ${item.isStarred ? 'is-on' : ''}" type="button" aria-label="收藏"></button>
          </div>
          ${locationsHtml}
        </div>`;
      }
      // 单地点或无地点：整卡片可点击
      const cardUrl = singleUrl || firstUrl;
      const tag = cardUrl ? 'a' : 'div';
      const linkAttr = cardUrl ? `href="${cardUrl}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;"` : '';
      return `
      <${tag} class="rt-card" data-domain="${item.domain}" ${linkAttr}>
        <div class="rt-card-head">
          <span class="rt-card-title">${item.title}</span>
          <button class="rt-card-star ${item.isStarred ? 'is-on' : ''}" type="button" aria-label="收藏"></button>
        </div>
      </${tag}>`;
    }).join('');
  }

  // --- 招聘项目（campus.html）全量同步 ---
  async function loadPrograms() {
    const container = document.querySelector('.program-grid');
    if (!container) return;
    const data = await fetchData('programs');
    if (!data || !data.length) return;
    container.innerHTML = data.map(item => {
      let buttons = item.buttons;
      if (typeof buttons === 'string') { try { buttons = JSON.parse(buttons); } catch(e) { buttons = []; } }
      const targetAudience = item.targetAudience || item.target_audience || '';
      const actionsHtml = (buttons && buttons.length) ? buttons.map(btn =>
        `<a class="hero-cta-glass" href="${btn.url || '#'}" ${btn.url && btn.url.startsWith('http') ? 'target="_blank" rel="noopener"' : ''} onclick="trackClickEvent('校园招聘-${item.title}-${btn.label}')"><span class="hero-cta-label">${btn.label}</span></a>`
      ).join('') : '';
      return `<div class="program-card">
        <h3>${item.title || ''}</h3>
        <p class="program-intro">${item.description || ''}</p>
        <div class="program-bottom">
          ${targetAudience ? `<div class="program-meta"><div class="program-meta-item"><div class="program-meta-label">投递对象</div><div class="program-meta-value" style="font-size:14px;">${targetAudience.replace(/\n/g, '<br>')}</div></div></div>` : ''}
          ${actionsHtml ? `<div class="program-actions">${actionsHtml}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // --- 宣讲会行程（campus.html）---
  async function loadSchedule() {
    const container = document.getElementById('schList');
    if (!container) return;
    const data = await fetchData('schedule');
    
    if (!data || !data.length) { container.innerHTML = ''; return; }
    const mode = item => (item.eventType || item.event_type) === '直播' ? '线上' : '线下';

    // 动态生成城市筛选 tab
    const tabsEl = document.getElementById('schTabs');
    if (tabsEl) {
      const cities = [];
      let hasOnline = false;
      data.forEach(item => {
        const m = mode(item);
        if (m === '线上') { hasOnline = true; return; }
        if (item.city && !cities.includes(item.city)) cities.push(item.city);
      });
      tabsEl.innerHTML = '<button class="sch-tab active" data-city="all">全部</button>' +
        cities.map(c => '<button class="sch-tab" data-city="' + c + '">' + c + '</button>').join('') +
        (hasOnline ? '<button class="sch-tab" data-city="线上">线上</button>' : '');
    }

    container.innerHTML = data.map(item => {
      const d = new Date(item.eventDate || item.event_date);
      const month = (d.getMonth() + 1) + '月';
      const day = String(d.getDate()).padStart(2, '0');
      const eventType = item.eventType || item.event_type;
      const timeRange = item.timeRange || item.time_range;
      return `
        <div class="sch-item" data-city="${item.city}" data-mode="${mode(item)}">
          <div class="sch-date-col">
            <div class="sch-date"><div class="sch-month">${month}</div><div class="sch-day">${day}</div></div>
          </div>
          <div><div class="sch-col-label">城市 / 院校</div><div class="sch-col-value"><span class="sch-city">${item.city} · ${item.venue}</span></div></div>
          <div><div class="sch-col-label">时间 / 地址</div><div class="sch-col-value">${timeRange}<br>${item.address || ''}</div></div>
          <div><div class="sch-col-label">形式</div><div class="sch-col-value">${eventType}</div></div>
        </div>
      `;
    }).join('');
  }

  // --- 顶尖人才卡片（top-talent-o.html）---
  async function loadTalentCards() {
    const container = document.querySelector('.tto-apply-grid');
    if (!container) return;
    const data = await fetchData('talent-cards');
    if (!data || !data.length) return;
    container.innerHTML = data.map(card => `
      <div class="tto-apply-card">
        <div class="tto-apply-year">${card.yearText || card.year_text}</div>
        <p class="tto-apply-sub">${card.subtitle || ''}</p>
        <div class="tto-apply-title">${card.programTitle || card.program_title}</div>
        ${(card.buttonLabel || card.button_label) ? `<a class="hero-cta-glass" href="${card.buttonUrl || card.button_url || '#'}"><span class="hero-cta-label">${card.buttonLabel || card.button_label}</span></a>` : ''}
        ${(card.noticeLabel || card.notice_label) && (card.noticeUrl || card.notice_url) ? `<a class="tto-apply-link" href="${card.noticeUrl || card.notice_url}" target="_blank" rel="noopener">${card.noticeLabel || card.notice_label}</a>` : ''}
      </div>
    `).join('');
  }

  // --- 城市跳转链接（opportunities.html）---
  async function loadCityLinks() {
    const cards = document.querySelectorAll('.loc-pcard[data-city]');
    if (!cards.length) return;
    const data = await fetchData('city-links');
    if (!data || !data.length) return;
    const map = {};
    data.forEach(c => { map[c.cityName || c.city_name] = c.linkUrl || c.link_url; });
    cards.forEach(card => {
      const city = card.dataset.city;
      if (map[city]) card.setAttribute('href', map[city]);
    });
  }

  // --- 宣讲会报名提交 ---
  async function submitSignup(scheduleId, formData) {
    try {
      const res = await fetch(API_BASE + '/api/signups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: scheduleId, ...formData })
      });
      return await res.json();
    } catch (e) { return { error: '网络错误' }; }
  }

  // Expose for signup form
  window.adminAPI = { submitSignup };

  // Auto-load based on page
  function bootstrap() {
    const page = document.body.dataset.page;
    if (page === 'home') { loadNews(); }
    if (page === 'life') { loadVoices(); }
    if (page === 'campus') { loadCampusNews(); loadPrograms(); loadSchedule(); }
    if (page === 'toptalent-o') { loadResearch(); loadTalentCards(); }
    if (page === 'opportunities') { loadCityLinks(); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
