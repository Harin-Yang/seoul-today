// 여러 소스의 행사를 모아 data/events.json 을 만든다.
// 환경변수: SEOUL_API_KEY(서울 열린데이터광장), DATA_GO_KR_KEY(공공데이터포털). 없는 소스는 건너뛴다.
import { writeFile, mkdir } from 'node:fs/promises';
import { kstToday } from './lib.mjs';
import { mergeSeries } from './series.mjs';
import { dedupe } from './dedupe.mjs';
import { fetchSeoul } from './sources/seoul.mjs';
import { fetchCulture } from './sources/culture.mjs';
import { fetchTour } from './sources/tour.mjs';

const today = kstToday();
const SOURCES = [['seoul', fetchSeoul], ['culture', fetchCulture], ['tour', fetchTour]];

const results = await Promise.allSettled(SOURCES.map(([, fn]) => fn(today)));
const stats = {};
const all = [];
let mode = 'full';
results.forEach((r, i) => {
  const name = SOURCES[i][0];
  if (r.status === 'rejected') {
    stats[name] = { error: String(r.reason?.message ?? r.reason).slice(0, 300) };
    console.error(`[${name}] 실패:`, r.reason);
    return;
  }
  if (r.value.skipped) { stats[name] = { skipped: r.value.skipped }; return; }
  if (r.value.mode === 'sample') mode = 'sample';
  stats[name] = { ...r.value.stats, kept: r.value.events.length };
  all.push(...r.value.events);
});

if (!all.length) {
  console.error('수집된 행사가 없어 기존 데이터를 유지합니다.', JSON.stringify(stats));
  process.exit(1);
}

const series = mergeSeries(all);
const { events, dupBySrc } = dedupe(series);
events.sort((a, b) => a.end.localeCompare(b.end));
stats.total = { collected: all.length, afterSeries: series.length, final: events.length, crossSourceDup: dupBySrc };

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../data/events.json', import.meta.url),
  JSON.stringify({ updatedAt: new Date().toISOString(), date: today, mode, count: events.length, stats, events }),
);
console.log(`${mode} 모드: ${events.length}건 저장`);
console.log(JSON.stringify(stats, null, 1));
