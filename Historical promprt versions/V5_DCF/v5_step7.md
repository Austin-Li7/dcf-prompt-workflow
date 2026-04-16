# Step 7: Valuation Engineering & Implied Cost of Capital (v5 — Validated)

---

## 1. Objective
Calculate the company's Weighted Average Cost of Capital (WACC) by synthesizing a market-implied discount rate using the Damodaran Bottom-Up Beta methodology. This step includes built-in validation for input data quality, constant staleness, and output reasonableness.

---

## 2. Python Script (Execute Locally)

```python
import yfinance as yf
from datetime import datetime

def calculate_validated_wacc(ticker_symbol, unlevered_beta_input):
    """
    Calculates WACC using Damodaran's Re-levered Beta methodology.
    Includes validation checks for data quality and reasonableness.
    
    Args:
        ticker_symbol (str): The stock ticker (e.g., 'MSFT').
        unlevered_beta_input (float or list): 
            - If float: Industry unlevered beta for a single-business company.
            - If list: [(unlevered_beta, segment_value), ...] for conglomerates.
    
    Returns:
        dict with WACC results, inputs, sensitivity, and validation warnings.
    """
    
    # ── Constants (UPDATE MONTHLY from Damodaran's website) ──
    # Source: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html
    CONSTANTS_AS_OF = "2026-03-15"  # ⭐ Date when constants were last verified
    RISK_FREE_RATE = 0.0428         # 10-Year U.S. Treasury Yield
    IMPLIED_ERP = 0.0451            # Damodaran Implied Equity Risk Premium
    MARGINAL_TAX_RATE = 0.21        # U.S. Statutory Corporate Tax Rate
    
    # ── Staleness Check ──
    constants_date = datetime.strptime(CONSTANTS_AS_OF, "%Y-%m-%d")
    days_since_update = (datetime.now() - constants_date).days
    warnings = []
    
    if days_since_update > 30:
        warnings.append(
            f"⚠️ Constants last updated {days_since_update} days ago ({CONSTANTS_AS_OF}). "
            f"Risk-free rate and ERP may be outdated. "
            f"Verify at: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html"
        )
    
    try:
        ticker = yf.Ticker(ticker_symbol)
        info = ticker.info
        
        # ── 1. Market Values for Capital Structure ──
        market_cap = info.get('marketCap')
        total_debt = info.get('totalDebt', 0)
        
        if not market_cap:
            return {"error": "Could not retrieve Market Cap from yfinance."}
        
        # ── Data Quality Checks ──
        if market_cap < 1e6:
            warnings.append("⚠️ Market cap < $1M — likely data error in yfinance.")
        
        if total_debt == 0 and market_cap > 1e9:
            warnings.append(
                "⚠️ Total debt = $0 for a company with market cap > $1B. "
                "yfinance may be missing debt data. Cross-check with 10-K balance sheet."
            )
        
        # ── 2. D/E Ratio ──
        de_ratio = total_debt / market_cap
        enterprise_value = market_cap + total_debt
        
        # ── 3. Determine Unlevered Beta ──
        if isinstance(unlevered_beta_input, list):
            total_segment_value = sum(val for _, val in unlevered_beta_input)
            u_beta = sum(beta * (val / total_segment_value) for beta, val in unlevered_beta_input)
            calc_type = "Conglomerate (Weighted)"
        else:
            u_beta = unlevered_beta_input
            calc_type = "Single Business"
        
        # Beta reasonableness check
        if u_beta < 0.3 or u_beta > 2.5:
            warnings.append(
                f"⚠️ Unlevered beta ({u_beta:.2f}) outside typical range [0.3, 2.5]. "
                "Verify against Damodaran's industry beta table."
            )
        
        # ── 4. Re-lever Beta (Hamada Formula) ──
        levered_beta = u_beta * (1 + (1 - MARGINAL_TAX_RATE) * de_ratio)
        
        # ── 5. Cost of Equity (CAPM) ──
        cost_of_equity = RISK_FREE_RATE + (levered_beta * IMPLIED_ERP)
        
        # ── 6. After-Tax Cost of Debt ──
        financials = ticker.financials
        interest_expense = 0
        if 'Interest Expense' in financials.index:
            interest_expense = abs(financials.loc['Interest Expense'].iloc[0])
        
        pre_tax_rd = (interest_expense / total_debt) if total_debt > 0 else RISK_FREE_RATE
        after_tax_rd = pre_tax_rd * (1 - MARGINAL_TAX_RATE)
        
        # Cost of debt reasonableness
        if pre_tax_rd > 0.15:
            warnings.append(
                f"⚠️ Pre-tax cost of debt ({pre_tax_rd:.2%}) > 15%. "
                "Likely a data issue with interest expense or debt balance."
            )
        if total_debt > 0 and pre_tax_rd < RISK_FREE_RATE * 0.5:
            warnings.append(
                f"⚠️ Pre-tax cost of debt ({pre_tax_rd:.2%}) < 50% of risk-free rate. "
                "Company may have below-market legacy debt or data may be incomplete."
            )
        
        # ── 7. WACC Calculation ──
        w_equity = market_cap / enterprise_value
        w_debt = total_debt / enterprise_value
        wacc = (w_equity * cost_of_equity) + (w_debt * after_tax_rd)
        
        # WACC reasonableness
        if wacc < 0.03 or wacc > 0.20:
            warnings.append(
                f"⚠️ WACC ({wacc:.2%}) outside typical range [3%, 20%]. Review all inputs."
            )
        
        # ── 8. Sensitivity Analysis ──
        sensitivity = {}
        for name, d_rf, d_erp in [
            ("Bull (rates -50bp)", -0.005, -0.005),
            ("Base", 0, 0),
            ("Bear (rates +50bp)", 0.005, 0.005),
        ]:
            adj_rf = RISK_FREE_RATE + d_rf
            adj_erp = IMPLIED_ERP + d_erp
            adj_ke = adj_rf + (levered_beta * adj_erp)
            adj_wacc = (w_equity * adj_ke) + (w_debt * after_tax_rd)
            sensitivity[name] = f"{adj_wacc:.2%}"
        
        # ── 9. Return Results ──
        return {
            "ticker": ticker_symbol.upper(),
            "calculation_type": calc_type,
            "as_of": datetime.now().strftime("%Y-%m-%d"),
            
            "results": {
                "wacc": f"{wacc:.2%}",
                "cost_of_equity": f"{cost_of_equity:.2%}",
                "after_tax_cost_of_debt": f"{after_tax_rd:.2%}",
                "re_levered_beta": round(levered_beta, 3),
            },
            
            "inputs_used": {
                "unlevered_beta": round(u_beta, 3),
                "de_ratio_market": f"{de_ratio:.2%}",
                "equity_weight": f"{w_equity:.2%}",
                "debt_weight": f"{w_debt:.2%}",
                "risk_free_rate": f"{RISK_FREE_RATE:.2%}",
                "implied_erp": f"{IMPLIED_ERP:.2%}",
                "marginal_tax_rate": f"{MARGINAL_TAX_RATE:.0%}",
                "constants_as_of": CONSTANTS_AS_OF,
            },
            
            "raw_data_from_yfinance": {
                "market_cap": f"${market_cap/1e9:.1f}B",
                "total_debt": f"${total_debt/1e9:.1f}B",
                "interest_expense": f"${interest_expense/1e6:.0f}M",
            },
            
            "sensitivity": sensitivity,
            
            "validation": {
                "warnings": warnings if warnings else ["All checks passed"],
                "action_required": (
                    "Cross-check market cap and total debt against the most recent "
                    "10-K balance sheet. yfinance data may lag by 1-2 quarters. "
                    "Use Checkpoint B below to verify."
                ),
            }
        }
        
    except Exception as e:
        return {"error": str(e)}


# ── Usage Examples ──

# Single business:
# result = calculate_validated_wacc("MSFT", 1.05)
# print(json.dumps(result, indent=2))

# Conglomerate (weighted by segment revenue):
# betas = [
#     (1.18, 120810),  # P&BP segment: software industry beta × revenue
#     (1.10, 106265),  # Intelligent Cloud: internet/cloud beta × revenue
#     (1.05, 54649),   # More Personal Computing: entertainment/tech beta × revenue
# ]
# result = calculate_validated_wacc("MSFT", betas)
```

---

## ════════════════════════════════════════
## VALIDATION LAYER
## ════════════════════════════════════════

### 🟢 Checkpoint A — WACC Range Verification
**Model: Basic model (Gemini Flash / Haiku / GPT-4o-mini)**

```
You are a range checker. Do NOT analyze or explain.

The calculated WACC for [company] in the [industry] sector is [X]%.

Typical WACC ranges by industry:
- Technology / Software: 7-12%
- Consumer Staples: 6-9%
- Healthcare: 8-13%
- Financials: 8-14%
- Industrials: 7-11%
- Energy: 8-12%

Is [X]% within the expected range for [industry]?
→ WITHIN_RANGE or OUTSIDE_RANGE

If OUTSIDE_RANGE, which direction? TOO_HIGH or TOO_LOW
```

→ OUTSIDE_RANGE = review all inputs. Something may be wrong.

---

### 🟢 Checkpoint B — Input Cross-Verification Against 10-K
**Model: Basic model**

```
You are a number verifier. Do NOT analyze or explain.

The WACC calculation used these inputs from yfinance:
  Market Cap: $[X]B
  Total Debt: $[Y]B

Here is the company's most recent 10-K Balance Sheet:
[PASTE: balance sheet from 10-K]

1. Find "Total debt" or "Long-term debt + Current portion of long-term debt":
   10-K says: $___B
   yfinance says: $[Y]B
   → MATCH (within 5%) or MISMATCH?

2. Find "Shares outstanding":
   10-K says: ___M shares
   Current stock price: $[P]
   Implied market cap = shares × price = $___B
   yfinance says: $[X]B
   → MATCH (within 5%) or MISMATCH?
```

→ Any MISMATCH = yfinance data is unreliable. Use 10-K figures instead and re-run the WACC script.

---

### ⚫ Gate Decision

```
Script validation warnings: [list from output]
Checkpoint A (WACC range):   WITHIN_RANGE / OUTSIDE_RANGE
Checkpoint B (input verify):  Debt MATCH/MISMATCH, Market Cap MATCH/MISMATCH

GATE RULES:
  Constants stale (>30 days) → update before finalizing
  WACC OUTSIDE_RANGE → review inputs
  Input MISMATCH → re-run with 10-K figures
  All warnings say "All checks passed" + checkpoints pass → WACC is validated

  PASS → Proceed to Pipeline Audit (or use WACC for DCF valuation).
```
