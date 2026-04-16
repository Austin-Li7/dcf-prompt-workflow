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
