// 같은 장소에서 열리는 같은 행사의 여러 회차(1일차, 2회차 …)를 하나로 묶는다.
// 장소 표기는 회차마다 조금씩 달라서(", " vs " & ") 좌표로 비교한다.
const seriesKey = (e) =>
  `${e.title.replace(/\s*[-–:]?\s*\(?\d+\s?(일차|회차|차|회|부)\)?/g, '').replace(/\(\d+\/\d+\)|\d{1,2}\.\d{1,2}\.?\s?\(.\)/g, '').replace(/\s+/g, '')}|${e.lat.toFixed(3)},${e.lng.toFixed(3)}`;

export function mergeSeries(events) {
  const groups = new Map();
  for (const e of events) {
    const k = seriesKey(e);
    const g = groups.get(k);
    if (!g) { groups.set(k, { ...e, sessions: 1 }); continue; }
    g.sessions += 1;
    if (e.start < g.start) g.start = e.start;
    if (e.end > g.end) g.end = e.end;
    g.free = g.free && e.free;
  }
  return [...groups.values()].map((g) => {
    if (g.sessions > 1) {
      g.title = g.title.replace(/\s*[-–:]?\s*\(?\d+\s?(일차|회차|차)\)?(?=\s|$)/g, '').trim();
      g.time = `${g.sessions}개 회차 · ${g.time}`;
    }
    if (g.sessions === 1) delete g.sessions;
    return g;
  });
}
