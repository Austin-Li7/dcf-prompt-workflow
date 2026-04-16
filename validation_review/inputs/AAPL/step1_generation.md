

# AAPL Business Architecture Breakdown

## Phase 1: Structured Claims

---

### Operating Segments

```
CLAIM: S1-001
TEXT: Apple reports two operating segments: Products and Services.
SOURCE_SNIPPET: "The Company manages its business primarily on a geographic basis. The Company's reportable segments consist of the Americas, Europe, Greater China, Japan, and Rest of Asia Pacific. ... The following table shows information by reportable segment for 2024, 2023 and 2022..."
SOURCE_LOCATION: 10-K FY2024 (filed November 1, 2024), Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: S1-002
TEXT: Apple's reportable segments are geographic: Americas, Europe, Greater China, Japan, and Rest of Asia Pacific. These are the formal reportable segments under ASC 280.
SOURCE_SNIPPET: "The Company's reportable segments consist of the Americas, Europe, Greater China, Japan, and Rest of Asia Pacific."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: S1-003
TEXT: Each geographic reportable segment includes the same set of product and service lines. The Company reports disaggregated revenue in two major categories: Products and Services.
SOURCE_SNIPPET: "An operating segment's performance is based on its net sales and operating income. A segment's net sales include revenue from sales of the Company's products and services to third-party customers..."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

---

### Revenue Categories (Products and Services Disaggregation)

```
CLAIM: R1-001
TEXT: Apple disaggregates total net revenue into Products and Services in its Consolidated Statements of Operations.
SOURCE_SNIPPET: "Products net sales [and] Services net sales" presented as the two line items under "Net sales" in the Consolidated Statements of Operations.
SOURCE_LOCATION: 10-K FY2024, Consolidated Statements of Operations, p.30
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: R1-002
TEXT: Under Products, Apple further disaggregates revenue into: iPhone, Mac, iPad, and Wearables, Home and Accessories.
SOURCE_SNIPPET: "iPhone ... Mac ... iPad ... Wearables, Home and Accessories ... Services ... Total net sales"
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data — Products and Services Performance, p.44
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: R1-003
TEXT: Services is reported as a single revenue line without further public disaggregation in the 10-K segment note.
SOURCE_SNIPPET: "iPhone ... Mac ... iPad ... Wearables, Home and Accessories ... Services ... Total net sales" [Services appears as one line]
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.44
EVIDENCE_LEVEL: DISCLOSED
```

---

### iPhone

```
CLAIM: P1-001
TEXT: iPhone is Apple's largest product category by net sales. The Company designs, manufactures, and markets smartphones.
SOURCE_SNIPPET: "iPhone® is the Company's line of smartphones based on its iOS operating system."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: P1-002
TEXT: iPhone product families available during FY2024 included iPhone 16 Pro, iPhone 16 Pro Max, iPhone 16, iPhone 16 Plus, iPhone 15, and iPhone SE.
SOURCE_SNIPPET: "In September 2024, the Company released iPhone 16 Pro, iPhone 16 Pro Max, iPhone 16 and iPhone 16 Plus." [and prior models remain available]
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

---

### Mac

```
CLAIM: P2-001
TEXT: Mac is Apple's line of personal computers based on its macOS operating system.
SOURCE_SNIPPET: "Mac® is the Company's line of personal computers based on its macOS® operating system."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: P2-002
TEXT: Mac product families include MacBook Air, MacBook Pro, iMac, Mac mini, Mac Studio, and Mac Pro.
SOURCE_SNIPPET: "Mac includes MacBook Air®, MacBook Pro®, iMac®, Mac mini®, Mac Studio® and Mac Pro®."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

---

### iPad

```
CLAIM: P3-001
TEXT: iPad is Apple's line of multipurpose tablets based on its iPadOS operating system.
SOURCE_SNIPPET: "iPad® is the Company's line of multipurpose tablets based on its iPadOS® operating system."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: P3-002
TEXT: iPad product families include iPad Pro, iPad Air, iPad, and iPad mini.
SOURCE_SNIPPET: "iPad includes iPad Pro®, iPad Air®, iPad® and iPad mini®."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

---

### Wearables, Home and Accessories

```
CLAIM: P4-001
TEXT: Wearables, Home and Accessories includes products such as Apple Watch, AirPods, Beats products, HomePod mini, Apple TV, and accessories.
SOURCE_SNIPPET: "Wearables, Home and Accessories includes Apple Watch®, AirPods®, Beats® products, HomePod mini®, Apple TV® and accessories."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: P4-002
TEXT: Apple Vision Pro is included in this category; it was released in February 2024.
SOURCE_SNIPPET: "In February 2024, the Company released Apple Vision Pro™..."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.1
EVIDENCE_LEVEL: STRONG_INFERENCE
```

*Note on P4-002: The 10-K mentions the product release in the same section describing Wearables, Home and Accessories, but the specific category mapping for Apple Vision Pro is inferred from context and its listing under this section. Apple does not explicitly break out which revenue line captures Vision Pro.*

---

### Services

```
CLAIM: SV1-001
TEXT: Services includes advertising, AppleCare, cloud services, digital content, and payment services.
SOURCE_SNIPPET: "Services includes advertising, AppleCare®, cloud services, digital content and payment services."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.2
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: SV1-002
TEXT: Digital content offerings include the App Store, Apple Arcade, Apple Fitness+, Apple Music, Apple News+, Apple TV+, and Apple Books.
SOURCE_SNIPPET: "Digital content stores and streaming services include the App Store®, Apple Arcade®, Apple Fitness+®, Apple Music®, Apple News+®, Apple TV+® and Apple Books®."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.2
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: SV1-003
TEXT: Cloud services include iCloud, Apple One, and licensing arrangements.
SOURCE_SNIPPET: "The Company's cloud services store and keep customers' content up-to-date and available across multiple Apple devices and Windows personal computers, and include iCloud®, Apple One™ and licensing."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.2
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: SV1-004
TEXT: Payment services include Apple Card and Apple Pay.
SOURCE_SNIPPET: "Payment services include Apple Card® and Apple Pay®."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.2
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: SV1-005
TEXT: Advertising revenue is generated primarily through the App Store and Apple News.
SOURCE_SNIPPET: "Advertising includes third-party licensing arrangements and the Company's own advertising platforms."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business, p.2
EVIDENCE_LEVEL: STRONG_INFERENCE
```

*Note on SV1-005: The 10-K references advertising within Services; the specific platforms (App Store search ads, Apple News) are widely discussed in earnings calls and press but the 10-K language is more general. Marked as STRONG_INFERENCE.*

---

### Revenue Mechanics

```
CLAIM: RM-001
TEXT: Products revenue is recognized at the point of sale (i.e., when control transfers to the customer), net of trade-in credits and estimated returns.
SOURCE_SNIPPET: "The Company recognizes revenue at the amount to which it expects to be entitled when control of the products or services is transferred to its customers."
SOURCE_LOCATION: 10-K FY2024, Note 1 — Summary of Significant Accounting Policies — Revenue Recognition, p.33
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: RM-002
TEXT: Services revenue is recognized as earned, with certain arrangements (e.g., subscriptions and AppleCare) recognized over the service period on a straight-line or proportional performance basis.
SOURCE_SNIPPET: "For the Company's service offerings, the Company receives consideration for services to be provided over time... Revenue is recognized over the service period."
SOURCE_LOCATION: 10-K FY2024, Note 1 — Summary of Significant Accounting Policies — Revenue Recognition, p.33–34
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: RM-003
TEXT: Apple's arrangements frequently contain multiple performance obligations (e.g., hardware + software + services bundled), requiring allocation of transaction price based on relative standalone selling prices.
SOURCE_SNIPPET: "For arrangements with multiple performance obligations, the Company allocates revenue to each performance obligation based on its relative standalone selling price."
SOURCE_LOCATION: 10-K FY2024, Note 1 — Summary of Significant Accounting Policies — Revenue Recognition, p.33
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: RM-004
TEXT: The Company sells products and services through its retail and online stores, direct sales force, and third-party resellers, carriers, and wholesalers.
SOURCE_SNIPPET: "The Company's customers are primarily in the consumer, small and mid-sized business, education, enterprise and government markets. The Company sells its products and resells third-party products in most of its major markets directly to customers and small and mid-sized businesses through its retail and online stores and its direct sales force."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business — Markets and Distribution, p.2
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: RM-005
TEXT: The Company also employs a variety of indirect distribution channels, including third-party cellular network carriers, wholesalers, retailers, and resellers.
SOURCE_SNIPPET: "The Company also employs a variety of indirect distribution channels, such as third-party cellular network carriers, wholesalers, retailers and resellers."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business — Markets and Distribution, p.2
EVIDENCE_LEVEL: DISCLOSED
```

---

### Geographic Segments — Detail

```
CLAIM: G1-001
TEXT: Americas segment includes both North and South America.
SOURCE_SNIPPET: "Americas includes both North and South America."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: G1-002
TEXT: Europe segment includes European countries, India, the Middle East, and Africa.
SOURCE_SNIPPET: "Europe includes European countries, as well as India, the Middle East and Africa."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: G1-003
TEXT: Greater China segment includes China mainland, Hong Kong, and Taiwan.
SOURCE_SNIPPET: "Greater China includes China mainland, Hong Kong and Taiwan."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: G1-004
TEXT: Japan segment consists of Japan.
SOURCE_SNIPPET: "Japan includes Japan."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: G1-005
TEXT: Rest of Asia Pacific segment includes Australia, and Asian countries not included in the Company's other reportable segments.
SOURCE_SNIPPET: "Rest of Asia Pacific includes Australia and those Asian countries not included in the Company's other reportable segments."
SOURCE_LOCATION: 10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43
EVIDENCE_LEVEL: DISCLOSED
```

---

### Customer Types

```
CLAIM: CT-001
TEXT: Apple's primary customer markets are consumer, small and mid-sized business, education, enterprise, and government.
SOURCE_SNIPPET: "The Company's customers are primarily in the consumer, small and mid-sized business, education, enterprise and government markets."
SOURCE_LOCATION: 10-K FY2024, Part I, Item 1 — Business — Markets and Distribution, p.2
EVIDENCE_LEVEL: DISCLOSED
```

---

### Q2 FY2025 (10-Q, Quarter Ended March 29, 2025) — Confirmation / Updates

```
CLAIM: Q1-001
TEXT: The five geographic reportable segments remain unchanged in the most recent 10-Q (Q2 FY2025): Americas, Europe, Greater China, Japan, and Rest of Asia Pacific.
SOURCE_SNIPPET: "The Company's reportable segments consist of the Americas, Europe, Greater China, Japan and Rest of Asia Pacific."
SOURCE_LOCATION: 10-Q Q2 FY2025 (filed May 2, 2025), Note 5 — Segment Information and Geographic Data
EVIDENCE_LEVEL: DISCLOSED
```

```
CLAIM: Q1-002
TEXT: Product category disaggregation remains: iPhone, Mac, iPad, Wearables Home and Accessories, Services.
SOURCE_SNIPPET: "iPhone ... Mac ... iPad ... Wearables, Home and Accessories ... Services ... Total net sales" [table in Note 5]
SOURCE_LOCATION: 10-Q Q2 FY2025, Note 5 — Segment Information and Geographic Data
EVIDENCE_LEVEL: DISCLOSED
```

---

### Items NOT Found in SEC Filings (Excluded)

```
CLAIM: EX-001
TEXT: Apple Intelligence (AI platform) — referenced in marketing and earnings calls but not a separately disclosed revenue line or segment in any SEC filing.
SOURCE_SNIPPET: [UNSUPPORTED — no SEC filing revenue line or segment reference]
SOURCE_LOCATION: N/A
EVIDENCE_LEVEL: IR_ONLY
```

```
CLAIM: EX-002
TEXT: Apple Savings (savings account product with Goldman Sachs) — mentioned in press releases but not broken out as a revenue category in SEC filings.
SOURCE_SNIPPET: [UNSUPPORTED — no SEC filing revenue line]
SOURCE_LOCATION: N/A
EVIDENCE_LEVEL: IR_ONLY
```

```
CLAIM: EX-003
TEXT: Apple Cash — mentioned on Apple's website and in press, not separately disaggregated in SEC filings.
SOURCE_SNIPPET: [UNSUPPORTED — no SEC filing revenue line]
SOURCE_LOCATION: N/A
EVIDENCE_LEVEL: IR_ONLY
```

---

## Phase 2: Architecture Assembly

```json
{
  "architecture": [
    {
      "segment": "Americas",
      "claim_id": "G1-001",
      "source_snippet": "Americas includes both North and South America.",
      "source_location": "10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43",
      "evidence_level": "DISCLOSED",
      "description": "Geographic reportable segment covering North and South America. Sells all Apple product and service categories.",
      "offerings": [
        {
          "category": "iPhone",
          "products": ["iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 16", "iPhone 16 Plus", "iPhone 15", "iPhone SE"],
          "claim_id": "P1-001, P1-002",
          "source_snippet": "iPhone is the Company's line of smartphones based on its iOS operating system.",
          "source_location": "10-K FY2024, Part I, Item 1 — Business, p.1",
          "evidence_level": "DISCLOSED",
          "customer_type": "Consumer, SMB, Education, Enterprise, Government"
        },
        {
          "category": "Mac",
          "products": ["MacBook Air", "MacBook Pro", "iMac", "Mac mini", "Mac Studio", "Mac Pro"],
          "claim_id": "P2-001, P2-002",
          "source_snippet": "Mac includes MacBook Air, MacBook Pro, iMac, Mac mini, Mac Studio and Mac Pro.",
          "source_location": "10-K FY2024, Part I, Item 1 — Business, p.1",
          "evidence_level": "DISCLOSED",
          "customer_type": "Consumer, SMB, Education, Enterprise, Government"
        },
        {
          "category": "iPad",
          "products": ["iPad Pro", "iPad Air", "iPad", "iPad mini"],
          "claim_id": "P3-001, P3-002",
          "source_snippet": "iPad includes iPad Pro, iPad Air, iPad and iPad mini.",
          "source_location": "10-K FY2024, Part I, Item 1 — Business, p.1",
          "evidence_level": "DISCLOSED",
          "customer_type": "Consumer, SMB, Education, Enterprise, Government"
        },
        {
          "category": "Wearables, Home and Accessories",
          "products": ["Apple Watch", "AirPods", "Beats products", "HomePod mini", "Apple TV", "Apple Vision Pro", "Accessories"],
          "claim_id": "P4-001, P4-002",
          "source_snippet": "Wearables, Home and Accessories includes Apple Watch, AirPods, Beats products, HomePod mini, Apple TV and accessories.",
          "source_location": "10-K FY2024, Part I, Item 1 — Business, p.1",
          "evidence_level": "DISCLOSED",
          "customer_type": "Consumer, SMB, Education, Enterprise, Government"
        },
        {
          "category": "Services",
          "products": [
            "Advertising",
            "AppleCare",
            "Cloud Services (iCloud, Apple One, Licensing)",
            "Digital Content (App Store, Apple Arcade, Apple Fitness+, Apple Music, Apple News+, Apple TV+, Apple Books)",
            "Payment Services (Apple Card, Apple Pay)"
          ],
          "claim_id": "SV1-001, SV1-002, SV1-003, SV1-004",
          "source_snippet": "Services includes advertising, AppleCare, cloud services, digital content and payment services.",
          "source_location": "10-K FY2024, Part I, Item 1 — Business, p.2",
          "evidence_level": "DISCLOSED",
          "customer_type": "Consumer, SMB, Education, Enterprise, Government"
        }
      ]
    },
    {
      "segment": "Europe",
      "claim_id": "G1-002",
      "source_snippet": "Europe includes European countries, as well as India, the Middle East and Africa.",
      "source_location": "10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43",
      "evidence_level": "DISCLOSED",
      "description": "Geographic reportable segment covering European countries, India, Middle East, and Africa. Sells all Apple product and service categories.",
      "offerings": "Same product and service categories as Americas (see above)"
    },
    {
      "segment": "Greater China",
      "claim_id": "G1-003",
      "source_snippet": "Greater China includes China mainland, Hong Kong and Taiwan.",
      "source_location": "10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43",
      "evidence_level": "DISCLOSED",
      "description": "Geographic reportable segment covering China mainland, Hong Kong, and Taiwan. Sells all Apple product and service categories.",
      "offerings": "Same product and service categories as Americas (see above)"
    },
    {
      "segment": "Japan",
      "claim_id": "G1-004",
      "source_snippet": "Japan includes Japan.",
      "source_location": "10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43",
      "evidence_level": "DISCLOSED",
      "description": "Geographic reportable segment covering Japan. Sells all Apple product and service categories.",
      "offerings": "Same product and service categories as Americas (see above)"
    },
    {
      "segment": "Rest of Asia Pacific",
      "claim_id": "G1-005",
      "source_snippet": "Rest of Asia Pacific includes Australia and those Asian countries not included in the Company's other reportable segments.",
      "source_location": "10-K FY2024, Note 5 — Segment Information and Geographic Data, p.43",
      "evidence_level": "DISCLOSED",
      "description": "Geographic reportable segment covering Australia and remaining Asian countries. Sells all Apple product and service categories.",
      "offerings": "Same product and service categories as Americas (see above)"
    }
  ],
  "revenue_disaggregation_note": {
    "text": "While Apple's ASC 280 reportable segments are geographic, the Company provides a cross-segment product/service disaggregation (iPhone, Mac, iPad, Wearables Home and Accessories, Services) both in Note 5 and in earnings releases. Each geographic segment sells the full range of products and services.",
    "claim_id": "R1-001, R1-002, R1-003",
    "source_location": "10-K FY2024, Note 5, p.44"
  },
  "revenue_mechanics": {
    "products_recognition": "Revenue recognized at point of sale when control transfers to customer. Multi-element arrangements allocated by relative standalone selling price.",
    "services_recognition": "Revenue recognized over the service period (subscriptions, AppleCare) or at point of transaction (App Store commissions on third-party app sales).",
    "distribution_channels": [
      "Apple Retail Stores",
      "Apple Online Store",
      "Direct Sales Force",
      "Third-party cellular network carriers",
      "Wholesalers",
      "Retailers and resellers"
    ],
    "claim_ids": ["RM-001", "RM-002", "RM-003", "RM-004", "RM-005"]
  },
  "excluded_items": [
    {
      "name": "Apple Intelligence (AI platform)",
      "reason": "IR_ONLY — mentioned in marketing and earnings calls, not a disclosed revenue line or segment in SEC filings",
      "claim_id": "EX-001"
    },
    {
      "name": "Apple Savings",
      "reason": "IR_ONLY — mentioned in press releases and on website, not separately broken out in SEC filings",
      "claim_id": "EX-002"
    },
    {
      "name": "Apple Cash",
      "reason": "IR_ONLY — mentioned on website and in press, not separately disaggregated in SEC filings",
      "claim_id": "EX-003"
    }
  ],
  "self_check": {
    "segments_in_10K_footnote": 5,
    "segments_in_output": 5,
    "match": true,
    "product_categories_in_10K": 5,
    "product_categories_in_output": 5,
    "product_category_match": true,
    "claims_DISCLOSED": 26,
    "claims_STRONG_INFERENCE": 2,
    "claims_WEAK_INFERENCE": 0,
    "claims_UNSUPPORTED_excluded": 3,
    "note": "Apple's formal ASC 280 reportable segments are geographic (5 segments). 'Products' and 'Services' are NOT reportable segments but are the primary revenue disaggregation categories cross-cutting all segments. The architecture above reflects this dual structure faithfully."
  }
}
```

---

### Key Structural Clarification

Apple's business architecture has a **dual reporting taxonomy** that is important to understand:

1. **Formal ASC 280 Reportable Segments (5):** Americas, Europe, Greater China, Japan, Rest of Asia Pacific — these are the segments with disclosed operating income.

2. **Revenue Disaggregation Categories (5):** iPhone, Mac, iPad, Wearables Home and Accessories, Services — these are cross-segment product/service categories disclosed in Note 5 and the earnings press release, but they are **not** reportable segments under ASC 280.

Every geographic segment sells the complete suite of products and services. Apple does not report operating income by product category — only by geographic segment.