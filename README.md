# 오늘 어디 가지

열자마자 내 위치와 주변 서울 문화행사를 지도로 보여주는 모바일 웹입니다.
행사마다 💑 데이트 / 🎧 혼놀 / 👯 친구와 라벨이 붙어 있습니다.

- **데이터**: 서울 열린데이터광장 [문화행사 정보](https://data.seoul.go.kr/dataList/OA-15486/S/1/datasetView.do) API
- **갱신**: GitHub Actions가 매일 06:00(KST)에 `data/events.json`을 새로 만듭니다
- **호스팅**: GitHub Pages (서버·DB 없음, 비용 0원)
- **지도**: Leaflet + OpenStreetMap/CARTO 타일 (키 불필요)

## 구조

```
index.html / style.css / app.js   지도 화면 (빌드 과정 없음)
data/events.json                  매일 자동 생성되는 행사 데이터
scripts/fetch-events.mjs          API 수집 → 오늘~14일 내 행사만 추림
scripts/classify.mjs              데이트/혼놀/친구와 규칙 기반 분류
scripts/serve.mjs                 로컬 미리보기 서버 (node scripts/serve.mjs)
.github/workflows/update.yml      매일 실행되는 자동 업데이트
```

## 서울시 API 키 연결

키가 없으면 공개 샘플키로 일부 데이터(미리보기)만 수집합니다.

1. [서울 열린데이터광장](https://data.seoul.go.kr) 로그인 → 상단 "이용안내 > 인증키 신청"에서 **일반 인증키** 발급
2. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `SEOUL_API_KEY`, Secret: 발급받은 키
3. Actions 탭 → "매일 이벤트 업데이트" → **Run workflow**

## 라벨 규칙 손보기

`scripts/classify.mjs`의 `RULES`에서 카테고리별 점수와 키워드를 고치면 됩니다. 2점 이상이면 라벨이 붙습니다.
어린이 전용 행사는 제외합니다.
