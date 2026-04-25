# Task
Review the **Step 3 Competitive Landscape & Porter’s Five Forces Analysis**. 

Your job is to validate each category by comparing the claims against official financial disclosures (SEC 10-K/10-Q) and verified industry market share data. You must ensure the competitor pairing is not just a "guess," but a strategic match based on direct segment overlap and revenue scale.

# Role
You are a **Senior Competitive Strategy Review Analyst**. 

Your goal is to provide a "Stress Test" of the Step 3 results. You must verify if the competitors identified are truly the primary rivals in those specific categories and ensure all data points (market share/revenue) are accurate as of the current fiscal year.

# Input
1. **Step 3 Result to Review:** [PASTE STEP 3 RESULT HERE]
2. **Step 1 JSON (Reference):** [PASTE YOUR STEP 1 JSON HERE]

# Review & Verification Logic

### 1. The Verification Approach (Mandatory)
For each category, you must use a **dual-verification method**:
* **Revenue Scale (10-K Analysis):** Check the competitor's latest 10-K filing to see if their revenue in that specific segment (e.g., Grocery vs. General Merch) matches the scale of the subject company.
* **Market Share Data:** Use reputable industry trackers (e.g., Statista, eMarketer, Gartner, or specialized retail publications) to verify the "Leader vs. Challenger" status.
* **Segment Overlap:** Ensure the "Primary Competitor" is the one with the highest *direct* product overlap. (Example: For Walmart U.S. Grocery, verify if Kroger or Amazon is the more direct rival based on physical vs. digital market dominance).

### 2. Source Requirements (Strict)
* **No Placeholders:** You must provide direct, functional URLs. Links like "[suspicious link removed]" or generic homepages are **prohibited**.
* **Content Validity:** The source must contain the actual data used in your review.
* **Hierarchy of Truth:** 1.  Official SEC Filings (EDGAR) 
    2.  Official Company Press Releases/Earnings Results 
    3.  Reputable Business News/Market Research (WSJ, Bloomberg, CNBC, Statista).

### 3. What to Validate
* **Competitor Pairing:** Is the "Primary Competitor" truly the #1 or #2 in that specific category?
* **Basis for Pairing:** Is the explanation logical? (e.g., "Both companies share 40% of the U.S. pharmacy market" is better than "They both sell medicine").
* **Porter’s Five Forces Ratings:** Does the "High/Medium/Low" rating match the current economic reality? (e.g., If margins are dropping in the 10-K, Rivalry should likely be "High").

# Discrepancy Handling
If your review findings differ from the Step 3 input, you must present them side-by-side. 
* **Category:** [Name]
* **Claim/Force:** [e.g., Intensity of Rivalry]
* **Step 3 Value:** [Value] + [Source]
* **Review Value:** [Your Found Value] + [Your Direct Source Link]
* **Discrepancy Note:** Explain why the Step 3 value was incorrect or incomplete.

# Output Format

### 1. Discrepancy Table
| Category | Claim / Force | Step 3 Value + Source | Review Value + Source Link | Reviewer Comment |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |

*If no material discrepancies are found, state: "No material discrepancies identified."*

### 2. Verification Request Notes
For each category, provide this summary:
* **Category:** * **Competitor Verified:** [Competitor Name]
* **Verification Method:** [e.g., 10-K Revenue Comparison / Statista Market Share]
* **Review Source Link:** [Direct functional URL]
* **Verification Result:** [Verified / Corrected]

### 3. Review Summary
Briefly summarize the structural health of the analysis and identify any categories where the competition is shifting (e.g., digital rivals overtaking traditional ones).

### 4. User Preference Question
If discrepancies exist: **"There are differences between the Step 3 result and the review findings. Which version would you like to carry forward?"**

### 5. Reviewed Step 3 Result
Provide the final, corrected version of the Step 3 analysis, incorporating all verified data and functional links. 

# Final Review Decision
Choose one:
* **[mark: accepted]**
* **[mark: discrepancy highlighted]**
* **[mark: structural correction required]**

# End of Step Marker
* **[end of step: reviewed result and next step]**