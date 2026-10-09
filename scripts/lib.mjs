// 수집기 공통 도구
import { classify, excludeReason, isOutdoor } from './classify.mjs';

export const HORIZON_DAYS = 14; // 오늘부터 2주 안에 진행되는 행사까지 포함
const DESC_MAX = 280;

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
export const compact = (d) => d.replaceAll('-', '');
/** 20261009, 2026.10.09, 2026-10-09 00:00:00 → 2026-10-09 */
export function isoDate(s) {
  const m = String(s ?? '').match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export function cleanText(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function clipDesc(...parts) {
  const text = parts.map(cleanText).filter((p) => p && p !== '-' && p.length > 4).join(' · ');
  return text.length > DESC_MAX ? `${text.slice(0, DESC_MAX).replace(/\s\S*$/, '')}…` : text;
}

/** 서울 근처 좌표만 허용. 위경도가 뒤바뀐 데이터는 바로잡는다 */
export function seoulCoords(latRaw, lngRaw) {
  let lat = parseFloat(latRaw), lng = parseFloat(lngRaw);
  if (lat > 100 && lng < 100) [lat, lng] = [lng, lat];
  if (!(lat > 37.0 && lat < 38.0 && lng > 126.4 && lng < 127.6)) return null;
  return [+lat.toFixed(6), +lng.toFixed(6)];
}

export function firstUrl(s) {
  return String(s ?? '').match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? '';
}

export async function getText(url, { retries = 3, timeout = 30000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return text;
    } catch (err) {
      // 연결 자체가 안 되면(HTTP 응답 없음) http로 한 번 더 시도한다
      if (attempt === retries && err.cause && url.startsWith('https://apis.data.go.kr')) {
        try { return await getText(url.replace('https://', 'http://'), { retries: 1, timeout }); } catch { /* 아래에서 원래 오류 보고 */ }
      }
      if (attempt === retries) {
        // "fetch failed"만으로는 원인을 알 수 없어 네트워크 오류 코드를 붙인다 (키는 가린다)
        const cause = err.cause ? ` (${err.cause.code ?? ''} ${err.cause.message ?? ''})` : '';
        throw new Error(`${err.message}${cause} @ ${url.replace(/serviceKey=[^&]+/, 'serviceKey=***').slice(0, 120)}`);
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** 동시에 limit개씩 실행 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (err) { out[idx] = { error: err }; }
    }
  }));
  return out;
}

/** 단순한 XML(<item><필드>값</필드>…</item>)을 객체 배열로 */
export function parseXmlItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const o = {};
    for (const [, k, v] of body.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
      o[k] = v.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
    }
    return o;
  });
}
export const xmlTag = (xml, tag) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '';

/** data.go.kr 키는 인코딩/디코딩 두 형태가 있어서 디코딩 형태로 맞춘다 */
export function decodeKey(k) {
  if (!k) return '';
  const t = k.trim();
  try { return t.includes('%') ? decodeURIComponent(t) : t; } catch { return t; }
}

/**
 * 각 소스가 만든 "원본 비슷한" 객체를 화면용 이벤트로 바꾼다.
 * raw: { TITLE, CODENAME, PLACE, PROGRAM, USE_TRGT, PRO_TIME, IS_FREE } (classify 입력 형식)
 * 제외 대상이면 { excluded: 사유 }를 돌려준다.
 */
export function buildEvent({ id, src, raw, start, end, lat, lng, gu = '', fee = '', img = '', url = '', ticket = '', desc = '' }) {
  const why = excludeReason(raw);
  if (why) return { excluded: why };
  const c = classify(raw);
  return {
    id,
    src,
    title: cleanText(raw.TITLE),
    cat: raw.CODENAME,
    gu,
    place: cleanText(raw.PLACE),
    start,
    end,
    time: cleanText(raw.PRO_TIME),
    fee: cleanText(fee),
    free: raw.IS_FREE === '무료',
    target: cleanText(raw.USE_TRGT),
    desc,
    img,
    url,
    ticket: ticket && ticket !== url ? ticket : '',
    out: isOutdoor(raw),
    lat,
    lng,
    labels: c.labels,
    reason: c.reason,
  };
}

/** 기간 검사 결과: null이면 통과, 아니면 stats 키 */
export function dateCheck(start, end, today) {
  if (!start || !end || end < start || end > addDays(today, 3 * 365)) return 'badDate';
  if (end < today) return 'past';
  if (start > addDays(today, HORIZON_DAYS)) return 'future';
  return null;
}

export function newStats() {
  return { raw: 0, past: 0, future: 0, badDate: 0, noCoord: 0, notSeoul: 0, dup: 0, excluded: {} };
}
export function countExcluded(stats, why) {
  stats.excluded[why] = (stats.excluded[why] ?? 0) + 1;
}

/** 서울 25개 구 이름을 주소/장소에서 찾는다 */
const GU = ['종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구'];
export function findGu(...texts) {
  const t = texts.join(' ');
  return GU.find((g) => new RegExp(`(^|[^가-힣])${g}`).test(t)) ?? '';
}
