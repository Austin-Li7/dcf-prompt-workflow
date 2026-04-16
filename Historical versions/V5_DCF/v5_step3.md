# Step 3: Competitive Landscape & Porter's Five Forces Analysis (v5 — Validated)

---

## 1. Objective
Based on the Business Architecture defined in the Step 1 JSON, identify the primary competitor for each Product Category and conduct a rigorous strategic analysis using Porter's Five Forces framework.

Please use the following validated JSON architecture:
[PASTE YOUR VALIDATED STEP 1 JSON HERE]

---

## 2. Competitor Identification Logic
For each Product Category identified in the architecture:
* If the Subject Company is the **Market Leader**, identify the **#2 player (Primary Challenger)**
* If the Subject Company is **NOT the leader**, identify the **Current Market Leader (Gold Standard)**

### Evidence Requirements
The competitor pairing MUST be backed by at least ONE of:
- Market share data with named source (e.g., "IDC Worldwide Cloud 2025: AWS 31%, Azure 25%")
- Analyst report with report name + year (e.g., "Gartner Magic Quadrant for Cloud Infrastructure, 2025")
- Revenue comparison from the competitor's public SEC filing

**Allowed source types:**
- SEC filings / annual reports (subject or competitor)
- Earnings press releases
- Named analyst reports: IDC, Gartner, Forrester, Canalys, StatCounter
- Official investor presentations

**NOT allowed as sole basis:**
- "Industry consensus" / "various reports" / "analyst estimates"
→ If these are your only basis: mark [QUALITATIVE_BASIS — no authoritative source found]
→ Do NOT fabricate report names, specific market share percentages, or Gartner quadrant positions

---

## 3. Output Method: CLAIMS FIRST

### Phase 1: Competitor Pairing Claims
For each category, output:

```
CLAIM: [claim_id, e.g. C3-001]
TEXT: [the competitive positioning statement]
SOURCE_SNIPPET: [exact quote or data point from the source]
SOURCE_LOCATION: [source name, year, page/section]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE / QUALITATIVE_BASIS]
```

### Phase 2: Porter's Five Forces Claims
For each force within each category, output:

```
CLAIM: [claim_id, e.g. C3-010]
TEXT: [the force rating and justification]
SOURCE_SNIPPET: [the specific data point supporting the rating — a number, not vague words]
SOURCE_LOCATION: [source]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
```

### Causal Discipline
When describing WHY a force is rated High/Medium/Low:
- If the source DIRECTLY uses causal language (e.g., "barriers to entry are high due to...") → [DISCLOSED]
- If you are INFERRING causality from a data point → must label [WEAK_INFERENCE] and rewrite as correlation:
  ❌ "High rivalry is caused by low switching costs"
  ✅ "High rivalry coincides with low observed switching costs [WEAK_INFERENCE]"

### Phase 3: Assembled Output

For every Category in the JSON:

```
### Category: [Category Name]
- **Primary Competitor:** [Competitor Name]
- **Competitive Status:** [Subject is Leader / Subject is Challenger]
- **Basis for Pairing:** [claim_id + evidence] or [QUALITATIVE_BASIS]

| Porter's Force | Rating | Quantitative Anchor | Evidence Level | Source | Justification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Intensity of Rivalry | [H/M/L] | [specific number] | [level] | [source] | [1-2 sentences] |
| Threat of New Entrants | [H/M/L] | [specific number] | [level] | [source] | [1-2 sentences] |
| Power of Suppliers | [H/M/L] | [specific number] | [level] | [source] | [1-2 sentences] |
| Power of Buyers | [H/M/L] | [specific number] | [level] | [source] | [1-2 sentences] |
| Threat of Substitutes | [H/M/L] | [specific number] | [level] | [source] | [1-2 sentences] |
```

"Quantitative Anchor" = a specific number: market share %, revenue figure, CapEx threshold, customer concentration ratio, etc. If truly no number exists for a force → write [NO_QUANTITATIVE_DATA] and provide qualitative basis instead. Do NOT fabricate percentages.

---

## 4. Execution Rules
* Analyze EVERY category defined in the Step 1 JSON
* The analysis must reflect current market conditions
* Focus on commercial/enterprise reality and structural industry dynamics
* Every data point cited must include: source name + year
* If a data point comes from the subject company's own filing → note [SELF-REPORTED]

---

## ════════════════════════════════════════
## VALIDATION LAYER (run AFTER generation)
## ════════════════════════════════════════

### 🟢 Checkpoint A — Competitor Existence Verification
**Model: Basic model (Gemini Flash / Haiku / GPT-4o-mini)**

```
You are a fact checker. Do NOT analyze or explain.

For each pair below, answer: does the named competitor operate in the
same product category as described?

1. Category: "[Category 1]" — Competitor: "[Competitor X]" → YES / NO / UNSURE
2. Category: "[Category 2]" — Competitor: "[Competitor Y]" → YES / NO / UNSURE
3. [repeat for all pairings]
```

→ Any NO = that pairing is likely wrong. Review.
→ UNSURE = acceptable but note for human review.

---

### 🟢 Checkpoint B — Evidence Has Specific Data
**Model: Basic model**

```
You are a format checker. Do NOT analyze content quality.

For each Porter force row in the table below, check:
Does the "Quantitative Anchor" column contain a SPECIFIC NUMBER
(a percentage, dollar amount, count, ratio)?
Or does it contain only vague words ("significant", "many", "generally")?

[PASTE: the Porter table rows from all categories]

Reply per row:
Category 1 / Rivalry: HAS_NUMBER or NO_NUMBER
Category 1 / New Entrants: HAS_NUMBER or NO_NUMBER
... [all rows]
```

→ NO_NUMBER on more than 50% of rows = the analysis lacks rigor. Consider re-generating.

---

### 🟡 Claim-Support-Fit Audit
**Model: Different advanced model from the generator**

```
You are a skeptical competitive analyst auditor.

## Task
For each competitive claim, evaluate:

1. Does the source snippet ACTUALLY support the claim?
   - Market share number: is the exact figure in the snippet?
   - Analyst report: does the report name + year look real and verifiable?
     If you cannot verify the report exists → mark [CITATION_UNVERIFIABLE]

2. For Porter force ratings — does the evidence prove the RATING
   or just describe a related fact?
   Example: "AWS spent $50B on CapEx" is a fact.
   "Therefore barriers to entry are HIGH" is an inference.
   → The fact is [DISCLOSED]. The rating conclusion is [STRONG_INFERENCE] at best.

3. For any causal claim:
   Does the source snippet contain causal language (caused, drove, because, resulted in)?
   → If NO → the claim must be [WEAK_INFERENCE] regardless of its current label

## Claims to audit:
[PASTE: all Step 3 claims]

## Output per claim:
CLAIM: [id]
Snippet supports claim: FULLY / PARTIALLY / NOT_AT_ALL
Source verifiable: YES / UNVERIFIABLE
Causal language in source: YES / NO
Level check: CORRECT / OVERLABELED → should be [X]
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```

---

### 🔵 Cross-Model Generation (RECOMMENDED for this step)
**Model: A different advanced model from the generator**

Run the exact same Step 3 prompt with a different advanced model (e.g., if Step 3 was generated by Claude, re-run on GPT-4o, or vice versa).

Then compare outputs — DO NOT auto-merge or auto-average:

| Dimension | Model A | Model B | Status |
|:---|:---|:---|:---|
| Competitor for Category 1 | [name] | [name] | CONSENSUS or CONFLICT |
| Competitor for Category 2 | [name] | [name] | CONSENSUS or CONFLICT |
| Market share % cited | [X]% | [Y]% | CONSENSUS (<5pp gap) or DIVERGENCE |
| Rivalry rating for Cat 1 | [H/M/L] | [H/M/L] | CONSENSUS or CONFLICT |

→ CONSENSUS = keep
→ CONFLICT = human must decide. Do NOT auto-select either side.
→ DIVERGENCE in numbers = trace both to original sources, human picks the verified one.

---

### ⚫ Gate Decision

```
Review results:
  Checkpoint A (competitors):    X/N confirmed
  Checkpoint B (evidence data):  X/N have numbers
  Claim-Support-Fit:             X FULL / Y PARTIAL / Z issues
  Cross-Model (if run):          X consensus / Y conflicts

GATE RULES:
  Any competitor NOT confirmed → review pairing
  >50% of forces lack quantitative anchor → consider re-generating
  Any SNIPPET_MISMATCH → fix or remove claim
  Any OVERLABELED → downgrade evidence level
  Cross-model CONFLICT → human resolves before proceeding

  ALL pass → Proceed to Step 4.
```
