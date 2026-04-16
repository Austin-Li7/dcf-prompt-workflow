# Step 5: High-Granularity Quarterly Financial Forecasting (5-Year Outlook)

## 1. Objective
Project the quarterly revenue for **every specific product** identified in the Step 1 JSON for the next **five fiscal years** (20 consecutive quarters). This forecast must integrate the historical baseline from Step 2, competitive resistance from Step 3, and synergy acceleration from Step 4.

## 2. Input Data (The "Feeding" Section)
Please use the following data points as the mathematical and strategic foundation:
* **Business Architecture (Step 1):** [PASTE STEP 1 JSON]
* **Historical Financial Baseline (Step 2):** [PASTE HISTORICAL REVENUE/TRENDS] - *Used for Y1 Q1 anchoring.*
* **Competitive Resistance (Step 3):** [PASTE COMPETITOR ANALYSIS] - *Used to adjust market share growth.*
* **Synergy Multipliers (Step 4):** [PASTE SYNERGY MATRIX] - *Used to accelerate growth via bundling.*

## 3. Forecasting Logic & Constraints
* **Baseline Anchoring:** The Y1 Q1 forecast must use the most recent actual reporting period from Step 2 as its starting point.
* **Seasonality:** Reference historical quarterly fluctuations (e.g., Q2 holiday surges, Q4 procurement cycles) from Step 2.
* **Competitive Resistance:** Discount growth rates in categories where Step 3 identified a "High" Intensity of Rivalry or a dominant "Gold Standard" leader.
* **Synergy Acceleration:** Quantify how "Ecosystem Synergies" from Step 4 (e.g., Azure AI powering Office 365) will manifest in revenue growth.
* **Summation Integrity:** All product revenues must logically roll up to Category and Segment totals. All values in **USD Millions**.

## 4. Output Format: Annual Tables Per Product
Generate the forecast for **one Segment at a time**. For each product within the segment, provide the following:

---
### Product: [Specific Product Name]
**Category:** [Parent Category Name]

#### 5-Year Quarterly Forecast (FY1 - FY5)
| Quarter | Projected Revenue (USD M) | Y/Y Growth % | Strategic Drivers / Milestones |
| :--- | :--- | :--- | :--- |
| **Y1 Q1** | | | [Baseline Anchor] |
| **Y1 Q2** | | | [Seasonality/Synergy Impact] |
| **Y1 Q3** | | | [Competitor Resistance Factor] |
| **Y1 Q4** | | | [Fiscal Year End Cycle] |
| **...** | | | |
| **Y5 Q4** | | | [Long-term Terminal Growth] |
| **Total FY5**| **[Sum]** | **[%]** | |

---

## 5. Execution Instructions (Batching)
1.  **Process by Segment:** Output the forecast for the **first Segment only**.
2.  **Wait for Confirmation:** After completing the first segment, **STOP** and wait for my "Continue" command before moving to the next segment.
3.  **Consistency:** Ensure the "Strategic Drivers" column explicitly references Step 3 (Competitors) or Step 4 (Synergies).



# Step 6: Consolidated 5-Year Master Forecast (Executive View)

## 1. Objective
Synthesize all the granular product-level forecasts from Step 5 into a single, high-level **Master Architecture Table**. This table will provide a bird's-eye view of the company’s revenue trajectory across all Segments and Categories.

## 2. Structure Requirements
The master table must aggregate the quarterly data into **Annual Totals** for each Category to maintain scannability while preserving the 5-year outlook.

## 3. Output Format: The Master Forecast Table

| Segment | Product Category | FY+1 Total (USD M) | FY+2 Total (USD M) | FY+3 Total (USD M) | FY+4 Total (USD M) | FY+5 Total (USD M) | 5-Year CAGR % |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **[Segment A]** | [Category 1] | | | | | | |
| | [Category 2] | | | | | | |
| *Segment Subtotal* | | | | | | | |
| **[Segment B]** | [Category 3] | | | | | | |
| | [Category 4] | | | | | | |
| *Segment Subtotal* | | | | | | | |
| **CONSOLIDATED TOTAL** | | | | | | | |

## 4. Strategic Growth Heatmap
Directly below the table, identify the **Top 3 Growth Engines** based on the 5-Year CAGR:
1. **[Product/Category Name]:** Brief explanation of why this is the primary winner (referencing Step 3 and 4).
2. **[Product/Category Name]:** Brief explanation.
3. **[Product/Category Name]:** Brief explanation.

## 5. Summary Conclusion
Provide a final 3nd-order insight:
* **The Revenue Shift:** How will the company's revenue mix change from Year 1 to Year 5? (e.g., "The company will shift from a hardware-centric model to a 70% service-recurring model by Year 5").
* **Ecosystem Resilience:** A final statement on how the integrated architecture protects the company from the competitors identified in Step 3.

## 6. Execution Rules
* **Mathematical Accuracy:** Ensure the Category totals perfectly match the sum of the individual product forecasts generated in Step 5.
* **Consistency:** Use the exact same Segment and Category names established in the Step 1 JSON.

