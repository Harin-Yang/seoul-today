// 여러 소스의 행사를 모아 data/events.json 을 만든다.
// 환경변수: SEOUL_API_KEY(서울 열린데이터광장), DATA_GO_KR_KEY(공공데이터포털). 없는 소스는 건너뛴다.
// 소스 하나가 실패하면 직전 데이터에서 그 소스의 (아직 안 끝난) 행사를 그대로 쓴다.
// --strict: 주 소스(서울시)가 실패하면 저장하지 않고 종료코드 2 (워크플로가 잠시 뒤 다시 시도)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { kstToday } from './lib.mjs';
import { mergeSeries } from './series.mjs';
import { dedupe } from './dedupe.mjs';
import { fetchSeoul } from './sources/seoul.mjs';
import { fetchCulture } from './sources/culture.mjs';
import { fetchTour } from './sources/tour.mjs';

const today = kstToday();
const STRICT = process.argv.includes('--strict');
const OUT = new URL('../data/events.json', import.meta.url);
const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);
const SOURCES = [['seoul', fetchSeoul], ['culture', fetchCulture], ['tour', fetchTour]];

// 키 문제 진단용: 값은 남기지 않고 길이·문자 종류만 기록한다
function keyShape(k) {
  if (!k) return null;
  const t = k.trim();
  return { len: t.length, trimmed: t.length !== k.length, invisible: /[​-‍⁠﻿]/.test(k), percent: t.includes('%'), plusSlashEq: /[+/=]/.test(t), hexOnly: /^[0-9a-f]+$/i.test(t) };
}
console.log('DATA_GO_KR_KEY 형태:', JSON.stringify(keyShape(process.env.DATA_GO_KR_KEY)));

const results = await Promise.allSettled(SOURCES.map(([, fn]) => fn(today)));
const stats = {};
const all = [];
let mode = 'full';
results.forEach((r, i) => {
  const name = SOURCES[i][0];
  if (r.status === 'rejected') {
    const reused = (prev?.events ?? []).filter((e) => (e.src ?? 'seoul') === name && e.end >= today);
    stats[name] = { error: String(r.reason?.message ?? r.reason).slice(0, 300), reusedPrevious: reused.length };
    console.error(`[${name}] 실패 (직전 데이터 ${reused.length}건 재사용):`, r.reason?.message ?? r.reason);
    all.push(...reused);
    return;
  }
  if (r.value.skipped) { stats[name] = { skipped: r.value.skipped }; return; }
  if (r.value.mode === 'sample') mode = 'sample';
  stats[name] = { ...r.value.stats, kept: r.value.events.length };
  all.push(...r.value.events);
});

if (STRICT && stats.seoul?.error) {
  console.error('서울시 데이터 수집 실패 → 다시 시도합니다.');
  process.exit(2);
}
if (!all.length) {
  console.error('수집된 행사가 없어 기존 데이터를 유지합니다.', JSON.stringify(stats));
  process.exit(1);
}

const series = mergeSeries(all);
const { events, dupBySrc } = dedupe(series);
events.sort((a, b) => a.end.localeCompare(b.end));
stats.dataGoKrKey = keyShape(process.env.DATA_GO_KR_KEY);
stats.total = { collected: all.length, afterSeries: series.length, final: events.length, crossSourceDup: dupBySrc };

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ updatedAt: new Date().toISOString(), date: today, mode, count: events.length, stats, events }),
);
console.log(`${mode} 모드: ${events.length}건 저장`);
console.log(JSON.stringify(stats, null, 1));
