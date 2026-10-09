// 행사 필터링 + 라벨 분류: date(데이트) / solo(혼놀) / friends(친구와)
// 카테고리 점수 + 키워드 점수가 2점 이상이면 라벨을 붙이고, 최소 1개는 보장한다.

const RULES = {
  date: {
    cats: { '전시/미술': 3, '뮤지컬/오페라': 3, '연극': 3, '콘서트': 2, '클래식': 2, '영화': 2, '무용': 2,
      '독주/독창회': 1, '국악': 1, '축제-자연/경관': 3, '축제-문화/예술': 1, '축제-관광/체육': 1 },
    kw: /야경|불꽃|빛|조명|정원|재즈|미디어\s?아트|로맨|커플|와인|한강|별빛|달빛|야간|밤|산책|플라워|꽃|가을|낭만|사랑|연애|피크닉|노을|궁|한옥|루프탑|차방|티\s?클래스|칵테일/,
  },
  solo: {
    cats: { '전시/미술': 3, '영화': 2, '클래식': 2, '독주/독창회': 2, '국악': 2, '교육/체험': 2, '무용': 1, '연극': 1 },
    kw: /강연|특강|강좌|북\s?토크|인문|도서관|책|명상|힐링|사진|드로잉|글쓰기|아카이브|소장품|개인전|상영|리사이틀|독주|토크|세미나|요가|작가와의\s?만남|해설/,
  },
  friends: {
    cats: { '축제-시민화합': 3, '축제-문화/예술': 2, '축제-전통/역사': 2, '축제-기타': 3, '축제-자연/경관': 1,
      '축제-관광/체육': 3, '콘서트': 2, '교육/체험': 1, '뮤지컬/오페라': 1 },
    kw: /페스티벌|축제|마켓|장터|파티|게임|댄스|버스킹|체험|만들기|공방|원데이|클래스|푸드|맥주|러닝|달리기|스포츠|EDM|힙합|락|록|밴드|퀴즈|방탈출|보드게임|대회|챌린지|투어|한끼|먹거리|야시장/,
  },
};

// ── 일반인이 그냥 놀러 가기 어려운 행사 ──
const KIDS = /어린이|유아|키즈|초등|아동|인형극|가족극|영유아|미취학/;
const ADULT_OK = /성인|누구나|전체|제한\s?없|일반|청년|시민|대학생|전\s?연령/;
const NOT_OUTING_TITLE = /모집|아카데미|인력\s?양성|양성\s?과정|정규\s?강좌|수강생|특수학급|북\s?큐레이션|온라인|일자리|취업|심포지엄|학술대회|어린이열람실/;
// 교육/체험 중 여러 주에 걸친 기수제 강좌 등
const NOT_OUTING_EDU = /교실|진로\s?탐색|지혜학교|인생학교|축제학교|문화예술교육|예술교육|지원사업|\d+\s?기\]|\[\d+\s?기|\d+\s?기,|\d+\s?기\s|사서|정기\s?예술교육|분기/;
// 특정 자격·소속이 있어야 참여 가능한 대상
const RESTRICTED_TARGET = /단체|학급|학교|고등학생|전공|경력|수료자|실무자|극작가|예술인|자립준비|중장년|노년|어르신|시니어|\d+\s?~\s?\d+세|거주|주민|회원|대학·대학원생|영화인/;
// 청소년·청년 전용 (성인·일반이 같이 적혀 있으면 허용)
const YOUTH_ONLY = /^(청소년|청년|중[ㆍ·,]?\s?고등)/;

const REASONS = {
  date: {
    night: '저녁에 둘이 산책 겸 들르기 좋아요',
    show: '분위기 있는 공연으로 데이트 코스 완성',
    exhibit: '천천히 걸으며 이야기 나누기 좋은 전시',
    festival: '함께 구경하며 걷기 좋은 축제',
    hands: '둘이 같이 만들고 추억 남기기 좋아요',
    talk: '둘이 함께 듣고 이야기 나누기 좋아요',
    default: '둘이 함께 가기 좋은 곳',
  },
  solo: {
    exhibit: '혼자 천천히 몰입하기 좋아요',
    talk: '혼자 가도 어색하지 않은 프로그램',
    show: '혼자 관람하기 편한 공연',
    hands: '혼자 가서 손으로 몰입하는 시간',
    night: '혼자 조용히 저녁 시간 보내기 좋아요',
    festival: '혼자 가볍게 둘러보기 좋아요',
    default: '나만의 시간 보내기 좋아요',
  },
  friends: {
    festival: '여럿이 왁자지껄 즐기기 좋아요',
    hands: '같이 만들고 체험하는 재미',
    show: '함께 신나게 즐기는 공연',
    exhibit: '같이 사진 찍고 구경하기 좋아요',
    night: '친구들과 저녁 나들이로 딱',
    talk: '같이 듣고 수다 떨기 좋은 프로그램',
    default: '친구들과 함께 가기 좋아요',
  },
};

const OUTDOOR = /야외|공원|광장|한강|거리|숲|정원|마당|운동장|산책|걷기|투어|탐방|둘레길|시장|노을|불꽃|캠핑|피크닉/;
const INDOOR_PLACE = /홀|극장|아트센터|미술관|박물관|도서관|센터|갤러리|기념관|과학관|아카이브|책방|공연장|씨어터|시어터|스튜디오|라운지|문화원|회관|플라자|관$/;

function kind(cat, text) {
  if (cat.startsWith('축제')) return 'festival';
  if (cat === '전시/미술') return 'exhibit';
  if (cat === '교육/체험') return /만들기|공방|체험|원데이|클래스|요리|뜨개|드로잉/.test(text) ? 'hands' : 'talk';
  if (/야경|야간|밤|불꽃|별빛|달빛|노을/.test(text)) return 'night';
  return 'show';
}

/** 일상 나들이로 보기 어려운 행사면 제외 사유를 돌려준다 */
export function excludeReason(r) {
  const title = r.TITLE || '';
  const target = (r.USE_TRGT || '').trim();
  if ((KIDS.test(title) || KIDS.test(target)) && !ADULT_OK.test(target)) return 'kids';
  if (NOT_OUTING_TITLE.test(title)) return 'not-outing-title';
  if (r.CODENAME === '교육/체험' && NOT_OUTING_EDU.test(title)) return 'not-outing-edu';
  if (RESTRICTED_TARGET.test(target) && !/누구나/.test(target)) return 'restricted-target';
  if (YOUTH_ONLY.test(target) && !/성인|누구나|일반|시민/.test(target)) return 'youth-only';
  return null;
}

export function isOutdoor(r) {
  const text = `${r.TITLE} ${r.PLACE ?? ''}`;
  if (INDOOR_PLACE.test((r.PLACE || '').trim())) return false;
  return (r.CODENAME || '').startsWith('축제') || OUTDOOR.test(text);
}

export function classify(r) {
  const cat = r.CODENAME || '';
  const text = `${r.TITLE} ${r.PROGRAM ?? ''} ${r.PLACE ?? ''}`;

  const scores = {};
  for (const [label, rule] of Object.entries(RULES)) {
    const kwHits = (text.match(new RegExp(rule.kw, 'g')) || []).length;
    scores[label] = (rule.cats[cat] ?? 0) + Math.min(kwHits, 2);
  }
  // 저녁 시간대(18시 이후) 프로그램은 데이트 가산점
  const hours = [...(r.PRO_TIME || '').matchAll(/(\d{1,2}):\d{2}/g)].map((m) => +m[1]);
  if (hours.some((h) => h >= 18)) scores.date += 1;
  if (r.IS_FREE === '무료') scores.solo += 0.5;

  // 동점이면 friends > date > solo 순으로 대표 라벨을 정해 지도 색이 한쪽으로 쏠리지 않게 한다
  const order = { friends: 0, date: 1, solo: 2 };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || order[a[0]] - order[b[0]]);
  const labels = ranked.filter(([, s]) => s >= 2).map(([l]) => l);
  if (!labels.length) labels.push(ranked[0][0]);

  const k = kind(cat, text);
  const top = labels[0];
  return { labels, reason: REASONS[top][k] ?? REASONS[top].default };
}
