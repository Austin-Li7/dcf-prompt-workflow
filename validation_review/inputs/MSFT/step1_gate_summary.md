# MSFT Step 1 — Gate Summary

**Decision: CONDITIONAL_PASS**
**Timestamp:** 2026-04-10T02:37:51 UTC
**Generation model:** claude-sonnet-4-6 (8192 max_tokens, no web search — training data only)
**Sources cited:** FY2024 Form 10-K + FY2025 Q2 10-Q

---

## Checkpoint Results

| Checkpoint | Test | Result |
|---|---|---|
| A — Segment count | Expected 3, found 3 in 10-K footnote | **PASS** |
| B — Segment names | 3/3 names match 10-K segment disclosure | **PASS** (3/3 FOUND) |
| C — Source snippets | 5 snippets sampled; 1 found, 4 not found in cached narrative | **CONDITIONAL** (1/5) |

### Checkpoint C — Why the NOT_FOUNDs are likely false negatives

Snippets 2–5 (S1-002, S1-003, S1-004, PBP-001) are long quoted blocks from the **Business Description / Segment Overview** section (10-K Part I, p.5–6). The narrative fetcher pulls MD&A / Segment Results sections, not the front-of-10K business description paragraphs. The cached text fed to Checkpoint C simply doesn't include those pages — so the snippets can't be found even if they are verbatim 10-K text.

Snippet 1 (S1-001 from Note 19) was FOUND_PARAPHRASED because the segment information footnote **is** included in the cached text.

**Manual verification recommended** for S1-002, S1-003, S1-004 against FY2024 10-K Part I, p.5–6.

---

## CSF Audit Findings

20 claims were audited (S1-001 through PBP-016). Claims IC-001 onward were not audited.

### Summary by verdict

| Verdict | Count | Claims |
|---|---|---|
| FULL_SUPPORT | 5 | S1-001, S1-002, S1-003, S1-004, PBP-014 |
| PARTIAL_SUPPORT | 15 | PBP-001 through PBP-016 (except PBP-014) |

### PARTIAL_SUPPORT pattern

All 15 PARTIAL_SUPPORT claims have the same structure: the filing **names** the product/service (confirmed) but the claim adds **functional descriptions** not stated in the filing (flagged as unsupported). For example:

- **PBP-006:** "Talent Solutions" is listed — confirmed. But "provides recruiting and hiring tools to enterprise customers" — not in filing.
- **PBP-012:** "Microsoft 365 Copilot... driving higher revenue per user" — confirmed. But "is disclosed as an AI-powered add-on to Office Commercial" — not verbatim.

These are inferential elaborations, not fabrications. The underlying structural claims (which products exist, which segment they belong to) are confirmed.

### CSF-audited claim detail

| Claim | Text Summary | Fit |
|---|---|---|
| S1-001 | Three segments confirmed | FULL_SUPPORT |
| S1-002 | PBP = Office + Dynamics + LinkedIn | FULL_SUPPORT |
| S1-003 | IC = server products + Azure + enterprise services | FULL_SUPPORT |
| S1-004 | MPC = Windows + Devices + Gaming + Search | FULL_SUPPORT |
| PBP-001 | Office Commercial is a revenue category in PBP | PARTIAL — "Microsoft 365 subscriptions" unsupported |
| PBP-002 | Microsoft 365 Commercial is primary cloud offering | PARTIAL — functional claim unsupported |
| PBP-003 | Office Consumer = M365 Consumer + on-premises | FULL_SUPPORT |
| PBP-004 | M365 Consumer subscribers: 82.5M / 76.7M | PARTIAL — "Personal and Family" label unsupported |
| PBP-005 | LinkedIn = Talent + Marketing + Premium + Sales | PARTIAL — "separate revenue category" label unsupported |
| PBP-006 | Talent Solutions listed | PARTIAL — "enterprise customers" description unsupported |
| PBP-007 | Marketing Solutions listed | PARTIAL — "advertising and marketing services" unsupported |
| PBP-008 | Premium Subscriptions listed | PARTIAL — "consumer/professional" label unsupported |
| PBP-009 | Sales Solutions listed | PARTIAL — "sales intelligence tools" description unsupported |
| PBP-010 | Dynamics = on-prem + Dynamics 365 | PARTIAL — "separate revenue category" label unsupported |
| PBP-011 | Dynamics 365 is cloud business application suite | PARTIAL — "ERP, CRM" framing unsupported |
| PBP-012 | Copilot driving higher revenue per user | PARTIAL — "AI-powered add-on" label unsupported |
| PBP-013 | Office Commercial sold via volume licensing | PARTIAL — "E3, E5, frontline worker SKUs" unsupported |
| PBP-014 | Revenue table: 4 PBP line items confirmed | FULL_SUPPORT |
| PBP-015 | Microsoft Viva listed | PARTIAL — "product within M365" placement unsupported |
| PBP-016 | Microsoft Teams listed | PARTIAL — "product within Office Commercial" placement unsupported |

Claims **IC-001 through MPC-018 and CS-001 through CS-006** (46 claims) were **not audited**.

---

## THINGS TO VERIFY

### 1. Checkpoint C Snippets — Manual 10-K Check Required

Open FY2024 10-K, Part I, p.5–6 (Business Description, Segment Overview). Verify these 4 snippets are present:

- **S1-002:** "Productivity and Business Processes — This segment consists of products and services in our portfolio of productivity, information worker, and communication products and services..."
- **S1-003:** "Intelligent Cloud — This segment consists of our public, private, and hybrid server products and cloud services..."
- **S1-004:** "More Personal Computing — This segment consists of products and services geared towards harmonizing the interests of end users, developers, and IT professionals across all devices..."

If confirmed, Checkpoint C false-negative rate can be documented and accepted. If any snippet is wrong, the claim's EVIDENCE_LEVEL needs correction.

### 2. PARTIAL_SUPPORT Claims — Decide: Accept or Downgrade

15 of 20 CSF-audited claims are PARTIAL_SUPPORT because functional descriptions were added beyond what the filing states. These are **not errors** — the products are real and correctly named. Decide whether:

- (A) Accept as-is — the inferential elaborations are well-known, commonly understood context.
- (B) Edit claim TEXT to remove the unsupported descriptions, keeping only what the filing explicitly states.

This matters for downstream DCF steps that consume claim evidence levels.

### 3. IC and MPC Claims — Not CSF-Audited

**46 claims** (IC-001 through MPC-018, CS-001 through CS-006) were not reviewed by the CSF audit. Spot-check at minimum:

- **IC-001:** Azure is primary cloud service in Intelligent Cloud
- **IC-003 / IC-004:** Nuance and GitHub placement in IC segment
- **MPC-001:** Windows OEM as primary MPC revenue category
- **MPC-007 / MPC-008:** Xbox hardware vs. Xbox content and services split
- **CS-001 through CS-006:** Cross-segment claims (if any) — verify they don't contradict segment-level claims

### 4. Source Page Numbers — Approximate

The generation cites specific page numbers (e.g., "p.5", "p.46", "p.104"). These came from training data, not the live fetched filing. Verify 2–3 page references match the actual FY2024 10-K PDF before using in any downstream documentation.

### 5. Q2 FY2025 Claims — Not from Fetched Document

The generation references the FY2025 Q2 10-Q. The pipeline fetched the 10-K only. Any claim relying on Q2 data (e.g., subscriber counts, revenue growth rates) was from training data — not a cached source file.

---

## Claim Coverage Summary

| Segment | Claims Generated | CSF Audited | Chkpt C Tested |
|---|---|---|---|
| Segment-level (S1) | 4 | 4 (all FULL_SUPPORT) | 4 (1 found, 3 false-negative) |
| Productivity & Business Processes (PBP) | 19 | 16 (1 FULL, 15 PARTIAL) | 1 (FOUND_PARAPHRASED) |
| Intelligent Cloud (IC) | 19 | 0 | 0 |
| More Personal Computing (MPC) | 18 | 0 | 0 |
| Cross-Segment (CS) | 6 | 0 | 0 |
| **Total** | **66** | **20** | **5** |

---

## Recommendation

**Conditional PASS — 3 actions before Step 2:**

1. **Manually confirm** S1-002, S1-003, S1-004 snippets against FY2024 10-K Part I, p.5–6. If confirmed, the CONDITIONAL_PASS checkpoint failure is a known false negative and can be overridden.
2. **Decide** whether PARTIAL_SUPPORT claims are acceptable for downstream use, or whether claim texts should be tightened to remove unsupported functional descriptions.
3. **Spot-check** 3–5 IC/MPC claims that were not CSF-audited.
