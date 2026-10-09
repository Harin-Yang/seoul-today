(() => {
  'use strict';

  const SEOUL = [37.5665, 126.978];
  const LABELS = {
    date: { name: '데이트', emoji: '💑' },
    solo: { name: '혼놀', emoji: '🎧' },
    friends: { name: '친구와', emoji: '👯' },
  };
  const LIST_LIMIT = 80;

  const $ = (id) => document.getElementById(id);
  const state = {
    events: [],
    label: 'all',
    when: 'today',
    freeOnly: false,
    me: null,
    selected: null,
    saved: new Set(load('saved', [])),
  };

  // ── 저장소 (실패해도 동작) ──
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 무시 */ }
  }

  // ── 날짜 ──
  const ymd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
  const addDays = (s, n) => ymd(new Date(Date.parse(s + 'T12:00:00+09:00') + n * 864e5));
  const today = ymd(new Date());
  function range(when) {
    if (when === 'today') return [today, today];
    if (when === 'week') return [today, addDays(today, 6)];
    const dow = new Date(today + 'T12:00:00+09:00').getUTCDay(); // 0=일
    if (dow === 0) return [today, today];
    const sat = addDays(today, 6 - dow);
    return [sat, addDays(sat, 1)];
  }
  function daysLeft(end) {
    return Math.round((Date.parse(end) - Date.parse(today)) / 864e5);
  }
  const shortDate = (s) => `${+s.slice(5, 7)}.${+s.slice(8, 10)}`;

  // ── 거리 ──
  function dist(a, b) {
    const R = 6371e3, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ── 지도 ──
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(SEOUL, 12);
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
    const l = primaryLabel(e);
    return L.divIcon({
      html: `<div class="pin ${l}${active ? ' active' : ''}"><span>${LABELS[l].emoji}</span></div>`,
      className: '', iconSize: [34, 34], iconAnchor: [17, 34],
    });
  }

  // ── 필터 ──
  function filtered() {
    const [from, to] = range(state.when);
    return state.events.filter((e) => {
      if (e.start > to || e.end < from) return false;
      if (state.freeOnly && !e.free) return false;
      if (state.label === 'saved') return state.saved.has(e.id);
      if (state.label !== 'all' && !e.labels.includes(state.label)) return false;
      return true;
    });
  }

  function renderMarkers() {
    cluster.clearLayers();
    markers.clear();
    const list = filtered();
    const layers = list.map((e) => {
      const m = L.marker([e.lat, e.lng], { icon: pinIcon(e, state.selected?.id === e.id) });
      m.on('click', () => openDetail(e, false));
      markers.set(e.id, m);
      return m;
    });
    cluster.addLayers(layers);
    renderList();
  }

  // ── 목록 ──
  function origin() { return state.me ?? [map.getCenter().lat, map.getCenter().lng]; }

  function tagsHtml(e) {
    const left = daysLeft(e.end);
    return `<div class="tags">${e.labels.map((l) => `<span class="tag ${l}">${LABELS[l].emoji} ${LABELS[l].name}</span>`).join('')}${
      e.free ? '<span class="tag free">무료</span>' : ''}${
      left <= 3 && left >= 0 ? `<span class="tag soon">${left === 0 ? '오늘 마감' : `D-${left}`}</span>` : ''}</div>`;
  }

  function renderList() {
    if (state.selected) return;
    const bounds = map.getBounds().pad(0.1);
    const all = filtered();
    const o = origin();
    const inView = all
      .filter((e) => bounds.contains([e.lat, e.lng]))
      .map((e) => ({ e, d: dist(o, [e.lat, e.lng]) }))
      .sort((a, b) => a.d - b.d);

    $('countText').textContent = `이 지역 ${inView.length}곳`;
    $('subText').textContent = `${state.me ? '내 위치' : '지도 중심'}에서 가까운 순`;
    $('list').innerHTML = inView.length
      ? inView.slice(0, LIST_LIMIT).map(({ e, d }) => `
        <li class="item" data-id="${esc(e.id)}">
          <img class="thumb" src="${esc(e.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
          <div class="item-body">
            ${tagsHtml(e)}
            <h3>${esc(e.title)}</h3>
            <div class="meta">${fmtDist(d)} · ${esc(e.gu)} · ~${shortDate(e.end)}${e.time ? ` · ${esc(e.time)}` : ''}</div>
            <div class="reason">${esc(e.reason)}</div>
          </div>
        </li>`).join('')
      : `<li class="empty">${all.length ? '이 지역엔 없어요. 지도를 움직이거나 축소해 보세요.' : state.label === 'saved' ? '찜한 곳이 없어요. 상세에서 ♥를 눌러 저장하세요.' : '조건에 맞는 행사가 없어요.'}</li>`;
  }

  $('list').addEventListener('click', (ev) => {
    const li = ev.target.closest('.item');
    if (!li) return;
    const e = state.events.find((x) => x.id === li.dataset.id);
    if (e) openDetail(e, true);
  });

  // ── 상세 ──
  function setActive(e, on) {
    const m = e && markers.get(e.id);
    if (m) m.setIcon(pinIcon(e, on));
  }

  function openDetail(e, fly) {
    setActive(state.selected, false);
    state.selected = e;
    setActive(e, true);
    const d = state.me ? ` · 내 위치에서 ${fmtDist(dist(state.me, [e.lat, e.lng]))}` : '';
    const saved = state.saved.has(e.id);
    const kakao = `https://map.kakao.com/link/to/${encodeURIComponent(e.place)},${e.lat},${e.lng}`;
    $('detail').innerHTML = `
      <button class="back" id="backBtn">‹ 목록</button>
      ${tagsHtml(e)}
      <h2>${esc(e.title)}</h2>
      <div class="reason">${esc(e.reason)}</div>
      <dl>
        <dt>기간</dt><dd>${e.start === e.end ? e.start : `${e.start} ~ ${e.end}`}${e.time ? `<br>${esc(e.time)}` : ''}</dd>
        <dt>장소</dt><dd>${esc(e.place)} (${esc(e.gu)})${d}</dd>
        <dt>요금</dt><dd>${esc(e.fee || (e.free ? '무료' : '-'))}</dd>
        ${e.target ? `<dt>대상</dt><dd>${esc(e.target)}</dd>` : ''}
        <dt>분류</dt><dd>${esc(e.cat)}</dd>
      </dl>
      <div class="actions">
        <a class="btn primary" href="${kakao}" target="_blank" rel="noopener">길찾기</a>
        <a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener">상세 보기</a>
        <button class="btn ${saved ? 'saved' : ''}" id="saveBtn" aria-label="찜">${saved ? '♥' : '♡'}</button>
      </div>
      ${e.img ? `<img class="poster" src="${esc(e.img.replace('thumb=Y', 'thumb=N'))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}`;
    $('list').hidden = true;
    $('detail').hidden = false;
    $('countText').textContent = '상세 정보';
    $('subText').textContent = '';
    $('sheetBody').scrollTop = 0;
    $('backBtn').onclick = closeDetail;
    $('saveBtn').onclick = () => toggleSave(e);
    setSheet('half');
    const m = markers.get(e.id);
    if (fly && m) cluster.zoomToShowLayer(m, () => showAboveSheet([e.lat, e.lng]));
    else showAboveSheet([e.lat, e.lng]);
  }

  // 시트(화면 절반)와 상단 필터에 가리지 않는 영역의 가운데로 지점을 옮긴다
  function showAboveSheet(latlng) {
    const top = 104, bottom = innerHeight * 0.5;
    const target = L.point(innerWidth / 2, (top + bottom) / 2);
    const now = map.latLngToContainerPoint(latlng);
    map.panBy(now.subtract(target), { duration: 0.4 });
  }

  function closeDetail() {
    setActive(state.selected, false);
    state.selected = null;
    $('detail').hidden = true;
    $('list').hidden = false;
    renderList();
  }

  function toggleSave(e) {
    state.saved.has(e.id) ? state.saved.delete(e.id) : state.saved.add(e.id);
    store('saved', [...state.saved]);
    const on = state.saved.has(e.id);
    $('saveBtn').textContent = on ? '♥' : '♡';
    $('saveBtn').classList.toggle('saved', on);
    toast(on ? '찜했어요' : '찜을 취소했어요');
  }

  // ── 바텀시트 ──
  const sheet = $('sheet');
  const snaps = () => {
    const vh = innerHeight;
    return { peek: 168, half: Math.round(vh * 0.5), full: sheet.offsetHeight };
  };
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

  // ── 내 위치 ──
  function setMe(pos, recenter) {
    state.me = pos;
    if (!meMarker) {
      meMarker = L.marker(pos, { icon: L.divIcon({ html: '<div class="me"></div>', className: '', iconSize: [18, 18] }), zIndexOffset: 1000, interactive: false }).addTo(map);
    } else meMarker.setLatLng(pos);
    if (recenter) map.setView(pos, 15);
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
          if (dist(pos, SEOUL) > 60e3) {
            setMe(pos, false);
            toast('서울 밖에 계셔서 서울 지도를 보여드려요');
          } else setMe(pos, true);
        } else setMe(pos, false);
      },
      () => {
        $('locateBtn').classList.remove('searching');
        if (firstFix) toast('위치 권한이 없어 서울시청 기준으로 보여드려요');
        firstFix = false;
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
    );
  }
  $('locateBtn').addEventListener('click', () => {
    if (state.me) map.flyTo(state.me, 15, { duration: 0.6 });
    else { firstFix = true; locate(); }
  });

  // ── 칩 ──
  function bindChips(containerId, attr, key) {
    $(containerId).addEventListener('click', (ev) => {
      const b = ev.target.closest(`[data-${attr}]`);
      if (!b) return;
      state[key] = b.dataset[attr];
      $(containerId).querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
      store('prefs', { label: state.label, when: state.when, freeOnly: state.freeOnly });
      if (state.selected) closeDetail();
      renderMarkers();
    });
  }
  bindChips('labelChips', 'label', 'label');
  bindChips('whenChips', 'when', 'when');
  $('freeChip').addEventListener('click', () => {
    state.freeOnly = !state.freeOnly;
    $('freeChip').classList.toggle('on', state.freeOnly);
    store('prefs', { label: state.label, when: state.when, freeOnly: state.freeOnly });
    renderMarkers();
  });
  const prefs = load('prefs', null);
  if (prefs) {
    Object.assign(state, { label: prefs.label ?? 'all', when: prefs.when ?? 'today', freeOnly: !!prefs.freeOnly });
    document.querySelectorAll('[data-label]').forEach((x) => x.classList.toggle('on', x.dataset.label === state.label));
    document.querySelectorAll('[data-when]').forEach((x) => x.classList.toggle('on', x.dataset.when === state.when));
    $('freeChip').classList.toggle('on', state.freeOnly);
  }

  // ── 토스트 ──
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ── 시작 ──
  map.on('moveend', renderList);
  setSheet('peek');
  locate();
  fetch('data/events.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((data) => {
      state.events = data.events;
      const updated = new Date(data.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      $('foot').textContent = `${updated} 업데이트 · 서울시 문화행사 정보 ${data.count}건${data.mode === 'sample' ? ' (미리보기 데이터)' : ''}`;
      renderMarkers();
    })
    .catch(() => {
      $('countText').textContent = '데이터를 불러오지 못했어요';
    });
})();
