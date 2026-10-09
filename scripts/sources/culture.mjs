// 한국문화정보원 한눈에보는문화정보 (data.go.kr 15138937) — 공연·전시·행사 전국 통합, 서울만 사용
import {
  addDays, buildEvent, clipDesc, compact, countExcluded, dateCheck, decodeKey, findGu, firstUrl, getText,
  isoDate, mapLimit, newStats, parseXmlItems, seoulCoords, xmlTag,
} from '../lib.mjs';

const BASE = 'http://apis.data.go.kr/B553457/cultureinfo';
const ROWS = 100;
const MAX_PAGES = 60;
const MAX_DETAILS = 900;
const GAP_MS = 150;
const PERFORMANCE = new Set(['연극', '뮤지컬/오페라', '콘서트', '클래식', '무용', '국악']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 분류명 → 서울시 데이터와 같은 카테고리 체계
function category(realm = '', service = '', title = '') {
  const t = `${realm} ${service}`;
  // "음악/콘서트"로 묶여 오는 클래식 공연은 제목으로 가려낸다
  if (/음악|콘서트/.test(t) && /독주회|리사이틀|연주회|오케스트라|교향|필하모닉|심포니|실내악|챔버|첼로|피아노|바이올린|비올라|성악|가곡|콰르텟|트리오|소나타|협주곡/.test(title) && !/재즈|밴드|록|힙합|아이돌|팬미팅/.test(title)) return '클래식';
  if (/전시|미술|사진/.test(t)) return '전시/미술';
  if (/뮤지컬|오페라/.test(t)) return '뮤지컬/오페라';
  if (/연극/.test(t)) return '연극';
  if (/클래식/.test(t)) return '클래식';
  if (/국악/.test(t)) return '국악';
  if (/무용|발레/.test(t)) return '무용';
  if (/콘서트|음악|대중/.test(t)) return '콘서트';
  if (/영화/.test(t)) return '영화';
  if (/축제|행사/.test(t)) return '축제-문화/예술';
  if (/교육|체험/.test(t)) return '교육/체험';
  return '기타';
}

function checkError(xml) {
  const auth = xmlTag(xml, 'returnAuthMsg') || xmlTag(xml, 'errMsg');
  if (auth && !/NORMAL/.test(auth)) throw new Error(`data.go.kr: ${auth} ${xmlTag(xml, 'returnReasonCode')}`);
  const code = xmlTag(xml, 'resultCode');
  if (code && !/^0+$/.test(code)) throw new Error(`cultureinfo ${code} ${xmlTag(xml, 'resultMsg')}`);
}

async function list(key, params) {
  const q = new URLSearchParams({ serviceKey: key, numOfrows: String(ROWS), ...params });
  const xml = await getText(`${BASE}/area2?${q}`);
  checkError(xml);
  return { total: +xmlTag(xml, 'totalCount') || 0, items: parseXmlItems(xml) };
}

async function detail(key, seq) {
  const q = new URLSearchParams({ serviceKey: key, seq });
  const xml = await getText(`${BASE}/detail2?${q}`, { retries: 2, timeout: 20000 });
  checkError(xml);
  return parseXmlItems(xml)[0] ?? {};
}

export async function fetchCulture(today, keyRaw = process.env.DATA_GO_KR_KEY) {
  const key = decodeKey(keyRaw);
  if (!key) return { skipped: 'DATA_GO_KR_KEY 없음' };
  const base = { from: compact(addDays(today, -180)), to: compact(addDays(today, 14)) };

  // 시/도 표기가 문서에 없어 두 가지를 시도한다
  let sido = '서울', first = await list(key, { ...base, sido, PageNo: '1' });
  if (!first.total) { sido = '서울특별시'; first = await list(key, { ...base, sido, PageNo: '1' }); }
  // 초당 요청 제한(429)이 있어 페이지는 하나씩 천천히 받는다
  const pages = Math.min(Math.ceil(first.total / ROWS), MAX_PAGES);
  const items = [...first.items];
  for (let p = 2; p <= pages; p++) {
    await sleep(GAP_MS);
    items.push(...(await list(key, { ...base, sido, PageNo: String(p) })).items);
  }

  const stats = { ...newStats(), raw: items.length, apiTotal: first.total, sido };
  const candidates = [];
  const seen = new Set();
  for (const it of items) {
    if (it.area && !/서울/.test(it.area)) { stats.notSeoul++; continue; }
    const start = isoDate(it.startDate), end = isoDate(it.endDate);
    const bad = dateCheck(start, end, today);
    if (bad) { stats[bad]++; continue; }
    const pos = seoulCoords(it.gpsY, it.gpsX);
    if (!pos) { stats.noCoord++; continue; }
    if (seen.has(it.seq)) { stats.dup++; continue; }
    seen.add(it.seq);
    candidates.push({ it, start, end, pos });
  }

  // 상세(설명·요금·링크)는 걸러진 후보만 조회
  const details = await mapLimit(candidates.slice(0, MAX_DETAILS), 2, async ({ it }) => { await sleep(GAP_MS); return detail(key, it.seq); });
  stats.detailErrors = details.filter((d) => d?.error).length;

  const events = [];
  candidates.forEach(({ it, start, end, pos }, i) => {
    const d = details[i] && !details[i].error ? details[i] : {};
    const price = cleanPrice(d.price);
    const raw = {
      TITLE: it.title,
      CODENAME: category(it.realmName, it.serviceName, it.title),
      PLACE: it.place || d.place || '',
      PROGRAM: d.contents1 || '',
      USE_TRGT: /아동|가족|어린이/.test(it.realmName ?? '') ? '어린이' : '',
      PRO_TIME: '',
      IS_FREE: /^무료$|^0원$|무료\s*$/.test(price) ? '무료' : '유료',
    };
    const e = buildEvent({
      id: `c${it.seq}`,
      src: 'culture',
      raw,
      start,
      end,
      lat: pos[0],
      lng: pos[1],
      gu: findGu(it.sigungu, d.placeAddr, it.place),
      fee: price,
      img: d.imgUrl || it.thumbnail || '',
      url: firstUrl(d.url) || firstUrl(d.placeUrl) || `https://www.culture.go.kr/search/search.do?searchKeyword=${encodeURIComponent(it.title)}`,
      desc: clipDesc(d.contents1),
    });
    if (e.excluded) { countExcluded(stats, e.excluded); return; }
    // 이 소스는 공연 시간이 없다. 국내 공연은 대부분 저녁(19:30~20:00) 시작이라 공연은 저녁 가능으로 본다
    if (PERFORMANCE.has(e.cat)) e.night = true;
    events.push(e);
  });
  return { events, stats };
}

function cleanPrice(p) {
  const t = String(p ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t === '-' ? '' : t;
}
