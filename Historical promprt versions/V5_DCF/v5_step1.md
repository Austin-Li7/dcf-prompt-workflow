# Step 1: Business Architecture Breakdown (v5 — Validated)

**Company:** [Insert Name or Ticker]

---

## Scope
Provide a complete mapping of:
- Reported operating segments
- Business lines within each segment
- Product families
- Specific commercial offerings
- Revenue generation mechanics

## Mandatory Sources
1. Most recent Form 10-K (or annual report equivalent)
2. Most recent quarterly earnings release or 10-Q

## Rules
- Base segmentation strictly on how the company reports it
- Clearly distinguish between:
  • Reported operating segments
  • Revenue categories (if different from segments)
  • Product groupings (commercial view)
- Do not estimate revenue contribution
- Do not analyze margins, growth, or performance
- Do not provide valuation commentary

---

## Output Method: CLAIMS FIRST, THEN ASSEMBLE

You must output in two phases.

### Phase 1: Structured Claims

Before writing any narrative or table, output every factual assertion as a structured claim. For each segment and each product, output one block:

```
CLAIM: [claim_id, e.g. S1-001]
TEXT: [the factual statement you are making]
SOURCE_SNIPPET: [exact quote or table row from the filing that supports this — copy the words directly]
SOURCE_LOCATION: [filing name, section name, page number]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
```

Evidence level definitions:
- **DISCLOSED**: The filing directly states this fact in its own words.
- **STRONG_INFERENCE**: The filing does not state this exactly, but it can be derived in one logical step from disclosed data (e.g., calculating a ratio from two disclosed numbers).
- **WEAK_INFERENCE**: Requires multiple assumptions, external information, or causal reasoning not present in the filing.

Rules for claims:
- Every segment name → one claim with source snippet from the filing
- Every product category → one claim with source snippet
- Every product within a category → one claim with source snippet
- Every customer type assertion → one claim
- If you cannot find a source snippet for a product → mark evidence level as [UNSUPPORTED] and DO NOT include it in the final architecture JSON
- If information comes from the company's IR website but is NOT in any SEC filing → mark [IR_ONLY] and list separately
- If information is only in a press release, not the 10-K → mark [PRESS_RELEASE_ONLY]

### Phase 2: Architecture Assembly

After all claims are listed, assemble them into the final output. ONLY include items that have claims with evidence level [DISCLOSED] or [STRONG_INFERENCE].

---

## Required Output Format

### I. Segment-Level Product Architecture
For each reported segment, provide:
1. **Segment Name** — exact name from filing
2. **Source** — claim_id + filing reference
3. **Major Product Categories**
4. **Sub-products / Brands / Platforms** — each with its own claim_id
5. **Customer Type** (Consumer / Enterprise / Government / Mixed)
6. **Evidence Level** per item

### II. Source References
- Filing name + year + specific page/section for each segment and product
- Earnings release quarter + specific section
- Website URLs tagged as [IR_ONLY] if not filing-backed

### III. Boundary Conditions
Use these tags where applicable:
- **[RESTATED]** — segment structure changed in most recent filing; use new structure
- **[PENDING_BREAKOUT]** — business acquired mid-year, not yet reported as separate segment
- **[DISCONTINUED as of YYYY-QN]** — product or business line discontinued
- **[UNMAPPED]** — product exists in filing but cannot determine segment assignment; do NOT guess
- **[IR_ONLY]** — found on investor relations website but not in any SEC filing
- **[PRESS_RELEASE_ONLY]** — found in earnings press release but not in 10-K

### IV. Self-Check
After completing the architecture, output this validation block:

```json
{
  "self_check": {
    "segments_in_10K_footnote": "[count from the segment information note]",
    "segments_in_your_output": "[count in your output]",
    "match": true or false,
    "claims_DISCLOSED": "[count]",
    "claims_STRONG_INFERENCE": "[count]",
    "claims_WEAK_INFERENCE": "[count]",
    "claims_UNSUPPORTED_excluded": "[count]",
    "items_IR_ONLY": "[count]"
  }
}
```

The segment counts MUST match. If they do not, explain the discrepancy before proceeding.

### V. Structured JSON

```json
{
  "architecture": [
    {
      "segment": "Exact Segment Name from Filing",
      "claim_id": "S1-001",
      "source_snippet": "exact quote from filing",
      "source_location": "10-K FY20XX, Note XX, p.XX",
      "evidence_level": "DISCLOSED",
      "offerings": [
        {
          "category": "Product Category Name",
          "products": ["Product A", "Product B"],
          "claim_id": "S1-003",
          "source_snippet": "exact quote",
          "source_location": "10-K FY20XX, p.XX",
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
  "sources": [
    {
      "segment": "Segment Name",
      "source": "Filing/Section Name",
      "link": "https://..."
    }
  ]
}
```

---

## ════════════════════════════════════════
## VALIDATION LAYER (run AFTER generation)
## ════════════════════════════════════════

After the above output is generated, run the following three checkpoints and one audit using different models.

### 🟢 Checkpoint A — Segment Count Verification
**Model: Gemini Flash / GPT-4o-mini / Haiku (basic model)**

```
You are a counter. Do NOT analyze, explain, or add any commentary.

Task: Read the following text from a 10-K filing's segment footnote.
Count the number of REPORTABLE OPERATING SEGMENTS mentioned.

--- START 10-K TEXT ---
[PASTE: the company's 10-K segment information footnote text]
--- END 10-K TEXT ---

Reply with ONLY a single number. Nothing else.
```

→ Compare to self_check.segments_in_your_output. Must match.
→ MATCH = PASS. MISMATCH = STOP.

---

### 🟢 Checkpoint B — Segment Name Exact Match
**Model: Gemini Flash / GPT-4o-mini / Haiku (basic model)**

```
You are a text matcher. Do NOT analyze, explain, or add any commentary.

Task: Check if each segment name in List A appears in Text B.
An exact match or officially stated alternative name counts as FOUND.

List A (segment names from AI report):
1. [segment_name_1]
2. [segment_name_2]
3. [segment_name_3]

Text B (from 10-K segment disclosure):
--- START ---
[PASTE: 10-K segment disclosure paragraph]
--- END ---

Reply ONLY in this format:
1. FOUND or NOT_FOUND
2. FOUND or NOT_FOUND
3. FOUND or NOT_FOUND
```

→ Any NOT_FOUND = that segment may be hallucinated. Review before proceeding.

---

### 🟢 Checkpoint C — Source Snippet Verification (Random Sample)
**Model: Gemini Flash / GPT-4o-mini / Haiku (basic model)**

```
You are a quote verifier. Do NOT analyze, explain, or add any commentary.

Task: For each claim below, check if the SOURCE_SNIPPET actually
appears in the provided filing text.

Claim 1:
  SNIPPET: "[paste exact source_snippet from a random claim]"
  CLAIMED LOCATION: [paste source_location]

Claim 2:
  SNIPPET: "[paste from another random claim]"
  CLAIMED LOCATION: [paste source_location]

Claim 3:
  SNIPPET: "[paste from another random claim]"
  CLAIMED LOCATION: [paste source_location]

Claim 4:
  SNIPPET: "[paste from another random claim]"
  CLAIMED LOCATION: [paste source_location]

Claim 5:
  SNIPPET: "[paste from another random claim]"
  CLAIMED LOCATION: [paste source_location]

Filing text:
--- START ---
[PASTE: relevant sections of the 10-K]
--- END ---

For each claim, reply ONLY:
1. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
2. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
3. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
4. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
5. FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND
```

→ Any NOT_FOUND on a [DISCLOSED] claim = possible hallucination. Must investigate.

---

### 🟡 Claim-Support-Fit Audit
**Model: A DIFFERENT advanced model from the one that generated Step 1**
**(e.g., if Step 1 was generated by Claude, run this on GPT-4o, or vice versa)**

```
You are a skeptical financial auditor. You did NOT write this report.
Your job is to find gaps between what the source snippets actually say
and what the claims assert.

## Task
For each claim below, answer FOUR questions:

1. SUPPORTED PORTION: Which specific part of the claim text is
   directly stated in the source snippet? Be specific — quote it.

2. UNSUPPORTED PORTION: Which part of the claim goes BEYOND what
   the source snippet says? This includes:
   - Product lists that are assembled from multiple places in the filing
     rather than appearing together in one location
   - Category assignments the filing doesn't explicitly make
   - Customer type assertions the filing doesn't directly state
   - Any causal or comparative claims the snippet doesn't contain

3. EVIDENCE LEVEL CHECK: Is the assigned evidence level correct?
   - If the claim says [DISCLOSED] but the snippet doesn't directly
     state the full claim → OVERLABELED (should be STRONG_INFERENCE or lower)
   - If the claim says [STRONG_INFERENCE] but it actually requires
     multiple assumptions → OVERLABELED (should be WEAK_INFERENCE)

4. FIT VERDICT:
   - FULL_SUPPORT: The snippet fully supports the entire claim
   - PARTIAL_SUPPORT: The snippet supports facts but not the full assertion
   - SNIPPET_MISMATCH: The snippet doesn't relate to the claim

## Claims to audit:
[PASTE: ALL claims from Phase 1 of the Step 1 output]

## Filing text for reference:
[PASTE: relevant 10-K sections]

## Output format (per claim):
CLAIM: [id]
Supported: "[the part the snippet directly says]"
Unsupported: "[the part that goes beyond]" or "NONE"
Level check: CORRECT / OVERLABELED → should be [X]
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```

→ Any OVERLABELED → downgrade the evidence level in the JSON before passing to Step 2.
→ Any SNIPPET_MISMATCH → remove the claim or provide a new source.
→ Any PARTIAL_SUPPORT → note which part is unsupported; if it's a product list assembled from multiple places, either break into separate claims or downgrade to STRONG_INFERENCE.

---

### ⚫ Gate Decision

```
Review results:
  Checkpoint A (segment count):     PASS / FAIL
  Checkpoint B (name match):        X/N found
  Checkpoint C (snippet verify):    X/5 verified
  Claim-Support-Fit audit:          X FULL / Y PARTIAL / Z MISMATCH

GATE RULES:
  Checkpoint A = FAIL → STOP. Cannot proceed to Step 2.
  Checkpoint B has any NOT_FOUND → fix that segment before proceeding.
  Checkpoint C has NOT_FOUND on any [DISCLOSED] claim → re-examine claim.
  Any SNIPPET_MISMATCH → must fix or remove claim before Step 2.
  Any OVERLABELED → downgrade evidence level in JSON, then proceed.

  ALL checks pass → Proceed to Step 2 with the validated JSON.
```
