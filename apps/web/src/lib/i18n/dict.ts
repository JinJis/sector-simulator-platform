/**
 * Translation registry — flat key → { ko, en } map.
 *
 * Strategy: not the full app — just the strings the user explicitly
 * sees on the most-used pages (header, /visions hero, /community hub,
 * settings). Inline-mixed Korean throughout the rest of the app stays
 * untouched for now; we extract as we touch each page.
 *
 * Convention: dot-namespaced keys like 'nav.visions'. Adding a new
 * string = appending one entry. Missing keys fall back to the key
 * itself (loud in dev, harmless in prod).
 */

export type Locale = "ko" | "en";

interface Entry {
  ko: string;
  en: string;
}

export const DICT: Record<string, Entry> = {
  // ---- Header --------------------------------------------------------
  "nav.visions": { ko: "Visions", en: "Visions" },
  "nav.community": { ko: "Community", en: "Community" },
  "header.brand": {
    ko: "Vision Feasibility Monitor",
    en: "Vision Feasibility Monitor",
  },
  "header.skipToContent": {
    ko: "본문으로 건너뛰기",
    en: "Skip to content",
  },

  // ---- User menu ----------------------------------------------------
  "menu.proposals": { ko: "＋ 제안 모음", en: "＋ Proposals" },
  "menu.predictions": { ko: "🎯 예측", en: "🎯 Predictions" },
  "menu.settings": { ko: "⚙ 설정", en: "⚙ Settings" },
  "menu.signOut": { ko: "로그아웃", en: "Sign out" },
  "menu.signIn": { ko: "로그인", en: "Sign in" },
  "menu.signUp": { ko: "가입", en: "Sign up" },

  // ---- /visions -----------------------------------------------------
  "visions.title": { ko: "Visions", en: "Visions" },
  "visions.live": { ko: "● Live", en: "● Live" },
  "visions.subtitle": {
    ko: "기술 가설을 0–100 점수로 추적합니다. 논문 · 특허 · 뉴스 · 공시가 들어올 때마다 capability 점수가 움직이고 비전 전체 점수가 갱신됩니다.",
    en: "Bold technology questions, scored 0–100 by source-grounded signals (papers · patents · news · filings). Each vision decomposes into capabilities — when the data moves, the feasibility score moves with it.",
  },
  "visions.featured": { ko: "★ Featured · 가장 활발한 비전", en: "★ Featured · most active" },
  "visions.allVisions": { ko: "전체 비전", en: "All visions" },
  "visions.empty": {
    ko: "이 도메인에 비전이 없습니다 — 다른 필터를 선택해보세요.",
    en: "No visions in this domain yet — try a different filter.",
  },
  "visions.footer": {
    ko: "Fixture-backed preview. Signal ingest cron이 매일 arXiv + USPTO + 뉴스로부터 capability 점수를 업데이트합니다.",
    en: "Fixture-backed preview. Signal ingest cron updates capability scores from arXiv + USPTO + news daily.",
  },
  "filter.all": { ko: "전체", en: "All" },

  // ---- /community --------------------------------------------------
  "community.badge": { ko: "👥 커뮤니티", en: "👥 Community" },
  "community.title": {
    ko: "제안하고, 예측하고, 평판을 쌓으세요",
    en: "Propose, predict, build reputation",
  },
  "community.subtitle": {
    ko: "드라이버 · 종목 · capability · 리스크 · actor · 시그널 소스까지, 섹터를 구성하는 어떤 요소든 근거와 함께 제안하고 다른 유저의 upvote를 받습니다. 또 1일 / 1주 / 1달 가격 밴드를 예측해서 난이도(Easy 10p / Medium 25p / Hard 50p)에 맞는 포인트를 획득하세요. 평판이 쌓이면 admin queue 가중치 + 직접 적용 권한이 점진적으로 열립니다.",
    en: "Suggest a driver · equity · capability · risk · actor · signal source — any element of a sector — with evidence and let other users upvote. Place 1-day / 1-week / 1-month price-band predictions and earn points by difficulty (Easy 10p / Medium 25p / Hard 50p). Reputation gradually unlocks admin-queue weight + direct-apply rights.",
  },
  "community.proposeCta": { ko: "＋ 제안하기", en: "＋ Propose a change" },
  "community.predictCta": { ko: "🎯 예측 등록", en: "🎯 Place a prediction" },
  "community.cards.hotProposals": { ko: "🔥 Hot proposals", en: "🔥 Hot proposals" },
  "community.cards.livePredictions": { ko: "🔴 Live predictions", en: "🔴 Live predictions" },
  "community.cards.leaderboard": { ko: "🏆 Leaderboard", en: "🏆 Leaderboard" },
  "community.cards.seeAll": { ko: "모두 보기 →", en: "See all →" },
  "community.cards.fullLeaderboard": {
    ko: "전체 리더보드 →",
    en: "Full leaderboard →",
  },
  "community.empty.proposals": {
    ko: "열린 제안이 아직 없습니다. 드라이버 / 종목 / capability 변경을 처음 제안해 보세요.",
    en: "No open proposals yet. Be the first to suggest a driver / equity / capability change.",
  },
  "community.empty.predictions": {
    ko: "베팅된 예측이 없습니다. 종목을 고르고 밴드를 베팅해 보세요 — Easy / Medium / Hard 자동 산정.",
    en: "No open predictions yet. Pick a stock and place a band — Easy / Medium / Hard auto-assigned.",
  },
  "community.empty.leaderboard": {
    ko: "아직 채점된 예측이 없습니다 — 첫 horizon이 마감되면 리더보드가 채워집니다.",
    en: "No resolved predictions yet — leaderboard fills in after the first horizon closes.",
  },

  // ---- Settings -----------------------------------------------------
  "settings.title": { ko: "설정", en: "Settings" },
  "settings.profile": { ko: "프로필", en: "Profile" },
  "settings.email": { ko: "이메일", en: "Email" },
  "settings.emailHint": {
    ko: "이메일 변경은 별도 절차 — 추후 지원 예정",
    en: "Email change handled separately — coming soon",
  },
  "settings.name": { ko: "이름", en: "Name" },
  "settings.locale": { ko: "언어 / Locale", en: "Language / Locale" },
  "settings.localeHint": {
    ko: "현재 가장 자주 쓰이는 화면(헤더 · /visions · /community · 설정)이 다국어를 지원합니다. 점진적으로 더 많은 페이지가 추가됩니다.",
    en: "The most-used surfaces (header, /visions, /community, settings) are translated. Other pages roll in progressively.",
  },
  "settings.theme": { ko: "테마", en: "Theme" },
  "settings.themeHint": {
    ko: "Dark / Light / System(OS 설정 따름). 변경은 즉시 적용됩니다.",
    en: "Dark / Light / System (follows OS). Changes apply immediately.",
  },
  "settings.themeDark": { ko: "Dark", en: "Dark" },
  "settings.themeLight": { ko: "Light", en: "Light" },
  "settings.themeSystem": { ko: "System", en: "System" },
  "settings.save": { ko: "저장", en: "Save" },
  "settings.savedOk": { ko: "저장됨", en: "Saved" },
  "settings.password": { ko: "비밀번호 변경", en: "Change password" },
  "settings.deleteAccount": { ko: "계정 삭제", en: "Delete account" },
  "settings.deleteAccountHint": {
    ko: "계정 삭제는 현재 수동 절차입니다 — 관리자에게 문의해 주세요. 자가 삭제는 추후 활성화됩니다.",
    en: "Account deletion is manual for now — contact an admin. Self-service deletion is coming.",
  },
};

export function translate(key: string, locale: Locale): string {
  const entry = DICT[key];
  if (!entry) {
    // Loud in dev — caller can spot the missing key. Prod silently
    // returns the key.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`i18n: missing translation for "${key}"`);
    }
    return key;
  }
  return entry[locale];
}
