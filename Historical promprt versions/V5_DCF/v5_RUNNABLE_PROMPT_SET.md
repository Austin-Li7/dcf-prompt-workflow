# ══════════════════════════════════════════════════════════
# FINANCIAL VALUATION PIPELINE — v5 RUNNABLE PROMPT SET
# 可直接复制粘贴执行的完整 Prompt 集
# ══════════════════════════════════════════════════════════
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
   Types: NONE / CATEGORY_ASSIGNMENT / CUSTOMER_TYPE / SCOPE

3. EVIDENCE LEVEL CHECK: Is the assigned evidence level correct?
   - If claim says [DISCLOSED] but snippet doesn't directly state it → OVERLABELED
   - If claim says [STRONG_INFERENCE] but it requires multiple assumptions → OVERLABELED

4. FIT VERDICT: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH

## Output per claim:
```
CLAIM: [id]
Supported: "[the part that the snippet directly says]"
Unsupported: "[the part that goes beyond]" or "NONE"
Level Check: CORRECT / OVERLABELED (should be [X] instead)
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```
"""


# ──────────────────────────
# ⚫ STEP 1 GATE — Human Decision
# ──────────────────────────

"""
Review results:
  Checkpoint A (segment count):     PASS / FAIL
  Checkpoint B (name match):        X/N found
  Checkpoint C (snippet verify):    X/5 verified
  Claim-Support-Fit:                X FULL / Y PARTIAL / Z MISMATCH

GATE RULES:
  A = FAIL → STOP. Do not proceed.
  B has NOT_FOUND → fix that segment before proceeding
  C has NOT_FOUND for [DISCLOSED] claims → re-examine those claims
  Any SNIPPET_MISMATCH → must fix or remove claim before Step 2
  Any OVERLABELED → downgrade evidence level before Step 2
"""


# ════════════════════════════════
# STEP 2 — Historical Financial Data
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 2 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 2: Longitudinal Financial Data Extraction (Past 5 Years)

## Input
[PASTE: Step 1 architecture JSON — ONLY after Step 1 gate passed]

## Objective
Extract quarterly financial data for segments and products in Step 1.
5 fiscal years, 20+ consecutive quarters.

## CRITICAL: Disclosure-Bounded Extraction
Before extracting ANY product-level data, determine:
  - Separately reported in 10-K/10-Q → EXTRACT with source
  - NOT separately reported → [NOT_SEPARATELY_REPORTED] — NO numbers
  - Annual only → [ANNUAL_ONLY] — extract annual, skip quarterly
  - Segment-level only → [SEGMENT_LEVEL_ONLY]

The output table WILL have fewer rows than Step 1's product list.
That is correct. Do NOT fill gaps.

## Sources
SEC filings (10-K, 10-Q) and Earnings Press Releases only.
Use RESTATED figures from latest filings.
All values USD Millions.

## Output Method: CLAIMS FIRST

### Phase 1: Data Claims
For each numerical data point, output as claim:

```
CLAIM: D2-001
TEXT: Intelligent Cloud segment revenue in Q3 FY2024 was $26,707M
SOURCE_SNIPPET: "Intelligent Cloud ... $26,707" [from revenue table row]
SOURCE_LOCATION: 10-Q Q3 FY2024, Revenue by Segment table, p.24
EVIDENCE_LEVEL: DISCLOSED
BASIS: restated
```

Rules:
- [DISCLOSED]: number appears directly in a filing table
- [STRONG_INFERENCE]: derived by calculation from disclosed numbers
  (e.g., Q4 = FY total - Q1 - Q2 - Q3). Show the calculation.
- NEVER mark a calculated number as [DISCLOSED]
- NEVER provide numbers for [NOT_SEPARATELY_REPORTED] entities

### Phase 2: Tables
Assemble verified claims into tables:

| Quarter | Revenue ($M) | Claim ID | Evidence Level | Source | Y/Y % | Flags |
|:---|:---|:---|:---|:---|:---|:---|

### Phase 3: Validation Outputs

Disclosure Inventory:
```json
{
  "entities_in_step1": N,
  "entities_with_quarterly_data": X,
  "entities_annual_only": Y,
  "entities_not_separately_reported": Z,
  "entities_given_numbers_without_source": 0
}
```

Rollup Check:
```json
{
  "FY2025_segment_sum": XXXXX,
  "FY2025_reported_consolidated": XXXXX,
  "gap_pct": "X.XX%",
  "status": "PASS or FAIL"
}
```

CSV:
Fiscal_Year,Quarter,Segment,Product,Revenue_USD_M,Claim_ID,Evidence_Level,Source,Basis,Flags

## Anomaly Flags
- Revenue >20% Q/Q drop → [ANOMALY]
- Growth >30pp Y/Y swing → [VOLATILITY]
- Margin >500bps Q/Q change → [MARGIN_SHIFT]

## Batching
Batch 1: Major segments + primary products. STOP after.
Batch 2: After "Continue" — remaining items.
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT A — Rollup Math
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze or explain.

Add these numbers:
[LIST: all segment revenue values for FY2025 from Step 2]

Total = ?
Reported consolidated revenue for FY2025 = $[X]M
Difference = ?
Difference as % = ?

Reply: MATCH (if <0.5%) or MISMATCH
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT B — Spot-Check 3 Numbers
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze or explain.

Claim 1: "[Segment] Q3 FY2024 revenue was $[Y]M"
Source table from 10-Q:
[PASTE: relevant revenue table]
→ What number does the table show for this segment/quarter? $___M
→ MATCH or MISMATCH?

Claim 2: "[Segment] Q1 FY2023 revenue was $[Z]M"
Source table: [PASTE]
→ MATCH or MISMATCH?

Claim 3: "[Product] FY2025 annual revenue was $[W]M"
Source table: [PASTE]
→ MATCH or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT C — Zero Fabrication Check
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a list comparator. Do NOT analyze or explain.

List A — entities that have revenue numbers in Step 2 output:
[LIST: entity names that have numbers]

List B — entities marked [NOT_SEPARATELY_REPORTED] in Step 2:
[LIST: entity names marked as not reported]

Is there ANY entity that appears in BOTH lists?
→ YES (list them) or NO
"""


# ──────────────────────────
# 🟡 STEP 2 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a financial data auditor. You did NOT generate this data.

## Task
Audit 5 randomly selected numerical claims from Step 2.

For each:
1. Read the source snippet provided with the claim
2. Read the cited source location
3. Does the snippet contain the exact number claimed?
4. Is the evidence level correct?
   - Number directly in a table → should be [DISCLOSED]
   - Calculated from other numbers → should be [STRONG_INFERENCE]

## Claims to audit:
[PASTE: 5 randomly selected claims from Step 2]

## Output per claim:
```
CLAIM: [id]
Claimed value: $[X]M
Snippet says: $[Y]M
Number match: EXACT / CLOSE (within 0.5%) / MISMATCH
Level check: CORRECT / OVERLABELED
```
"""


# ════════════════════════════════
# STEP 3 — Competitive Landscape
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 3 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 3: Competitive Landscape & Porter's Five Forces

## Input
[PASTE: Step 1 JSON — only after gate passed]

## Competitor Selection
- Subject is Market Leader → identify #2
- Subject is NOT leader → identify Market Leader

For each pairing, output as claim:
```
CLAIM: C3-001
TEXT: In Cloud Infrastructure, AWS is the market leader with approximately 31% share, vs Azure at approximately 25%.
SOURCE_SNIPPET: "AWS held 31% of the worldwide cloud infrastructure market in Q4 2025, followed by Microsoft Azure at 25%"
SOURCE_LOCATION: IDC Worldwide Quarterly Cloud Infrastructure Tracker, Q4 2025
EVIDENCE_LEVEL: DISCLOSED (third-party report)
```

Allowed source types for competitive claims:
- SEC filings / annual reports (subject or competitor)
- Earnings press releases
- Named analyst reports: IDC, Gartner, Forrester, Canalys, StatCounter
- Official investor presentations

NOT allowed as sole basis:
- "Industry consensus" / "various reports" / "analyst estimates"
→ If these are your only basis: [QUALITATIVE_BASIS — no authoritative source found]
→ Do NOT fabricate report names or specific numbers

## Porter's Five Forces

For each Category, output claims THEN table:

Claims for each force:
```
CLAIM: C3-010
TEXT: Threat of new entrants for Cloud Infrastructure is LOW because minimum viable data center buildout requires capital expenditure exceeding $10B.
SOURCE_SNIPPET: "Capital expenditures were $XX billion for the fiscal year" [from competitor 10-K]
SOURCE_LOCATION: Amazon 10-K FY2024, Cash Flow Statement
EVIDENCE_LEVEL: STRONG_INFERENCE (specific barrier threshold inferred from disclosed CapEx)
```

## ⭐ Causal Discipline
When describing WHY a force is rated High/Medium/Low:
- If the source DIRECTLY uses causal language → [DISCLOSED]
- If you are INFERRING causality → must label [WEAK_INFERENCE]
  and rewrite as correlation:
    ❌ "High rivalry is caused by low switching costs"
    ✅ "High rivalry coincides with low observed switching costs [WEAK_INFERENCE]"

## Output
Compile claims into Porter table:
| Category | Force | Rating | Evidence (claim_id) | Source Snippet | Evidence Level |
"""


# ──────────────────────────
# 🟢 STEP 3 CHECKPOINT A — Competitor Existence
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a fact checker. Do NOT analyze or explain.

For each pair, does the named competitor operate in this category?
Reply YES / NO / UNSURE only.

1. Cloud Infrastructure — Competitor: Amazon Web Services → ?
2. Office Productivity — Competitor: Google Workspace → ?
3. [... repeat for all pairings]
"""


# ──────────────────────────
# 🟢 STEP 3 CHECKPOINT B — Evidence Has Specific Data
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a format checker. Do NOT analyze content quality.

For each Porter force row, does the Evidence column contain
a specific number (%, $, count)?
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
     (If you cannot verify the report exists, mark [CITATION_UNVERIFIABLE])

2. For Porter force ratings — does the evidence prove the RATING 
   or just describe a related fact?
   Example: "AWS spent $50B on CapEx" is a fact.
   "Therefore barriers to entry are HIGH" is an inference.
   → If the rating is based on inference from the fact, 
     the RATING claim is [STRONG_INFERENCE], not [DISCLOSED].

3. For any causal claim:
   Does the source snippet contain causal language?
   → NO → must be [WEAK_INFERENCE] regardless of current label

## Claims to audit:
[PASTE: all Step 3 claims]

## Output per claim:
```
CLAIM: [id]
Snippet supports claim: FULLY / PARTIALLY / NOT_AT_ALL
Source verifiable: YES / UNVERIFIABLE
Causal language in source: YES / NO
Level check: CORRECT / OVERLABELED → should be [X]
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```
"""


# ──────────────────────────
# 🔵 STEP 3 CROSS-MODEL (optional but recommended)
# Model: Different advanced model, same prompt as 🔴
# ──────────────────────────

"""
[Run the exact same Step 3 prompt with a different advanced model]

Then compare outputs — DO NOT auto-merge:

| Dimension | Model A | Model B | Status |
|:---|:---|:---|:---|
| Competitor for Category 1 | X | X | CONSENSUS |
| Competitor for Category 2 | X | Y | CONFLICT → human decides |
| Market share % | 31% | 28% | DIVERGENCE → trace to source |
| Rivalry rating | High | High | CONSENSUS |
| Rivalry rating | Medium | High | CONFLICT → human decides |

⚫ CONFLICT or DIVERGENCE → human must choose. No auto-averaging.
"""


# ════════════════════════════════
# STEP 4 — Synergy & Flywheel
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 4 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 4: Cross-Business Synergy & Flywheel Analysis

## Input
- Architecture (Step 1): [PASTE JSON]
- Financial Data (Step 2): [PASTE CSV]
- Competition (Step 3): [PASTE]

## Framework

### 4A — One Core Capability Per Business Line
Define the single deepest competency no Step 3 competitor can replicate.
One per business line. No generic strengths.

### 4B — Penetration Paths
For each: Capability / Mechanism / Product Impact / Why competitor can't replicate

### 4C — ⭐ Three-Split Verdict (v5 核心)

For EACH synergy, you must provide THREE separate verdicts:

```
SYNERGY: SYN-001
Description: Azure AI services are embedded in Dynamics 365

VERDICT 1 — INTEGRATION:
  Claim: Azure AI capabilities are integrated into Dynamics 365
  Source snippet: "Dynamics 365 Copilot, powered by Azure OpenAI Service..."
  Source location: 10-K FY2025, p.15
  Evidence level: DISCLOSED
  Integration proven: YES

VERDICT 2 — DIFFERENTIATION:
  Claim: This integration gives Dynamics 365 capabilities 
         that Salesforce cannot match
  Source snippet: [none found in filing]
  Evidence level: WEAK_INFERENCE
  Differentiation proven: NO — this is an inference from Step 3 analysis

VERDICT 3 — FINANCIAL CAUSALITY:
  Claim: This integration drove revenue acceleration in Dynamics 365
  Source snippet: [none — filing mentions growth but doesn't attribute to AI]
  Evidence level: WEAK_INFERENCE
  Financial causality proven: NO

OVERALL CLASSIFICATION: integration_proven_only
```

Classification rules:
- All 3 proven with [DISCLOSED]/[STRONG_INFERENCE] → "fully_verified_synergy"
- Integration proven + differentiation/causality inferred → "integration_proven_only"
- Only narrative basis → "narrative_synergy"
- No filing evidence → "unsupported_synergy" → EXCLUDE

### 4D — Flywheel Triple Test
For each proposed flywheel:

1. Reinforcement: Name the specific metric in SOURCE that improves 
   due to RECIPIENT growth. [DISCLOSED/STRONG_INFERENCE/WEAK_INFERENCE]
2. Counter-evidence: Any evidence the loop is NOT working? 
   If yes → downgrade to "one-directional"
3. Time-lag: >4Q with no observable signal → "unproven_flywheel"

### 4E — Causal Discipline
For EVERY causal claim in this step:
- Does the source snippet use causal language 
  (caused, drove, resulted in, due to, because of)?
  → YES: may label [DISCLOSED] or [STRONG_INFERENCE]
  → NO: MUST label [WEAK_INFERENCE] and rewrite as correlation

## Output

Synergy Matrix:
| Source→Recipient | Integration | Differentiation | Causality | Overall | Flywheel? |
|:---|:---|:---|:---|:---|:---|

Each cell contains: verdict + evidence level + claim_id

## ⭐ WHAT STEP 5 CAN USE:
Only synergies classified as "fully_verified_synergy" or 
"integration_proven_only" (integration part only) can serve as 
Step 5 forecast drivers.

"narrative_synergy" → Step 5 context/narrative column only, 
CANNOT drive growth rate numbers.

"unsupported_synergy" → blocked from Step 5 entirely.
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

### Differentiation verdict:
- Does the source snippet say B can do something competitors CANNOT?
- Or is this inferred from Step 3's competitor analysis?
- Usually this will be [STRONG_INFERENCE] at best, often [WEAK_INFERENCE]

### Financial causality verdict:
- Does the source snippet attribute B's financial performance to A?
- Does it use causal language?
- If not → [WEAK_INFERENCE], regardless of what the generation model labeled

## Red flags to catch:
- "Integration is DISCLOSED" sliding into "therefore causality is DISCLOSED"
- Flywheel feedback loops with no named metric → "unproven"
- "AI drove growth" when filing only says "we are investing in AI"

## Claims to audit:
[PASTE: all Step 4 synergy claims with three-split verdicts]

## Output per synergy:
```
SYN: [id]
Integration: [confirm/downgrade] → [evidence level]
Differentiation: [confirm/downgrade] → [evidence level]
Causality: [confirm/downgrade] → [evidence level]
Overall: [confirm/downgrade classification]
Issues found: [list] or NONE
```
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

## Required Metrics (every number must have claim + source snippet)

| Metric | Formula | FY-4 | FY-3 | FY-2 | FY-1 | FY0 | Claim ID | Source |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| CapEx ($M) | PP&E from CF stmt | | | | | | D45-001 | 10-K p.XX |
| CapEx/Rev % | CapEx ÷ Revenue | | | | | | D45-002 | derived |
| FCF Margin | (OCF-CapEx)/Rev | | | | | | D45-003 | derived |

Source MUST be "Purchases of property and equipment" from Cash Flow Statement.
NOT total investing cash flows.

## Feasibility Checks
1. Current CapEx/Rev vs 5yr avg → if >1.5x → [ELEVATED_CAPEX]
2. Revenue CAGR vs CapEx CAGR → "scale economies" or "capital-intensive"
3. Management CapEx guidance vs historical → [GUIDANCE_DIVERGENCE] if inconsistent

## Subsidiary Analysis
- Technical moat evidence from Step 3
- Contribution margin: [DISCLOSED] if in filing, [NOT_DISCLOSED] if not — no estimates
"""


# ──────────────────────────
# 🟢 STEP 4.5 CHECKPOINT — CapEx Verify
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

Claim: "FY2025 CapEx was $[X]M"
Source line: "Purchases of property and equipment"

Cash Flow Statement:
[PASTE]

"Purchases of property and equipment" = $___M
MATCH (within 1%) or MISMATCH?
"""


# ════════════════════════════════
# STEP 5 & 6 — Forecasting
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 5 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 5: 5-Year Quarterly Revenue Forecast

## Input (ALL must have passed gates)
- Architecture (Step 1): [PASTE]
- Historical (Step 2): [PASTE]
- Competition (Step 3): [PASTE]
- Synergies (Step 4): [PASTE — with AUDITED evidence levels and classifications]
- CapEx (Step 4.5): [PASTE]

## TAGGING — Every number:
- [FACT] = from Step 2
- [FORECAST] = your projection
- [DERIVED] = calculated (CAGR, growth %)

## ⭐ DRIVER ELIGIBILITY (HARD RULES)

Review Step 4's audited synergy classifications:

| Step 4 Classification | Can drive forecast? |
|:---|:---|
| fully_verified_synergy | ✅ Yes — can drive growth rates |
| integration_proven_only (integration part) | ✅ Yes — as tech enabler, conservative |
| integration_proven_only (causality part) | ⚠️ No — causality was [WEAK_INFERENCE] |
| narrative_synergy | ❌ Context column only, cannot drive numbers |
| unsupported_synergy | ❌ Must not appear |

If a major driver relies on [WEAK_INFERENCE]:
→ Tag assumption as [DRIVER_FROM_WEAK_INFERENCE]
→ MUST include in Weak-Inference Sensitivity table
→ If removing this driver changes FY5 revenue by >10% → flag [HIGH_UNCERTAINTY]

## ASSUMPTION REGISTRY (before ANY numbers)
```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "Cloud grows 25% Y/Y in Y1",
      "basis": "Step 2 trailing 4Q avg = 27%, discounted 2pp for Step 3 High Rivalry",
      "basis_evidence_level": "DISCLOSED (historical from 10-K)",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "sensitivity": "±5pp = ±$XB in FY5"
    },
    {
      "id": "A003",
      "text": "AI contributes +3pp incremental growth from Y2",
      "basis": "Step 4 SYN-001: integration proven, causality = WEAK_INFERENCE",
      "basis_evidence_level": "WEAK_INFERENCE",
      "synergy_driver": "SYN-001",
      "driver_quality": "WEAK_INFERENCE_DEPENDENT",
      "sensitivity": "If removed: Cloud FY5 rev -$XB",
      "remove_test_impact_pct": "X%"
    }
  ]
}
```

## Forecasting Logic
- Y1 Q1 anchor = Step 2 latest actual × (1 + A-registry growth rate)
- Seasonality from Step 2 historical patterns
- Growth discounted for Step 3 "High Rivalry"
- Only fully_verified or integration_proven synergies drive numbers
- Growth must be supportable by Step 4.5 CapEx

## Reasonableness Flags
- Y/Y >50% for product >$5B → [AGGRESSIVE_GROWTH]
- CAGR >2x TAM growth → [TAM_CONSTRAINT]
- Unannounced product launch as milestone → [SPECULATIVE]

## ⭐ OUTPUT AS RANGES (v5)
Default output is a range, not a point estimate.

| Q | Rev Low ($M) | Rev Base ($M) | Rev High ($M) | Tag | Y/Y % | Driver | Quality | Flags |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|

Point estimate (Base) is only shown when:
- All drivers are [DISCLOSED] or [STRONG_INFERENCE]
- Cross-model gap <10pp

Otherwise: "Range: $X - $Y M"

## Summation
Products → Categories → Segments → Consolidated (±$1M tolerance)

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
|:---|:---|:---|:---|:---|:---|
| A003: AI synergy | WEAK_INFERENCE | -$XB | -Xpp | [HIGH_UNCERTAINTY] if >10% |

## ⭐ Forecast Confidence Summary
```json
{
  "total_FY5_revenue_base": "$XXX B",
  "revenue_from_DISCLOSED_drivers": "$XXX B (XX%)",
  "revenue_from_STRONG_INFERENCE_drivers": "$XX B (XX%)",
  "revenue_from_WEAK_INFERENCE_drivers": "$XX B (XX%)",
  "high_uncertainty_flags": N
}
```
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT A — Baseline Anchor
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Step 2 latest actual: [Segment] FY2025 Q4 = $[X]M
Step 5 first forecast: Y1 Q1 Base = $[Y]M

Q/Q change = (Y-X)/X × 100 = ?%

WITHIN_RANGE (-15% to +15%) or OUTSIDE_RANGE?
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

Question: Any assumption where driver_quality = "WEAK_INFERENCE_DEPENDENT"
but the assumption is NOT tagged [DRIVER_FROM_WEAK_INFERENCE]?

→ YES (list violations) or NO
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
   → Trace back: does the cited Step and claim_id exist?
   → Does that claim's audited evidence level match what's stated?

2. If basis references a Step 4 synergy:
   → What was the AUDITED classification after Step 4 CSF?
   → If causality was downgraded to [WEAK_INFERENCE] but this 
     assumption treats it as growth driver → VIOLATION

3. Are any "milestones" in the forecast based on unannounced events?

## Assumptions to audit:
[PASTE: full assumption registry]

## Output per assumption:
```
A-[id]: basis traces to [step/claim_id] — evidence level [X]
  Stated level: [Y] → MATCH or MISMATCH
  If synergy-based: audited classification = [Z]
  Driver eligibility: ELIGIBLE / VIOLATION
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

⚫ CONFLICT: human must choose one or make independent judgment.
   Record reasoning. No auto-merge.
"""


# ════════════════════════════════
# STEP 7 — WACC
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 7 — Python Script
# Execute locally
# ──────────────────────────

"""
[Use the validated WACC Python script from v3/v4 — includes:
 - Constants staleness check
 - Data quality warnings
 - Beta range check
 - Cost of debt reasonableness
 - WACC range check
 - Bull/Base/Bear sensitivity]
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


# ════════════════════════════════════
# PIPELINE AUDIT — Run after ALL steps
# ════════════════════════════════════

# ──────────────────────────
# 🔵 PIPELINE AUDIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a senior analyst conducting a final quality audit 
on an AI-generated valuation. You did NOT create any of it.
Be adversarial. Your job is to find errors.

## Inputs
[PASTE: all Step 1-7 outputs including claims, audits, gates]

## Audit Checklist

### 1. Structural Consistency
- Every Step 1 segment appears in Steps 2, 3, 4, 5, 6? (exact name)
- No phantom segments/products in later steps?
- No [DISCONTINUED] products with growing forecast?

### 2. Numerical Consistency
- Step 2 rollup matches consolidated?
- Step 5 Y1Q1 traces to Step 2 latest actual?
- Step 6 sums match Step 5 granular?
- Step 7 inputs match 10-K balance sheet?

### 3. Evidence Level Integrity
- ⭐ LAUNDERING CHECK: Any claim whose evidence level INCREASED 
  between steps without new source snippet?
  (e.g., [WEAK_INFERENCE] in Step 4 → treated as [DISCLOSED] in Step 5)
- Any [UNSUPPORTED] or [narrative_synergy] appearing as Step 5 driver?
- Any [NOT_SEPARATELY_REPORTED] entity with forecast numbers in Step 5?

### 4. Causal Discipline
- Any causal claim without causal language in its source snippet?
- Any Step 4 causality verdict marked [DISCLOSED] when source only 
  describes integration?

### 5. Forecast Integrity
- Weak-inference-dependent revenue as % of FY5 total?
- Any [AGGRESSIVE_GROWTH] flags on products with [WEAK_INFERENCE] drivers?
- Cross-model conflicts resolved by human or left unresolved?

### 6. Source Spot-Check (5 random claims across all steps)
For each: read source snippet, verify fit.

## Output
```json
{
  "audit_result": "PASS / CONDITIONAL / FAIL",
  "structural_issues": [],
  "numerical_issues": [],
  "evidence_laundering": [],
  "causal_discipline_violations": [],
  "forecast_issues": [],
  "source_spot_check": [
    {"claim": "...", "step": N, "fit": "FULL/PARTIAL/MISMATCH"}
  ],
  "weak_inference_revenue_exposure": {
    "amount": "$X B",
    "pct_of_FY5": "X%"
  },
  "confidence": "HIGH / MEDIUM / LOW",
  "recommendation": "Proceed / Fix [steps] / Major revision"
}
```
"""
