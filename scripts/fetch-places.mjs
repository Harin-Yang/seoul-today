// 가보기 좋은 곳(관광지·문화시설·레포츠·쇼핑) → data/places.json
// 장소는 자주 바뀌지 않으므로 소개글은 직전 파일에서 이어 쓰고, 하루에 DAILY_OVERVIEWS곳씩만 새로 채운다
// (관광공사 개발계정 하루 호출 한도 1,000건)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { decodeKey } from './lib.mjs';
import { fetchPlaces, fillOverviews } from './sources/places.mjs';

const DAILY_OVERVIEWS = 250;
const OUT = new URL('../data/places.json', import.meta.url);
const prev = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);

let result;
try {
  result = await fetchPlaces();
} catch (err) {
  console.error('장소 수집 실패, 기존 파일 유지:', err.message);
  process.exit(0);
}
if (result.skipped) { console.log('장소 수집 건너뜀:', result.skipped); process.exit(0); }

const prevDesc = new Map((prev?.places ?? []).filter((p) => p.desc).map((p) => [p.id, p.desc]));
for (const p of result.places) if (prevDesc.has(p.id)) p.desc = prevDesc.get(p.id);
const filled = await fillOverviews(decodeKey(process.env.DATA_GO_KR_KEY), result.places, DAILY_OVERVIEWS).catch((err) => {
  console.error('소개글 채우기 실패:', err.message);
  return 0;
});

const stats = { ...result.stats, total: result.places.length, withDesc: result.places.filter((p) => p.desc).length, filledToday: filled };
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), count: result.places.length, stats, places: result.places }));
console.log(`장소 ${result.places.length}곳 저장`, JSON.stringify(stats));
