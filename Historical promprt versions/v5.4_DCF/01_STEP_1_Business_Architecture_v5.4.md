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
