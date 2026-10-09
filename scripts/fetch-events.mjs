// 서울시 문화행사 API → data/events.json
// 사용: SEOUL_API_KEY=xxxx node scripts/fetch-events.mjs
// 키가 없으면 공개 샘플키로 "미리보기" 데이터를 만든다 (날짜별 5건씩, 일부만 수집됨).
import { writeFile, mkdir } from 'node:fs/promises';
import { classify, excludeReason, isOutdoor } from './classify.mjs';
import { mergeSeries } from './series.mjs';

const KEY = process.env.SEOUL_API_KEY?.trim();
const BASE = 'http://openapi.seoul.go.kr:8088';
const PAGE = 1000;
const HORIZON_DAYS = 14; // 오늘부터 2주 안에 진행되는 행사까지 포함
const DESC_MAX = 280;

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

async function call(key, start, end, filter = '') {
  const url = `${BASE}/${key}/json/culturalEventInfo/${start}/${end}/${filter}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (!text.startsWith('{')) throw new Error(text.slice(0, 200));
      const body = JSON.parse(text).culturalEventInfo;
      if (!body) return { total: 0, rows: [] };
      const code = body.RESULT?.CODE;
      if (code === 'INFO-200') return { total: 0, rows: [] };
      if (code !== 'INFO-000') throw new Error(`${code} ${body.RESULT?.MESSAGE}`);
      return { total: body.list_total_count, rows: body.row ?? [] };
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

async function fetchAll(today) {
  if (KEY) {
    const { total } = await call(KEY, 1, 1);
    const pages = Math.ceil(total / PAGE);
    console.log(`전체 ${total}건, ${pages}페이지 수집`);
    const rows = [];
    for (let p = 0; p < pages; p += 4) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(4, pages - p) }, (_, i) =>
          call(KEY, (p + i) * PAGE + 1, (p + i + 1) * PAGE))
      );
      batch.forEach(b => rows.push(...b.rows));
    }
    return { mode: 'full', rows };
  }
  // 샘플키: 시작일 필터로 최근 60일 + 앞으로 14일을 하루씩 5건까지
  console.log('SEOUL_API_KEY 없음 → 샘플키 미리보기 모드');
  const rows = [];
  for (let i = -60; i <= HORIZON_DAYS; i++) {
    const day = addDays(today, i);
    const { rows: r } = await call('sample', 1, 5, `%20/%20/${day}`);
    rows.push(...r);
  }
  return { mode: 'sample', rows };
}

function coords(r) {
  let lat = parseFloat(r.LAT), lng = parseFloat(r.LOT);
  if (lat > 100 && lng < 100) [lat, lng] = [lng, lat]; // 위경도가 뒤바뀐 데이터 보정
  if (!(lat > 37.0 && lat < 38.0 && lng > 126.4 && lng < 127.6)) return null;
  return [+lat.toFixed(6), +lng.toFixed(6)];
}

function cleanText(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function summary(r) {
  const parts = [cleanText(r.PROGRAM), cleanText(r.ETC_DESC)].filter((p) => p && p !== '-' && p.length > 4);
  const text = parts.join(' · ');
  return text.length > DESC_MAX ? `${text.slice(0, DESC_MAX).replace(/\s\S*$/, '')}…` : text;
}

function normalize(r) {
  const c = classify(r);
  const pos = coords(r);
  return {
    id: r.HMPG_ADDR?.match(/cultcode=(\d+)/)?.[1] ?? `${r.TITLE}|${r.PLACE}`,
    title: cleanText(r.TITLE),
    cat: r.CODENAME,
    gu: r.GUNAME || '',
    place: cleanText(r.PLACE),
    start: r.STRTDATE.slice(0, 10),
    end: r.END_DATE.slice(0, 10),
    time: cleanText(r.PRO_TIME),
    fee: cleanText(r.USE_FEE),
    free: r.IS_FREE === '무료',
    target: cleanText(r.USE_TRGT),
    desc: summary(r),
    img: r.MAIN_IMG || '',
    url: r.HMPG_ADDR || r.ORG_LINK || '',
    ticket: r.ORG_LINK && r.ORG_LINK !== r.HMPG_ADDR ? r.ORG_LINK : '',
    out: isOutdoor(r),
    lat: pos[0],
    lng: pos[1],
    labels: c.labels,
    reason: c.reason,
  };
}

const today = kstToday();
const horizon = addDays(today, HORIZON_DAYS);
const maxEnd = addDays(today, 3 * 365);
const { mode, rows } = await fetchAll(today);

const stats = { raw: rows.length, past: 0, future: 0, badDate: 0, noCoord: 0, dup: 0, excluded: {}, merged: 0 };
const seen = new Set();
const kept = [];
for (const r of rows) {
  const start = r.STRTDATE?.slice(0, 10), end = r.END_DATE?.slice(0, 10);
  if (!start || !end || end < start || end > maxEnd) { stats.badDate++; continue; }
  if (end < today) { stats.past++; continue; }
  if (start > horizon) { stats.future++; continue; }
  if (!coords(r)) { stats.noCoord++; continue; }
  const why = excludeReason(r);
  if (why) { stats.excluded[why] = (stats.excluded[why] ?? 0) + 1; continue; }
  const e = normalize(r);
  if (seen.has(e.id)) { stats.dup++; continue; }
  seen.add(e.id);
  kept.push(e);
}
const events = mergeSeries(kept).sort((a, b) => a.end.localeCompare(b.end));
stats.merged = kept.length - events.length;

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../data/events.json', import.meta.url),
  JSON.stringify({ updatedAt: new Date().toISOString(), date: today, mode, count: events.length, stats, events })
);
console.log(`${mode} 모드: 원본 ${rows.length}건 → ${events.length}건 저장`);
console.log(JSON.stringify(stats));
