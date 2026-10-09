// 서울시 문화행사 정보 (서울 열린데이터광장)
// 키가 없으면 공개 샘플키로 "미리보기" 데이터를 만든다 (날짜별 5건씩, 일부만 수집됨).
import { addDays, buildEvent, clipDesc, countExcluded, dateCheck, getText, HORIZON_DAYS, newStats, seoulCoords } from '../lib.mjs';

const BASE = 'http://openapi.seoul.go.kr:8088';
const PAGE = 1000;

async function call(key, start, end, filter = '') {
  const text = await getText(`${BASE}/${key}/json/culturalEventInfo/${start}/${end}/${filter}`);
  if (!text.startsWith('{')) throw new Error(text.slice(0, 200));
  const body = JSON.parse(text).culturalEventInfo;
  if (!body) return { total: 0, rows: [] };
  const code = body.RESULT?.CODE;
  if (code === 'INFO-200') return { total: 0, rows: [] };
  if (code !== 'INFO-000') throw new Error(`${code} ${body.RESULT?.MESSAGE}`);
  return { total: body.list_total_count, rows: body.row ?? [] };
}

async function fetchRows(key, today) {
  if (key) {
    const { total } = await call(key, 1, 1);
    const pages = Math.ceil(total / PAGE);
    const rows = [];
    for (let p = 0; p < pages; p += 4) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(4, pages - p) }, (_, i) => call(key, (p + i) * PAGE + 1, (p + i + 1) * PAGE)),
      );
      batch.forEach((b) => rows.push(...b.rows));
    }
    return { mode: 'full', rows };
  }
  const rows = [];
  for (let i = -60; i <= HORIZON_DAYS; i++) {
    const { rows: r } = await call('sample', 1, 5, `%20/%20/${addDays(today, i)}`);
    rows.push(...r);
  }
  return { mode: 'sample', rows };
}

export async function fetchSeoul(today, key = process.env.SEOUL_API_KEY?.trim()) {
  const { mode, rows } = await fetchRows(key, today);
  const stats = { ...newStats(), raw: rows.length };
  const events = [];
  const seen = new Set();
  for (const r of rows) {
    const start = r.STRTDATE?.slice(0, 10), end = r.END_DATE?.slice(0, 10);
    const bad = dateCheck(start, end, today);
    if (bad) { stats[bad]++; continue; }
    const pos = seoulCoords(r.LAT, r.LOT);
    if (!pos) { stats.noCoord++; continue; }
    // 기존 찜·공유 링크가 깨지지 않게 서울시 행사는 접두사 없이 cultcode를 그대로 쓴다
    const id = r.HMPG_ADDR?.match(/cultcode=(\d+)/)?.[1] ?? `${r.TITLE}|${r.PLACE}`;
    if (seen.has(id)) { stats.dup++; continue; }
    seen.add(id);
    const e = buildEvent({
      id,
      src: 'seoul',
      raw: r,
      start,
      end,
      lat: pos[0],
      lng: pos[1],
      gu: r.GUNAME || '',
      fee: r.USE_FEE,
      img: r.MAIN_IMG || '',
      url: r.HMPG_ADDR || r.ORG_LINK || '',
      ticket: r.ORG_LINK || '',
      desc: clipDesc(r.PROGRAM, r.ETC_DESC),
    });
    if (e.excluded) { countExcluded(stats, e.excluded); continue; }
    events.push(e);
  }
  return { mode, events, stats };
}
