// 여러 소스에 같은 행사가 올라온 경우 하나만 남긴다.
// 우선순위: 앞에 온 소스(서울시 > 문화정보원 > 관광공사). 빠진 정보(설명·이미지·예매)는 중복본에서 채운다.

const norm = (t) => t
  .replace(/^\s*\[[^\]]*\]\s*/, '') // [기관명] 접두사
  .replace(/20\d\d\s*년?/g, '')
  .replace(/[\s\[\]()《》「」『』<>〈〉"'‘’“”·:,.!?~\-–_/]/g, '')
  .toLowerCase();

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function similar(a, b) {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 4;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter) >= 0.6;
}
function meters(a, b) {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function dedupe(events) {
  const kept = [];
  const dupBySrc = {};
  for (const e of events) {
    const n = norm(e.title);
    const twin = kept.find((k) =>
      k.start <= e.end && e.start <= k.end && meters(k, e) < 800 && similar(k._n, n));
    if (!twin) { kept.push({ ...e, _n: n }); continue; }
    dupBySrc[e.src] = (dupBySrc[e.src] ?? 0) + 1;
    for (const f of ['desc', 'img', 'ticket', 'time', 'fee', 'gu']) if (!twin[f] && e[f]) twin[f] = e[f];
    twin.alt = [...new Set([...(twin.alt ?? []), e.src])];
  }
  return { events: kept.map(({ _n, ...e }) => e), dupBySrc };
}
