// 한국관광공사 국문 관광정보 서비스 (data.go.kr 15101578) — 축제·행사, 서울(법정동 시도코드 11)
import {
  addDays, buildEvent, clipDesc, compact, countExcluded, dateCheck, decodeKey, findGu, firstUrl, getText,
  isoDate, mapLimit, newStats, seoulCoords,
} from '../lib.mjs';

const BASE = 'http://apis.data.go.kr/B551011/KorService2';
const COMMON = { MobileOS: 'ETC', MobileApp: 'SeoulToday', _type: 'json' };
const ROWS = 100;

async function call(key, op, params) {
  const q = new URLSearchParams({ serviceKey: key, ...COMMON, ...params });
  const text = await getText(`${BASE}/${op}?${q}`, { retries: 2 });
  if (!text.trim().startsWith('{')) {
    const msg = text.match(/<returnAuthMsg>([^<]+)/)?.[1] ?? text.match(/<resultMsg>([^<]+)/)?.[1] ?? text.slice(0, 160);
    throw new Error(`KorService2 ${op}: ${msg}`);
  }
  const json = JSON.parse(text);
  const res = json.response ?? json;
  const code = res.header?.resultCode;
  if (code && code !== '0000') throw new Error(`KorService2 ${op}: ${code} ${res.header?.resultMsg}`);
  const items = res.body?.items?.item ?? [];
  return { total: +res.body?.totalCount || 0, items: Array.isArray(items) ? items : [items] };
}

function category(title) {
  if (/전시|展|아트페어|비엔날레/.test(title)) return '전시/미술';
  if (/콘서트|음악회|공연|페스타|뮤직|재즈/.test(title)) return '콘서트';
  if (/전통|궁|문화재|국가유산|역사/.test(title)) return '축제-전통/역사';
  if (/꽃|빛|정원|한강|숲|단풍|야경/.test(title)) return '축제-자연/경관';
  return '축제-기타';
}

export async function fetchTour(today, keyRaw = process.env.DATA_GO_KR_KEY) {
  const key = decodeKey(keyRaw);
  if (!key) return { skipped: 'DATA_GO_KR_KEY 없음' };
  const params = { lDongRegnCd: '11', eventStartDate: compact(addDays(today, -120)), arrange: 'A', numOfRows: String(ROWS) };
  const first = await call(key, 'searchFestival2', { ...params, pageNo: '1' });
  const items = [...first.items];
  for (let p = 2; p <= Math.min(Math.ceil(first.total / ROWS), 10); p++) {
    items.push(...(await call(key, 'searchFestival2', { ...params, pageNo: String(p) })).items);
  }

  const stats = { ...newStats(), raw: items.length, apiTotal: first.total };
  const candidates = [];
  for (const it of items) {
    if (/취소|연기/.test(it.progresstype ?? '') || /온라인/.test(it.festivaltype ?? '')) { countExcluded(stats, 'cancelled-or-online'); continue; }
    const start = isoDate(it.eventstartdate), end = isoDate(it.eventenddate);
    const bad = dateCheck(start, end, today);
    if (bad) { stats[bad]++; continue; }
    const pos = seoulCoords(it.mapy, it.mapx);
    if (!pos) { stats.noCoord++; continue; }
    candidates.push({ it, start, end, pos });
  }

  // 소개(시간·요금·장소)와 개요는 후보만 조회
  const intros = await mapLimit(candidates, 2, ({ it }) =>
    call(key, 'detailIntro2', { contentId: it.contentid, contentTypeId: it.contenttypeid || '15' }).then((r) => r.items[0] ?? {}));
  const commons = await mapLimit(candidates, 2, ({ it }) =>
    call(key, 'detailCommon2', { contentId: it.contentid }).then((r) => r.items[0] ?? {}));
  stats.detailErrors = [...intros, ...commons].filter((d) => d?.error).length;

  const events = [];
  candidates.forEach(({ it, start, end, pos }, i) => {
    const intro = intros[i]?.error ? {} : intros[i] ?? {};
    const common = commons[i]?.error ? {} : commons[i] ?? {};
    const fee = String(intro.usetimefestival ?? '').replace(/<br\s*\/?>/gi, ' ').trim();
    const raw = {
      TITLE: it.title,
      CODENAME: category(it.title),
      PLACE: intro.eventplace || [it.addr1, it.addr2].filter(Boolean).join(' '),
      PROGRAM: [common.overview, intro.program].filter(Boolean).join(' '),
      USE_TRGT: intro.agelimit || '',
      PRO_TIME: intro.playtime || '',
      IS_FREE: /^\s*무료\s*$|^없음$/.test(fee) ? '무료' : '유료',
    };
    const e = buildEvent({
      id: `t${it.contentid}`,
      src: 'tour',
      raw,
      start,
      end,
      lat: pos[0],
      lng: pos[1],
      gu: findGu(it.addr1, intro.eventplace),
      fee,
      img: it.firstimage || it.firstimage2 || '',
      url: firstUrl(intro.eventhomepage) || firstUrl(common.homepage) || `https://korean.visitkorea.or.kr/search/search_list.do?keyword=${encodeURIComponent(it.title)}`,
      ticket: firstUrl(intro.bookingplace),
      desc: clipDesc(common.overview),
    });
    if (e.excluded) { countExcluded(stats, e.excluded); return; }
    events.push(e);
  });
  return { events, stats };
}
