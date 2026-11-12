const preview = document.querySelector('.preview-rail');
const tabs = [...preview.querySelectorAll('[role="tab"]')];
const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
const chapters = [...document.querySelectorAll('[data-preview-step]')];
const mobileSticky = window.matchMedia('(max-width: 880px) and (min-height: 600px)');
let activeIndex = 0;
let scrollIndex = 0;
let frame = 0;

function selectPreview(index) {
  if (index === activeIndex) return;

  tabs[activeIndex].setAttribute('aria-selected', 'false');
  tabs[activeIndex].tabIndex = -1;
  panels[activeIndex].hidden = true;
  panels[activeIndex].classList.remove('is-entering');
  chapters[activeIndex].classList.remove('is-preview-step');

  activeIndex = index;
  tabs[index].setAttribute('aria-selected', 'true');
  tabs[index].tabIndex = 0;
  panels[index].hidden = false;
  panels[index].classList.add('is-entering');
  chapters[index].classList.add('is-preview-step');
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectPreview(index));
  tab.addEventListener('keydown', event => {
    let nextIndex;
    if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectPreview(nextIndex);
    tabs[nextIndex].focus({ preventScroll: true });
  });
});

function syncPreviewWithScroll() {
  frame = 0;
  const focused = document.activeElement;
  if (preview.contains(focused) && focused.matches(':focus-visible')) return;

  const defaultLine = window.innerHeight * .58;
  const readingLine = mobileSticky.matches
    ? Math.min(window.innerHeight * .78, Math.max(defaultLine, preview.getBoundingClientRect().bottom + 64))
    : defaultLine;
  const nextIndex = window.scrollY <= 0 ? 0 : chapters.reduce((index, chapter, i) => (
    chapter.getBoundingClientRect().top <= readingLine ? i : index
  ), 0);

  // Keep a manual tab selection until the reader crosses into another chapter.
  if (nextIndex !== scrollIndex) {
    scrollIndex = nextIndex;
    selectPreview(nextIndex);
  }
}

function schedulePreviewSync() {
  if (!frame) frame = requestAnimationFrame(syncPreviewWithScroll);
}

window.addEventListener('scroll', schedulePreviewSync, { passive: true });
window.addEventListener('resize', schedulePreviewSync);
window.addEventListener('pageshow', schedulePreviewSync);
preview.addEventListener('focusout', schedulePreviewSync);
schedulePreviewSync();

if ('IntersectionObserver' in window) {
  const guideObserver = new IntersectionObserver(([entry]) => {
    entry.target.classList.toggle('is-in-view', entry.isIntersecting);
  }, { threshold: .25 });
  guideObserver.observe(document.querySelector('.chapter-guide'));
}

const verificationStatus = document.getElementById('verification-status');
const verificationList = document.getElementById('verification-list');
const verificationTemplate = document.getElementById('verification-row');
const sourceLabels = { employer_official: '企业官方招聘', nwu_official: '西北大学就业信息' };
const checkedDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function loadVerifiedJobs() {
  verificationStatus.textContent = '正在读取核验记录…';
  try {
    const response = await fetch('/api/jobs?record_type=job&sort=verified');
    if (!response.ok) throw new Error('无法读取核验记录。');
    const { items } = await response.json();
    const jobs = items.filter(job => {
      if (!Object.hasOwn(sourceLabels, job.source_type) || job.direct_apply_verified !== true) return false;
      if (!Number.isFinite(Date.parse(job.link_checked_at))) return false;

      try {
        const url = new URL(job.apply_url);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    }).slice(0, 3);

    for (const job of jobs) {
      const row = verificationTemplate.content.cloneNode(true);
      const cities = Array.isArray(job.cities) ? job.cities.filter(Boolean) : [];
      const base = cities.slice(0, 2).join(' / ') + (cities.length > 2 ? ' 等' : '');
      const locationLabel = job.base_scope === 'campaign' ? '简章 Base' : 'Base';
      const time = row.querySelector('[data-job-checked]');
      const link = row.querySelector('[data-job-apply]');
      row.querySelector('[data-job-title]').textContent = job.title;
      row.querySelector('[data-job-company]').textContent = job.company;
      row.querySelector('[data-job-base]').textContent = base ? locationLabel + ' · ' + base : 'Base 未公布';
      row.querySelector('[data-job-source]').textContent = sourceLabels[job.source_type];
      time.dateTime = job.link_checked_at;
      time.textContent = checkedDate.format(new Date(job.link_checked_at));
      link.href = job.apply_url;
      link.setAttribute('aria-label', '前往投递页 · ' + job.title + '（在新窗口打开）');
      verificationList.append(row);
    }

    if (jobs.length) {
      verificationList.hidden = false;
      verificationStatus.hidden = true;
      return;
    }
    verificationStatus.textContent = '暂无可显示的核验记录，可前往岗位库查看。';
  } catch {
    verificationStatus.textContent = '暂时无法读取核验记录，可前往岗位库查看。';
  }
}

loadVerifiedJobs();
