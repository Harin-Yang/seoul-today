# 오늘 어디 가지

열자마자 내 위치와 주변 서울 문화행사를 지도로 보여주는 모바일 웹입니다.
행사마다 💑 데이트 / 🎧 혼놀 / 👯 친구와 라벨이 붙어 있습니다.

**https://harin-yang.github.io/seoul-today/**

- **데이터**: 아래 세 곳을 매일 06:00(KST)에 GitHub Actions로 모아 `data/events.json`으로 만듭니다
  - 서울 열린데이터광장 [문화행사 정보](https://data.seoul.go.kr/dataList/OA-15486/S/1/datasetView.do)
  - 공공데이터포털 [한국문화정보원 한눈에보는문화정보](https://www.data.go.kr/data/15138937/openapi.do) (공연·전시)
  - 공공데이터포털 [한국관광공사 국문 관광정보](https://www.data.go.kr/data/15101578/openapi.do) (축제·행사)
- **호스팅**: GitHub Pages (서버·DB 없음, 비용 0원)
- **지도**: Leaflet + OpenStreetMap 타일 / **날씨**: Open-Meteo (둘 다 키 불필요)

## 구조

```
index.html / style.css / app.js   지도 화면 (빌드 과정 없음)
data/events.json                  매일 자동 생성되는 행사 데이터 (stats에 소스별 수집·제외 통계)
scripts/fetch-events.mjs          소스별 수집 → 회차 묶기 → 소스 간 중복 제거 → 저장
scripts/sources/*.mjs             소스별 수집기 (seoul / culture / tour)
scripts/classify.mjs              놀러 가기 어려운 행사 제외 + 데이트/혼놀/친구와 분류
scripts/series.mjs, dedupe.mjs    같은 행사 회차 묶기, 소스 간 중복 제거
scripts/serve.mjs                 로컬 미리보기 서버 (node scripts/serve.mjs)
.github/workflows/update.yml      매일 실행되는 자동 업데이트 (scripts 수정 시에도 실행)
```

## API 키 (GitHub → Settings → Secrets and variables → Actions)

| 이름 | 발급처 | 없으면 |
|---|---|---|
| `SEOUL_API_KEY` | 서울 열린데이터광장 → 인증키 신청 | 공개 샘플키로 일부만 수집 |
| `DATA_GO_KR_KEY` | 공공데이터포털 → 마이페이지 → 활용신청 현황 → 개발계정 상세의 "일반 인증키" (Encoding/Decoding 모두 가능) | 문화정보원·관광공사 소스 건너뜀 |

키를 바꾼 뒤에는 Actions 탭 → "매일 이벤트 업데이트" → **Run workflow**.

## 라벨·제외 규칙 손보기

`scripts/classify.mjs`
- `RULES`: 카테고리별 점수와 키워드. 2점 이상이면 라벨이 붙습니다
- `NOT_OUTING_*`, `RESTRICTED_TARGET`: 모집 공고·기수제 강좌·단체/자격 대상 등 제외 규칙
