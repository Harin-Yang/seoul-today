(() => {
  'use strict';

  const SEOUL = [37.5665, 126.978];
  const HOME = [37.47258, 127.04243]; // 위치를 모를 때 기준: 언남고 (서초구 양재동)
  const HOME_NAME = '언남고';
  const LABELS = {
    date: { name: '데이트', emoji: '💑' },
    solo: { name: '혼놀', emoji: '🎧' },
    friends: { name: '친구와', emoji: '👯' },
  };
  const CAT_EMOJI = {
    '전시/미술': '🎨', '콘서트': '🎤', '클래식': '🎻', '독주/독창회': '🎻', '국악': '🥁', '무용': '💃',
    '뮤지컬/오페라': '🎭', '연극': '🎭', '영화': '🎬', '교육/체험': '✋', '기타': '✨',
  };
  const SRC = { seoul: '서울시 문화행사 정보', culture: '문화포털(한국문화정보원)', tour: '한국관광공사', place: '한국관광공사 관광정보' };
  const catEmoji = (cat) => CAT_EMOJI[cat] ?? (cat?.startsWith('축제') ? '🎪' : '✨');
  const emojiOf = (e) => e.emoji ?? catEmoji(e.cat);
  const LIST_LIMIT = 80;
  // 상단 검색·필터 영역 아래 끝 (지도에서 가려지지 않는 영역 계산용)
  const topH = () => (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 110) + 8;
  const WALK_M_PER_MIN = 67;
  const MIN_VISIBLE = 8;

  const $ = (id) => document.getElementById(id);
  const state = {
    events: [],
    byId: new Map(),
    label: 'all',
    when: 'today',
    freeOnly: false,
    indoorOnly: false,
    nightOnly: false,
    query: '',
    sort: 'near',
    places: [],
    showPlaces: !!load('showPlaces', false),
    locFailed: false,
    me: null,
    selected: null,
    saved: new Set(load('saved', [])),
    deepLink: new URLSearchParams(location.search).get('e'),
  };

  // ── 저장소 (실패해도 동작) ──
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 무시 */ }
  }
  const savePrefs = () => store('prefs', { label: state.label, when: state.when, freeOnly: state.freeOnly, sort: state.sort });

  // ── 날짜 ──
  const ymd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
  const addDays = (s, n) => ymd(new Date(Date.parse(s + 'T12:00:00+09:00') + n * 864e5));
  const today = ymd(new Date());
  const tomorrow = addDays(today, 1);
  function range(when) {
    if (when === 'today') return [today, today];
    if (when === 'week') return [today, addDays(today, 6)];
    const dow = new Date(today + 'T12:00:00+09:00').getUTCDay(); // 0=일
    if (dow === 0) return [today, today];
    const sat = addDays(today, 6 - dow);
    return [sat, addDays(sat, 1)];
  }
  const daysLeft = (end) => Math.round((Date.parse(end) - Date.parse(today)) / 864e5);
  const shortDate = (s) => `${+s.slice(5, 7)}.${+s.slice(8, 10)}`;
  function when(e) {
    if (e.isPlace) return '언제든';
    if (e.start > today) return e.start === tomorrow ? '내일 시작' : `${shortDate(e.start)} 시작`;
    if (e.end === today) return e.start === today ? '오늘만' : '오늘까지';
    return `~${shortDate(e.end)}`;
  }

  // ── 거리 ──
  function dist(a, b) {
    const R = 6371e3, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    return m < 1000 ? `${Math.max(Math.round(m / 10) * 10, 10)}m` : `${(m / 1000).toFixed(1)}km`;
  }

  // ── 무슨 행사인지 한눈에: 짧은 분류명, 장소, 한 줄 요약, 가격 ──
  const CAT_SHORT = {
    '전시/미술': '전시', '뮤지컬/오페라': '뮤지컬·오페라', '교육/체험': '체험·강연', '독주/독창회': '독주회',
    '축제-문화/예술': '축제', '축제-전통/역사': '전통 축제', '축제-자연/경관': '야외 축제', '축제-시민화합': '축제',
    '축제-관광/체육': '축제', '축제-기타': '축제', '기타': '행사',
  };
  const catShort = (c) => CAT_SHORT[c] ?? c;
  // "공간아울, 후암스테이지, 열린극장" → "공간아울", "롯데시네마 [도곡] 7관" → "롯데시네마 도곡"
  function mainPlace(p) {
    return String(p ?? '')
      .replace(/\[([^\]]*)\]/g, ' $1 ')
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s*(?:[,/&·]|\s및\s|\s등\s|\s일대|\s일원)\s*/)[0]
      .replace(/\s*\d+\s*관$|\s*(?:지하)?\s*\d+\s*층.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const whereOf = (e) => (e.isPlace ? e.gu || '서울' : mainPlace(e.place) || e.gu);
  // 제목 앞의 [기관명]은 목록에서 떼어낸다
  const shortTitle = (t) => t.replace(/^\s*\[[^\]]{1,20}\]\s*/, '') || t;
  // 웹에서 후기 찾기: 행사는 제목, 장소는 이름 (+구)
  const searchTerm = (e) => (e.isPlace ? `${e.title} ${e.gu}` : shortTitle(e.title)).trim();
  const blogUrl = (e) => `https://m.search.naver.com/search.naver?where=m_blog&query=${encodeURIComponent(searchTerm(e))}`;
  const webUrl = (e) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(searchTerm(e))}`;
  const instaUrl = (e) => `https://www.instagram.com/explore/tags/${encodeURIComponent(shortTitle(e.title).replace(/[^0-9A-Za-z가-힣]/g, ''))}/`;
  function summary(e) {
    const d = (e.desc ?? '').replace(/\s+/g, ' ').trim();
    if (d) {
      const first = d.split(/(?<=[.!?。])\s|(?<=다\.)|(?<=요\.)/)[0].trim();
      return clip(first.length >= 12 ? first : d, 64);
    }
    return /\d/.test(e.time ?? '') ? `🕒 ${clip(e.time, 40)}` : '';
  }
  function priceShort(e) {
    if (e.free) return '무료';
    const m = (e.fee ?? '').match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
    if (m) return `${m[1]}원${/[,·/]|~|부터/.test(e.fee.slice(m.index + m[0].length)) ? '~' : ''}`;
    const man = (e.fee ?? '').match(/(\d+(?:\.\d)?)\s*만\s*원/);
    return man ? `${man[1]}만원` : '';
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

  // ── 지도 ──
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(HOME, 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 44,
    spiderfyDistanceMultiplier: 1.6,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 36 : n < 50 ? 44 : 52;
      return L.divIcon({ html: `<div class="cluster" style="width:${size}px;height:${size}px">${n}</div>`, className: '', iconSize: [size, size] });
    },
  }).addTo(map);
  const markers = new Map();
  let meMarker = null;

  function primaryLabel(e) {
    return LABELS[state.label] && e.labels.includes(state.label) ? state.label : e.labels[0];
  }
  function pinIcon(e, active) {
    return L.divIcon({
      html: `<div class="pin ${primaryLabel(e)}${e.isPlace ? ' place' : ''}${active ? ' active' : ''}${state.saved.has(e.id) ? ' saved' : ''}"><span>${emojiOf(e)}</span></div>`,
      className: '', iconSize: [36, 44], iconAnchor: [18, 44],
    });
  }

  // ── 필터 ──
  // 고른 기간의 모든 요일이 정기 휴관일이면 갈 수 없으니 뺀다 ("7일 내"는 빼지 않음)
  function rangeDays() {
    if (state.when === 'week') return null;
    const [from, to] = range(state.when);
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(new Date(d + 'T12:00:00+09:00').getUTCDay());
    return days;
  }
  const closedAll = (e, days) => days && e.closed && days.every((d) => e.closed.includes(d));
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  function baseFiltered() {
    const [from, to] = range(state.when);
    const days = rangeDays();
    const q = norm(state.query);
    const pool = state.showPlaces ? state.events.concat(state.places) : state.events;
    // 검색 중에는 기간과 상관없이 2주 안의 모든 행사에서 찾는다 (장소는 기간 없이 항상 포함)
    return pool.filter((e) =>
      (q || (e.start <= to && e.end >= from && !closedAll(e, days))) &&
      (!state.freeOnly || e.free) &&
      (!state.indoorOnly || !e.out) &&
      (!state.nightOnly || e.night) &&
      (!q || norm(`${e.title} ${e.place} ${e.gu} ${e.cat}`).includes(q)));
  }
  function matchesLabel(e, label) {
    if (label === 'all') return true;
    if (label === 'saved') return state.saved.has(e.id);
    return e.labels.includes(label);
  }
  const filtered = () => baseFiltered().filter((e) => matchesLabel(e, state.label));

  function renderMarkers() {
    cluster.clearLayers();
    markers.clear();
    const layers = filtered().map((e) => {
      const m = L.marker([e.lat, e.lng], { icon: pinIcon(e, state.selected?.id === e.id) });
      m.on('click', () => openDetail(e, { fly: false }));
      markers.set(e.id, m);
      return m;
    });
    cluster.addLayers(layers);
    renderList();
  }

  // ── 목록 ──
  // 거리 기준: 내 위치(서울 안일 때) → 없으면 지도 중심
  const origin = () => (state.me && dist(state.me, SEOUL) <= 60e3 ? state.me : [map.getCenter().lat, map.getCenter().lng]);

  function tagsHtml(e) {
    const left = daysLeft(e.end);
    return `<div class="tags">${e.labels.map((l) => `<span class="tag ${l}">${LABELS[l].emoji} ${LABELS[l].name}</span>`).join('')}${
      e.out ? '<span class="tag plain">야외</span>' : ''}${
      e.night ? '<span class="tag plain">🌙 저녁</span>' : ''}${
      left <= 3 && left >= 1 && e.start <= today ? `<span class="tag soon">D-${left}</span>` : ''}</div>`;
  }

  function updateChipCounts(inView) {
    document.querySelectorAll('#labelChips [data-label]').forEach((b) => {
      const n = b.querySelector('.n');
      if (n) n.textContent = ` ${inView.filter((e) => matchesLabel(e, b.dataset.label)).length}`;
    });
  }

  function renderList() {
    if (state.selected) return;
    const bounds = map.getBounds().pad(0.05);
    const o = origin();
    const base = baseFiltered();
    const inViewBase = state.query ? base : base.filter((e) => bounds.contains([e.lat, e.lng]));
    updateChipCounts(inViewBase);
    const all = base.filter((e) => matchesLabel(e, state.label));
    const items = inViewBase
      .filter((e) => matchesLabel(e, state.label))
      .map((e) => ({ e, d: dist(o, [e.lat, e.lng]) }))
      .sort(state.sort === 'near' ? (a, b) => a.d - b.d : (a, b) => a.e.end.localeCompare(b.e.end) || a.d - b.d);

    $('countText').textContent = state.query ? `검색 결과 ${items.length}곳` : `이 지역 ${items.length}곳`;
    $('sortBtn').textContent = state.sort === 'near' ? '가까운 순' : '마감 임박 순';
    if (!items.length) {
      $('list').innerHTML = `<li class="empty">${
        !all.length
          ? state.label === 'saved' ? '찜한 곳이 없어요.<br>상세 화면에서 ♡를 눌러 저장하세요.' : '조건에 맞는 행사가 없어요.<br>기간이나 필터를 바꿔 보세요.'
          : `이 지역엔 없어요.<br><button class="btn small" id="nearestBtn">가장 가까운 곳 보기</button>`}</li>`;
      $('nearestBtn')?.addEventListener('click', () => showNearest(all));
      return;
    }
    $('list').innerHTML = items.slice(0, LIST_LIMIT).map(({ e, d }) => `
      <li class="item" data-id="${esc(e.id)}">
        <img class="thumb" src="${esc(e.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div class="item-body">
          <div class="kicker">${emojiOf(e)} ${esc(catShort(e.cat))} · ${esc(clip(whereOf(e), 22))}</div>
          <h3>${state.saved.has(e.id) ? '<span class="heart">♥</span> ' : ''}${esc(shortTitle(e.title))}</h3>
          ${summary(e) ? `<p class="summary">${esc(summary(e))}</p>` : ''}
          <div class="meta"><b>${fmtDist(d)}</b> · ${esc(when(e))}${priceShort(e) ? ` · ${esc(priceShort(e))}` : ''}</div>
          ${tagsHtml(e)}
        </div>
      </li>`).join('') + (items.length > LIST_LIMIT ? `<li class="empty">가까운 ${LIST_LIMIT}곳까지 보여드려요. 지도를 확대해 보세요.</li>` : '')
      + (!state.query && items.length < MIN_VISIBLE && all.length > items.length
        ? `<li class="empty"><button class="btn small" id="widerBtn">더 넓게 보기 (+${Math.min(all.length - items.length, MIN_VISIBLE)}곳)</button></li>` : '');
    $('widerBtn')?.addEventListener('click', () => showNearest(all, MIN_VISIBLE));
  }

  function showNearest(list, n = 3) {
    const o = origin();
    const near = list.map((e) => ({ e, d: dist(o, [e.lat, e.lng]) })).sort((a, b) => a.d - b.d).slice(0, n);
    const pts = near.map(({ e }) => [e.lat, e.lng]);
    if (state.me) pts.push(state.me);
    map.fitBounds(pts, { paddingTopLeft: [40, topH() + 10], paddingBottomRight: [40, innerHeight * 0.5 + 20], maxZoom: 16 });
  }

  $('list').addEventListener('click', (ev) => {
    const li = ev.target.closest('.item');
    if (!li) return;
    const e = state.byId.get(li.dataset.id);
    if (e) openDetail(e, { fly: true });
  });

  $('sortBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    state.sort = state.sort === 'near' ? 'ending' : 'near';
    savePrefs();
    renderList();
    $('sheetBody').scrollTop = 0;
  });

  // ── 상세 ──
  function setActive(e, on) {
    const m = e && markers.get(e.id);
    if (m) m.setIcon(pinIcon(e, on));
  }
  const shareUrl = (e) => `${location.origin}${location.pathname}?e=${encodeURIComponent(e.id)}`;

  // 걸어서 15분 안에 있는, 같은 기간에 갈 수 있는 다른 행사 (같은 장소는 제외)
  function nearbyFor(e, n = 3) {
    return baseFiltered()
      .filter((x) => x.id !== e.id && x.place !== e.place)
      .map((x) => ({ x, d: dist([e.lat, e.lng], [x.lat, x.lng]) }))
      .filter(({ d }) => d * 1.3 / WALK_M_PER_MIN <= 15)
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  }

  function openDetail(e, { fly = false, push = true } = {}) {
    if (push) {
      if (state.selected) history.replaceState({ e: e.id }, '', `?e=${encodeURIComponent(e.id)}`);
      else history.pushState({ e: e.id }, '', `?e=${encodeURIComponent(e.id)}`);
    }
    setActive(state.selected, false);
    state.selected = e;
    setActive(e, true);
    const d = state.me ? ` · 내 위치에서 ${fmtDist(dist(state.me, [e.lat, e.lng]))}` : '';
    const saved = state.saved.has(e.id);
    const kakao = `https://map.kakao.com/link/to/${encodeURIComponent(e.place)},${e.lat},${e.lng}`;
    const naver = `https://map.naver.com/p/search/${encodeURIComponent(mainPlace(e.place) || e.title)}`;
    const period = e.start === e.end ? e.start : `${e.start} ~ ${e.end}`;
    $('detail').innerHTML = `
      <button class="back" id="backBtn">‹ 목록</button>
      <div class="kicker">${emojiOf(e)} ${esc(catShort(e.cat))} · ${esc(whereOf(e) || e.place)}</div>
      <h2>${esc(e.title)}</h2>
      ${e.desc ? `<p class="desc clamp" id="descText">${esc(e.desc)}</p>` : ''}
      ${tagsHtml(e)}
      <div class="actions">
        <a class="btn primary" href="${kakao}" target="_blank" rel="noopener">길찾기</a>
        <button class="btn" id="shareBtn" type="button">공유</button>
        <button class="btn icon ${saved ? 'saved' : ''}" id="saveBtn" type="button" aria-label="찜">${saved ? '♥' : '♡'}</button>
      </div>
      ${e.isPlace ? `<dl>
        <dt>주소</dt><dd>${esc(e.addr)} <span class="muted">${d.replace(/^ · /, '')}</span><br><a href="${naver}" target="_blank" rel="noopener" id="naverLink">네이버지도에서 보기</a></dd>
        ${e.tel ? `<dt>전화</dt><dd><a href="tel:${esc(e.tel.replace(/[^0-9-]/g, ''))}">${esc(e.tel)}</a></dd>` : ''}
        <dt>분류</dt><dd>${emojiOf(e)} ${esc(e.cat)} · ${esc(e.type)}</dd>
      </dl>` : `<dl>
        <dt>기간</dt><dd>${esc(period)}${e.start > today || e.end === today ? ` <span class="muted">(${esc(when(e))})</span>` : ''}</dd>
        ${e.time ? `<dt>시간</dt><dd>${esc(e.time)}</dd>` : ''}
        ${e.closed ? `<dt>휴관</dt><dd>${e.closed.map((d) => '일월화수목금토'[d]).join('·')}요일${e.closed.includes(new Date(today + 'T12:00:00+09:00').getUTCDay()) ? ' <span class="tag soon">오늘 휴관</span>' : ''}</dd>` : ''}
        <dt>장소</dt><dd>${esc(e.place)} <span class="muted">${esc(e.gu)}${d}</span><br><a href="${naver}" target="_blank" rel="noopener" id="naverLink">네이버지도에서 보기</a></dd>
        <dt>요금</dt><dd>${esc(e.fee || (e.free ? '무료' : '-'))}</dd>
        ${e.target ? `<dt>대상</dt><dd>${esc(e.target)}</dd>` : ''}
        <dt>분류</dt><dd>${catEmoji(e.cat)} ${esc(e.cat)}${e.out ? ' · 야외' : ''}</dd>
      </dl>`}
      <div class="links">
        <a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener">상세 정보</a>
        ${e.ticket ? `<a class="btn" href="${esc(e.ticket)}" target="_blank" rel="noopener">예매·신청</a>` : ''}
      </div>
      <div class="web">
        <span>후기 찾아보기</span>
        <a href="${blogUrl(e)}" target="_blank" rel="noopener">📝 블로그</a>
        <a href="${instaUrl(e)}" target="_blank" rel="noopener">📷 인스타그램</a>
        <a href="${webUrl(e)}" target="_blank" rel="noopener">🔎 웹 검색</a>
      </div>
      ${(() => {
        const near = nearbyFor(e);
        return near.length ? `<section class="near"><h4>근처에서 같이 가기 좋은 곳</h4>${near.map(({ x, d }) => `
          <button class="near-item" data-id="${esc(x.id)}" type="button">
            <span class="near-emoji">${emojiOf(x)}</span>
            <span class="near-body"><b>${esc(clip(shortTitle(x.title), 34))}</b><small>${fmtDist(d)} · ${x.isPlace ? esc(catShort(x.cat)) : esc(when(x))}${x.night ? ' · 🌙 저녁' : ''}</small></span>
          </button>`).join('')}</section>` : '';
      })()}
      <p class="src">출처: ${[e.src ?? 'seoul', ...(e.alt ?? [])].map((s) => SRC[s] ?? s).join(' · ')}</p>
      ${e.img ? `<img class="poster" src="${esc(e.img.replace('thumb=Y', 'thumb=N'))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}`;
    $('list').hidden = true;
    $('detail').hidden = false;
    $('countText').textContent = '상세 정보';
    $('sortBtn').hidden = true;
    $('sheetBody').scrollTop = 0;
    $('backBtn').onclick = () => (history.state?.e ? history.back() : closeDetail());
    $('detail').querySelectorAll('.near-item').forEach((b) => (b.onclick = () => {
      const x = state.byId.get(b.dataset.id);
      if (x) openDetail(x, { fly: true });
    }));
    $('saveBtn').onclick = () => toggleSave(e);
    $('descText')?.addEventListener('click', (ev) => ev.currentTarget.classList.toggle('clamp'));
    $('shareBtn').onclick = () => share(e);
    // 폰에서는 네이버지도 앱을 좌표로 바로 열고, 앱이 없으면 웹 검색으로
    $('naverLink').onclick = (ev) => {
      if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) return;
      ev.preventDefault();
      const web = ev.currentTarget.href;
      const app = `nmap://place?lat=${e.lat}&lng=${e.lng}&name=${encodeURIComponent(mainPlace(e.place) || e.title)}&appname=${encodeURIComponent(location.hostname)}`;
      const t = setTimeout(() => { if (!document.hidden) location.href = web; }, 1200);
      addEventListener('pagehide', () => clearTimeout(t), { once: true });
      location.href = app;
    };
    setSheet('half');
    const m = markers.get(e.id);
    if (fly && m) cluster.zoomToShowLayer(m, () => showAboveSheet([e.lat, e.lng]));
    else showAboveSheet([e.lat, e.lng]);
  }

  // 시트(화면 절반)와 상단 필터에 가리지 않는 영역의 가운데로 지점을 옮긴다
  function showAboveSheet(latlng) {
    const top = topH(), bottom = innerHeight * 0.5;
    const target = L.point(innerWidth / 2, (top + bottom) / 2);
    const now = map.latLngToContainerPoint(latlng);
    map.panBy(now.subtract(target), { duration: 0.4 });
  }

  function closeDetail() {
    setActive(state.selected, false);
    state.selected = null;
    $('detail').hidden = true;
    $('list').hidden = false;
    $('sortBtn').hidden = false;
    renderList();
  }

  addEventListener('popstate', () => {
    const id = history.state?.e;
    const e = id && state.byId.get(id);
    if (e) openDetail(e, { push: false });
    else if (state.selected) closeDetail();
  });

  function toggleSave(e) {
    state.saved.has(e.id) ? state.saved.delete(e.id) : state.saved.add(e.id);
    store('saved', [...state.saved]);
    const on = state.saved.has(e.id);
    $('saveBtn').textContent = on ? '♥' : '♡';
    $('saveBtn').classList.toggle('saved', on);
    setActive(e, true);
    toast(on ? '찜했어요 · 상단 ♥ 찜에서 모아볼 수 있어요' : '찜을 취소했어요');
  }

  async function share(e) {
    const data = { title: e.title, text: `${e.title}\n${e.isPlace ? e.addr : `${e.place} · ${when(e)}`}`, url: shareUrl(e) };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
      toast('링크를 복사했어요');
    } catch (err) {
      if (err?.name !== 'AbortError') toast('공유하지 못했어요');
    }
  }

  // ── 바텀시트 ──
  const sheet = $('sheet');
  const snaps = () => ({ peek: 176, half: Math.round(innerHeight * 0.5), full: sheet.offsetHeight });
  let snap = 'peek';
  function setSheet(name) {
    snap = name;
    applySheet(snaps()[name]);
  }
  function applySheet(visible) {
    const H = sheet.offsetHeight;
    sheet.style.transform = `translateY(${H - visible}px)`;
    document.documentElement.style.setProperty('--peek', `${Math.min(visible, innerHeight * 0.5)}px`);
    $('locateBtn').style.visibility = visible > innerHeight * 0.6 ? 'hidden' : 'visible';
  }
  (() => {
    let startY = 0, startVis = 0, lastY = 0, lastT = 0, vel = 0, moved = false;
    const head = $('sheetHead');
    head.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      startY = lastY = ev.clientY; lastT = performance.now(); vel = 0; moved = false;
      startVis = snaps()[snap];
      sheet.classList.add('dragging');
      head.setPointerCapture(ev.pointerId);
    });
    head.addEventListener('pointermove', (ev) => {
      if (!head.hasPointerCapture(ev.pointerId)) return;
      const now = performance.now();
      vel = (ev.clientY - lastY) / Math.max(now - lastT, 1);
      lastY = ev.clientY; lastT = now;
      if (Math.abs(ev.clientY - startY) > 4) moved = true;
      const s = snaps();
      applySheet(Math.max(s.peek - 40, Math.min(s.full, startVis - (ev.clientY - startY))));
    });
    const end = (ev) => {
      if (!head.hasPointerCapture(ev.pointerId)) return;
      sheet.classList.remove('dragging');
      const s = snaps();
      if (!moved) { setSheet(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek'); return; }
      const vis = startVis - (ev.clientY - startY);
      const order = ['peek', 'half', 'full'];
      let target;
      if (Math.abs(vel) > 0.5) {
        const i = order.indexOf(snap) + (vel < 0 ? 1 : -1);
        target = order[Math.max(0, Math.min(2, i))];
      } else {
        target = order.reduce((a, b) => (Math.abs(s[b] - vis) < Math.abs(s[a] - vis) ? b : a));
      }
      setSheet(target);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    addEventListener('resize', () => setSheet(snap));
  })();

  // 지도 빈 곳을 누르면 시트를 내린다 (상세 보기 중이면 목록으로)
  map.on('click', () => {
    if (state.selected) { history.state?.e ? history.back() : closeDetail(); }
    setSheet('peek');
  });

  // ── 내 위치 ──
  // 지도 윗부분(필터 아래 ~ 시트 위)에 행사가 MIN_VISIBLE곳 이상 보이는 가장 가까운 줌을 고른다
  function zoomFor(center) {
    const list = filtered();
    if (!list.length) return 14;
    for (let z = 16; z >= 11; z--) {
      const c = map.project(center, z);
      const top = topH(), bottom = innerHeight - 176;
      const nw = map.unproject(L.point(c.x - innerWidth / 2, c.y - (innerHeight / 2 - top)), z);
      const se = map.unproject(L.point(c.x + innerWidth / 2, c.y + (bottom - innerHeight / 2)), z);
      const b = L.latLngBounds(nw, se);
      if (list.filter((e) => b.contains([e.lat, e.lng])).length >= MIN_VISIBLE) return z;
    }
    return 11;
  }
  let centeredOnMe = false;
  function centerOnMe() {
    if (!state.me || !state.events.length || centeredOnMe) return;
    centeredOnMe = true;
    map.setView(state.me, zoomFor(state.me));
  }
  // 위치를 못 쓰면 언남고를 기준으로
  function centerOnHome() {
    if (!state.events.length || centeredOnMe || state.deepLink) return;
    centeredOnMe = true;
    map.setView(HOME, zoomFor(HOME));
  }

  function setMe(pos, recenter) {
    state.me = pos;
    if (!meMarker) {
      meMarker = L.marker(pos, { icon: L.divIcon({ html: '<div class="me"></div>', className: '', iconSize: [18, 18] }), zIndexOffset: 1000, interactive: false }).addTo(map);
    } else meMarker.setLatLng(pos);
    if (recenter) centerOnMe();
    renderList();
  }

  let firstFix = true;
  function locate() {
    if (!navigator.geolocation) { toast('이 브라우저는 위치를 지원하지 않아요'); return; }
    $('locateBtn').classList.add('searching');
    navigator.geolocation.watchPosition(
      (p) => {
        $('locateBtn').classList.remove('searching');
        const pos = [p.coords.latitude, p.coords.longitude];
        if (firstFix) {
          firstFix = false;
          const outside = dist(pos, SEOUL) > 60e3;
          if (outside) {
            toast(`서울 밖에 계셔서 ${HOME_NAME} 주변을 보여드려요`);
            state.locFailed = true;
            setMe(pos, false);
            centerOnHome();
          } else setMe(pos, !state.deepLink);
        } else setMe(pos, false);
      },
      () => {
        $('locateBtn').classList.remove('searching');
        if (firstFix) toast(`위치를 알 수 없어 ${HOME_NAME} 주변을 보여드려요`);
        firstFix = false;
        state.locFailed = true;
        centerOnHome();
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
    );
  }
  $('locateBtn').addEventListener('click', () => {
    if (state.me) map.flyTo(state.me, Math.max(map.getZoom(), zoomFor(state.me)), { duration: 0.6 });
    else { firstFix = true; locate(); }
  });

  // ── 날씨 (Open-Meteo, 키 불필요) ──
  const WMO = (c) => (c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 || (c >= 80 && c <= 82) ? '🌧️' : c <= 77 || c >= 85 && c <= 86 ? '🌨️' : '⛈️');
  let forecast = null;
  async function loadWeather() {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=8';
      const d = (await (await fetch(url)).json()).daily;
      forecast = new Map(d.time.map((t, i) => [t, { code: d.weather_code[i], hi: Math.round(d.temperature_2m_max[i]), lo: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max[i] }]));
      renderWeather();
    } catch { /* 날씨 없이도 동작 */ }
  }
  function renderWeather() {
    if (!forecast) return;
    const [from, to] = range(state.when);
    const days = [...forecast.entries()].filter(([t]) => t >= from && t <= to).map(([, v]) => v);
    if (!days.length) { $('weather').textContent = ''; return; }
    const rain = Math.max(...days.map((v) => v.rain ?? 0));
    const first = days[0];
    $('weather').textContent = `${WMO(first.code)} ${first.lo}°/${first.hi}°${rain >= 30 ? ` · 비 ${rain}%` : ''}`;
    $('indoorChip').classList.toggle('suggest', rain >= 50 && !state.indoorOnly);
  }

  // ── 칩 ──
  function bindChips(containerId, attr, key) {
    $(containerId).addEventListener('click', (ev) => {
      const b = ev.target.closest(`[data-${attr}]`);
      if (!b) return;
      state[key] = b.dataset[attr];
      $(containerId).querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
      savePrefs();
      if (state.selected) closeDetail();
      renderMarkers();
      renderWeather();
    });
  }
  bindChips('labelChips', 'label', 'label');
  $('whenSelect').addEventListener('change', (ev) => {
    state.when = ev.target.value;
    savePrefs();
    if (state.selected) closeDetail();
    renderMarkers();
    renderWeather();
  });
  $('freeChip').addEventListener('click', () => {
    state.freeOnly = !state.freeOnly;
    $('freeChip').classList.toggle('on', state.freeOnly);
    savePrefs();
    renderMarkers();
  });
  $('nightChip').addEventListener('click', () => {
    state.nightOnly = !state.nightOnly;
    $('nightChip').classList.toggle('on', state.nightOnly);
    if (state.nightOnly) toast('19시 이후에도 운영하는 곳만 보여드려요');
    renderMarkers();
  });
  let searchTimer;
  $('searchInput').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = ev.target.value.trim(); renderMarkers(); }, 200);
  });
  $('searchInput').addEventListener('focus', () => setSheet('full'));
  $('searchInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.target.blur(); });
  // 검색을 마치면 결과가 모두 보이게 지도를 맞춘다
  $('searchInput').addEventListener('change', (ev) => {
    state.query = ev.target.value.trim();
    renderMarkers();
    const hits = state.query ? filtered() : [];
    if (!hits.length) return;
    setSheet('half');
    map.fitBounds(hits.slice(0, 60).map((e) => [e.lat, e.lng]), { paddingTopLeft: [40, topH() + 10], paddingBottomRight: [40, innerHeight * 0.5 + 20], maxZoom: 16 });
  });
  $('indoorChip').addEventListener('click', () => {
    state.indoorOnly = !state.indoorOnly;
    $('indoorChip').classList.toggle('on', state.indoorOnly);
    renderMarkers();
    renderWeather();
  });
  const prefs = load('prefs', null);
  if (prefs) {
    Object.assign(state, { label: prefs.label ?? 'all', when: prefs.when ?? 'today', freeOnly: !!prefs.freeOnly, sort: prefs.sort ?? 'near' });
    document.querySelectorAll('[data-label]').forEach((x) => x.classList.toggle('on', x.dataset.label === state.label));
    $('whenSelect').value = state.when;
    $('freeChip').classList.toggle('on', state.freeOnly);
  }

  // ── 가볼 곳 (관광지·문화시설 등, 행사와 달리 기간 없음) ──
  const OUTDOOR_KIND = /공원|정원|수목원|숲|산|고개|오름|봉우리|둘레길|골목|거리|광장|호수|한강|섬|해변|야영|캠핑|생태|고궁|성곽|산성|마을|시장|테마파크|동물원|전망/;
  function normalizePlace(p) {
    return {
      ...p,
      isPlace: true,
      src: 'place',
      cat: p.kind,
      place: p.title,
      start: '0000-00-00',
      end: '9999-12-31',
      time: '',
      fee: '',
      free: false,
      out: OUTDOOR_KIND.test(`${p.kind} ${p.title}`) && !/박물관|미술관|전시|기념관/.test(p.kind),
      url: `https://korean.visitkorea.or.kr/search/search_list.do?keyword=${encodeURIComponent(p.title)}`,
    };
  }
  let placesLoading = null;
  function loadPlaces() {
    if (state.places.length) return Promise.resolve();
    placesLoading ??= fetch('data/places.json', { cache: 'no-cache' })
      .then((r) => r.json())
      .then((d) => {
        state.places = d.places.map(normalizePlace);
        state.places.forEach((p) => state.byId.set(p.id, p));
      })
      .catch(() => toast('가볼 곳을 불러오지 못했어요'));
    return placesLoading;
  }
  $('placeChip').classList.toggle('on', state.showPlaces);
  $('placeChip').addEventListener('click', async () => {
    state.showPlaces = !state.showPlaces;
    store('showPlaces', state.showPlaces);
    $('placeChip').classList.toggle('on', state.showPlaces);
    if (state.showPlaces) {
      await loadPlaces();
      toast('공원·미술관·고궁 같은 가볼 곳도 함께 보여드려요');
    }
    if (state.selected) closeDetail();
    renderMarkers();
  });

  // ── 토스트 ──
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  $('todayText').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date());

  // ── 오프라인 지원 ──
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 없어도 동작 */ });
  }

  // ── 시작 ──
  map.on('moveend', renderList);
  setSheet('peek');
  locate();
  loadWeather();
  fetch('data/events.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then(async (data) => {
      state.events = data.events;
      state.byId = new Map(data.events.map((e) => [e.id, e]));
      if (state.showPlaces || state.deepLink?.startsWith('p')) await loadPlaces();
      const updated = new Date(data.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const bySrc = {};
      data.events.forEach((e) => (bySrc[e.src ?? 'seoul'] = (bySrc[e.src ?? 'seoul'] ?? 0) + 1));
      $('foot').textContent = `${updated} 업데이트 · ${data.count}건 (${Object.entries(bySrc).map(([s, n]) => `${SRC[s] ?? s} ${n}`).join(', ')})${data.mode === 'sample' ? ' · 미리보기 데이터' : ''}`;
      renderMarkers();
      if (!state.deepLink && state.me && dist(state.me, SEOUL) <= 60e3) centerOnMe();
      else if (state.locFailed) centerOnHome();
      const linked = state.deepLink && state.byId.get(state.deepLink);
      if (linked) {
        history.replaceState(null, '', location.pathname);
        map.setView([linked.lat, linked.lng], 16);
        openDetail(linked, { fly: true });
      } else if (state.deepLink) {
        history.replaceState(null, '', location.pathname);
        toast('공유된 행사가 끝났거나 목록에서 빠졌어요');
      }
    })
    .catch(() => {
      $('countText').textContent = '데이터를 불러오지 못했어요';
    });
})();
