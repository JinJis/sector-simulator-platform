# Milestone: Public Vision Builder, Gamification & Conceptual UX

This milestone enhances the **Sector Simulator Platform** with three primary capabilities:
1. **User-Facing Vision Builder**: Migrating the administrative wizard into a secure, user-facing, stateless multi-step wizard that respects private drafts and a community upvoting consensus before publication.
2. **User Tiering & Leveling (Gamification)**: Introducing user progression tiers (Explorer ➔ Practitioner ➔ Visionary ➔ Master) linked to active engagement, Stripe subscriptions, and XP progression.
3. **Conceptual Explanatory UX Toggles**: Introducing premium, domain-aware tooltips, modals, and toggle overlays explaining core mathematical and agentic principles (e.g., Liebig's Law of the Minimum, Signal Extractor delta calibration, Score Updater decay).

---

## 1. User-Facing Vision Builder & Consensus Publication

### Database Design
Extend the Prisma schema (`packages/db/prisma/schema.prisma`) to support private drafts and consensus upvoting:

```prisma
model Sector {
  // Existing fields...
  is_private         Boolean        @default(true) @map("is_private")
  upvotes_count      Int            @default(0) @map("upvotes_count")
  created_by_user_id String?        @map("created_by_user_id")
  created_by         User?          @relation(fields: [created_by_user_id], references: [id], onDelete: SetNull)
  upvotes            SectorUpvote[]

  @@index([is_private, created_by_user_id])
}

model SectorUpvote {
  id          String   @id @default(cuid())
  sector_slug String   @map("sector_slug")
  sector      Sector   @relation(fields: [sector_slug], references: [slug], onDelete: Cascade)
  user_id     String   @map("user_id")
  user        User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  created_at  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([sector_slug, user_id])
  @@index([sector_slug])
  @@index([user_id])
  @@map("sector_upvotes")
}
```

### tRPC Routing & Middleware (`services/sector-service/src/trpc/`)
1. **Auth Gate**: Introduce a `practitionerProcedure` helper in `init.ts` that verifies the caller is logged in and has a role/tier of `practitioner` or higher.
2. **Mutation: `visionBuilder.propose`**:
   * Authenticated call. Fetches existing slugs + global actor keys.
   * Triggers the agent-orchestration `/vision-builder/build` pipeline.
3. **Mutation: `visionBuilder.commit`**:
   * Commits the stateless payload.
   * Sets `is_private = true` by default when committed by a standard practitioner. 
   * Automatically populates `created_by_user_id = ctx.user.id`.
4. **Query Visibility Gate (`vision.list` / `sector.list`)**:
   * Guest/Explorer: Retrieves only `is_private: false` sectors.
   * Practitioner: Retrieves all `is_private: false` sectors, **plus** their own private drafts (`created_by_user_id == ctx.user.id`).
   * Visionary / Master: Retrieves all public sectors and **all** private drafts (moderator privilege).
5. **Mutation: `vision.upvote(slug)`**:
   * Inserts a record in `SectorUpvote`.
   * Increments `Sector.upvotes_count` in a transaction.
   * **Consensus Logic**: 
     * If the voter has `role == 'visionary'` or `'master'`, **OR**
     * If the `Sector.upvotes_count` reaches `N = 5` upvotes from other Practitioners:
     * Automatically set `is_private = false` (making it a public live vision).

### UI/UX Requirements (`apps/web/`)
* **Route**: `/visions/new`
* **Component**: Port the multi-step builder flow from SQLAdmin Jinja templates into standard Next.js JSX components (`apps/web/src/app/visions/new/page.tsx`):
  1. **Prompt Input Screen**: Elegant text area for the prompt + rich text editor for an optional research brief. Action triggers tRPC `visionBuilder.propose`.
  2. **Loading Stream Screen**: Employs the same polling strategy (fetching `/api/trpc/visionBuilder.progress` every 1.5s) to display live, animated stage updates (PromptValidator ➔ VisionDecomposition ➔ DataSourceSelector ➔ ValidationGate).
  3. **Review Panel**: Tabbed view showcasing the draft summary, capability tree DAG, risk mapping, and actor lists. Renders any validation warnings beautifully.
  4. **Stateless Commit**: Action buttons for **Commit Draft (Private)** and **Cancel/Refine**.

---

## 2. User Tiering & Leveling System (Gamification)

### Database Design
Extend the Prisma schema to capture user tiers, XP progression, and subscription status:

```prisma
enum UserTier {
  EXPLORER
  PRACTITIONER
  VISIONARY
  MASTER
}

model User {
  // Existing fields...
  tier          UserTier       @default(EXPLORER) @map("tier")
  xp            Int            @default(0) @map("xp")
  is_subscribed Boolean        @default(false) @map("is_subscribed")
  sectors       Sector[]
  upvotes       SectorUpvote[]
}
```

### Progression & Permission Matrix

| Tier | Unlock Method | Permissions Granted | XP Threshold |
|---|---|---|---|
| **Explorer** | Default on signup | Read-only access to public visions, live signals, and basic charts. | `0 XP` |
| **Practitioner** | Active Stripe subscription **OR** reaches XP threshold | Access to `/visions/new` (Vision Builder), upvoting other practitioners' visions. | `1,000 XP` |
| **Visionary** | Appointed by Masters **OR** 3 published public visions | Instant publicization of any sector with 1 upvote. Moderation queue access to review all drafts. | `5,000 XP` |
| **Master** | Admin env seed / flag | Global overrides, full access to SQLAdmin, managing crons/queue. | N/A |

### XP Earning Rules
Create an internal event handler helper `services/sector-service/src/lib/progression.ts`:
```typescript
export async function awardXP(prisma: PrismaClient, userId: string, action: string): Promise<void> {
  const xpGain = XP_REWARDS[action] || 0;
  if (xpGain === 0) return;

  // Update User XP, recalculate Tier if they cross the threshold,
  // and log in audit log.
}
```

#### XP Rewards Chart:
* `complete_profile`: `+50 XP`
* `submit_signal_feedback`: `+10 XP`
* `submit_community_proposal`: `+50 XP`
* `proposal_approved_by_moderator`: `+200 XP`
* `vision_committed`: `+100 XP`
* `vision_receives_upvote`: `+30 XP` (awarded to the creator of the Sector)

---

## 3. Conceptual Explanatory UX Toggles

Introduce rich, premium, interactive overlays that educate the user on the underlying complex feasibility equations and agent workflows.

### Educational Components to Add

#### 1. Liebig's Law of the Minimum (Feasibility Index)
* **UI Placement**: Located adjacent to the main **Feasibility Gauge** (the radial dial).
* **Interaction**: A subtle Info Icon `(?)` that reveals a popover or collapsible alert block explaining:
  > "The overall Vision Feasibility is governed by **Liebig's Law of the Minimum**. Rather than averaging the readiness of all capabilities, the gauge reflects the score of the most restrictive bottleneck capability. In short, a system is only as ready as its weakest link."
* **Visuals**: A micro-chart demonstrating an array of variables bounded by a low line representing the "Liebig threshold".

#### 2. Signal Extractor Score Delta Calibration
* **UI Placement**: Located on **Signal Row** details or under the "Live Pulse" overview page.
* **Interaction**: A sliding "How Delta is Determined" panel explaining the technical, economic, regulatory, and supply dimensions:
  * **`±1-2` (Incremental)**: Regional approvals, minor prototypes, or seed funding rounds.
  * **`±3-5` (Notable)**: Peer-reviewed breakthroughs, major commercial contracts, or national regulatory changes.
  * **`±6-10` (Structural)**: Paradigm shifts, major industry entries/exits, or international treaties.
* **Visuals**: Colour-coded pill charts mapping past signals to their respective magnitude scales.

#### 3. Ingestion & Scoring Lifespans (Decay Curve)
* **UI Placement**: On the **Capability Score Cards** or **Feasibility Timeline**.
* **Interaction**: Explanatory hovercard explaining the scoring engine:
  * **Weekly Crawlers**: Keyword-based sweeps across arXiv, Google News, and patents.
  * **Signal Extractors**: Flash-lite model scoring raw inputs to produce score deltas.
  * **Temporal Decay & Daily Updates**: The daily `recompute_feasibility` cron uses the ScoreUpdater agent to reconcile all recent delta vectors and decay historical confidence over time.
  * **Deep Research digests**: Premium high-effort Gemini research briefs generated daily to catch strategic context the crawler keyword sweeps missed.

### Component Implementation
* Rely exclusively on reusable React components in `packages/ui/` (incorporating `shadcn/ui` primitives: Tooltip, Dialog, Accordion, HoverCard).
* Ensure smooth CSS transitions (`transition-all duration-300 ease-in-out`) to ensure the explanation feels premium and integrated.

---

## Verification & Acceptance Criteria (Actionable Test List)

Future AI agents executing this milestone must satisfy the following:

### Section 1: Consensus Builder
- [ ] Upvoting a sector inserts a row in `SectorUpvote` and correctly increments the aggregate `upvotes_count` on the target `Sector` in a single transaction.
- [ ] Guest/Explorer users cannot see `is_private: true` sectors in list results.
- [ ] A practitioner can see their own `is_private: true` sectors in list results, but not others' private drafts.
- [ ] Casting an upvote as a `Visionary` instantly changes the sector's `is_private` flag to `false` in the database.
- [ ] Accumulating `5` upvotes from different Practitioners changes the sector's `is_private` flag to `false`.

### Section 2: User Tiering
- [ ] Reaching `1,000 XP` transitions a user's `tier` from `EXPLORER` to `PRACTITIONER` in the DB automatically.
- [ ] An `EXPLORER` attempting to POST to `/visions/new` or `visionBuilder.propose` is rejected with a `403 FORBIDDEN` or tRPC authentication error.
- [ ] Creating a sector successfully grants `+100 XP` to the user, verified via progression audit log logs.

### Section 3: Educational UX
- [ ] Clicking concept help buttons opens elegant, responsive popovers or overlays on mobile and desktop viewports.
- [ ] The explanation UI is free of placeholders and uses real-time data anchors where applicable.