/**
 * Translation registry — flat key → { ko, en } map.
 *
 * Voice:
 *   ko — 친근한 존댓말. 번역체 회피. 짧고 명확하게.
 *   en — concise, friendly, never robotic. Sentence case.
 *
 * Convention: dot-namespaced keys. Missing keys log in dev, return the
 * key in prod (loud-then-quiet — same approach as react-intl).
 */

export type Locale = "ko" | "en";

interface Entry {
  ko: string;
  en: string;
}

export const DICT: Record<string, Entry> = {
  // ---- Header --------------------------------------------------------
  "nav.visions": { ko: "비전", en: "Visions" },
  "nav.community": { ko: "커뮤니티", en: "Community" },
  "header.brand": {
    ko: "Vision Feasibility Monitor",
    en: "Vision Feasibility Monitor",
  },
  "header.skipToContent": { ko: "본문 바로가기", en: "Skip to content" },

  // ---- User menu ----------------------------------------------------
  "menu.proposals": { ko: "내 제안", en: "Proposals" },
  "menu.predictions": { ko: "내 예측", en: "Predictions" },
  "menu.settings": { ko: "설정", en: "Settings" },
  "menu.signOut": { ko: "로그아웃", en: "Sign out" },
  "menu.signIn": { ko: "로그인", en: "Sign in" },
  "menu.signUp": { ko: "회원가입", en: "Sign up" },

  // ---- /visions -----------------------------------------------------
  "visions.title": { ko: "비전", en: "Visions" },
  "visions.live": { ko: "● 실시간", en: "● Live" },
  "visions.subtitle": {
    ko: "어떤 기술이 실제로 실현될 수 있는지, 0–100 점수로 추적합니다. 논문 · 특허 · 뉴스 · 공시가 들어올 때마다 점수가 움직여요.",
    en: "Track how feasible each technology vision is — scored 0 to 100. Scores move when fresh papers, patents, news, and filings land.",
  },
  "visions.featured": { ko: "★ 지금 가장 활발한 비전", en: "★ Most active right now" },
  "visions.allVisions": { ko: "모든 비전", en: "All visions" },
  "visions.empty": {
    ko: "이 도메인엔 아직 비전이 없어요. 다른 필터를 골라보세요.",
    en: "Nothing here yet — try another domain.",
  },
  "visions.footer": {
    ko: "현재는 미리보기 데이터로 표시되고 있어요. 매일 arXiv · USPTO · 뉴스에서 점수가 새로 들어옵니다.",
    en: "Preview data for now. Capability scores refresh daily from arXiv, USPTO, and news.",
  },
  "filter.all": { ko: "전체", en: "All" },

  // Tile stats
  "tile.feasibility": { ko: "실현 가능성", en: "Feasibility" },
  "tile.capabilities": { ko: "Capability 수", en: "Capabilities" },
  "tile.signals30d": { ko: "최근 30일 신호", en: "30d signals" },
  "tile.eta": { ko: "예상 시점", en: "ETA" },
  "tile.binding": { ko: "병목", en: "Binding" },
  "tile.trending": { ko: "🔥 상승세", en: "🔥 Trending" },
  "tile.slowing": { ko: "⚠ 둔화", en: "⚠ Slowing" },

  // ---- /community --------------------------------------------------
  "community.badge": { ko: "👥 커뮤니티", en: "👥 Community" },
  "community.title": {
    ko: "함께 제안하고, 함께 예측하세요",
    en: "Propose, predict, build reputation together",
  },
  "community.subtitle": {
    ko: "드라이버 · 종목 · capability · 리스크 · actor · 시그널까지 — 섹터의 어떤 부분이든 근거와 함께 제안하고, 다른 분들의 업보트를 받아보세요. 1일 · 1주 · 1달 가격 베팅도 가능해요. 난이도(Easy 10p / Medium 25p / Hard 50p)에 따라 포인트가 적립되고, 평판이 쌓이면 권한이 점점 열립니다.",
    en: "Suggest a driver, a stock, a capability, a risk, an actor, or a signal source — anything that makes the sector data sharper. Place 1-day / 1-week / 1-month price-band bets. Difficulty auto-tags every prediction (Easy 10p / Medium 25p / Hard 50p), and reputation gradually unlocks more weight in the admin queue.",
  },
  "community.proposeCta": { ko: "＋ 제안하기", en: "＋ Propose a change" },
  "community.predictCta": { ko: "🎯 예측 등록", en: "🎯 Place a prediction" },
  "community.cards.hotProposals": { ko: "🔥 인기 제안", en: "🔥 Hot proposals" },
  "community.cards.livePredictions": { ko: "🔴 진행 중인 예측", en: "🔴 Live predictions" },
  "community.cards.leaderboard": { ko: "🏆 리더보드", en: "🏆 Leaderboard" },
  "community.cards.seeAll": { ko: "전체 보기 →", en: "See all →" },
  "community.cards.fullLeaderboard": { ko: "전체 리더보드 →", en: "Full leaderboard →" },
  "community.empty.proposals": {
    ko: "아직 열린 제안이 없어요. 첫 번째 제안을 올려보세요.",
    en: "No open proposals yet — be the first to drop one.",
  },
  "community.empty.predictions": {
    ko: "진행 중인 예측이 없어요. 종목을 골라 첫 베팅을 등록해 보세요.",
    en: "No live predictions yet — pick a stock and place the first bet.",
  },
  "community.empty.leaderboard": {
    ko: "아직 결과가 나온 예측이 없어요. 첫 마감일이 지나면 리더보드가 채워집니다.",
    en: "Leaderboard fills in after the first prediction resolves.",
  },

  // ---- /community/proposals (feed + detail) ------------------------
  "proposals.title": { ko: "커뮤니티 제안", en: "Community proposals" },
  "proposals.subtitle": {
    ko: "드라이버 · 종목 · capability · 리스크 · actor · 시그널 — 섹터를 더 정확하게 만드는 어떤 변경이든 제안할 수 있어요. 다른 분들이 업보트한 제안은 실제 데이터에 반영됩니다.",
    en: "Suggest any change that makes the sectors more accurate — drivers, equities, capabilities, risks, actors, or signal sources. Upvoted proposals get applied to the live data.",
  },
  "proposals.propose": { ko: "＋ 제안하기", en: "＋ Propose" },
  "proposals.tab.hot": { ko: "🔥 인기", en: "🔥 Hot" },
  "proposals.tab.new": { ko: "✨ 최신", en: "✨ New" },
  "proposals.empty.title": { ko: "아직 제안이 없네요", en: "No proposals yet" },
  "proposals.empty.hint": {
    ko: "첫 번째 제안을 올려보세요. 영구 링크 · 근거 카드 · 업보트 버튼이 자동으로 따라옵니다.",
    en: "Drop the first one. You get a permalink, evidence cards, and an upvote button automatically.",
  },
  "proposals.empty.cta": { ko: "제안 폼 열기 →", en: "Open the proposal form →" },
  "proposals.evidence": { ko: "근거 자료", en: "Evidence" },
  "proposals.proposedPayload": { ko: "제안 데이터", en: "Proposed payload" },
  "proposals.proposedPayloadHint": {
    ko: "승인되면 그대로 적용되는 원본 데이터예요. 관리자용 — 일반 독자는 넘겨도 됩니다.",
    en: "Raw data the applier uses on acceptance. Admin-grade detail — most readers can skip.",
  },
  "proposals.decision": { ko: "결정 내역", en: "Decision" },
  "proposals.voteHint": {
    ko: "업보트가 많아지면 자동으로 관리자 검토 큐로 올라갑니다.",
    en: "Highly-upvoted proposals get auto-promoted into the admin review queue.",
  },
  "proposals.upvoted": { ko: "업보트됨", en: "voted" },
  "proposals.upvote": { ko: "업보트", en: "upvote" },

  // ---- /community/predictions (feed + detail) ----------------------
  "predictions.title": { ko: "가격 예측", en: "Price predictions" },
  "predictions.subtitle": {
    ko: "1일 / 1주 / 1달 가격 밴드를 베팅해 보세요. 종목 변동성과 기간, 밴드 폭으로 난이도가 자동 정해집니다 — Easy 10p, Medium 25p, Hard 50p.",
    en: "Bet a 1-day / 1-week / 1-month price band. Difficulty is auto-assigned from horizon × volatility × spread — Easy 10p, Medium 25p, Hard 50p when you nail it.",
  },
  "predictions.placeCta": { ko: "🎯 예측 등록", en: "🎯 Place prediction" },
  "predictions.tab.live": { ko: "🔴 진행 중", en: "🔴 Live" },
  "predictions.tab.resolved": { ko: "✅ 마감", en: "✅ Resolved" },
  "predictions.tab.leaderboard": { ko: "🏆 리더보드", en: "🏆 Leaderboard" },
  "predictions.empty.live": {
    ko: "진행 중인 예측이 없어요. 첫 베팅을 등록해 보세요.",
    en: "No live predictions yet. Be the first.",
  },
  "predictions.empty.resolved": { ko: "마감된 예측이 없습니다.", en: "No resolved predictions yet." },
  "predictions.empty.leaderboard": {
    ko: "아직 채점된 예측이 없어요 — 첫 horizon이 지나면 리더보드가 채워집니다.",
    en: "Leaderboard fills in after the first horizon closes.",
  },
  "predictions.col.rank": { ko: "#", en: "#" },
  "predictions.col.user": { ko: "유저", en: "User" },
  "predictions.col.points": { ko: "총 포인트", en: "Total points" },
  "predictions.col.resolved": { ko: "마감 횟수", en: "Resolved" },
  "predictions.col.avg": { ko: "평균 정확도", en: "Avg score" },
  "predictions.detail.anchor": { ko: "현재가", en: "Anchor" },
  "predictions.detail.band": { ko: "예측 밴드", en: "Predicted band" },
  "predictions.detail.actual": { ko: "실제 종가", en: "Actual close" },
  "predictions.detail.resolvesAt": { ko: "마감", en: "Resolves at" },
  "predictions.detail.resolution": { ko: "결과", en: "Resolution" },
  "predictions.detail.whyTier": { ko: "난이도 산정", en: "Why this tier" },
  "predictions.detail.rationale": { ko: "근거", en: "Rationale" },
  "predictions.detail.miss": { ko: "miss", en: "miss" },

  // ---- Settings ----------------------------------------------------
  "settings.title": { ko: "설정", en: "Settings" },
  "settings.profile": { ko: "프로필", en: "Profile" },
  "settings.email": { ko: "이메일", en: "Email" },
  "settings.emailHint": {
    ko: "이메일 변경은 별도 절차로 안내해 드릴게요.",
    en: "Email change is handled separately — coming soon.",
  },
  "settings.name": { ko: "이름", en: "Name" },
  "settings.locale": { ko: "언어", en: "Language" },
  "settings.localeHint": {
    ko: "선택 즉시 적용됩니다. 일부 페이지는 점진적으로 다국어가 확대돼요.",
    en: "Applies right away. Some pages still mix languages — coverage rolls in progressively.",
  },
  "settings.theme": { ko: "테마", en: "Theme" },
  "settings.themeHint": {
    ko: "Dark · Light · System (운영체제 설정 따라감). 즉시 적용됩니다.",
    en: "Dark · Light · System (follows your OS). Applies immediately.",
  },
  "settings.themeDark": { ko: "Dark", en: "Dark" },
  "settings.themeLight": { ko: "Light", en: "Light" },
  "settings.themeSystem": { ko: "System", en: "System" },
  "settings.save": { ko: "저장", en: "Save" },
  "settings.savedOk": { ko: "저장됨", en: "Saved" },
  "settings.password": { ko: "비밀번호 변경", en: "Change password" },
  "settings.deleteAccount": { ko: "계정 삭제", en: "Delete account" },
  "settings.deleteAccountHint": {
    ko: "지금은 관리자에게 문의해 주세요. 자가 삭제는 추후 활성화됩니다.",
    en: "Contact an admin for now — self-service deletion is coming.",
  },

  // ---- Wizard shared -----------------------------------------------
  "wizard.back": { ko: "← 이전", en: "← Back" },
  "wizard.next": { ko: "다음 →", en: "Next →" },
  "wizard.step": { ko: "단계", en: "Step" },
  "wizard.publishing": { ko: "올리는 중…", en: "Publishing…" },
  "wizard.placing": { ko: "등록 중…", en: "Placing…" },

  // ---- Proposal wizard --------------------------------------------
  "proposal.new.title": { ko: "새 제안 작성", en: "New proposal" },
  "proposal.new.subtitle": {
    ko: "5단계 — 종류 고르기 → 섹터 고르기 → 본문 → AI가 상세 자동 채움 (확인만) → 근거 첨부.",
    en: "Five steps — pick a kind, pick a sector, write the gist, AI fills the details (just confirm), attach evidence.",
  },
  "proposal.new.backLink": { ko: "← 제안 목록", en: "← Proposals" },
  "proposal.steps.kind": { ko: "종류", en: "Kind" },
  "proposal.steps.sector": { ko: "섹터", en: "Sector" },
  "proposal.steps.describe": { ko: "설명", en: "Describe" },
  "proposal.steps.details": { ko: "AI 상세", en: "AI details" },
  "proposal.steps.evidence": { ko: "근거", en: "Evidence" },
  "proposal.kind.heading": { ko: "어떤 걸 제안하시겠어요?", en: "What are you proposing?" },
  "proposal.kind.subheading": {
    ko: "섹터의 어떤 부분을 추가하거나 바꾸고 싶은지 골라주세요. 카드를 누르면 다음 단계로 넘어가요.",
    en: "Pick the kind of change you want to make. Tapping a card moves to the next step.",
  },
  "proposal.kind.selected": { ko: "선택됨", en: "selected" },
  "proposal.kind.add_driver.title": { ko: "드라이버 추가", en: "Add driver" },
  "proposal.kind.add_driver.blurb": { ko: "시뮬레이터에 새 슬라이더", en: "New slider on the simulator" },
  "proposal.kind.add_driver.example": { ko: "예: 라드-하드 칩 수율 %", en: "e.g. rad-hard chip yield %" },
  "proposal.kind.add_equity.title": { ko: "종목 추가", en: "Add equity" },
  "proposal.kind.add_equity.blurb": { ko: "섹터에 새 상장사 추가", en: "New listed company on a sector" },
  "proposal.kind.add_equity.example": { ko: "예: memory-semi에 TSMC", en: "e.g. add TSMC to memory-semi" },
  "proposal.kind.add_capability.title": { ko: "Capability 추가", en: "Add capability" },
  "proposal.kind.add_capability.blurb": { ko: "비전에 새 capability + 점수", en: "New vision capability + score" },
  "proposal.kind.add_capability.example": { ko: "예: 양자 오류 정정", en: "e.g. quantum error correction" },
  "proposal.kind.add_risk.title": { ko: "리스크 추가", en: "Add risk" },
  "proposal.kind.add_risk.blurb": { ko: "외부 · 정치 · 공급망 위험", en: "External / political / supply" },
  "proposal.kind.add_risk.example": { ko: "예: ITAR 수출 통제", en: "e.g. ITAR export controls" },
  "proposal.kind.add_actor.title": { ko: "Actor 추가", en: "Add actor" },
  "proposal.kind.add_actor.blurb": { ko: "회사 · 연구소 · 정부 기관", en: "Company · lab · gov body" },
  "proposal.kind.add_actor.example": { ko: "예: space-data-center에 JPL", en: "e.g. add JPL to space-data-center" },
  "proposal.kind.add_signal_source.title": { ko: "시그널 추가", en: "Add signal source" },
  "proposal.kind.add_signal_source.blurb": { ko: "데이터 수집용 키워드", en: "New keyword set for ingest" },
  "proposal.kind.add_signal_source.example": {
    ko: "예: arXiv에 \"solid-state battery\"",
    en: "e.g. \"solid-state battery\" for arXiv",
  },
  "proposal.kind.edit.title": { ko: "기존 수정", en: "Edit existing" },
  "proposal.kind.edit.blurb": { ko: "이미 있는 항목 손보기", en: "Fix or refine something" },
  "proposal.kind.edit.example": { ko: "예: Samsung 소개 업데이트", en: "e.g. update Samsung's blurb" },
  "proposal.kind.other.title": { ko: "자유 제안", en: "Freeform" },
  "proposal.kind.other.blurb": { ko: "그 외 — 관리자가 검토", en: "Anything else — admin reviews" },
  "proposal.kind.other.example": { ko: "자동 적용 안 됨", en: "Won't auto-apply" },
  "proposal.sector.heading": { ko: "어느 비전 / 섹터에 해당하나요?", en: "Which vision or sector?" },
  "proposal.sector.subheading": {
    ko: "이 제안이 적용될 비전을 골라주세요.",
    en: "Pick the vision this proposal affects.",
  },
  "proposal.sector.empty": {
    ko: "비전 목록을 불러오지 못했어요. 새로고침해 보세요.",
    en: "Couldn't load visions — try refreshing.",
  },
  "proposal.describe.heading": { ko: "내용을 적어주세요", en: "Tell us about it" },
  "proposal.describe.subheading": {
    ko: "제목은 한 줄로 핵심을, 본문은 왜 이게 중요한지를 짧게 설명해 주세요.",
    en: "Title: a one-liner of the change. Body: why it matters, in a short paragraph.",
  },
  "proposal.describe.targetRef": { ko: "수정 대상 키", en: "Target key" },
  "proposal.describe.targetRefHint": {
    ko: "Driver 이름 · ticker · capability key 등 기존 항목의 식별자",
    en: "Identifier of the existing item — driver name, ticker, capability key",
  },
  "proposal.describe.title": { ko: "제목", en: "Title" },
  "proposal.describe.titleMinErr": { ko: "조금 더 길게 적어주세요", en: "A bit more, please" },
  "proposal.describe.body": { ko: "본문 — 왜 이게 중요한가요?", en: "Body — why does this matter?" },
  "proposal.describe.bodyMinErr": { ko: "조금 더 자세히 적어주세요", en: "A few more words, please" },
  "proposal.payload.heading": {
    ko: "AI가 채운 상세 — 확인만 해주세요",
    en: "AI-drafted details — just review",
  },
  "proposal.payload.subheading": {
    ko: "제목과 본문을 보고 가벼운 LLM이 구조화 필드를 채웠어요. 마음에 안 들면 [다시 생성] 또는 직접 편집할 수 있어요.",
    en: "A light LLM filled the structured fields from your title + body. Hit Regenerate if it's off, or edit by hand.",
  },
  "proposal.payload.editOtherHint": {
    ko: "이 종류는 구조화 필드가 없어요. 본문과 근거만으로 관리자가 검토해 반영합니다.",
    en: "No structured fields for this kind — admins decide from your body + evidence.",
  },
  "proposal.payload.loading": {
    ko: "초안 생성 중… (한두 초)",
    en: "Drafting… (a second or two)",
  },
  "proposal.payload.regenerate": { ko: "다시 생성", en: "Regenerate" },
  "proposal.payload.editManually": { ko: "직접 편집하기", en: "Edit manually" },
  "proposal.payload.draftCost": {
    ko: "생성 비용",
    en: "Draft cost",
  },
  "proposal.payload.draftFailed": {
    ko: "초안 생성 실패 — 직접 편집해주세요",
    en: "Drafting failed — please fill in manually",
  },
  "proposal.review.heading": { ko: "근거 첨부 + 최종 확인", en: "Evidence + final review" },
  "proposal.review.subheading": {
    ko: "근거가 풍부할수록 빨리 채택돼요. URL · 노트 모두 가능 (이미지 · PDF 업로드는 곧 추가됩니다).",
    en: "More evidence = faster acceptance. URLs and notes work today; PDF / image upload is coming.",
  },
  "proposal.review.evidence": { ko: "근거 자료", en: "Evidence" },
  "proposal.review.evidenceAddNote": { ko: "+ 노트", en: "+ note" },
  "proposal.review.evidenceAddUrl": { ko: "+ URL", en: "+ URL" },
  "proposal.review.evidenceEmpty": {
    ko: "아직 근거가 없어요. URL 또는 노트로 보탬을 추가해 주세요.",
    en: "No evidence yet — add a URL or a note.",
  },
  "proposal.review.publishCta": { ko: "제안 올리기 →", en: "Publish proposal →" },
  "proposal.review.recap": { ko: "올리기 전에 확인하세요", en: "Before you publish" },
  "proposal.review.recapKind": { ko: "종류", en: "Kind" },
  "proposal.review.recapSector": { ko: "섹터", en: "Sector" },
  "proposal.review.recapTitle": { ko: "제목", en: "Title" },
  "proposal.review.recapEvidence": { ko: "근거 자료", en: "Evidence" },
  "proposal.review.recapPreview": { ko: "본문 + payload 미리보기", en: "Preview body + payload" },
  "proposal.review.recapEmpty": { ko: "(미입력)", en: "(empty)" },

  // ---- Prediction wizard ------------------------------------------
  "prediction.new.title": { ko: "새 예측 등록", en: "Place a prediction" },
  "prediction.new.subtitle": {
    ko: "3단계 — 종목 고르기 → 기간 + 가격 밴드 설정 → 확인 후 등록. 난이도는 자동으로 정해져요.",
    en: "Three quick steps — pick a stock, set horizon + price band, confirm. Difficulty is auto-assigned.",
  },
  "prediction.new.backLink": { ko: "← 예측 목록", en: "← Predictions" },
  "prediction.steps.stock": { ko: "종목", en: "Stock" },
  "prediction.steps.bet": { ko: "베팅", en: "Bet" },
  "prediction.steps.review": { ko: "확인", en: "Review" },
  "prediction.stock.heading": { ko: "어떤 종목으로 베팅할까요?", en: "Which stock?" },
  "prediction.stock.subheading": {
    ko: "섹터를 먼저 고르면 그 섹터의 종목 카드가 나타나요.",
    en: "Pick a sector first and its equities show up below.",
  },
  "prediction.stock.sectorLabel": { ko: "섹터", en: "Sector" },
  "prediction.stock.equityLabel": { ko: "종목", en: "Equities" },
  "prediction.stock.filter": { ko: "ticker · 회사명 검색", en: "Filter by ticker / name" },
  "prediction.stock.empty": { ko: "이 섹터에 종목이 없어요.", en: "No equities in this sector." },
  "prediction.bet.heading": { ko: "베팅 조건을 정하세요", en: "Set your bet" },
  "prediction.bet.subheading": {
    ko: "기간 + 가격 밴드를 정하면 난이도와 예상 보상이 바로 미리 보입니다.",
    en: "Pick horizon + band and the tier + max reward update live.",
  },
  "prediction.bet.horizon": { ko: "기간", en: "Horizon" },
  "prediction.bet.horizon.1d.label": { ko: "1일", en: "1 day" },
  "prediction.bet.horizon.1d.sub": { ko: "내일 종가 기준 (Hard)", en: "Next trading day (Hard)" },
  "prediction.bet.horizon.1w.label": { ko: "1주일", en: "1 week" },
  "prediction.bet.horizon.1w.sub": { ko: "7일 안에", en: "Within 7 days" },
  "prediction.bet.horizon.1m.label": { ko: "1개월", en: "1 month" },
  "prediction.bet.horizon.1m.sub": { ko: "30일 안에", en: "Within 30 days" },
  "prediction.bet.spread": { ko: "밴드 폭", en: "Band width" },
  "prediction.bet.offset": { ko: "방향성", en: "Direction" },
  "prediction.bet.offsetHint": {
    ko: "0% = 현재가 주변. + 는 상승, − 는 하락 예측.",
    en: "0% = centered on current. + means up, − means down.",
  },
  "prediction.bet.previewTitle": { ko: "난이도 + 보상 미리보기", en: "Difficulty + reward preview" },
  "prediction.bet.previewComputing": { ko: "계산 중…", en: "computing…" },
  "prediction.bet.previewEmpty": { ko: "밴드를 조정해 주세요.", en: "Adjust the band to preview." },
  "prediction.bet.previewMaxReward": { ko: "최대 보상", en: "max reward" },
  "prediction.bet.previewVol": { ko: "변동성 σ", en: "σ" },
  "prediction.review.heading": { ko: "확인 후 등록하세요", en: "Confirm and place" },
  "prediction.review.subheading": {
    ko: "한 번 등록한 예측은 마감일까지 수정 · 취소할 수 없어요.",
    en: "Once placed, predictions can't be edited or cancelled until they resolve.",
  },
  "prediction.review.placeCta": { ko: "🎯 베팅 등록 →", en: "🎯 Place prediction →" },
  "prediction.review.horizon": { ko: "기간", en: "Horizon" },
  "prediction.review.anchor": { ko: "기준가", en: "Anchor" },
  "prediction.review.bandMin": { ko: "밴드 하단", en: "Band min" },
  "prediction.review.bandMax": { ko: "밴드 상단", en: "Band max" },
  "prediction.review.maxReward": { ko: "최대 보상", en: "Max reward" },
  "prediction.review.vol": { ko: "연 변동성", en: "σ /yr" },

  // ── Proposal payload — common labels ───────────────────────────────
  "payload.name": { ko: "이름", en: "Name" },
  "payload.nameSnake": { ko: "이름 (snake_case)", en: "Name (snake_case)" },
  "payload.group": { ko: "그룹", en: "Group" },
  "payload.unit": { ko: "단위", en: "Unit" },
  "payload.default": { ko: "기본값", en: "Default" },
  "payload.min": { ko: "최솟값", en: "Min" },
  "payload.max": { ko: "최댓값", en: "Max" },
  "payload.description": { ko: "설명", en: "Description" },
  "payload.iso2": { ko: "ISO 국가 (대문자 2자)", en: "ISO country (2 uppercase letters)" },
  "payload.iso2Short": { ko: "ISO 국가 (2자)", en: "ISO country (2 letters)" },

  // add_driver
  "payload.driver.descPh": {
    ko: "이 드라이버가 무엇을 조정하는지 한두 문장으로 적어주세요.",
    en: "One or two lines on what this driver controls.",
  },

  // add_equity
  "payload.equity.companyName": { ko: "회사명", en: "Company name" },
  "payload.equity.sectorExposure": { ko: "섹터 노출 (%)", en: "Sector exposure (%)" },
  "payload.equity.rationale": { ko: "포함 근거", en: "Inclusion rationale" },
  "payload.equity.rationalePh": {
    ko: "왜 이 종목이 이 섹터의 핵심 swing 종목인지 한 단락으로.",
    en: "A short paragraph on why this is a key swing name in the sector.",
  },

  // add_capability
  "payload.cap.descPh": {
    ko: "이 capability가 기술적으로 무엇인지 설명해주세요.",
    en: "Describe what this capability is, technically.",
  },
  "payload.cap.rationale": { ko: "비전에 왜 필요한가", en: "Why the vision needs it" },
  "payload.cap.rationalePh": {
    ko: "이 capability가 부족할 때 비전 전체가 어떻게 영향을 받는지.",
    en: "How the whole vision is affected if this capability is missing.",
  },
  "payload.cap.weight": { ko: "가중치 (0.02-0.50)", en: "Weight (0.02-0.50)" },
  "payload.cap.initTech": { ko: "초기 Technical (0-100)", en: "Initial Technical (0-100)" },
  "payload.cap.initEcon": { ko: "초기 Economic", en: "Initial Economic" },
  "payload.cap.initReg": { ko: "초기 Regulatory", en: "Initial Regulatory" },
  "payload.cap.initSupply": { ko: "초기 Supply", en: "Initial Supply" },

  // add_risk
  "payload.risk.descPh": {
    ko: "이 위험이 비전에 어떻게 영향을 미치는지 한두 줄로.",
    en: "A line or two on how this risk affects the vision.",
  },
  "payload.risk.affected": {
    ko: "영향받는 capability keys (콤마 구분)",
    en: "Affected capability keys (comma-separated)",
  },

  // add_actor
  "payload.actor.blurb": { ko: "Blurb (한 줄 설명)", en: "Blurb (one-liner)" },
  "payload.actor.blurbPh": {
    ko: "예: Foundry 1위, 3nm 양산.",
    en: "e.g. Foundry leader, 3nm in volume production.",
  },
  "payload.actor.signals": {
    ko: "Signal 키워드 (콤마 구분)",
    en: "Signal keywords (comma-separated)",
  },

  // add_signal_source
  "payload.sig.capability": { ko: "대상 Capability key", en: "Target capability key" },
  "payload.sig.arxiv": {
    ko: "arXiv 키워드 (콤마 구분, 필수)",
    en: "arXiv keywords (comma-separated, required)",
  },
  "payload.sig.uspto": {
    ko: "USPTO 키워드 (선택)",
    en: "USPTO keywords (optional)",
  },
  "payload.sig.news": {
    ko: "뉴스 키워드 (선택)",
    en: "News keywords (optional)",
  },

  // Evidence textarea
  "proposal.review.evidenceFreeformPh": {
    ko: "자유 형식으로 근거를 적어주세요 (한 단락).",
    en: "Free-form supporting note (one paragraph).",
  },

  // ── Settings page extras ───────────────────────────────────────────
  "settings.passwordSection": { ko: "비밀번호 변경", en: "Change password" },
  "settings.currentPw": { ko: "현재 비밀번호", en: "Current password" },
  "settings.newPw": { ko: "새 비밀번호", en: "New password" },
  "settings.newPwHint": { ko: "8자 이상", en: "8+ characters" },
  "settings.changeCta": { ko: "변경", en: "Update" },
  "settings.changing": { ko: "변경 중…", en: "Updating…" },
  "settings.changeOk": {
    ko: "✓ 변경되었어요 — 다른 디바이스의 세션은 모두 만료됩니다.",
    en: "✓ Updated — sessions on other devices are now signed out.",
  },
  "settings.changeFail": { ko: "변경 실패", en: "Update failed" },
  "settings.newPwTooShort": {
    ko: "새 비밀번호는 8자 이상이어야 해요.",
    en: "New password must be at least 8 characters.",
  },

  "settings.appSection": { ko: "앱", en: "App" },
  "settings.replayOnboarding": { ko: "↻ 가이드 다시 보기", en: "↻ Replay onboarding" },
  "settings.replayHint": {
    ko: "핵심 페이지 4-5개를 다시 둘러봐요.",
    en: "Walks you through the 4-5 key pages again.",
  },

  "settings.dangerSection": { ko: "위험 구역", en: "Danger zone" },
  "settings.dangerHint": {
    ko: "계정 삭제는 지금은 수동입니다 — 관리자에게 문의해 주세요. 셀프 삭제는 곧 추가됩니다.",
    en: "Account deletion is manual for now — please contact admin. Self-delete is coming.",
  },

  "settings.currentPlan": { ko: "현재 플랜", en: "Current plan" },
  "settings.premiumActiveRenew": {
    ko: "Premium 사용 중이에요. 다음 갱신일",
    en: "Premium active. Renews on",
  },
  "settings.willCancel": {
    ko: " (다음 갱신일에 해지 예정)",
    en: " (will cancel on next renewal)",
  },
  "settings.freePlanBetaHint": {
    ko: "Free 플랜에서는 기본 섹터(메모리·우주·SOFC)를 모두 둘러볼 수 있어요. 에이전트로 시뮬레이터를 직접 만드는 기능은 베타 동안 모두에게 무료이고, 정식 출시 후엔 Premium 전용으로 바뀝니다.",
    en: "On Free you get full access to the base sectors (Memory · Space · SOFC). Agent-driven simulator creation is free for everyone during the beta and will move to Premium-only at launch.",
  },
  "settings.freePlanNonBeta": {
    ko: "에이전트로 시뮬레이터를 직접 만들고, 우선 응답과 더 넉넉한 월별 사용량을 받으려면 Premium으로 업그레이드하세요.",
    en: "Upgrade to Premium for agent-driven simulator creation, priority response, and a higher monthly quota.",
  },
  "settings.opening": { ko: "여는 중…", en: "Opening…" },
  "settings.managePayment": { ko: "결제 관리", en: "Manage billing" },
  "settings.openingCheckout": { ko: "결제 페이지 여는 중…", en: "Opening checkout…" },
  "settings.upgradePremium": { ko: "★ Premium 업그레이드", en: "★ Upgrade to Premium" },
  "settings.premiumFreeBeta": { ko: "★ Premium (베타 중 무료)", en: "★ Premium (free during beta)" },
  "settings.checkoutHintReady": { ko: "Stripe Checkout으로 이동합니다.", en: "Continues to Stripe Checkout." },
  "settings.checkoutHintNotConfigured": {
    ko: "결제 시스템이 아직 연결되지 않았어요. 베타 동안은 무료로 쓰실 수 있어요.",
    en: "Billing isn't wired up yet. Enjoy it free during the beta.",
  },
  "settings.checkoutStartFail": { ko: "결제 시작 실패", en: "Checkout failed to start" },
  "settings.portalOpenFail": { ko: "Portal 열기 실패", en: "Failed to open billing portal" },

  "settings.monthlyAgentUsage": { ko: "이번 달 에이전트 사용량", en: "This month — agent usage" },
  "settings.usageLoading": { ko: "불러오는 중…", en: "Loading…" },
  "settings.premiumQuota": { ko: "★ Premium 한도", en: "★ Premium quota" },
  "settings.freeQuota": { ko: "Free 한도", en: "Free quota" },
  "settings.remaining": { ko: "남은 한도", en: "Remaining" },
  "settings.betaMessage": {
    ko: "🎁 베타 기간 — 에이전트 시뮬레이터 만들기를 모두에게 무료로 열어두고 있어요. 정식 출시 후엔 Premium 사용자에게 매월 ",
    en: "🎁 Beta — agent-driven simulator creation is free for everyone. After launch, Premium users get a monthly quota of ",
  },
  "settings.afterRelease": { ko: " 한도가 부여됩니다.", en: "." },
  "settings.freeNoAgent": {
    ko: "Free 플랜에서는 에이전트 시뮬레이터 만들기를 사용할 수 없어요. Premium으로 업그레이드하면 매월 사용량 한도가 생깁니다.",
    en: "Agent-driven simulator creation isn't available on Free. Upgrade to Premium for a monthly quota.",
  },
  "settings.concurrentLimit": { ko: "동시 실행 한도", en: "Concurrent limit" },
  "settings.currentlyRunning": { ko: "현재 실행 중", en: "Currently running" },
  "settings.runs": { ko: "개", en: "" },
  "settings.unlockAgentByUpgrade": {
    ko: "★ Premium으로 업그레이드하면 에이전트 기능이 열립니다.",
    en: "★ Upgrade to Premium to unlock agent features.",
  },

  // ── Auth: login / signup ───────────────────────────────────────────
  "auth.login.title": { ko: "로그인", en: "Sign in" },
  "auth.login.subtitle": {
    ko: "계정으로 로그인해 주세요.",
    en: "Sign in to continue.",
  },
  "auth.login.cta": { ko: "로그인", en: "Sign in" },
  "auth.login.submitting": { ko: "로그인 중…", en: "Signing in…" },
  "auth.login.fail": { ko: "로그인에 실패했어요.", en: "Sign-in failed." },
  "auth.login.noAccount": { ko: "아직 계정이 없으신가요?", en: "No account yet?" },
  "auth.login.signupLink": { ko: "가입하기", en: "Create one" },
  "auth.email": { ko: "이메일", en: "Email" },
  "auth.password": { ko: "비밀번호", en: "Password" },

  "auth.signup.title": { ko: "가입하기", en: "Create account" },
  "auth.signup.subtitle": {
    ko: "익명으로 둘러보는 것도 가능하지만, 가입하시면 시나리오 · 그래프 편집 이력이 본인 명의로 남아요.",
    en: "You can explore anonymously, but signing up keeps your scenario and graph edits attributed to you.",
  },
  "auth.signup.cta": { ko: "가입하기", en: "Sign up" },
  "auth.signup.submitting": { ko: "가입 중…", en: "Creating account…" },
  "auth.signup.fail": { ko: "가입에 실패했어요.", en: "Sign-up failed." },
  "auth.signup.pwTooShort": {
    ko: "비밀번호는 8자 이상이어야 해요.",
    en: "Password must be at least 8 characters.",
  },
  "auth.signup.haveAccount": { ko: "이미 계정이 있으신가요?", en: "Already have an account?" },
  "auth.signup.loginLink": { ko: "로그인", en: "Sign in" },
  "auth.signup.nameOptional": { ko: "이름 (선택)", en: "Name (optional)" },
  "auth.signup.namePlaceholder": { ko: "홍길동", en: "Jane Doe" },
  "auth.signup.tos": {
    ko: "가입하면 이용 약관과 개인정보 처리방침에 동의한 것으로 간주돼요. (약관은 준비 중)",
    en: "By signing up you agree to our terms and privacy policy. (Terms still being drafted.)",
  },

  "settings.pageTitle": { ko: "설정", en: "Settings" },
  "settings.pageSubtitle": {
    ko: "계정 정보, 환경설정, 보안.",
    en: "Account, preferences, and security.",
  },

  // ── Manual simulator panel ─────────────────────────────────────────
  "manual.outputsSubtitle": {
    ko: "현재 슬라이더 값으로 계산했어요",
    en: "Calculated from current slider values",
  },
  "manual.simulating": { ko: "시뮬레이션 실행 중…", en: "Running simulation…" },
  "manual.initFromLive": {
    ko: "라이브 데이터로 드라이버 초기화",
    en: "Initialize drivers from live data",
  },
  "manual.sensitivityHint": {
    ko: "드라이버를 min↔max로 휘둘렀을 때 결과의 변화 폭. 막대가 길수록 그 드라이버에 더 민감해요.",
    en: "How much each output swings when its driver is moved min↔max. Longer bars = more sensitive.",
  },

  // ── Page tour modal ────────────────────────────────────────────────
  "tour.openTitle": { ko: "이 페이지 둘러보기", en: "Tour this page" },
  "tour.openShort": { ko: "도움말", en: "Tour" },
  "tour.close": { ko: "닫기", en: "Close" },
  "tour.prev": { ko: "이전", en: "Back" },
  "tour.next": { ko: "다음 →", en: "Next →" },

  // ── Onboarding modal ───────────────────────────────────────────────
  "onboarding.guideLabel": { ko: "Vision Monitor — 3분 가이드", en: "Vision Monitor — 3-minute tour" },
  "onboarding.skip": { ko: "건너뛰기", en: "Skip" },
  "onboarding.step1.heading": {
    ko: "어떤 기술 비전이 가장 궁금하세요?",
    en: "Which tech vision are you most curious about?",
  },
  "onboarding.step1.sub": {
    ko: "하나 고르시면, 이 플랫폼이 그 비전의 실현 가능성을 어떻게 추적하는지 함께 살펴볼게요.",
    en: "Pick one and we'll walk through how this platform tracks its feasibility.",
  },
  "onboarding.step2.question": { ko: "The question", en: "The question" },
  "onboarding.step2.context": {
    ko: "이 비전은 약 10개의 capability(기술 · 경제 · 규제 · 공급)로 쪼개지고, 각 capability는 매일 들어오는 신호(논문 · 특허 · 뉴스 · 공시)에 따라 점수가 갱신돼요. 다음 화면에서 현재 상태를 5초 만에 읽는 법을 알려드릴게요.",
    en: "This vision breaks into ~10 capabilities (tech · economic · regulatory · supply). Each gets a score updated daily by incoming signals (papers, patents, news, filings). Next: how to read the current state in 5 seconds.",
  },
  "onboarding.step2.back": { ko: "← 다른 비전 보기", en: "← Pick another" },
  "onboarding.step2.next": { ko: "5초 만에 읽는 법 →", en: "Read it in 5 seconds →" },
  "onboarding.step3.heading": { ko: "5초 만에 읽는 법", en: "How to read it in 5 seconds" },
  "onboarding.step3.sub": {
    ko: "각 비전의 Hero 페이지 맨 위에는 숫자 세 개가 있어요. 그것만 봐도 80%는 이해돼요.",
    en: "Three numbers sit at the top of every vision's Hero page — they get you 80% of the way.",
  },
  "onboarding.step3.feasibility": { ko: "현재", en: "Feasibility" },
  "onboarding.step3.feasibilityHint": {
    ko: "지금 얼마나 가까운지. 0 = 불가능, 100 = 상용화.",
    en: "How close it is right now. 0 = impossible, 100 = commercial.",
  },
  "onboarding.step3.delta": { ko: "최근 90일", en: "Last 90 days" },
  "onboarding.step3.deltaHint": {
    ko: "지난 90일 동안 점수가 어디로 움직였는지.",
    en: "Which direction the score moved over the last 90 days.",
  },
  "onboarding.step3.eta": { ko: "예상 도달", en: "ETA (median)" },
  "onboarding.step3.etaHint": {
    ko: "현재 추세가 이어지면 도달 예상 연도.",
    en: "Expected year if the current trend holds.",
  },
  "onboarding.step3.binding": { ko: "Binding", en: "Binding" },
  "onboarding.step3.bindingHint": {
    ko: "비전 점수의 천장을 결정하는 capability. 이걸 끌어올리는 신호가 가장 큰 영향을 줘요.",
    en: "The capability that caps the whole vision's score. Signals that lift this one move the needle the most.",
  },
  "onboarding.step3.full": {
    ko: "Hero 페이지에는 이 외에도 capability 카드(4-차원 막대), 리스크 보드, 최근 24h 신호 피드, 경제성 곡선이 함께 보여요. Playground 탭에서 직접 가정을 조정해볼 수도 있어요.",
    en: "The Hero page also has capability cards (4-dim bars), risk board, last-24h signal feed, and a cost curve. The Playground tab lets you tweak assumptions yourself.",
  },
  "onboarding.step3.back": { ko: "← 질문 다시 보기", en: "← Back to question" },
  "onboarding.step3.finishPrefix": { ko: "", en: "Open " },
  "onboarding.step3.finishSuffix": { ko: " 직접 보기 →", en: " →" },

  // Vision taglines / briefs (used by onboarding cards)
  "vision.space-data-center.tagline": { ko: "궤도에 컴퓨트가 떠 있는 시점", en: "When orbital compute becomes real" },
  "vision.space-data-center.brief": {
    ko: "발사 비용이 더 떨어지고, 광학 다운링크가 자리잡고, 우주 방사선에 견디는 칩이 동시에 준비돼야 가능해져요. 지금 가장 큰 병목은 라드-하드 칩이에요.",
    en: "Needs launch cost down, optical downlink ready, and rad-hard compute all maturing together. The big blocker right now is rad-hard chips.",
  },
  "vision.memory-semi.tagline": { ko: "HBM 사이클이 끊기지 않는다면", en: "If the HBM cycle keeps running" },
  "vision.memory-semi.brief": {
    ko: "AI 학습/추론 수요가 메모리 capex를 끌어가는 구조가 얼마나 오래 갈지. 가격 · 점유 · 신규 capa가 동시에 움직여요.",
    en: "How long AI training/inference demand keeps pulling memory capex. Price, share, and new capacity all move together.",
  },
  "vision.sofc.tagline": { ko: "SOFC가 그리드 패리티에 닿는 시점", en: "When SOFC hits grid parity" },
  "vision.sofc.brief": {
    ko: "AI 데이터센터의 전력 수요와 탄소 가격 상승이 SOFC 경제성을 끌어올리지만, 스택 수명과 양산 비용이 아직 큰 변수예요.",
    en: "AI-driven power demand and rising carbon prices help the economics, but stack lifetime and manufacturing cost are still the swing factors.",
  },
  "vision.binding.tbd": { ko: "곧 공개 (M38 시드)", en: "TBD (M38 seed)" },

  // ── Vision sub-nav + breadcrumb ────────────────────────────────────
  // 8 sub-tabs collapsed to 4 (overview / players-progress / pulse /
  // playground). Risks + economics inline on overview; capabilities +
  // actors merge into players-progress; signals + sources merge into
  // pulse. Legacy labels stay so the old sub-pages still render headers
  // for deep-linked URLs until the merged pages fully absorb them.
  "subnav.overview": { ko: "한눈에 보기", en: "Overview" },
  "subnav.players-progress": { ko: "Players · Progress", en: "Players & Progress" },
  "subnav.pulse": { ko: "Pulse", en: "Pulse" },
  "subnav.playground": { ko: "Playground", en: "Playground" },
  "subnav.capabilities": { ko: "Capability", en: "Capabilities" },
  "subnav.actors": { ko: "주요 플레이어", en: "Actors" },
  "subnav.signals": { ko: "신호", en: "Signals" },
  "subnav.risks": { ko: "리스크", en: "Risks" },
  "subnav.economics": { ko: "경제성", en: "Economics" },
  "subnav.sources": { ko: "출처", en: "Sources" },

  // ── Vision hero overview ───────────────────────────────────────────
  "hero.feasibilityEmpty": { ko: "아직 점수가 계산되지 않았어요.", en: "Feasibility not yet computed." },
  "hero.trajectory": { ko: "최근 추이", en: "Trajectory" },
  "hero.sixMonthsAgo": { ko: "6개월 전", en: "6mo ago" },
  "hero.today": { ko: "오늘", en: "today" },
  "hero.etaWindow": { ko: "예상 시점", en: "ETA window" },
  "hero.confidence": { ko: "신뢰도", en: "Confidence" },
  "hero.confidence.high": { ko: "높음", en: "high" },
  "hero.confidence.medium": { ko: "보통", en: "medium" },
  "hero.confidence.low": { ko: "낮음", en: "low" },
  "hero.countCapabilities": { ko: "개 Capability", en: "capabilities" },
  "hero.count30dSignals": { ko: "개 신호 (30일)", en: "signals · 30d" },
  "hero.countRisks": { ko: "개 리스크", en: "risks" },
  "hero.section.capabilities": { ko: "Capability", en: "Capabilities" },
  "hero.section.actors": { ko: "주요 플레이어", en: "Actors" },
  "hero.section.economics": { ko: "경제성", en: "Economics" },
  "hero.section.riskBoard": { ko: "리스크 보드", en: "Risk board" },
  "hero.section.liveSignals": { ko: "라이브 신호", en: "Live signals" },
  "hero.section.capabilityRadar": { ko: "Capability 레이더", en: "Capability radar" },
  "hero.section.timeline": { ko: "Feasibility 추이", en: "Feasibility timeline" },
  "actors.bubble.title": { ko: "Actor 분포", en: "Actor relevance × signal volume" },
  "actors.bubble.empty": {
    ko: "차트 가능한 데이터가 없습니다 (relevance + 90d 신호 필요).",
    en: "Not enough chartable data yet (needs relevance + 90d signals).",
  },
  "hero.viewAll": { ko: "전체 보기 →", en: "View all →" },
  "hero.fullBoard": { ko: "전체 보드 →", en: "Full board →" },
  "hero.fullCurves": { ko: "전체 곡선 →", en: "Full curves →" },
  "hero.activeActors": { ko: "활동 중", en: "Active" },
  "hero.emptyTree": {
    ko: "이 비전은 등록만 되어 있고, capability 트리는 아직 분해되지 않았어요. 직접 큐레이션은 M38, 에이전트 자동 생성은 M41에 들어옵니다.",
    en: "This vision is registered but its capability tree hasn't been decomposed yet. Hand-curation lands in M38, agent generation in M41.",
  },
  "hero.dataSource": { ko: "데이터 출처", en: "Data source" },
  "hero.dataSource.db": { ko: "라이브 DB", en: "live DB" },
  "hero.dataSource.fixture": {
    ko: "미리보기 (M37 fixture · sector-service 미연결)",
    en: "M37 fixture (sector-service unreachable)",
  },

  // Tile labels missing from above
  "tile.feasibilityShort": { ko: "Feasibility", en: "Feasibility" },
  "tile.last90d": { ko: "90일", en: "90d" },

  // Capability detail
  "capability.rationale": { ko: "근거", en: "Rationale" },
  "capability.noUpstream": { ko: "상위 의존성이 없어요.", en: "No upstream dependencies." },
  "capability.noDownstream": { ko: "하위 의존성이 없어요.", en: "No downstream dependents." },
  "capability.loadFail": {
    ko: "capability를 불러오지 못했어요",
    en: "Couldn't load capability",
  },
  "capability.weight": { ko: "가중치", en: "Weight" },
  "capability.primaryDriver": { ko: "주요 드라이버", en: "Primary driver" },
  "capability.displayOrder": { ko: "표시 순서", en: "Display order" },
  "capability.currentReadiness": { ko: "현재 readiness", en: "Current readiness" },
  "capability.asOf": { ko: "기준일", en: "as of" },
  "capability.composite": { ko: "종합 점수", en: "Composite" },
  "capability.scoreEmpty": {
    ko: "아직 점수가 계산되지 않았어요. M40 점수 엔진이 채워줍니다.",
    en: "Score not yet computed. M40 scoring engine populates current readiness.",
  },
  "capability.trajectoryTitle": { ko: "추이", en: "Trajectory" },
  "capability.trajectorySnapshots": { ko: "스냅샷", en: "snapshots" },
  "capability.whyMatters": {
    ko: "이 비전에서 왜 중요한가",
    en: "Why this matters for the vision",
  },
  "capability.dependenciesTitle": { ko: "의존성", en: "Dependencies" },
  "capability.dependsOn": { ko: "필요로 하는 것 (이게 있어야 함)", en: "Depends on (this needs)" },
  "capability.dependedOnBy": {
    ko: "이걸 필요로 하는 것",
    en: "Depended on by (these need this)",
  },
  "capability.activeActors": { ko: "활동 중인 플레이어", en: "Active actors" },
  "capability.actorsEmpty": {
    ko: "아직 actor가 연결되지 않았어요 — M45b에서 채워집니다.",
    en: "No actors wired yet — M45b populates these.",
  },
  "capability.signalFeedFooter": {
    ko: "이 capability에 필터링된 신호 피드는 M39와 함께 옵니다.",
    en: "Signal feed filtered to this capability lands with M39.",
  },

  // Risks sub-page
  "risks.title": { ko: "리스크 보드", en: "Risk board" },
  "risks.empty": {
    ko: "리스크 큐레이션은 capability 분해(M38)와 함께 들어옵니다.",
    en: "Risk curation lands with capability decomposition in M38.",
  },
  "risks.activeCount": { ko: "개 활성", en: "active." },
  "risks.matrixComing": {
    ko: "심각도 × 가능성 매트릭스와 대응 방안 drill-down은 M38에 들어옵니다.",
    en: "Severity × likelihood matrix + mitigation drill-down land in M38.",
  },

  // Economics sub-page
  "economics.title": { ko: "경제성", en: "Economics" },
  "economics.coming": {
    ko: "비용 곡선 · 단위 경제성 · 손익분기 민감도가 곧 들어옵니다.",
    en: "Cost curves + unit economics + break-even sensitivity — coming soon.",
  },

  // Sources sub-page
  "sources.title": { ko: "출처", en: "Sources" },
  "sources.subtitle": {
    ko: "이 비전 페이지의 모든 숫자는 출처가 있어요. 논문 · 특허 · 뉴스 · 공시 · 정부 보고서 · 벤더 문서 · 데이터셋을 모두 모은 통합 색인은 M39 신호 수집과 함께 들어와요. 지금은 최근 신호의 출처만 보여드려요.",
    en: "Every number on this Vision page is source-grounded. The full aggregated index (papers, patents, news, filings, gov reports, vendor docs, datasets) lands with the M39 signal ingest. For now, here are the sources behind the recent signals.",
  },
  "sources.empty": { ko: "출처 통합은 M39에 들어옵니다.", en: "Source aggregation lands in M39." },

  // Signals filter
  "signals.filter.allCapabilities": { ko: "모든 capability", en: "All capabilities" },
  "signals.filter.allSources": { ko: "모든 출처", en: "All sources" },
  "signals.filter.papers": { ko: "📄 논문", en: "📄 Papers" },
  "signals.filter.patents": { ko: "📜 특허", en: "📜 Patents" },
  "signals.filter.news": { ko: "📰 뉴스", en: "📰 News" },
  "signals.filter.filings": { ko: "📑 공시", en: "📑 Filings" },
  "signals.filter.govReports": { ko: "🏛 정부 보고서", en: "🏛 Govt reports" },
  "signals.filter.vendorDocs": { ko: "🔧 벤더 문서", en: "🔧 Vendor docs" },
  "signals.filter.capability": { ko: "Capability", en: "Capability" },
  "signals.filter.source": { ko: "출처", en: "Source" },
  "signals.filter.highlightsOnly": { ko: "하이라이트만", en: "Highlights only" },
  "signals.filter.apply": { ko: "적용", en: "Apply" },
  "signals.filter.clear": { ko: "초기화", en: "clear" },
  "signals.feed.title": { ko: "신호 피드", en: "Signal feed" },
  "signals.feed.subtitle": {
    ko: "추출기 에이전트가 arXiv · USPTO · NewsAPI 신호를 채점해요. capability · 출처 · 하이라이트로 필터링할 수 있어요.",
    en: "arXiv + USPTO + NewsAPI signals scored by the extractor agent. Filter by capability, source, or highlights only.",
  },
  "signals.fixtureNote": {
    ko: " (미리보기 — sector-service 미연결)",
    en: " (preview data — sector-service unreachable)",
  },
  "signals.empty": {
    ko: "이 필터에 맞는 신호가 없어요. 필터를 초기화해 보세요.",
    en: "No signals match. Try clearing the filters.",
  },
  "signals.start": { ko: "← 처음으로", en: "← Start" },
  "signals.older": { ko: "이전 →", en: "Older →" },
  "signals.showingPrefix": { ko: "신호", en: "showing" },
  "signals.showingSuffix": { ko: "개 표시", en: "" },
  "signals.liveDb": { ko: " · 라이브 DB", en: " · live DB" },

  // What-if Feasibility callout
  "whatif.current": { ko: "현재", en: "Current" },
  "whatif.projected": { ko: "예상", en: "Projected" },
  "whatif.title": { ko: "What-if 실현 가능성", en: "What-if vision feasibility" },
  "whatif.hint": {
    ko: "드라이버를 움직일 때, 연결된 capability의 technical 점수가 같은 비율로 움직인다고 가정한 예상치예요. 시뮬레이션 결과가 아닌 UX 힌트입니다.",
    en: "Assumes each driver shifts its capability's technical score proportionally. UX hint, not a sim output.",
  },
  "whatif.atDefault": { ko: "기본값 그대로", en: "sliders at default" },
  "whatif.techSuffix": { ko: " tech", en: " tech" },
  "prediction.review.rationale": { ko: "근거 (선택)", en: "Rationale (optional)" },
  "prediction.review.rationaleHint": {
    ko: "왜 이 베팅이 합리적인지 한두 줄 — 실적 발표, 가격 setup, 뉴스 등.",
    en: "A line or two on why — earnings, technicals, news, whatever you want.",
  },
  "prediction.review.rationalePlaceholder": {
    ko: "예: TSMC 11월 매출 가이드 상향 + 차세대 노드 양산 임박. 7일 내 +5% 가능.",
    en: "e.g. TSMC raised November revenue guide + next-gen node ramp imminent. +5% within 7 days.",
  },
};

export function translate(key: string, locale: Locale): string {
  const entry = DICT[key];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`i18n: missing translation for "${key}"`);
    }
    return key;
  }
  return entry[locale];
}
