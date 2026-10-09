// 한국관광공사 국문 관광정보 — 행사가 아닌 "가보기 좋은 곳" (관광지·문화시설·레포츠·쇼핑), 서울
import { cleanText, decodeKey, findGu, getText, mapLimit, seoulCoords } from '../lib.mjs';

const BASE = 'http://apis.data.go.kr/B551011/KorService2';
const COMMON = { MobileOS: 'ETC', MobileApp: 'SeoulToday', _type: 'json' };
const TYPES = { 12: '관광지', 14: '문화시설', 28: '레포츠', 38: '쇼핑' };
const ROWS = 500;

async function call(key, op, params) {
  const q = new URLSearchParams({ serviceKey: key, ...COMMON, ...params });
  const text = await getText(`${BASE}/${op}?${q}`, { retries: 2 });
  if (!text.trim().startsWith('{')) throw new Error(`KorService2 ${op}: ${text.match(/<returnAuthMsg>([^<]+)/)?.[1] ?? text.slice(0, 160)}`);
  const res = JSON.parse(text).response;
  if (res?.header?.resultCode && res.header.resultCode !== '0000') throw new Error(`KorService2 ${op}: ${res.header.resultCode} ${res.header.resultMsg}`);
  const items = res?.body?.items?.item ?? [];
  return { total: +res?.body?.totalCount || 0, items: Array.isArray(items) ? items : [items] };
}

// 분류체계 코드 → 이름 (예: VE0701 → 공원)
async function classNames(key) {
  try {
    const { items } = await call(key, 'lclsSystmCode2', { lclsSystmListYn: 'Y', numOfRows: '2000', pageNo: '1' });
    const m = new Map();
    for (const it of items) {
      for (const lv of [1, 2, 3]) {
        const cd = it[`lclsSystm${lv}Cd`], nm = it[`lclsSystm${lv}Nm`];
        if (cd && nm) m.set(cd, nm);
      }
    }
    return m;
  } catch (err) {
    console.error('분류체계 이름 조회 실패:', err.message);
    return new Map();
  }
}

// 놀러 갈 곳이 아닌 것
const SKIP = /컨벤션|회의|공연장|문화원|외국문화원|도서관|학교|대학|교육|연수|기관|청사|관공서|묘|능원|납골|종교|교회|성당|면세점|백화점|대형마트|아울렛|상가|전문매장|시장\s*$/;

// 장소 라벨: 이름·분류 키워드로
function placeLabels(kind, title) {
  const t = `${kind} ${title}`;
  const s = { date: 0, solo: 0, friends: 0 };
  if (/공원|정원|수목원|숲|호수|한강|전망|야경|타워|궁|고궁|한옥|산책|길|카페|거리|다리|섬|미술관|갤러리|식물원|해변|낙조|성곽/.test(t)) s.date += 2;
  if (/미술관|박물관|기념관|전시|갤러리|서점|사찰|절|명상|정원|도서/.test(t)) s.solo += 2;
  if (/테마파크|놀이|레포츠|체험|시장|스포츠|볼링|클라이밍|카트|수영|썰매|스케이트|캠핑|쇼핑|거리|광장|아쿠아|동물원|과학관/.test(t)) s.friends += 2;
  if (/궁|고궁|타워|전망|한강|공원/.test(t)) s.friends += 1;
  const order = { date: 0, friends: 1, solo: 2 };
  const ranked = Object.entries(s).sort((a, b) => b[1] - a[1] || order[a[0]] - order[b[0]]);
  const labels = ranked.filter(([, v]) => v >= 2).map(([k]) => k);
  return labels.length ? labels : [ranked[0][0]];
}

const EMOJI = (kind, title) => {
  const t = `${kind} ${title}`;
  if (/미술관|갤러리/.test(t)) return '🖼️';
  if (/박물관|기념관|전시|과학관/.test(t)) return '🏛️';
  if (/궁|고궁|한옥|사찰|절|성곽|문화재|유적/.test(t)) return '🏯';
  if (/공원|정원|수목원|숲|식물원/.test(t)) return '🌳';
  if (/한강|호수|섬|다리|해변/.test(t)) return '🌊';
  if (/타워|전망|야경/.test(t)) return '🌃';
  if (/시장|쇼핑|거리/.test(t)) return '🛍️';
  if (/테마파크|놀이|동물원|아쿠아/.test(t)) return '🎡';
  if (/레포츠|스포츠|체험|클라이밍|볼링|수영|스케이트/.test(t)) return '🏃';
  return '📍';
};

export async function fetchPlaces(keyRaw = process.env.DATA_GO_KR_KEY) {
  const key = decodeKey(keyRaw);
  if (!key) return { skipped: 'DATA_GO_KR_KEY 없음' };
  const names = await classNames(key);
  const stats = { byType: {}, noImage: 0, noCoord: 0, skipped: 0, classNames: names.size };
  const places = [];
  for (const [typeId, typeName] of Object.entries(TYPES)) {
    // arrange=O: 대표 이미지가 있는 것만 제목순
    const params = { lDongRegnCd: '11', contentTypeId: typeId, arrange: 'O', numOfRows: String(ROWS) };
    const first = await call(key, 'areaBasedList2', { ...params, pageNo: '1' });
    const items = [...first.items];
    const pages = Math.min(Math.ceil(first.total / ROWS), 6);
    for (let p = 2; p <= pages; p++) items.push(...(await call(key, 'areaBasedList2', { ...params, pageNo: String(p) })).items);
    stats.byType[typeName] = { total: first.total, got: items.length, kept: 0 };
    for (const it of items) {
      if (!it.firstimage) { stats.noImage++; continue; }
      const pos = seoulCoords(it.mapy, it.mapx);
      if (!pos) { stats.noCoord++; continue; }
      const kind = names.get(it.lclsSystm3) || names.get(it.lclsSystm2) || typeName;
      const title = cleanText(it.title);
      if (SKIP.test(kind) || SKIP.test(title)) { stats.skipped++; continue; }
      places.push({
        id: `p${it.contentid}`,
        kind,
        type: typeName,
        title,
        emoji: EMOJI(kind, title),
        addr: cleanText([it.addr1, it.addr2].filter(Boolean).join(' ')),
        gu: findGu(it.addr1),
        img: it.firstimage,
        tel: cleanText(it.tel),
        lat: pos[0],
        lng: pos[1],
        labels: placeLabels(kind, title),
      });
      stats.byType[typeName].kept++;
    }
  }
  return { places, stats };
}

// 상세 소개는 호출량이 많아 필요한 곳만 (개요 앞부분)
export async function fillOverviews(key, places, limit = 0) {
  if (!limit) return 0;
  const target = places.filter((p) => !p.desc).slice(0, limit);
  const res = await mapLimit(target, 2, (p) => call(key, 'detailCommon2', { contentId: p.id.slice(1) }).then((r) => r.items[0] ?? {}));
  let n = 0;
  target.forEach((p, i) => {
    const o = cleanText(res[i]?.overview);
    if (o) { p.desc = o.length > 200 ? `${o.slice(0, 200).replace(/\s\S*$/, '')}…` : o; n++; }
  });
  return n;
}
