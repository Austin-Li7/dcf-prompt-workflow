### Step 2: Longitudinal Financial Data Extraction (Past 5 Years)

### 1. Business Architecture Input (Step 1 JSON)
Please use the following JSON architecture as the basis for data extraction:

[PASTE YOUR STEP 1 JSON HERE]

### 2. Objective
Extract and organize financial data for EVERY segment and product identified in the JSON above. You must provide a continuous quarter-by-quarter breakdown covering the most recent 5 fiscal years (approximately 20+ consecutive quarters) up to the latest available reporting period.

### 3. Data Sourcing & Consistency Rules
* Official Sources: Use data from Microsoft’s SEC filings (10-K, 10-Q) and Earnings Press Releases.
* The "Restatement" Rule: Microsoft frequently updates its reporting structure. You MUST use the "Restated" historical figures provided in the latest filings to ensure a consistent "apples-to-apples" 5-year trend for all quarters.
* Granularity: Provide a strict chronological list. Do not skip any quarters. Provide data for all 4 quarters of each fiscal year.
* Currency: All monetary values must be in USD Millions.

### 4. Output Format: One Table Per Entity
#### Phase A: Markdown Tables (Visual Review)
For EACH Segment and Product identified in the JSON, generate a standalone Markdown table. 

**Table Template:**
| Fiscal Quarter | Revenue (USD M) | Revenue Growth % (Y/Y) | Operating Income (Segments Only) | Key KPI / Note |
| :--- | :--- | :--- | :--- | :--- |
| (Earliest Quarter) | | | | |
| (Next Quarter) | | | | |
| ... | | | | |
| (Most Recent Q) | | | | |

#### Phase B: Structured CSV Database (The "Forecast Input")
At the end of each batch, generate a code block containing the data in a standardized CSV format. This will be used as the direct input for Step 5.
**CSV Header:** `Fiscal_Year, Quarter, Segment, Product_Category, Product_Name, Revenue_USD_M, Op_Income_USD_M, Notes`

## 5. Execution Instruction (Batching)
* **Batch 1 (Respond to this first):** Major Operating Segments and the primary/top-tier business units. Provide both Markdown tables and the starting CSV block.
* **Batch 2 (Wait for my "Continue" command):** All remaining sub-products and granular line items. Update and append to the CSV data.

---
**Final Goal:** Once all batches are complete, I will have a comprehensive CSV "file" representing 5 years of historical performance to feed into the Step 5 forecasting model.

