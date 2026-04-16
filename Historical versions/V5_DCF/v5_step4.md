# Step 4: Cross-Business Synergy & Flywheel Analysis (v5 — Validated)

---

## 1. Objective
Identify how the core capabilities of one business line act as a technology or operational input into another business line's product — and trace that penetration to measurable product and financial outcomes.

This is NOT an analysis of shared infrastructure or resource allocation. The question is: does Business A's deepest competency show up as a differentiated feature or cost advantage inside Business B's product?

---

## 2. Input Data
- **Business Architecture:** [PASTE VALIDATED STEP 1 JSON]
- **Financial History:** [PASTE STEP 2 CSV]
- **Competitive Landscape:** [PASTE STEP 3 OUTPUT]

---

## 3. Capability Penetration Framework

### 3A — Identify Core Capabilities Per Business Line
For each business line in Step 1, define its **single deepest competency**: the thing it does that no pure-play competitor in Step 3 can easily replicate.
- One capability per business line
- Do NOT list generic strengths
- Must be grounded in what Step 3 shows competitors cannot match

### 3B — Map Penetration Paths
For each capability: does it show up as a feature, cost input, or operational advantage inside any other business line's product?

For each valid path, define:
- **The Capability:** What exactly is being transferred
- **The Mechanism:** How it enters the recipient (embedded model, shared API, internal tooling, shared dataset)
- **The Product Impact:** What the recipient can now do differently or better than its Step 3 competitor
- **What the Competitor Cannot Do:** Structural reason only, not "they're behind"

### 3C — Three-Split Verdict (v5 Core Innovation)

**For EACH synergy, you must provide THREE separate verdicts. These cannot automatically inherit from each other.**

```
SYNERGY: [synergy_id, e.g. SYN-001]
Description: [one-sentence description]

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

VERDICT 3 — FINANCIAL CAUSALITY:
  Claim: [Did this integration cause measurable financial improvement in B?]
  Source snippet: [quote showing causal attribution, or "none — filing does not attribute"]
  Source location: [filing, or "none"]
  Evidence level: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE]
  Financial causality proven: YES / NO
```

**Causal discipline:** For Verdict 3, the source must use causal language (caused, drove, resulted in, due to, because of, contributed to). If the filing only describes the integration without attributing financial outcomes to it, Verdict 3 is [WEAK_INFERENCE] at best.

**Classification:**
- All 3 proven with [DISCLOSED] or [STRONG_INFERENCE] → **"fully_verified_synergy"**
- Integration proven + differentiation/causality only inferred → **"integration_proven_only"**
- Only narrative basis, no specific filing evidence → **"narrative_synergy"**
- No filing evidence at all → **"unsupported_synergy"** → EXCLUDE from output

### 3D — Financial Signatures (from Step 2 data)
For each penetration path, look for in Step 2:

| Signal | Evidence Standard |
|:---|:---|
| Revenue Acceleration | ≥2 consecutive quarters of measurably higher growth vs. pre-deployment period |
| Margin Expansion | ≥100 basis points sustained for 3+ quarters |
| CAC Reduction | Specific metric cited from filing (not inferred) |
| Cost Displacement | Competitor's comparable spend must be cited from their filing |

If NONE of these signals are visible → mark the synergy as "product-only" (real integration but not yet financially material).

### 3E — Flywheel Triple Test
A penetration path qualifies as a **flywheel** only if self-reinforcing:

1. **Reinforcement test:** Name the specific metric in the SOURCE business that improves as a result of the RECIPIENT's growth
2. **Counter-evidence test:** Is there any evidence the loop is NOT working? (e.g., source metric did NOT improve despite recipient growth) → If yes, downgrade to "one-directional"
3. **Time-lag test:** How many quarters between recipient growth and observable source improvement? If >4 quarters with no signal → "unproven_flywheel"

Classification:
- `flywheel` — reinforcement visible in data, counter-evidence absent
- `one-directional` — benefit flows one way only
- `unproven_flywheel` — logical but no data evidence yet
- `product-only` — real synergy, no financial signature

---

## 4. Anti-Speculation Rules
- Every synergy MUST cite a specific SEC filing section (with page or section name)
- If synergy is only in marketing materials → [MARKETING_CLAIM_ONLY] → exclude from financial analysis
- If logically expected but not in filing → [EXPECTED_NOT_DISCLOSED] → note but don't use as Step 5 driver
- NEVER invent synergies. If you can't find evidence, say so.

---

## 5. Output Format

### Synergy Matrix

| Source→Recipient | Integration | Differentiation | Causality | Classification | Flywheel? | Key Claim IDs |
|:---|:---|:---|:---|:---|:---|:---|

### Step 5 Driver Eligibility (CRITICAL)

| Classification | Can drive Step 5 forecast numbers? |
|:---|:---|
| fully_verified_synergy | ✅ Yes |
| integration_proven_only (integration part) | ✅ Yes, conservatively |
| integration_proven_only (causality part) | ⚠️ No — causality is [WEAK_INFERENCE] |
| narrative_synergy | ❌ Context column only in Step 5, cannot drive numbers |
| unsupported_synergy | ❌ Must not appear in Step 5 |

---

## ════════════════════════════════════════
## VALIDATION LAYER (run AFTER generation)
## ════════════════════════════════════════

### 🟢 Checkpoint A — Citation Specificity
**Model: Basic model**

```
You are a citation checker. Do NOT analyze content.

For each synergy below, does the source location include
a specific page number or section name (like "MD&A" or "Note 18")?

1. SYN-001: Source = "[citation text]" → SPECIFIC or VAGUE?
2. SYN-002: Source = "[citation text]" → SPECIFIC or VAGUE?
... [all synergies]
```

→ VAGUE = claim needs more specific sourcing.

---

### 🟢 Checkpoint B — Three-Split Completeness
**Model: Basic model**

```
You are a completeness checker. Do NOT analyze content.

For each synergy, check: does it have ALL THREE verdicts
(Integration, Differentiation, Financial Causality)?
And does each verdict have its own evidence level?

1. SYN-001: Integration verdict? YES/NO | Differentiation? YES/NO | Causality? YES/NO
2. SYN-002: ...

Any synergy missing a verdict → INCOMPLETE
```

→ INCOMPLETE = must add the missing verdict before proceeding.

---

### 🟡 Claim-Support-Fit Audit ⭐ MOST IMPORTANT AUDIT IN THE PIPELINE
**Model: Different advanced model from the generator**

```
You are a skeptical synergy auditor. This is the most critical
audit in the entire pipeline. Your job is to prevent "integration"
from being silently upgraded to "financial causality."

## The core question for each synergy:
"Does the source prove INTEGRATION, DIFFERENTIATION, or CAUSALITY?"
These are THREE DIFFERENT things. Do not let them bleed into each other.

## For each synergy's three verdicts:

### Integration verdict:
- Does the source snippet explicitly describe A's technology being
  used inside B's product?
- If yes → [DISCLOSED] is appropriate
- If source only mentions them in the same paragraph without describing
  a specific mechanism → [WEAK_INFERENCE]

### Differentiation verdict:
- Does the source snippet say B can do something competitors CANNOT?
- Or is this inferred from Step 3's competitor analysis?
- Usually [STRONG_INFERENCE] at best, often [WEAK_INFERENCE]

### Financial causality verdict:
- Does the source snippet attribute B's financial performance to A?
- Does it use causal language (caused, drove, due to, because of)?
- If not → MUST be [WEAK_INFERENCE], regardless of what the generation model labeled

## Red flags to catch:
- "Integration is DISCLOSED" sliding into "therefore causality is DISCLOSED"
- Flywheel feedback loops with no named metric for the reverse direction
- "AI drove growth" when filing only says "we are investing in AI"
- Analyst-style narratives ("platform network effects", "AI flywheel") used as if they were disclosed facts

## Claims to audit:
[PASTE: all synergy claims with three-split verdicts from Step 4]

## Output per synergy:
SYN: [id]
Integration: [confirm / downgrade] → [final evidence level]
Differentiation: [confirm / downgrade] → [final evidence level]
Causality: [confirm / downgrade] → [final evidence level]
Overall classification: [confirm / downgrade]
Issues found: [list] or NONE
```

→ Any causality downgraded to [WEAK_INFERENCE] → that synergy CANNOT drive Step 5 numbers.
→ Update the Synergy Matrix with audited evidence levels before passing to Step 5.

---

### ⚫ Gate Decision

```
Review results:
  Checkpoint A (citations):     X/N specific
  Checkpoint B (three-split):   X/N complete
  Claim-Support-Fit:            X synergies confirmed / Y downgraded

Evidence level changes after audit:
  [List any synergies whose classification changed]

GATE RULES:
  Any synergy with VAGUE citation → must add specific source
  Any synergy INCOMPLETE → must add missing verdict
  Any causality verdict downgraded → update classification before Step 5
  Any "narrative_synergy" or "unsupported_synergy" → ensure excluded from Step 5 drivers

  ALL pass → Proceed to Step 4.5 with audited Synergy Matrix.
```
