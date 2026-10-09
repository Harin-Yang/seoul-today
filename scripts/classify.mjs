// 규칙 기반 라벨 분류: date(데이트) / solo(혼놀) / friends(친구와)
// 카테고리 점수 + 키워드 점수가 2점 이상이면 라벨을 붙이고, 최소 1개는 보장한다.

const RULES = {
  date: {
    cats: { '전시/미술': 2, '뮤지컬/오페라': 3, '연극': 3, '콘서트': 2, '클래식': 2, '영화': 2, '무용': 2,
      '독주/독창회': 1, '국악': 1, '축제-자연/경관': 3, '축제-문화/예술': 1 },
    kw: /야경|불꽃|빛|조명|정원|재즈|미디어\s?아트|로맨|커플|와인|한강|별빛|달빛|야간|밤|산책|플라워|꽃|가을|낭만|사랑|연애|피크닉|노을/,
  },
  solo: {
    cats: { '전시/미술': 3, '영화': 2, '클래식': 2, '독주/독창회': 2, '국악': 2, '교육/체험': 2, '무용': 1, '연극': 1 },
    kw: /강연|특강|강좌|북\s?토크|인문|도서관|책|명상|힐링|사진|원데이|드로잉|글쓰기|아카이브|소장품|개인전|상영|리사이틀|독주|토크|세미나|요가/,
  },
  friends: {
    cats: { '축제-시민화합': 3, '축제-문화/예술': 2, '축제-전통/역사': 2, '축제-기타': 3, '축제-자연/경관': 1,
      '콘서트': 2, '교육/체험': 1, '뮤지컬/오페라': 1 },
    kw: /페스티벌|축제|마켓|장터|파티|게임|댄스|버스킹|체험|만들기|공방|푸드|맥주|러닝|달리기|스포츠|EDM|힙합|락|록|밴드|퀴즈|방탈출|보드게임|대회|챌린지/,
  },
};

const KIDS = /어린이|유아|키즈|초등|아동|인형극|가족극|영유아|미취학/;
const ADULT_OK = /성인|누구나|전체|제한\s?없|일반|청년|시민|대학생/;

const REASONS = {
  date: {
    night: '저녁 산책 겸 둘이 들르기 좋아요',
    show: '분위기 있는 공연으로 데이트 코스 완성',
    exhibit: '천천히 걸으며 이야기 나누기 좋은 전시',
    festival: '함께 구경하며 걷기 좋은 축제',
    default: '둘이 함께 가기 좋은 곳',
  },
  solo: {
    exhibit: '혼자 천천히 몰입하기 좋아요',
    talk: '혼자 가도 어색하지 않은 프로그램',
    show: '혼자 관람하기 편한 공연',
    default: '나만의 시간 보내기 좋아요',
  },
  friends: {
    festival: '여럿이 왁자지껄 즐기기 좋아요',
    hands: '같이 만들고 체험하는 재미',
    show: '함께 신나게 즐기는 공연',
    default: '친구들과 함께 가기 좋아요',
  },
};

function kind(cat, text) {
  if (cat.startsWith('축제')) return 'festival';
  if (cat === '전시/미술') return 'exhibit';
  if (cat === '교육/체험') return /만들기|공방|체험|원데이|클래스/.test(text) ? 'hands' : 'talk';
  if (/야경|야간|밤|불꽃|별빛|달빛|노을/.test(text)) return 'night';
  return 'show';
}

export function classify(r) {
  const cat = r.CODENAME || '';
  const text = `${r.TITLE} ${r.PROGRAM ?? ''} ${r.PLACE ?? ''}`;
  const target = r.USE_TRGT || '';
  if ((KIDS.test(r.TITLE) || KIDS.test(target)) && !ADULT_OK.test(target)) return null;

  const scores = {};
  for (const [label, rule] of Object.entries(RULES)) {
    const kwHits = (text.match(new RegExp(rule.kw, 'g')) || []).length;
    scores[label] = (rule.cats[cat] ?? 0) + Math.min(kwHits, 2);
  }
  if (r.IS_FREE === '무료') scores.solo += 0.5;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const labels = ranked.filter(([, s]) => s >= 2).map(([l]) => l);
  if (!labels.length) labels.push(ranked[0][0]);

  const k = kind(cat, text);
  const top = labels[0];
  const reason = REASONS[top][k] ?? REASONS[top].default;
  return { labels, reason };
}
