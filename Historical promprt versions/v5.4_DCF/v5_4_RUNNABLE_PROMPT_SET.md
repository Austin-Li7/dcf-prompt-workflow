# ══════════════════════════════════════════════════════════
# FINANCIAL VALUATION PIPELINE — v5.4 RUNNABLE PROMPT SET
# 基于全流程优化蓝图 — 重点：数值闭环 + 低披露 fallback + 指令密度控制 + Light Mode 实质简化
# ══════════════════════════════════════════════════════════
#
# v5.3 → v5.4 变更摘要:
#   [P1] Step 5: Arithmetic Trace — assumption registry 必须包含数值推导链
#   [P1] Step 5: Segment-Only Fallback — 低披露公司自动切换 segment-level 预测
#   [P1] Step 3: 拆分为 3A (Competitor Pairing) + 3B (Porter's Forces) — 降低指令密度
#   [P1] Light Mode: Steps 3/4/5 独立简化 generation prompts
#   [P2] Step 2: Restatement History Depth — CAGR lookback 限于 restated period
#   [P2] Step 4.5: Asset-Light Threshold — CapEx/Rev < 8% → ceiling [NOT_APPLICABLE]
#   [P2] Steps 2-7: 每个 generation prompt 加入 name consistency 一行指令
#   [P2] Step 4: Differentiation default [WEAK_INFERENCE] + Flywheel 必须引用 Step 2
#   [P3] Step 7: Light Mode 合并 Checkpoint A+C
#   [P3] 因果纪律指令去重 — 仅在 header 定义，Steps 3/4 引用
#
# 保留自 v5.3:
#   Full/Light Mode 分层 + Canonical Name Registry + Revenue Ceiling + Mid-Horizon Check
#   Y/Y Growth Arithmetic + Cross-Model Penalty + Seasonality Check + CapEx Ceiling Check
#
# 保留自 v5.2:
#   Step 7 参数级 source-fit + Checkpoint E/F + Source Provenance + AUTO-BLOCK gates
#   Step 4 Causal language 分类表
#
# 保留自 v5.1:
#   Step 7 Checkpoint C/D + Source Tier + Pipeline Audit independent recalculation
#   Self-Contradiction Detection + Data Resolution + Driver Eligibility 量化
#   Snippet Coverage Rule + Market Share Scope + Capital Feasibility
#
# ════════════════════════════════════════
# EXECUTION MODE (v5.4 — REDESIGNED)
# ════════════════════════════════════════
#
# FULL MODE (investment committee deliverables, complex companies):
#   - All generation steps (🔴) with full field counts
#   - All checkpoints (🟢), all CSF audits (🟡), all cross-model (🔵)
#   - Step 3 = 3A + 3B (competitor pairing + Porter's)
#   - Step 4 = three-split (integration + differentiation + causality) + flywheel
#   - Step 5 = quarterly × product/segment, full assumption registry
#   - Step 7 = 6 checkpoints
#   - Pipeline audit = 7 sections, 8+ claim spot-checks
#   - Estimated: 18-25 model calls, 4-6 hours
#
# LIGHT MODE (screening, internal research, fast iteration):
#   ⭐ v5.4: Light Mode uses SIMPLIFIED generation prompts, not just fewer checks
#   - Step 3 = 3A ONLY (competitor pairing + rivalry). Skip Porter's (3B).
#     Drop source provenance fields. Keep tier classification only.
#   - Step 4 = TWO-SPLIT (integration + causality). Skip differentiation + flywheel.
#   - Step 5 = SEGMENT-LEVEL forecast only. Simplified assumption registry (5 fields).
#     Wider default ranges.
#   - Step 7 = 3 checkpoints (A/C merged, B, F)
#   - CSF audits (🟡) — SKIP
#   - Cross-model (🔵) — SKIP (claims tagged [SINGLE_MODEL_UNVERIFIED])
#   - Pipeline audit = 3 sections (structural, laundering, weak-inference), 5-claim spot-check
#   - Estimated: 10-14 model calls, 2-3 hours
#
# REQUIRED IN BOTH MODES (never skip):
#   🟢 Step 1 Checkpoint A (segment count) + B (name match)
#   🟢 Step 2 Checkpoint C (zero fabrication)
#   🟢 Step 4 Checkpoint B (three/two-split completeness) + C (self-contradiction)
#   🟢 Step 5 Checkpoint A (baseline) + B (summation) + D (driver eligibility)
#   🟢 Step 7 Checkpoint B (input cross-verify) + F (parameter completeness)
#   🔵 Pipeline Audit (at least 5-claim version)
#
# 使用方法:
# 1. 每个 Step 按标注的模型执行
# 2. 🔴 = 高级模型 (Claude Opus / GPT-4o)
# 3. 🟢 = 基础模型 (Gemini Flash / Haiku / GPT-4o-mini)
# 4. 🟡 = 另一个高级模型做审稿 (与🔴不同)
# 5. 🔵 = 另一个高级模型独立生成 (与🔴不同)
# 6. 每个 Step 必须通过 Gate 才能进入下一步
#
# Evidence Level 定义 (全流程统一):
#   [DISCLOSED]         = filing 原文直接说的
#   [STRONG_INFERENCE]   = 从披露数据一步推导
#   [WEAK_INFERENCE]     = 多步推理或因果假设
#   [UNSUPPORTED]        = 无 filing 依据
#
# Claim 输出规则 (全流程统一):
#   每条事实性 claim 必须输出为结构化条目:
#     claim_id / claim_text / source_snippet / source_location / evidence_level
#   然后才组装成 narrative 或 table
#
# 因果纪律 (全流程统一):
#   如果 source 没有使用因果语言 (caused, drove, resulted in, due to, because of),
#   则 claim 必须改写为相关性/可能性:
#     ❌ "AI drove Azure revenue growth"
#     ✅ "Azure revenue growth coincided with AI feature rollout [WEAK_INFERENCE]"


# ════════════════════════════════════════
# STEP 1 — Business Architecture
# ════════════════════════════════════════

# ──────────────────────────
# 🔴 STEP 1 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Task: Business Architecture Breakdown
# Company: [INSERT TICKER]

## Scope
Map the complete business structure based on official SEC filings:
- Reported operating segments
- Business lines within each segment
- Product families and specific offerings
- Revenue generation mechanics

## Sources
1. Most recent Form 10-K
2. Most recent 10-Q or earnings press release

## Rules
- Base segmentation STRICTLY on official reporting structure
- Do NOT estimate revenue, margins, or performance
- Do NOT provide valuation commentary

## Output Method: CLAIMS FIRST, THEN ASSEMBLE

You must output in two phases:

### Phase 1: Structured Claims
Output every factual assertion as a structured claim BEFORE writing any narrative.

For each segment and product, output:

```
CLAIM: [claim_id]
TEXT: [the factual statement]
SOURCE_SNIPPET: [exact quote or table row from filing that supports this]
SOURCE_LOCATION: [filing name, section, page number]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
```

Example:
```
CLAIM: S1-001
TEXT: Microsoft reports three operating segments: Productivity and Business Processes, Intelligent Cloud, and More Personal Computing.
SOURCE_SNIPPET: "We report our financial performance based on the following segments: Productivity and Business Processes, Intelligent Cloud, and More Personal Computing."
SOURCE_LOCATION: 10-K FY2025, Note 19 — Segment Information, p.87
EVIDENCE_LEVEL: DISCLOSED
```

Rules for claims:
- Every segment name → one claim with source snippet
- Every product/category → one claim with source snippet
- Every customer type assertion → one claim
- If you cannot find a source snippet → mark [UNSUPPORTED] and DO NOT include in final architecture
- If product is on website but not in filing → mark [IR_ONLY] and note separately
- If product is only in press release → mark [PRESS_RELEASE_ONLY]

### ⭐ Snippet Coverage Rule (v5.1 — HARD RULE)
If a claim TEXT lists N specific product names, the SOURCE_SNIPPET must contain
at least (N-1) of those product names verbatim.

If the snippet contains only the CATEGORY name but not the individual products:
→ Split into two claims:
  1. Category-level claim (DISCLOSED) — "The segment includes [category name]"
  2. Product-list claim (STRONG_INFERENCE) — "This category comprises [product1, product2, ...]"
     with source_snippet from wherever the individual products ARE listed (may be
     multiple locations), and note: "Products assembled from multiple filing locations"

Do NOT mark a product-list claim as [DISCLOSED] unless the snippet contains
the complete product list in one contiguous passage.

### Phase 2: Architecture Assembly
After all claims are listed, assemble them into the architecture JSON.
ONLY include items that have [DISCLOSED] or [STRONG_INFERENCE] claims.

```json
{
  "architecture": [
    {
      "segment": "Exact Name",
      "claim_id": "S1-001",
      "source_snippet": "exact quote",
      "source_location": "10-K FY2025, Note 19, p.87",
      "evidence_level": "DISCLOSED",
      "offerings": [
        {
          "category": "Name",
          "products": ["A", "B"],
          "claim_id": "S1-003",
          "source_snippet": "exact quote",
          "source_location": "10-K FY2025, p.12",
          "evidence_level": "DISCLOSED",
          "customer_type": "Enterprise"
        }
      ]
    }
  ],
  "excluded_items": [
    {
      "name": "Product X",
      "reason": "IR_ONLY — not found in any SEC filing",
      "claim_id": "S1-015"
    }
  ],
  "self_check": {
    "segments_in_10K_footnote": N,
    "segments_in_output": N,
    "match": true,
    "claims_DISCLOSED": X,
    "claims_STRONG_INFERENCE": Y,
    "claims_WEAK_INFERENCE": Z,
    "claims_UNSUPPORTED_excluded": W
  }
}
```

## Boundary Rules
- Mid-year acquisition not yet broken out → [PENDING_BREAKOUT]
- Segment structure changed → use NEW structure, note [RESTATED]
- Product discontinued → [DISCONTINUED as of YYYY-QN]
- Cannot determine segment mapping → [UNMAPPED] — do NOT guess

### ⭐ Canonical Name Registry (v5.3 — NEW)

After the architecture JSON, output a name registry that ALL subsequent
steps MUST use. This prevents name drift across steps.

```json
{
  "canonical_names": {
    "segments": [
      {"canonical": "Productivity and Business Processes", "abbreviation": "PBP", "claim_id": "S1-001"},
      {"canonical": "Intelligent Cloud", "abbreviation": "IC", "claim_id": "S1-002"},
      {"canonical": "More Personal Computing", "abbreviation": "MPC", "claim_id": "S1-003"}
    ],
    "products_with_data": [
      {"canonical": "Office Commercial", "parent_segment": "Productivity and Business Processes", "claim_id": "S1-004"}
    ]
  }
}
```

HARD RULE: In Steps 2-7, every reference to a segment or product
MUST use either the canonical name or the listed abbreviation.
Any other variant (e.g., "Cloud" for "Intelligent Cloud") is a
STRUCTURAL VIOLATION that the Pipeline Audit will flag.
"""


# ──────────────────────────
# 🟢 STEP 1 CHECKPOINT A — Segment Count
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a counter. Do NOT analyze, explain, or add any commentary.

Task: Read the following text from a 10-K filing's segment footnote.
Count the number of REPORTABLE OPERATING SEGMENTS mentioned.

--- START 10-K TEXT ---
[PASTE: 10-K segment information footnote]
--- END 10-K TEXT ---

Reply with ONLY a single number. Nothing else.
"""


# ──────────────────────────
# 🟢 STEP 1 CHECKPOINT B — Segment Name Match
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a text matcher. Do NOT analyze, explain, or add any commentary.

Task: Check if each segment name in List A appears in Text B.
An exact match or officially stated alternative name counts as FOUND.

List A (segment names from AI report):
1. [segment_1]
2. [segment_2]
3. [segment_3]

Text B (from 10-K segment disclosure):
--- START ---
[PASTE: 10-K segment disclosure paragraph]
--- END ---

Reply ONLY in this format:
1. FOUND or NOT_FOUND
2. FOUND or NOT_FOUND
3. FOUND or NOT_FOUND
"""


# ──────────────────────────
# 🟢 STEP 1 CHECKPOINT C — Source Snippet Verification
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a quote verifier. Do NOT analyze, explain, or add commentary.

Task: For each claim below, check if the SOURCE_SNIPPET actually
appears in the provided filing text.

Claim 1:
  SNIPPET: "[exact quote from claim S1-001]"
  CLAIMED LOCATION: [10-K FY2025, p.87]

Claim 2:
  SNIPPET: "[exact quote from claim S1-003]"
  CLAIMED LOCATION: [10-K FY2025, p.12]

[repeat for 5 randomly selected claims]

Filing text:
--- START ---
[PASTE: relevant 10-K pages]
--- END ---

For each claim, reply ONLY:
1. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
2. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
...
"""


# ──────────────────────────
# 🟡 STEP 1 CLAIM-SUPPORT-FIT AUDIT
# Model: Different advanced model from 🔴
# ──────────────────────────

"""
You are a skeptical financial auditor. You did NOT write this report.

## Task
For each claim below, evaluate whether the source snippet
actually supports the full claim.

## Claims to audit:
[PASTE: all claims from Step 1 Phase 1 output]

## For each claim, answer:

1. SUPPORTED PORTION: Which part of the claim text is directly
   stated in the source snippet? Be specific.

2. UNSUPPORTED PORTION: Which part goes beyond the snippet?
   Types: NONE / CATEGORY_ASSIGNMENT / CUSTOMER_TYPE / SCOPE / PRODUCT_LIST_ASSEMBLED

3. EVIDENCE LEVEL CHECK: Is the assigned evidence level correct?
   - If claim says [DISCLOSED] but snippet doesn't directly state it → OVERLABELED
   - If claim says [STRONG_INFERENCE] but it requires multiple assumptions → OVERLABELED
   - ⭐ SNIPPET COVERAGE CHECK (v5.1): If claim lists N products but snippet 
     contains fewer than N-1 of those product names → OVERLABELED (should be STRONG_INFERENCE)

4. FIT VERDICT: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH

## Output per claim:
```
CLAIM: [id]
Supported: "[the part that the snippet directly says]"
Unsupported: "[the part that goes beyond]" or "NONE"
Product count in claim: [N] | Products in snippet: [M] | Coverage: [M/N]
Level Check: CORRECT / OVERLABELED (should be [X] instead)
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```
"""


# ──────────────────────────
# ⚫ STEP 1 GATE — Hard Block (v5.2 — AUTO-BLOCK)
# ──────────────────────────

"""
Review results:
  Checkpoint A (segment count):     PASS / FAIL
  Checkpoint B (name match):        X/N found
  Checkpoint C (snippet verify):    X/5 verified
  Claim-Support-Fit:                X FULL / Y PARTIAL / Z MISMATCH

GATE RULES (v5.2 — AUTO-BLOCK):

  ⛔ HARD STOP (cannot proceed under any circumstance):
    - Checkpoint A = FAIL
    - Any SNIPPET_MISMATCH in CSF audit
    - Checkpoint B has any NOT_FOUND

  🔧 MUST FIX BEFORE PROCEEDING (fix, then re-check):
    - Any OVERLABELED → downgrade evidence level, re-run affected checkpoint
    - Snippet coverage < (N-1)/N → split into category + product-list claims

  ✅ PROCEED when:
    - All HARD STOP items clear
    - All MUST FIX items resolved
    - Re-checks confirm fixes
"""


# ════════════════════════════════
# STEP 2 — Historical Financial Data
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 2 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 2: Historical Financial Data Extraction
# Company: [INSERT TICKER]

## Input
[PASTE: Validated Step 1 JSON]

## Objective
Extract financial data for segments and products in Step 1 JSON.
Provide continuous breakdown covering most recent 5 fiscal years.

## CRITICAL: Disclosure-Bounded Extraction

Before extracting data for ANY entity, classify disclosure level:

| Disclosure Status | Rule |
|:---|:---|
| Quarterly $ revenue separately reported | ✅ EXTRACT with full citation |
| Only annual $ reported | Extract annual only. Mark quarterly as [ANNUAL_ONLY] |
| Only growth % reported (not $ amount) | Extract growth % only. Mark $ as [GROWTH_PCT_ONLY] |
| Only qualitative (e.g., "increased"/"declined", no %) | Mark [QUALITATIVE_GROWTH_ONLY] — do NOT assign a specific percentage |
| Not separately reported at all | Mark [NOT_SEPARATELY_REPORTED] — provide NO numbers |

**Rule: "entities_given_numbers_without_source" MUST be zero.**

## Data Sourcing Rules
- Official Sources Only: SEC filings (10-K, 10-Q) and Earnings Press Releases
- If company restated structure → use RESTATED figures from latest filings
- All monetary values in USD Millions
- If restated quarterly figures unavailable → [QUARTERLY_RESTATEMENT_NOT_AVAILABLE]

### ⭐ Name Consistency (v5.4 — applies to ALL generation steps 2-7)
VERIFY before output: every segment/product name matches Step 1 canonical_names
or its listed abbreviation. No other variants. Violation = STRUCTURAL ERROR.

### ⭐ Restatement History Depth (v5.4 — NEW)
If restated data covers fewer than 5 fiscal years:
→ Set HISTORY_DEPTH = [number of restated years available]
→ Tag [SHORT_HISTORY: N years] in self-check output
→ This value propagates to Step 5: CAGR lookback must use HISTORY_DEPTH, not 5
→ If computed Q4 as residual (FY - Q1 - Q2 - Q3) yields negative or > 2× average of Q1-Q3:
  tag [IMPLAUSIBLE_RESIDUAL] and mark as [UNVERIFIED]

## Output Method: CLAIMS FIRST, THEN TABLES

### Phase 1: Disclosure Inventory
```json
{
  "disclosure_inventory": {
    "entities_in_step1": "[total]",
    "entities_with_quarterly_dollar_data": "[count]",
    "entities_with_annual_dollar_data_only": "[count]",
    "entities_with_growth_pct_only": "[count]",
    "entities_with_qualitative_growth_only": "[count]",
    "entities_not_separately_reported": "[count]",
    "entities_given_numbers_without_source": 0
  }
}
```

### Phase 2: Structured Data Claims
For each data point:
```
CLAIM: [claim_id]
TEXT: [the factual data statement]
SOURCE_SNIPPET: [exact number from filing table — e.g., "$26,707"]
SOURCE_LOCATION: [filing type, period, table/exhibit name, page]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / DERIVED]
BASIS: [as-reported / restated]
```

Evidence levels for data:
- DISCLOSED: Number appears directly in a filing table or text
- STRONG_INFERENCE: Calculated from disclosed numbers in one step (show calculation)
- DERIVED: Growth rates, margins, ratios from disclosed values

**Rule: Never mark a calculated number as [DISCLOSED].**

### Phase 3: Markdown Tables
For entities with quarterly $ data: full table with Claim ID + Evidence Level + Source
For entities with growth % only: growth rate table (NO dollar estimates)
For entities with qualitative growth only: note "increased"/"declined" verbatim — NO % assigned
For [NOT_SEPARATELY_REPORTED]: list only, NO table

### Phase 4: Rollup Validation
For each fiscal year:
```json
{
  "rollup_check": {
    "fiscal_year": "FY20XX",
    "segment_sum": "[sum]",
    "reported_consolidated": "[from filing]",
    "gap": "[difference]",
    "gap_pct": "[X.XX%]",
    "status": "PASS (<0.5%) or FAIL"
  }
}
```

### Phase 5: Anomaly Flags
- Revenue drops >20% Q/Q without known cause → [ANOMALY]
- Growth rate swings >30pp Y/Y → [VOLATILITY]
- Operating margin changes >500bp Q/Q → [MARGIN_SHIFT]

### Phase 6: CSV Output
```
Fiscal_Year,Quarter,Segment,Product,Revenue_USD_M,Claim_ID,Evidence_Level,Source,Basis,Flags
```

## Batch 1: All operating segments. Batch 2: Product-level growth rates.
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT A — Rollup Math
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze or explain.

Add these numbers:
[PASTE: all segment revenue values for a given fiscal year]

Total = ?

Reported consolidated revenue: $[X]M (source: [filing])

Difference = ?
Percentage difference = ?

Reply: MATCH (if <0.5%) or MISMATCH
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT B — Spot-Check 3 Numbers
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze or explain.

Claim 1: "[Segment X] revenue in [Quarter] was $[Y]M"
Here is the revenue table from [filing]:
[PASTE: relevant table]
What number does the table show? $___M → MATCH or MISMATCH?

Claim 2: "[Segment Y] revenue in [Quarter] was $[Z]M"
Source table: [PASTE] → MATCH or MISMATCH?

Claim 3: "[Segment Z] annual revenue in [FY] was $[W]M"
Source table: [PASTE] → MATCH or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT C — Zero Fabrication
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a list comparator. Do NOT analyze or explain.

List A — entities with specific dollar revenue numbers in Step 2:
[LIST: entity names with $ numbers]

List B — entities marked [NOT_SEPARATELY_REPORTED] in Step 2:
[LIST: entity names marked not reported]

List C — entities marked [GROWTH_PCT_ONLY] in Step 2:
[LIST: entity names with growth % only]

Question 1: Any entity in BOTH List A and List B? → YES (list them) or NO
Question 2: Any entity in BOTH List A and List C? → YES (list them) or NO
(An entity with growth % only should NOT also have dollar revenue numbers)

→ Any YES = fabrication detected. Must fix.
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT D — Y/Y Growth Arithmetic (v5.3 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Verify 3 Y/Y growth calculations from Step 2:

1. [Segment] [Quarter]: Prior year = $[A]M, Current = $[B]M
   Claimed Y/Y = [X]%
   Calculated: ([B]-[A])/[A] × 100 = ?%
   → MATCH (within 0.1pp) or MISMATCH?

2. [Segment] [Quarter]: Prior year = $[C]M, Current = $[D]M
   Claimed Y/Y = [Y]%
   Calculated: ([D]-[C])/[C] × 100 = ?%
   → MATCH or MISMATCH?

3. [Segment] [Quarter]: Prior year = $[E]M, Current = $[F]M
   Claimed Y/Y = [Z]%
   Calculated: ([F]-[E])/[E] × 100 = ?%
   → MATCH or MISMATCH?
"""


# ──────────────────────────
# 🟡 STEP 2 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a financial data auditor. You did NOT generate this data.

## Task: Audit 5 randomly selected numerical claims from Step 2.

For each:
1. Does the source snippet contain the exact number claimed?
2. Is the evidence level correct?
   - Directly in table → [DISCLOSED]
   - Calculated from others → [STRONG_INFERENCE] (calculation must be shown)
   - Growth rate/ratio → [DERIVED]

## Claims to audit:
[PASTE: 5 randomly selected data claims]

## Filing tables for reference:
[PASTE: relevant financial tables]

## Output per claim:
CLAIM: [id]
Claimed value: $[X]M
Snippet says: $[Y]M
Number match: EXACT / CLOSE (within 0.5%) / MISMATCH
Level check: CORRECT / OVERLABELED → should be [X]
Calculation shown (if STRONG_INFERENCE): YES / NO / N/A
"""


# ──────────────────────────
# ⚫ STEP 2 GATE (v5.2 — AUTO-BLOCK)
# ──────────────────────────

"""
  Checkpoint A (rollup):        PASS/FAIL for each FY
  Checkpoint B (spot-check):    X/3 match
  Checkpoint C (fabrication):   YES/NO fabrication found
  Checkpoint D (Y/Y growth):    X/3 match (v5.3)
  Claim-Support-Fit:            X/5 correct

GATE RULES (v5.3 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any rollup FAIL
    - Fabrication found (Checkpoint C = YES)
    - Any spot-check MISMATCH on a [DISCLOSED] claim

  🔧 MUST FIX:
    - Spot-check MISMATCH on [DERIVED] claim → re-derive and show calculation
    - Any OVERLABELED → downgrade evidence level
    - ⭐ (v5.3) Any Y/Y growth MISMATCH → correct growth rate before Step 5 uses it

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""


# ════════════════════════════════
# STEP 3 — Competitive Landscape (v5.4: SPLIT INTO 3A + 3B)
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 3A GENERATION — Competitor Pairing (BOTH MODES)
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 3A: Competitor Pairing
# Company: [INSERT TICKER]

## Input
[PASTE: Validated Step 1 JSON]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Objective
For each Product Category in Step 1 JSON, identify the primary competitor.

## Competitor Identification Logic
- Subject is Market Leader → identify #2 (Primary Challenger)
- Subject is NOT leader → identify Market Leader (Gold Standard)

## Evidence Requirements
Pairing MUST be backed by at least ONE of:
- Market share data with named source
- Analyst report with report name + year
- Revenue comparison from competitor's SEC filing

### Source Tier Classification (v5.1)
TIER 1: IDC, Gartner, Forrester, Canalys, Synergy Research, SEC filings, investor presentations → [DISCLOSED]
TIER 2: StatCounter, SimilarWeb, Sensor Tower (ORIGINAL, not via article) → max [STRONG_INFERENCE]
TIER 3: Wikipedia, aggregators, blogs, press summaries → max [WEAK_INFERENCE]

HARD RULE: TIER 3 only → cannot exceed [WEAK_INFERENCE].

### Source Provenance (v5.2 — FULL MODE ONLY, skip in Light Mode)
SOURCE_ACCESS: [DIRECT / SECONDARY]
SECONDARY → cap at TIER 2 max. PROVENANCE_UNKNOWN → cap at [WEAK_INFERENCE].

### Market Share Scope (only when comparing two numbers in same category)
SCOPE: [exact market definition]. Different scopes → [SCOPE_MISMATCH].

## Output: Claims First
For each category:
```
CLAIM: [C3-001]
TEXT: [competitive positioning statement]
SOURCE_SNIPPET: [exact quote or data point]
SOURCE_LOCATION: [source name, year]
SOURCE_TIER: [1 / 2 / 3]
SOURCE_ACCESS: [DIRECT / SECONDARY] ← Full Mode only
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE / QUALITATIVE_BASIS]
```

Then assemble per category:
- Primary Competitor: [name]
- Competitive Status: [Leader / Challenger]
- Rivalry intensity: [H / M / L] with one-line justification
- Basis: [claim_id + evidence level]

## Causal Discipline: Apply rules from pipeline header.
"""


# ──────────────────────────
# 🔴 STEP 3B GENERATION — Porter's Five Forces (FULL MODE ONLY)
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 3B: Porter's Five Forces Analysis
# Company: [INSERT TICKER]

## Input
[PASTE: Step 3A output — validated competitor pairings]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Objective
For each category with a validated competitor pairing, analyze Porter's Five Forces.

## Output: Claims First
For each force in each category:
```
CLAIM: [C3-020]
TEXT: [force rating and justification]
SOURCE_SNIPPET: [specific data point — a number, not vague words]
SOURCE_LOCATION: [source]
SOURCE_TIER: [1 / 2 / 3]
DATA_EVIDENCE_LEVEL: [level of the underlying data]
RATING_EVIDENCE_LEVEL: [level of the H/M/L conclusion — always ≤ DATA level]
```

A data point being [DISCLOSED] does NOT make the rating [DISCLOSED].
"AWS spent $50B on CapEx" → data is [DISCLOSED], rating "HIGH barrier" is [STRONG_INFERENCE].

## Assembled Output per category:
| Force | Rating | Quantitative Anchor | Data Level | Rating Level | Source | Tier | Justification |

"Quantitative Anchor" = specific number. If none → [NO_QUANTITATIVE_DATA].
Do NOT fabricate percentages.

## ⭐ Qualitative Competition Fallback (v5.4 — NEW)
If ≥3 out of 5 forces for a category have [NO_QUANTITATIVE_DATA]:
→ Mark category as [LOW_EVIDENCE_COMPETITION]
→ All downstream driver eligibility for this category capped at +2pp (not +3pp)
→ Note: this is acceptable, not a gate failure. Some industries lack quantitative data.

## Causal Discipline: Apply rules from pipeline header.
"""


# ──────────────────────────
# 🟢 STEP 3 CHECKPOINT A — Competitor Existence
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a fact checker. Do NOT analyze or explain.

For each pair: does the named competitor operate in the same category?

1. Category: "[Cat 1]" — Competitor: "[Comp X]" → YES / NO / UNSURE
2. Category: "[Cat 2]" — Competitor: "[Comp Y]" → YES / NO / UNSURE
...
"""


# ──────────────────────────
# 🟢 STEP 3 CHECKPOINT B — Evidence Has Data
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a format checker. Do NOT analyze content quality.

For each Porter force row, does "Quantitative Anchor" contain
a SPECIFIC NUMBER (%, $, count, ratio)?
Or only vague words ("significant", "generally", "many")?

[PASTE: Porter table rows]

Reply per row: HAS_NUMBER or NO_NUMBER
"""


# ──────────────────────────
# 🟡 STEP 3 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a skeptical competitive analyst auditor.

## Task
For each competitive claim, evaluate:

1. Does the source snippet ACTUALLY support the claim?
   - Market share number: is it in the snippet?
   - Analyst report: does the report name + year look real?
     If you cannot verify the report exists → mark [CITATION_UNVERIFIABLE]

2. ⭐ Source Tier Verification (v5.1):
   - Is the claimed SOURCE_TIER correct?
   - If source is Wikipedia citing StatCounter → TIER 3, not TIER 2
   - If source is a blog/aggregator citing IDC → TIER 3, not TIER 1
   - Does the evidence level comply with the tier maximum?
     TIER 3 source with [DISCLOSED] label → OVERLABELED

3. ⭐ Source Provenance Check (v5.2):
   - Is SOURCE_ACCESS correctly classified?
   - If the claim cites "Statista, citing Synergy Research" → ACCESS should be SECONDARY
   - If the claim cites "synergy research group quarterly report" directly → DIRECT
   - Is evidence level compatible with access type?
     SECONDARY access on TIER 1 source → max [STRONG_INFERENCE]

4. For Porter force ratings:
   Does the evidence prove the RATING or just describe a related fact?
   → The data is one evidence level. The rating conclusion is usually lower.

5. For any causal claim:
   Does the source snippet contain causal language?
   → NO → must be [WEAK_INFERENCE] regardless of current label

## Claims to audit:
[PASTE: all Step 3 claims]

## Output per claim:
```
CLAIM: [id]
Snippet supports claim: FULLY / PARTIALLY / NOT_AT_ALL
Source verifiable: YES / UNVERIFIABLE
Source tier check: CORRECT / WRONG_TIER (should be [X])
Source access check: CORRECT / WRONG_ACCESS (should be [X])
Evidence level check: CORRECT / OVERLABELED → should be [X]
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```
"""


# ──────────────────────────
# 🔵 STEP 3 CROSS-MODEL (v5.3: PENALTY IF SKIPPED)
# Model: Different advanced model, same prompt
# ──────────────────────────

"""
[Run same Step 3 prompt with different model]

Compare — DO NOT auto-merge:

| Dimension | Model A | Model B | Status |
|:---|:---|:---|:---|
| Competitor for Cat 1 | [name] | [name] | CONSENSUS or CONFLICT |
| Market share % | [X]% | [Y]% | CONSENSUS (<5pp) or DIVERGENCE |
| Market share SCOPE | [def A] | [def B] | SAME_SCOPE or SCOPE_MISMATCH |
| Rivalry rating | [H/M/L] | [H/M/L] | CONSENSUS or CONFLICT |

⚫ CONFLICT or DIVERGENCE → human decides. No auto-selection.
⚫ SCOPE_MISMATCH → note that numbers are not directly comparable.

⭐ (v5.3) PENALTY IF SKIPPED:
If cross-model is NOT run:
→ All Step 3 competitive claims used in Step 4/5 must be tagged [SINGLE_MODEL_UNVERIFIED]
→ Pipeline Audit must spot-check at least 3 additional Step 3 claims (11 total instead of 8)
"""


# ──────────────────────────
# ⚫ STEP 3 GATE (v5.2 — AUTO-BLOCK + PROVENANCE)
# ──────────────────────────

"""
  Checkpoint A (competitors):    X/N confirmed
  Checkpoint B (evidence data):  X/N have numbers
  Claim-Support-Fit:             X FULL / Y PARTIAL / Z issues
  Source tier violations:        [count]
  Source provenance violations:  [count]
  Citations unverifiable:        [count]
  Cross-Model (if run):          X consensus / Y conflicts

GATE RULES (v5.2 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any competitor NOT confirmed by Checkpoint A
    - >50% of forces lack quantitative anchor → MUST re-generate
    - Any SNIPPET_MISMATCH in CSF audit

  🔧 MUST FIX BEFORE PROCEEDING:
    - Any OVERLABELED → downgrade evidence level
    - Any WRONG_TIER → correct tier and enforce tier maximum
    - ⭐ (v5.2) Any SECONDARY access on TIER 1 source → cap at STRONG_INFERENCE
    - ⭐ (v5.2) Any PROVENANCE_UNKNOWN → cap at WEAK_INFERENCE
    - Any [CITATION_UNVERIFIABLE] on a claim feeding Step 4 synergy →
      DOWNGRADE to [WEAK_INFERENCE]
    - If >3 claims are [CITATION_UNVERIFIABLE] → re-generate with different sources
    - Cross-model CONFLICT → human resolves

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""


# ════════════════════════════════
# STEP 4 — Synergy & Flywheel (v5.4: FULL MODE = 3-split, LIGHT MODE = 2-split)
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 4 GENERATION (FULL MODE — three-split + flywheel)
# Model: Claude Opus / GPT-4o
# For LIGHT MODE variant, see below.
# ──────────────────────────

"""
# Step 4: Cross-Business Synergy & Flywheel Analysis

## Input
- Architecture (Step 1): [PASTE JSON]
- Financial Data (Step 2): [PASTE CSV]
- Competition (Step 3A/3B): [PASTE]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## ⭐ Single-Segment Check (v5.4)
If Step 1 identified only 1 reportable segment:
→ Cross-business synergy analysis is NOT APPLICABLE
→ Output: "Single-segment company. No cross-segment synergy analysis."
→ Step 5 growth drivers limited to: historical trend, disclosed guidance, competitive position
→ Skip to Step 4.5

## Framework

### 4A — One Core Capability Per Business Line
Define the single deepest competency no Step 3 competitor can replicate.
One per business line. No generic strengths.
Must be grounded in what Step 3 shows competitors cannot match.

### 4B — Map Penetration Paths
For each capability: does it show up as a feature/cost input/advantage
inside any other business line's product?

### 4C — Three-Split Verdict (v5 Core Innovation)

For EACH synergy, provide THREE separate verdicts.
These CANNOT automatically inherit from each other.

```
SYNERGY: [synergy_id]
Description: [one-sentence]

VERDICT 1 — INTEGRATION:
  Claim: [Does A's capability exist inside B's product?]
  Source snippet: [exact quote from filing]
  Source location: [filing, section, page]
  Evidence level: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
  Integration proven: YES / NO

VERDICT 2 — DIFFERENTIATION:
  Claim: [Does this give B capabilities its Step 3 competitor cannot match?]
  Source snippet: [quote, or "none found"]
  Source location: [filing, or "inferred from Step 3"]
  Evidence level: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
  Differentiation proven: YES / NO

⭐ (v5.4) DIFFERENTIATION DEFAULT: The default expectation for differentiation
is [WEAK_INFERENCE]. Filing alone almost never proves competitive superiority.
[DISCLOSED] requires the filing to explicitly use competitive language
(e.g., "industry-leading", "only provider of", "competitors do not offer").
If you must explain WHY the filing proves differentiation, it is not [DISCLOSED].

VERDICT 3 — FINANCIAL CAUSALITY:
  Claim: [Did this integration cause measurable financial improvement in B?]
  Source snippet: [quote with causal language, or "none — filing does not attribute"]
  Source location: [filing, or "none"]
  Evidence level: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
  Financial causality proven: YES / NO
```

Causal discipline: For Verdict 3, source must use causal language
(caused, drove, resulted in, due to, because of, contributed to).
If filing only describes integration without attributing financial outcomes,
Verdict 3 is [WEAK_INFERENCE] at best.

### ⭐ Causal Language Classification Table (v5.2 — NEW)

Not all verbs are equally causal. Use this lookup:

| Source Language | Causal Strength | Maximum Evidence Level for Causality |
|:---|:---|:---|
| "caused", "drove", "resulted in", "because of" | STRONG CAUSAL | [DISCLOSED] if from filing |
| "due to", "attributable to", "as a result of" | STRONG CAUSAL | [DISCLOSED] if from filing |
| "contributed to", "aided by", "supported by" | PARTIAL CAUSAL | [STRONG_INFERENCE] maximum |
| "benefited from", "led by" | PARTIAL CAUSAL | [STRONG_INFERENCE] maximum |
| "due in part to" | PARTIAL CAUSAL | [STRONG_INFERENCE] maximum |
| "coincided with", "alongside", "in the context of" | CORRELATION ONLY | [WEAK_INFERENCE] maximum |
| "including", "such as", "with" (listing without attribution) | NO CAUSALITY | [WEAK_INFERENCE] maximum |
| No causal language present | NO CAUSALITY | [WEAK_INFERENCE] maximum |

HARD RULE: "contributed to" and "aided by" are NOT equivalent to "caused by".
A filing saying "growth was aided by AI adoption" supports [STRONG_INFERENCE]
for causality, NOT [DISCLOSED]. Only unambiguous causal attribution
("revenue growth was driven by" / "due to") qualifies for [DISCLOSED].

### ⭐ Self-Contradiction Detection Rule (v5.1 — HARD GATE)

After generating each synergy verdict, run this self-check:

If your NOTE or explanatory text contains ANY of these phrases:
- "the filing does not explicitly say/state/mention"
- "not explicitly named/described in"
- "though the [filing/10-K/report] does not"
- "logically" / "implies" / "assumed to"
- "inferred from" / "we can assume"

AND your evidence_level for that verdict is [DISCLOSED]:
→ AUTOMATIC DOWNGRADE to [STRONG_INFERENCE] or [WEAK_INFERENCE].

This is a mechanical rule. No exceptions. If you need to EXPLAIN
why something is DISCLOSED, it is by definition not DISCLOSED.
DISCLOSED means the filing says it directly with no explanation needed.

### Classification:
- All 3 proven with [DISCLOSED] or [STRONG_INFERENCE] → "fully_verified_synergy"
- Integration proven + differentiation/causality inferred → "integration_proven_only"
- Only narrative basis → "narrative_synergy"
- No filing evidence → "unsupported_synergy" → EXCLUDE

### 4D — Financial Signatures (from Step 2)
| Signal | Evidence Standard |
|:---|:---|
| Revenue Acceleration | ≥2 consecutive quarters higher growth vs pre-deployment |
| Margin Expansion | ≥100bp sustained for 3+ quarters |
| Cross-sell | Documented in filing language |
| Retention | Measurable churn reduction |

### 4E — Flywheel Analysis (v5.4 — ENHANCED, Full Mode only)
For each proposed flywheel:

1. Reinforcement: Does metric in SOURCE improve due to RECIPIENT growth?
   Evidence? If only timing correlation → [WEAK_INFERENCE]
   ⭐ (v5.3+) HARD RULE: The reinforcement metric must either:
   (a) Correspond to a Step 2 data series (cite claim_id), showing
       improvement coinciding with RECIPIENT growth, OR
   (b) Be marked [NO_STEP2_DATA] → automatically "unproven_flywheel"
   Vague concepts ("ecosystem value", "platform engagement")
   without a cited Step 2 metric → "unproven_flywheel"
2. Counter-evidence: Anything showing loop NOT working?
   If yes → downgrade to "one-directional"
3. Time-lag: >4Q with no observable signal → "unproven_flywheel"

### 4F — Causal Discipline
For EVERY causal claim:
- Does source snippet use causal language?
  → YES: may label [DISCLOSED] or [STRONG_INFERENCE]
  → NO: MUST label [WEAK_INFERENCE] and rewrite as correlation

## Output

### Synergy Matrix:
| Synergy | Source→Recipient | Integration | Differentiation | Causality | Classification | Flywheel? | Key Claims |

Each cell: verdict + evidence level + claim_id

### ⭐ Step 5 Driver Eligibility (v5.1 — QUANTIFIED)

| Classification | Step 5 Treatment |
|:---|:---|
| fully_verified_synergy | ✅ Can drive growth rate assumptions with no cap |
| integration_proven_only (integration part) | ⚠️ Can support growth, with constraints:
|   | (a) Cannot add more than +3pp above Step 2 historical CAGR
|   | (b) Must be tagged [INTEGRATION_ONLY_DRIVER]
|   | (c) If accounts for >20% of segment FY5 growth → [HIGH_CONCENTRATION] flag |
| integration_proven_only (causality part) | ❌ Cannot drive numbers. Causality is [WEAK_INFERENCE]. |
| narrative_synergy | ❌ Context column only. Cannot appear in Driver column. |
| unsupported_synergy | ❌ Must not appear anywhere in Step 5. |
"""


# ──────────────────────────
# 🟢 STEP 4 CHECKPOINT A — Citation Specificity
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a citation checker. Do NOT analyze content.

For each synergy, does the source location include
a specific page number or section name?

1. SYN-001: Source = "[citation]" → SPECIFIC or VAGUE?
2. SYN-002: Source = "[citation]" → SPECIFIC or VAGUE?
...
"""


# ──────────────────────────
# 🟢 STEP 4 CHECKPOINT B — Three-Split Completeness
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a completeness checker. Do NOT analyze content.

For each synergy below, check: does it have ALL THREE verdicts
(Integration, Differentiation, Financial Causality)?

1. SYN-001: Has Integration verdict? YES/NO
             Has Differentiation verdict? YES/NO
             Has Causality verdict? YES/NO
2. SYN-002: ...

Any synergy missing a verdict → INCOMPLETE
"""


# ──────────────────────────
# 🟢 STEP 4 CHECKPOINT C — Self-Contradiction Check (v5.1 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a contradiction detector. Do NOT analyze content quality.

For each synergy verdict below, check:

Does the NOTE or explanatory text contain phrases like:
"does not explicitly", "though the filing does not", "logically",
"implies", "assumed to", "inferred from", "we can assume"?

AND is the evidence_level for that verdict [DISCLOSED]?

1. SYN-001 Integration: evidence=[X], note contains caveat? YES/NO → CONTRADICTION or OK
2. SYN-001 Differentiation: evidence=[X], note contains caveat? YES/NO → CONTRADICTION or OK
3. SYN-001 Causality: evidence=[X], note contains caveat? YES/NO → CONTRADICTION or OK
...

Any CONTRADICTION → must downgrade evidence level before proceeding.
"""


# ──────────────────────────
# 🟡 STEP 4 CLAIM-SUPPORT-FIT ⭐ MOST IMPORTANT AUDIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a skeptical synergy auditor. This is the most critical
audit in the entire pipeline.

## The core question for each synergy:
"Does the source prove INTEGRATION, DIFFERENTIATION, or CAUSALITY?"
These are THREE DIFFERENT things. Do not let them bleed into each other.

## For each synergy claim's three verdicts:

### Integration verdict:
- Does the source snippet explicitly describe A's technology being
  used inside B's product?
- If yes → [DISCLOSED] is appropriate
- If source only mentions them in the same paragraph → [WEAK_INFERENCE]
- ⭐ (v5.1) If the generator's NOTE says "filing does not explicitly say"
  but verdict is [DISCLOSED] → OVERLABELED. Must downgrade.

### Differentiation verdict:
- Does the source snippet say B can do something competitors CANNOT?
- Or is this inferred from Step 3's competitor analysis?
- Usually this will be [STRONG_INFERENCE] at best, often [WEAK_INFERENCE]
- Filing alone almost never proves differentiation → default expectation is [WEAK_INFERENCE]

### Financial causality verdict:
- Does the source snippet attribute B's financial performance to A?
- Does it use causal language (caused, drove, due to, because of)?
- "Revenue grew 20%" with no causal attribution → [WEAK_INFERENCE]
- Even timing correlation (e.g., acquisition + revenue spike) → [STRONG_INFERENCE] max, not [DISCLOSED]

## Claims to audit:
[PASTE: all synergy claims]

## Output per synergy:
```
SYN-[id]:
  Integration: snippet says [X] → level should be [Y] → CORRECT / OVERLABELED
  Differentiation: snippet says [X] → level should be [Y] → CORRECT / OVERLABELED
  Causality: snippet says [X] → level should be [Y] → CORRECT / OVERLABELED
  Self-contradiction detected: YES / NO
  Classification should be: [classification]
```
"""


# ──────────────────────────
# ⚫ STEP 4 GATE (v5.2 — AUTO-BLOCK)
# ──────────────────────────

"""
  Checkpoint A (citations):      X/N specific
  Checkpoint B (three-split):    X/N complete
  Checkpoint C (contradiction):  X contradictions found
  Claim-Support-Fit:             X correct / Y overlabeled
  Synergies fully_verified:      [count]
  Synergies integration_only:    [count]
  Synergies narrative:           [count]

GATE RULES (v5.2 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any INCOMPLETE three-split (Checkpoint B)
    - Any CONTRADICTION detected (Checkpoint C) that has NOT been downgraded
      (v5.2: contradiction + no downgrade = automatic block, not just warning)

  🔧 MUST FIX:
    - Any VAGUE citation → provide specific source
    - Any OVERLABELED by CSF → downgrade evidence level
    - Any synergy reclassified by CSF → update classification
    - ⭐ (v5.2) Any causality verdict using "contributed to"/"aided by" language
      marked as [DISCLOSED] → downgrade to [STRONG_INFERENCE] per causal table

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""


# ──────────────────────────
# 🔴 STEP 4 GENERATION — LIGHT MODE VARIANT (v5.4 — TWO-SPLIT)
# Model: Claude Opus / GPT-4o
# Use this prompt INSTEAD of Full Mode Step 4 when running Light Mode
# ──────────────────────────

"""
# Step 4 (Light): Cross-Business Synergy Analysis — Two-Split

## Input
- Architecture (Step 1): [PASTE JSON]
- Financial Data (Step 2): [PASTE CSV]
- Competition (Step 3A): [PASTE]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Single-Segment Check: If only 1 segment → skip this step entirely.

## Framework (SIMPLIFIED — two verdicts per synergy)

### 4A — One Core Capability Per Business Line
Define the single deepest competency. One per business line.

### 4B — Penetration Paths
For each capability in another business line's product, define:
- The Capability, The Mechanism, The Product Impact

### 4C — Two-Split Verdict (Light Mode)

For EACH synergy, provide TWO verdicts only:

```
SYNERGY: [synergy_id]
Description: [one-sentence]

VERDICT 1 — INTEGRATION:
  Claim: [Does A's capability exist inside B's product?]
  Source snippet: [exact quote from filing]
  Source location: [filing, section, page]
  Evidence level: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]

VERDICT 2 — FINANCIAL CAUSALITY:
  Claim: [Did this integration cause financial improvement in B?]
  Source snippet: [causal quote, or "none"]
  Evidence level: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
```

Causal language classification: apply table from pipeline header.
Self-contradiction rule: apply as in Full Mode.

### Classification (Light Mode):
- Integration + Causality both [DISCLOSED/STRONG_INFERENCE] → "verified_synergy"
- Integration proven, causality [WEAK_INFERENCE] → "integration_only"
- Neither proven → "narrative_synergy"

### Driver Eligibility (same as Full Mode):
| verified_synergy | ✅ drive growth, no cap |
| integration_only | ⚠️ max +3pp above historical CAGR, tag [INTEGRATION_ONLY_DRIVER] |
| narrative_synergy | ❌ context only |

## Output: Synergy Matrix
| Synergy | Source→Recipient | Integration | Causality | Classification | Key Claims |
"""


# ════════════════════════════════
# STEP 4.5 — Capital Allocation
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 4.5 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 4.5: Capital Allocation & Investment Feasibility

## Input
- Step 1 JSON, Step 2 CSV, Step 4 Synergy Matrix

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Claims First
Every financial data point as a claim:
```
CLAIM: [D45-001]
TEXT: [data statement]
SOURCE_SNIPPET: [exact number from filing]
SOURCE_LOCATION: [filing, Cash Flow Statement, page]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / DERIVED]
```

Source line MUST be "Purchases of property and equipment" from Cash Flows.
Do NOT use total investing cash flows.

## Capital Metrics Table
| Metric | Formula | FY-4 | FY-3 | FY-2 | FY-1 | FY0 | Claim ID |
|:---|:---|:---|:---|:---|:---|:---|:---|
| CapEx ($M) | PP&E from CF stmt | | | | | | D45-001 |
| CapEx/Revenue % | CapEx ÷ Revenue | | | | | | D45-002 |
| Revenue per $ CapEx | Rev ÷ CapEx (lag 4-8Q) | | | | | | D45-003 |
| FCF Margin % | (OCF - CapEx) ÷ Rev | | | | | | D45-004 |

## Feasibility Checkpoints
1. CapEx Runway: current ratio vs 5Y average → [ELEVATED_CAPEX] if >1.5x
2. Scale Economics: Rev CAGR vs CapEx CAGR → "achieving" or "capital-intensive"
3. Guidance Alignment: management guidance vs historical → [GUIDANCE_DIVERGENCE] if inconsistent

### ⭐ Asset-Light Threshold (v5.4 — NEW)
If CapEx/Revenue < 8% for ALL 5 historical years:
→ Mark revenue ceiling as [NOT_APPLICABLE — ASSET_LIGHT]
→ Step 5 gate skips ceiling check
→ Pipeline audit notes the skip
→ Skip the revenue ceiling calculation below

### ⭐ Step 5 Revenue Ceiling (v5.3, skip if ASSET_LIGHT)

After computing the Capital Metrics Table, calculate:

  historical_rev_per_capex = 5-year average (Revenue / CapEx with 4-8Q lag)

  If management CapEx guidance exists:
    FY5_implied_capex = guidance-implied CapEx for FY5
  Else:
    FY5_implied_capex = FY0 CapEx × (1 + CapEx CAGR)^5

  max_implied_FY5_revenue = FY5_implied_capex × historical_rev_per_capex × 1.2
  (the 1.2x allows 20% improvement in capital efficiency)

Output:
```json
{
  "step5_revenue_ceiling": {
    "max_implied_FY5_revenue_M": "[number]",
    "basis": "[calculation shown]",
    "note": "Step 5 FY5 base exceeding this requires [CAPEX_CEILING_EXCEEDED] + justification"
  }
}
```
"""


# ──────────────────────────
# 🟢 STEP 4.5 CHECKPOINT — CapEx Verify
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

Claim: "FY20XX Capital Expenditure was $[X]M"
Source line: "Purchases of property and equipment"

Cash Flow Statement: [PASTE]

What is "Purchases of property and equipment"? $___M
Match? → MATCH (within 1%) or MISMATCH
"""


# ──────────────────────────
# ⚫ STEP 4.5 GATE
# ──────────────────────────

"""
  CapEx verify: PASS / FAIL
  CapEx runway: ELEVATED / NORMAL
  Scale economics: ACHIEVING / CAPITAL-INTENSIVE
  Guidance: ALIGNED / DIVERGENT

  GATE: CapEx verify must PASS. Proceed to Step 5 with feasibility context.
"""


# ════════════════════════════════
# STEP 5/6 — Forecasting
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 5 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 5: High-Granularity Quarterly Financial Forecasting (5-Year)

## Input (ALL must have passed gates)
- Business Architecture (Step 1): [PASTE JSON]
- Historical Baseline (Step 2): [PASTE CSV]
- Competitive Resistance (Step 3A, and 3B if Full Mode): [PASTE]
- Synergy Multipliers (Step 4): [PASTE AUDITED matrix with final evidence levels]
- Capital Feasibility (Step 4.5): [PASTE]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## ⭐ Segment-Only Fallback (v5.4 — NEW)
Review Step 2 disclosure inventory:
If the majority (>50%) of Step 1 products are marked [NOT_SEPARATELY_REPORTED]:
→ Switch to SEGMENT-ONLY FORECAST MODE
→ Forecast at segment level only (skip product → category → segment summation)
→ Step 6 master table shows segment-level rows only
→ Tag: [SEGMENT_ONLY_FORECAST — insufficient product-level disclosure]

## ⭐ Restatement History Depth (v5.4)
If Step 2 flagged [SHORT_HISTORY: N years]:
→ CAGR lookback = N years (not 5)
→ Widen Low-High range spread by 50% for affected segments
→ Tag: [SHORT_HISTORY_ADJUSTED]

## CRITICAL RULES

### Rule 1: [FACT] vs [FORECAST] vs [DERIVED] Tagging
Every number tagged:
- [FACT] — from Step 2 actual data
- [FORECAST] — projected by you
- [DERIVED] — calculated from other numbers

NEVER present forecast without [FORECAST] tag.

### Rule 2: Driver Eligibility from Step 4 (v5.1 — QUANTIFIED)

| Step 4 Classification | Step 5 Treatment |
|:---|:---|
| fully_verified_synergy / verified_synergy | ✅ Can drive growth — no cap |
| integration_proven_only / integration_only | ⚠️ Can support growth, but:
|   | (a) Cannot add more than +3pp above Step 2 historical CAGR
|   | (b) Must be tagged [INTEGRATION_ONLY_DRIVER]
|   | (c) If >20% of segment FY5 growth → [HIGH_CONCENTRATION] flag |
| integration_proven_only (causality) | ❌ Cannot drive numbers |
| narrative_synergy | ❌ Context column only, cannot drive growth rates |
| unsupported_synergy | ❌ Must not appear anywhere |

⭐ (v5.4) If Step 3B flagged category as [LOW_EVIDENCE_COMPETITION]:
→ Driver eligibility cap is +2pp (not +3pp) for that category's synergies.

Any assumption relying on [WEAK_INFERENCE] synergy as primary basis
→ tagged [DRIVER_FROM_WEAK_INFERENCE] + in sensitivity table.

### Rule 3: Output as Ranges
Default = RANGE (Low / Base / High), not single point.
- Low = Base minus impact of removing all [WEAK_INFERENCE] drivers
- High = Base plus optimistic scenario on verified drivers

### Rule 4: No Unannounced Events as Milestones
Only ALREADY publicly announced events (cite source).
Speculative → prefix [SPECULATIVE ASSUMPTION:]

### ⭐ Rule 5: Data Resolution Constraint (v5.1 — HARD RULE)

For any entity marked [GROWTH_PCT_ONLY] in Step 2:
- You MAY forecast growth RATES (percentages)
- You MUST NOT output specific dollar revenue unless you:
  1. State it explicitly as [ESTIMATED_BASE]
  2. Show calculation: segment_revenue × estimated_share = $X
  3. Tag share assumption as [WEAK_INFERENCE]
  4. Include in weak-inference sensitivity table

For any entity marked [NOT_SEPARATELY_REPORTED] in Step 2:
- You MUST NOT forecast this entity at all
- Narrative context only. Any dollar number = VIOLATION

For any growth rate marked "incr."/"decl."/"flat" (no specific %) in Step 2:
- You MUST NOT use a specific percentage as if disclosed
- State your assumed % and tag [ESTIMATED_GROWTH_RATE]

### ⭐ Rule 6: Capital Feasibility Constraint (v5.1)

If Step 4.5 flagged [ELEVATED_CAPEX]:
→ Any assumption requiring CapEx/Revenue to increase further
  must be tagged [CAPEX_STRETCH] and justified.

If Step 4.5 found "capital-intensive" (CapEx CAGR ≥ Revenue CAGR):
→ Revenue growth cannot exceed CapEx growth by >5pp without
  explicit scale economics evidence.

If Step 4.5 found [GUIDANCE_DIVERGENCE]:
→ Assumptions deviating from guidance tagged [DEVIATES_FROM_GUIDANCE].

If Step 4.5 ceiling is [NOT_APPLICABLE — ASSET_LIGHT]:
→ Skip ceiling check.

## Assumption Registry (REQUIRED — output BEFORE any numbers)

⭐ (v5.4) Each assumption MUST include an ARITHMETIC TRACE showing how the
stated growth rate produces the actual forecast number. This is the primary
mechanism for preventing numerical non-closure.

```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "IC segment grows 20% Y/Y in Y1",
      "basis": "Step 2 claim D2-XXX: FY2025 IC growth 21.5%. Discounted 1.5pp for Step 3 High Rivalry.",
      "basis_claim_id": "D2-XXX",
      "basis_evidence_level": "DISCLOSED",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "arithmetic_trace": {
        "anchor": "$[Step 2 latest actual Q]M",
        "growth_rate": "20% Y/Y",
        "seasonal_factor": "[Q1 historical share of FY = XX%]",
        "Y1Q1_computed": "$[anchor × 1.20 × seasonal]M",
        "Y1Q1_in_forecast_table": "$[must match computed]M"
      },
      "sensitivity": "±5pp growth = ±$X B revenue in FY5"
    }
  ]
}
```

⭐ (v5.4) ARITHMETIC TRACE RULE: If Y1Q1_computed ≠ Y1Q1_in_forecast_table (>1% gap),
the assumption is NUMERICALLY INCONSISTENT. Fix before outputting forecast tables.

⭐ (v5.1) Each assumption MUST include "basis_claim_id" pointing to a specific
claim_id from Steps 2/3/4. Narrative-only basis without claim_id = VIOLATION.

## Forecasting Logic
- Baseline: Y1Q1 = Step 2 latest actual × (1 + growth rate from registry)
- Seasonality: reference historical Q/Q patterns from Step 2
- Competitive resistance: discount growth where Step 3 = "High" Rivalry
- Synergy acceleration: only verified synergies can accelerate
- Capital feasibility: growth must be supportable by Step 4.5 trajectory
- ⭐ (v5.4) If SEGMENT_ONLY_FORECAST mode: summation = Segments → Consolidated only
- Otherwise: Products → Categories → Segments → Consolidated (±$1M)

## Reasonableness Flags (auto-trigger)
- Y/Y growth >50% for product >$5B revenue → [AGGRESSIVE_GROWTH]
- 5Y CAGR exceeds TAM growth by >2x → [TAM_CONSTRAINT]
- CAGR <-10% without explicit catalyst → [AGGRESSIVE_DECLINE]
- [SPECULATIVE ASSUMPTION] driving >10% of FY5 → [HIGH_UNCERTAINTY]
- ⭐ (v5.1) [INTEGRATION_ONLY_DRIVER] adding >3pp above historical CAGR → [DRIVER_CAP_EXCEEDED]

## Output Per Segment
| Quarter | Rev Low | Rev Base | Rev High | Tag | Y/Y% | Driver (Assumption ID) | Driver Quality | Flags |

## Batch: one segment, then STOP.

---

# Step 6: Consolidated Master Forecast

| Segment | Category | FY+1 | FY+2 | FY+3 | FY+4 | FY+5 | CAGR | Range | Key Drivers | Weak? |

## Standard Sensitivity
| Scenario | Change | FY5 Revenue | CAGR |
|:---|:---|:---|:---|
| Bull | +3pp all | | |
| Base | as forecast | | |
| Bear | -3pp all | | |

## ⭐ Weak-Inference Sensitivity (v5)
| Assumption | Evidence | If REMOVED | FY5 Impact | CAGR Impact | Flag |

## ⭐ Forecast Confidence Summary
```json
{
  "total_FY5_revenue_base": "$XXX B",
  "revenue_from_DISCLOSED_drivers": "$XXX B (XX%)",
  "revenue_from_STRONG_INFERENCE_drivers": "$XX B (XX%)",
  "revenue_from_WEAK_INFERENCE_drivers": "$XX B (XX%)",
  "revenue_from_ESTIMATED_BASE": "$XX B (XX%)",
  "high_uncertainty_flags": N
}
```
"""


# ──────────────────────────
# 🔴 STEP 5/6 GENERATION — LIGHT MODE VARIANT (v5.4)
# Model: Claude Opus / GPT-4o
# Use INSTEAD of Full Mode Step 5/6 when running Light Mode
# ──────────────────────────

"""
# Step 5/6 (Light): Segment-Level Annual Forecast (5-Year)

## Input (ALL must have passed gates)
- Step 1 JSON, Step 2 CSV, Step 3A output, Step 4 (Light) matrix, Step 4.5

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## LIGHT MODE SIMPLIFICATIONS:
- Forecast at SEGMENT LEVEL only (no product-level breakdown)
- ANNUAL granularity (not quarterly) — output FY+1 through FY+5
- Simplified assumption registry (5 fields per assumption)
- Wider default ranges than Full Mode

## Rules: Same as Full Mode Rules 1-6 (tagging, driver eligibility,
ranges, no milestones, data resolution, capital feasibility).

## Segment-Only Fallback: Always active in Light Mode.

## Assumption Registry (SIMPLIFIED — 5 fields)
```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "IC segment grows 20% Y/Y in Y1",
      "basis_claim_id": "D2-XXX",
      "driver_quality": "STRONG",
      "arithmetic_trace": "Step 2 FY latest = $[X]M × 1.20 = $[Y]M FY+1"
    }
  ]
}
```

## Output — Combined Step 5/6:

| Segment | FY+1 Low | FY+1 Base | FY+1 High | FY+2 | FY+3 | FY+4 | FY+5 | CAGR | Key Driver | Weak? |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| [Seg A] | | | | | | | | | A001 | No |
| **CONSOLIDATED** | | | | | | | | | | |

## Weak-Inference Sensitivity + Forecast Confidence Summary: same format as Full Mode.
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT A — Baseline + Growth + Arithmetic Trace (v5.4 — ENHANCED)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

For each segment:

Part 1 — Baseline anchor:
  Step 2 latest actual: [Segment] [QX] = $[A]M
  Step 5 first forecast: Y1 Q1 Base = $[B]M
  Q/Q change = (B-A)/A × 100 = ?%
  WITHIN_RANGE (-15% to +15%) or OUTSIDE_RANGE?

Part 2 — Growth rate consistency (v5.1):
  Step 2 same quarter prior year: [Segment] [QX-4] = $[C]M
  Step 5 Y1 same quarter: Y1 [QX] Base = $[D]M
  Implied Y/Y = (D-C)/C × 100 = [calculated]%
  Stated Y/Y growth in assumption registry = [G]%
  MATCH (within ±1pp) or MISMATCH?

Part 3 — Arithmetic trace verification (v5.4 — NEW):
  From assumption A001 arithmetic_trace:
    anchor = $[X]M, growth = [Y]%, seasonal = [Z]
    Y1Q1_computed = $[W]M
  From forecast table:
    Y1 Q1 Base = $[V]M
  Gap = |W - V| / W × 100 = ?%
  MATCH (within 1%) or TRACE_MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT B — Summation
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Add these FY+3 Base product revenues for [Segment]:
[LIST: product values]

Sum = ?
Master table says [Segment] FY+3 = $[Z]M

MATCH (±$1M) or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT C — Growth Sanity
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a range checker. Do NOT analyze.

Flag any product where:
- CAGR > 40% AND current revenue > $5,000M → FLAG
- CAGR < -10% with no flag in data → FLAG
- Otherwise → OK

[LIST: products with CAGRs]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT D — Driver Eligibility
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a list comparator. Do NOT analyze.

List A — assumptions with synergy_driver in Step 5:
[LIST: assumption_id, synergy_id, driver_quality]

Question 1: Any assumption where driver_quality = "WEAK_INFERENCE_DEPENDENT"
but NOT tagged [DRIVER_FROM_WEAK_INFERENCE]?
→ YES (list violations) or NO

Question 2 (v5.1): Any assumption where synergy classification is
"integration_proven_only" and the growth increment added exceeds +3pp
above the Step 2 historical CAGR for that segment?
→ YES (list violations) or NO

Question 3 (v5.1): Any assumption with basis_claim_id = "none" or missing?
→ YES (list violations) or NO
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT E — Mid-Horizon Growth Spot-Check (v5.3 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Pick the largest segment by revenue. Check its Y3 growth:

  Step 5 Y3 Q2 Base revenue for [Segment] = $[A]M
  Step 5 Y2 Q2 Base revenue for [Segment] = $[B]M

  Implied Y/Y growth = (A-B)/B × 100 = ?%

  Assumption registry says Y3 growth should be approximately [G]%
  (accounting for stated deceleration/acceleration schedule if any)

  MATCH (within ±2pp) or MISMATCH?

If MISMATCH: the stated assumption and actual forecast numbers diverge
at mid-horizon. Must align before proceeding.
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT F — Seasonality Pattern Check (v5.3 — NEW, Full Mode only)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a pattern checker. Do NOT analyze.

From Step 2, identify the historically strongest quarter (highest Q/Q share
of full-year revenue) for [Segment] over the last 3 fiscal years.

Historical strongest quarter: Q[X] (average share of FY revenue: [Y]%)

Now check Step 5 FY+3 forecast:
  Q1 share = Q1_rev / FY3_total × 100 = ?%
  Q2 share = Q2_rev / FY3_total × 100 = ?%
  Q3 share = Q3_rev / FY3_total × 100 = ?%
  Q4 share = Q4_rev / FY3_total × 100 = ?%

1. Is the historically strongest quarter still the strongest in FY+3?
   → YES (pattern preserved) or NO (flag [SEASONALITY_SHIFT])

2. Is any quarter's share deviating from historical average by >5pp?
   → YES (list which) or NO
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT G — CapEx Ceiling Check (v5.3 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number comparator. Do NOT analyze.

Step 4.5 revenue ceiling: max_implied_FY5_revenue = $[X]M
Step 5/6 FY5 consolidated Base revenue = $[Y]M

Is $[Y]M ≤ $[X]M?
→ WITHIN_CEILING or EXCEEDED

If EXCEEDED: Does Step 5 include a [CAPEX_CEILING_EXCEEDED] flag
with written justification?
→ JUSTIFIED / NOT_JUSTIFIED / NO_FLAG
"""


# ──────────────────────────
# 🟡 STEP 5 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a forecast auditor.

## Task
Check whether forecast assumptions are properly grounded.

For each assumption in the registry:

1. Is the "basis" actually from a [DISCLOSED] or [STRONG_INFERENCE]
   claim in Steps 2/3/4?
   → Trace back: does the cited claim_id exist?
   → Does that claim's AUDITED evidence level match what's stated?
   ⭐ (v5.1) If basis_claim_id is missing or says "none" → VIOLATION

2. If basis references a Step 4 synergy:
   → What was the AUDITED classification after Step 4 CSF?
   → If causality was downgraded to [WEAK_INFERENCE] but this
     assumption treats it as growth driver → VIOLATION
   ⭐ (v5.1) If synergy is "integration_proven_only" and growth
     increment >3pp above historical CAGR → DRIVER_CAP_VIOLATION

3. Are any "milestones" in the forecast based on unannounced events?

4. ⭐ (v5.1) Data resolution check:
   → Does any assumption assign specific dollar revenue to an entity
     that Step 2 marked [GROWTH_PCT_ONLY] or [NOT_SEPARATELY_REPORTED]?
   → If yes → VIOLATION unless tagged [ESTIMATED_BASE]

## Assumptions to audit:
[PASTE: full assumption registry]

## Output per assumption:
```
A-[id]: basis traces to [step/claim_id] — audited evidence level [X]
  Stated level: [Y] → MATCH or MISMATCH
  basis_claim_id present: YES / NO
  If synergy-based: classification = [Z], growth increment = [N]pp
  Driver eligibility: ELIGIBLE / VIOLATION / DRIVER_CAP_VIOLATION
  Data resolution: COMPLIANT / VIOLATION
```
"""


# ──────────────────────────
# 🔵 STEP 5/6 CROSS-MODEL
# Model: Different advanced model, same prompt
# ──────────────────────────

"""
[Run same Step 5 prompt with different model]

Compare — do NOT average:

| Product | Model A CAGR | Model B CAGR | Gap | Status |
|:---|:---|:---|:---|:---|
| X | 22% | 25% | 3pp | CONSENSUS → range [22-25%] |
| Y | 45% | 18% | 27pp | CONFLICT → ⚫ human decides |

⚫ CONFLICT: human must choose. Record reasoning. No auto-merge.
"""


# ──────────────────────────
# ⚫ STEP 5/6 GATE (v5.4 — AUTO-BLOCK + ARITHMETIC TRACE + CAPEX CEILING)
# ──────────────────────────

"""
  Checkpoint A (baseline + growth + trace): X/N range, growth X/N, trace X/N (v5.4)
  Checkpoint B (summation):          X/N match
  Checkpoint C (growth sanity):      X flagged (Full Mode only)
  Checkpoint D (driver):             violations? YES/NO
  Checkpoint E (mid-horizon):        MATCH/MISMATCH
  Checkpoint F (seasonality):        pattern? YES/NO (Full Mode only)
  Checkpoint G (capex ceiling):      WITHIN/EXCEEDED
  Claim-Support-Fit:                 X/N eligible (Full Mode only)
  Cross-model:                       X consensus / Y conflicts (Full Mode only)

GATE RULES (v5.4 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any Summation MISMATCH (Checkpoint B)
    - Any missing basis_claim_id (Checkpoint D Q3 = YES)
    - Any Data Resolution VIOLATION (dollar number for [NOT_SEPARATELY_REPORTED] entity)
    - Any untagged WEAK_INFERENCE driver (Checkpoint D Q1 = YES)
    - ⭐ (v5.4) Any TRACE_MISMATCH (Checkpoint A Part 3) — arithmetic trace
      does not produce the forecast number. Must fix computation before proceeding.

  🔧 MUST FIX:
    - Baseline OUTSIDE_RANGE → justify with seasonality evidence or fix
    - Growth rate MISMATCH → align stated % with implied %
    - DRIVER_CAP_VIOLATION → reduce increment to ≤+3pp or upgrade to fully_verified
    - Data resolution issue for [GROWTH_PCT_ONLY] → add [ESTIMATED_BASE] tag
    - Mid-horizon MISMATCH (Checkpoint E) → align Y3 numbers with stated assumptions
    - CapEx ceiling EXCEEDED without justification (Checkpoint G)
      → reduce forecast OR add [CAPEX_CEILING_EXCEEDED] with justification
    - Cross-model CONFLICT → human resolves

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""


# ════════════════════════════════
# STEP 7 — WACC
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 7 — WACC Calculation (v5.2 — PARAMETER CLAIMS FIRST)
# Execute Python script locally, then claim-ify all inputs
# ──────────────────────────

"""
## Step 7: WACC Calculation with Parameter-Level Source-Fit

### Phase 0: Run Python Script
[Execute the validated WACC Python script — includes staleness check,
 data quality warnings, beta range check, cost of debt reasonableness,
 WACC range check, Bull/Base/Bear sensitivity]

### Phase 1: Parameter Claims (v5.2 — MANDATORY, output BEFORE validation)

Every WACC input parameter must be output as a structured claim:

```
CLAIM: W7-001
TEXT: Risk-free rate used is 4.28%, based on the 10-Year U.S. Treasury yield.
SOURCE_SNIPPET: [exact yield value and date from source]
SOURCE_LOCATION: [e.g., "U.S. Treasury yield curve, treasury.gov, as of 2026-03-15"
                  OR "Damodaran data page, updated January 2026"]
EVIDENCE_LEVEL: DISCLOSED
STALENESS: [days since source date]
```

Required parameter claims (ALL must be present):

| Parameter | Claim ID | Required Source |
|:---|:---|:---|
| Risk-free rate | W7-001 | Treasury.gov or Damodaran page, with date |
| Equity Risk Premium | W7-002 | Damodaran implied ERP page, with update month |
| Unlevered beta (per segment) | W7-003a/b/c | Damodaran industry beta page + industry name used |
| Market Cap | W7-004 | yfinance (to be cross-checked in Checkpoint B) |
| Total Debt | W7-005 | yfinance (to be cross-checked in Checkpoint B) |
| Interest Expense | W7-006 | 10-K income statement or notes |
| Marginal Tax Rate | W7-007 | Statutory rate + source |

For conglomerates with weighted beta:
```
CLAIM: W7-003a
TEXT: Intelligent Cloud segment uses "Internet/Online Services" unlevered beta of 1.10
SOURCE_SNIPPET: "Unlevered Beta: 1.10" from "Internet/Online Services" row
SOURCE_LOCATION: Damodaran, betas by industry, US, updated January 2026
EVIDENCE_LEVEL: DISCLOSED
INDUSTRY_MATCH_RATIONALE: "IC segment is primarily Azure cloud services, maps to Internet/Online Services"
SEGMENT_WEIGHT: 37.7% (= $106,265M / $281,724M from Step 2)
WEIGHT_SOURCE: Step 2 FY2025 validated revenue
```

HARD RULE: If any required parameter claim is missing → WACC calculation
is INCOMPLETE and cannot pass gate. Every number must have a trail.
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT A — WACC Range
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a range checker. Do NOT analyze.

WACC = [X]% for a [industry] company.

Typical ranges:
- Technology: 7-12%
- Consumer Staples: 6-9%
- Healthcare: 8-13%
- Financials: 8-14%
- Industrials: 7-11%
- Energy: 8-12%

WITHIN_RANGE or OUTSIDE_RANGE?
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT B — Input Cross-Verify
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

WACC script used:
  Market Cap: $[X]B (from yfinance)
  Total Debt: $[Y]B (from yfinance)

10-K Balance Sheet says:
[PASTE: balance sheet]

1. Total debt (long-term + current portion) from 10-K = $___B
   vs yfinance $[Y]B → MATCH (within 5%) or MISMATCH?

2. Shares outstanding from 10-K = ___M
   × Stock price $[P] = implied market cap $___B
   vs yfinance $[X]B → MATCH (within 5%) or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT C — Beta Industry Verification (v5.1 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a classification checker. Do NOT analyze or explain.

The WACC calculation used this unlevered beta: [X.XX]
The user states this is the "[Industry Name]" beta from Damodaran.

The company operates in these segments (from Step 1):
[LIST: segment names and brief descriptions]

Question 1: Does the Damodaran industry "[Industry Name]" appear to match
the company's PRIMARY business? → PLAUSIBLE_MATCH or QUESTIONABLE_MATCH

Question 2: For a conglomerate with multiple segments, was a weighted beta used?
→ YES / NO / NOT_APPLICABLE
If YES: Do the segment weights approximately match Step 2 revenue proportions?
  Step 2 revenue shares: [LIST: segment, revenue, % of total]
  Beta weights used: [LIST: segment, weight %]
  → CONSISTENT (within 5pp per segment) or INCONSISTENT

Question 3: The unlevered beta of [X.XX] — is this plausible for this type of business?
  Pure software/SaaS: typically 0.9-1.3
  Cloud infrastructure: typically 1.0-1.4
  Consumer hardware: typically 0.8-1.2
  Gaming/entertainment: typically 0.9-1.3
  → PLAUSIBLE or IMPLAUSIBLE
"""


# ──────────────────────────
# 🟡 STEP 7 CHECKPOINT D — Peer WACC Comparison (v5.1 — NEW)
# Model: Advanced model
# ──────────────────────────

"""
You are a WACC reasonableness checker.

The calculated WACC for [COMPANY] is [X]%.

Peers from Step 3's competitive landscape:
[LIST: 3-5 peer companies from Step 3]

For each peer, estimate their approximate WACC based on:
- Their market cap and debt levels (publicly available)
- Their industry classification
- Standard Damodaran methodology

| Peer | Est. WACC | Reasoning |
|:---|:---|:---|

Is [COMPANY]'s WACC of [X]% within ±2 percentage points of the peer median?
→ CONSISTENT or FLAG_FOR_REVIEW (explain gap)

Note: This is a reasonableness check, not a precision calculation.
The goal is to catch gross input errors (e.g., wrong industry beta,
wrong debt figure) that would make the WACC wildly different from peers.
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT E — Cost of Debt Cross-Check (v5.2 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

The WACC script calculated pre-tax cost of debt = [X]%
This was derived from: Interest Expense $[A]M ÷ Total Debt $[B]M

Cross-check against 10-K:

1. Find "Interest expense" in the Income Statement:
   10-K says: $___M → MATCH (within 10%) with $[A]M or MISMATCH?

2. Find weighted average interest rate (often in debt footnote):
   If disclosed: ___% → vs calculated [X]%
   → MATCH (within 100bp) or MISMATCH?
   If not disclosed: [NOT_DISCLOSED] — rely on calculated rate.

3. Sanity: Is [X]% between 2% and 10% for an investment-grade company?
   → PLAUSIBLE or IMPLAUSIBLE
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT F — Parameter Claims Completeness (v5.2 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a completeness checker. Do NOT analyze.

Check: Are ALL required parameter claims present?

W7-001 (Risk-free rate):        PRESENT / MISSING
W7-002 (Equity Risk Premium):   PRESENT / MISSING
W7-003 (Unlevered beta):        PRESENT / MISSING
W7-004 (Market Cap):            PRESENT / MISSING
W7-005 (Total Debt):            PRESENT / MISSING
W7-006 (Interest Expense):      PRESENT / MISSING
W7-007 (Marginal Tax Rate):     PRESENT / MISSING

For each PRESENT claim:
- Does it have a SOURCE_LOCATION? YES / NO
- Does it have a date? YES / NO

Any MISSING or missing source → INCOMPLETE
"""


# ──────────────────────────
# ⚫ STEP 7 GATE (v5.4 — MODE-AWARE)
# ──────────────────────────

"""
  FULL MODE checkpoints:
    Checkpoint A (WACC range):     WITHIN_RANGE / OUTSIDE_RANGE
    Checkpoint B (input verify):   Debt MATCH/MISMATCH, Market Cap MATCH/MISMATCH
    Checkpoint C (beta verify):    PLAUSIBLE_MATCH / QUESTIONABLE_MATCH, weights CONSISTENT / INCONSISTENT
    Checkpoint D (peer WACC):      CONSISTENT / FLAG_FOR_REVIEW
    Checkpoint E (cost of debt):   Interest MATCH/MISMATCH, rate PLAUSIBLE/IMPLAUSIBLE
    Checkpoint F (param claims):   X/7 complete

  LIGHT MODE checkpoints (v5.4):
    Checkpoint A/C merged (WACC range + beta reasonableness): run as one call
    Checkpoint B (input verify): same as Full
    Checkpoint F (param claims): same as Full
    Skip: D (peer WACC), E (cost of debt)

GATE RULES (v5.4 — AUTO-BLOCK):

  ⛔ HARD STOP (both modes):
    - Any parameter claim MISSING (Checkpoint F < 7/7)
    - Input MISMATCH on market cap or debt (Checkpoint B)
    - Constants stale >60 days

  ⛔ HARD STOP (Full Mode only):
    - Cost of debt IMPLAUSIBLE (Checkpoint E)

  🔧 MUST FIX:
    - Constants stale 30-60 days → update before finalizing
    - WACC OUTSIDE_RANGE → review inputs, document reasoning
    - QUESTIONABLE_MATCH on beta industry → review selection, document reasoning
    - INCONSISTENT beta weights → realign with Step 2 revenue proportions
    - FLAG_FOR_REVIEW on peer comparison → investigate gap (Full Mode only)
    - Interest expense MISMATCH → re-check 10-K (Full Mode only)

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""


# ════════════════════════════════════
# PIPELINE AUDIT — Run after ALL steps
# ════════════════════════════════════

# ──────────────────────────
# 🔵 PIPELINE AUDIT (v5.4 — MODE-AWARE)
# Model: Different advanced model
# Full Mode: 7 sections, 8+ claim spot-checks
# Light Mode: 3 sections (structural, laundering, weak-inference), 5 claim spot-checks
# ──────────────────────────

"""
You are a senior analyst conducting a final quality audit
on an AI-generated valuation. You did NOT create any of it.
Be adversarial. Your job is to find errors.

## Inputs
[PASTE: all Step 1-7 outputs including claims, audits, gates]

## Audit Checklist

### 1. Structural Consistency (BOTH MODES)
- Every Step 1 segment appears in Steps 2, 3, 4, 5, 6? (exact name)
- No phantom segments/products in later steps?
- No [DISCONTINUED] products with growing forecast?
- ⭐ (v5.3) Name Consistency: verify all names match Step 1 canonical_names registry.
  Any deviation = STRUCTURAL_VIOLATION.
- ⭐ (v5.4) If [SEGMENT_ONLY_FORECAST] was activated: verify no product-level
  dollar forecasts exist in Step 5.
- ⭐ (v5.4) If Step 4 was single-segment skip: verify Step 5 drivers are
  limited to historical trend / guidance / competitive position.

### 2. Numerical Consistency (BOTH MODES)
- Step 2 rollup matches consolidated?
- Step 5 Y1Q1 traces to Step 2 latest actual?
- Step 6 sums match Step 5 granular (or segment → consolidated if segment-only)?
- Step 7 inputs match 10-K balance sheet?
- Step 7 beta weights match Step 2 revenue proportions?
- ⭐ (v5.2) Step 7 parameter claims: all 7 present with sources?
- ⭐ (v5.3) Step 5 FY5 consolidated ≤ Step 4.5 revenue ceiling?
  If ceiling [NOT_APPLICABLE — ASSET_LIGHT]: note and skip.
  If exceeded: is [CAPEX_CEILING_EXCEEDED] flag present with justification?
- ⭐ (v5.4) Arithmetic trace check: for 2 randomly selected assumptions,
  verify that the arithmetic_trace computation matches the forecast table number.

### 3. Evidence Level Integrity (BOTH MODES)
- ⭐ LAUNDERING CHECK: Any claim whose evidence level INCREASED
  between steps without new source snippet?
- Any [UNSUPPORTED] or [narrative_synergy] appearing as Step 5 driver?
- Any [NOT_SEPARATELY_REPORTED] entity with forecast numbers in Step 5?
- Any [GROWTH_PCT_ONLY] entity with dollar forecast not tagged [ESTIMATED_BASE]?

### 4. Causal Discipline (Full Mode only — Light Mode skip)
- Any causal claim without causal language in its source snippet?
- Any Step 4 causality verdict marked [DISCLOSED] when source only
  describes integration?
- Any Step 4 verdict where NOTE contains "does not explicitly"
  but evidence level is [DISCLOSED]? (self-contradiction check)
- ⭐ (v5.2) Any Step 4 causality using "contributed to"/"aided by" 
  marked [DISCLOSED] instead of [STRONG_INFERENCE]? (causal table check)
- ⭐ (v5.4) Any differentiation verdict marked [DISCLOSED] without
  explicit competitive language in filing? (differentiation default check)

### 5. Forecast Integrity (INDEPENDENTLY RECALCULATED — BOTH MODES)

⭐ Do NOT use Step 5's self-reported weak-inference exposure numbers.
Instead, independently recalculate:

a. List every Step 5 assumption that references a Step 4 synergy.
b. For each, look up the AUDITED Step 4 classification.
c. If the synergy's financial causality was [WEAK_INFERENCE]:
   → The revenue driven by this assumption is "weak-inference-dependent"
   → EVEN IF Step 5 did not tag it as [DRIVER_FROM_WEAK_INFERENCE]
d. Sum all weak-inference-dependent revenue for FY5.
e. Calculate: weak_dep_revenue / total_FY5_revenue = X%

If your independently calculated exposure differs from Step 5's
self-reported exposure by >5 percentage points → EVIDENCE_TAGGING_VIOLATION.

Additional checks:
- Any [AGGRESSIVE_GROWTH] flags on products with [WEAK_INFERENCE] drivers?
- Cross-model conflicts resolved by human or left unresolved?
- Any [INTEGRATION_ONLY_DRIVER] adding >3pp above historical CAGR?

### 6. Source Quality Audit (v5.4 — MODE-AWARE)
Full Mode: Pick 8 claims (at least one from each of Steps 1, 2, 3, 4, 5, 7).
Light Mode: Pick 5 claims (at least one from Steps 1, 2, 3A, 5, 7).
For each:
- Read the source snippet, verify fit
- For Step 3 claims: verify SOURCE_TIER and SOURCE_ACCESS are correct
- ⭐ (v5.2) For Step 7 parameter claims: verify source date is current

⭐ (v5.3) CROSS-MODEL PENALTY: If Step 3 cross-model was NOT run,
increase total spot-checks to 11 with at least 3 from Step 3.
All Step 3 claims used in Steps 4-5 should be tagged [SINGLE_MODEL_UNVERIFIED].
Check that this tag is present.

### 7. Gate Compliance Audit (v5.4 — Full Mode only, skip in Light Mode)
Verify that each step's gate was properly enforced:
- Were all HARD STOP conditions checked?
- Were any MUST FIX items left unresolved?
- Did any step proceed despite unresolved gate violations?
- ⭐ (v5.3) Was the Step 4.5 revenue ceiling computed and checked by Step 5?

If any step proceeded despite an unresolved HARD STOP → PIPELINE_INTEGRITY_VIOLATION

## Output
```json
{
  "audit_result": "PASS / CONDITIONAL / FAIL",
  "structural_issues": [],
  "name_consistency_violations": [],
  "numerical_issues": [],
  "evidence_laundering": [],
  "causal_discipline_violations": [],
  "self_contradiction_violations": [],
  "causal_table_violations": [],
  "source_tier_violations": [],
  "source_provenance_violations": [],
  "forecast_issues": [],
  "capex_ceiling_check": {"within_ceiling": true, "justification_if_exceeded": "N/A"},
  "step7_parameter_claims_complete": true/false,
  "gate_compliance": {
    "all_hard_stops_enforced": true/false,
    "unresolved_must_fix": [],
    "pipeline_integrity_violation": true/false
  },
  "source_spot_check": [
    {"claim": "...", "step": N, "fit": "FULL/PARTIAL/MISMATCH", 
     "tier_correct": true, "access_correct": true}
  ],
  "weak_inference_revenue_exposure": {
    "independently_calculated": "$X B (X%)",
    "step5_self_reported": "$Y B (Y%)",
    "discrepancy": "X pp",
    "tagging_violation": true/false
  },
  "confidence": "HIGH / MEDIUM / LOW",
  "recommendation": "Proceed / Fix [steps] / Major revision"
}
```

## Gate Rules
| Result | Meaning | Action |
|:---|:---|:---|
| PASS | No issues. Weak-inference exposure <5%. All gates compliant. | Proceed to valuation. |
| CONDITIONAL_PASS | Minor issues. No laundering. Exposure 5-15%. | Fix flagged items. |
| FAIL | Laundering, structural/numerical errors, exposure >15%, tagging violation, or pipeline integrity violation. | Revise affected steps. |
"""
