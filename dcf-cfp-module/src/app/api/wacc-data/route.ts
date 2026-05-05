import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import type { WACCDataResponse } from "@/types/wacc";

// =============================================================================
// GET /api/wacc-data?ticker=AAPL
// =============================================================================

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const FALLBACK_RISK_FREE = 0.0428; // 4.28%

// Some tickers are commonly typed in shorthand but Yahoo Finance requires a
// specific symbol.  Map them here before making any API call.
const YAHOO_TICKER_REMAPS: Record<string, string> = {
  "BRK":   "BRK-B",   // Berkshire Hathaway — default to Class B
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
};

// =============================================================================
// Multi-class share registry
// =============================================================================

interface CompanionShareClass {
  ticker: string;
  /**
   * Economic conversion factor: 1 companion share = toBaseRatio base-class shares.
   * e.g. BRK-A companion to BRK-B base → toBaseRatio = 1500
   *      GOOG companion to GOOGL base  → toBaseRatio = 1
   */
  toBaseRatio: number;
}

/**
 * Maps a primary ticker to its publicly-traded companion share classes.
 * Only classes with a live Yahoo Finance ticker are included — private/non-traded
 * classes (e.g. Meta Class B, Snap Class B/C) cannot be fetched and are omitted.
 * Both directions of each pair are listed so the adjustment fires regardless of
 * which class the user typed.
 */
const MULTI_CLASS_REGISTRY: Record<string, CompanionShareClass[]> = {
  // Berkshire Hathaway — 1 Class A = 1,500 Class B (fixed in charter)
  "BRK-B": [{ ticker: "BRK-A", toBaseRatio: 1500      }],
  "BRK-A": [{ ticker: "BRK-B", toBaseRatio: 1 / 1500  }],
  // Alphabet / Google — Class A (GOOGL) and Class C (GOOG) are economically equal
  "GOOGL": [{ ticker: "GOOG",  toBaseRatio: 1 }],
  "GOOG":  [{ ticker: "GOOGL", toBaseRatio: 1 }],
  // Fox Corporation — Class A (FOXA, voting) and Class B (FOX, non-voting)
  "FOXA":  [{ ticker: "FOX",   toBaseRatio: 1 }],
  "FOX":   [{ ticker: "FOXA",  toBaseRatio: 1 }],
  // News Corp — Class A (NWSA, limited voting) and Class B (NWS, non-voting)
  "NWSA":  [{ ticker: "NWS",   toBaseRatio: 1 }],
  "NWS":   [{ ticker: "NWSA",  toBaseRatio: 1 }],
  // Zillow Group — Class A (ZG, voting) and Class C (Z, non-voting)
  "ZG":    [{ ticker: "Z",     toBaseRatio: 1 }],
  "Z":     [{ ticker: "ZG",    toBaseRatio: 1 }],
  // Under Armour — Class A (UAA, voting) and Class C (UA, non-voting)
  "UAA":   [{ ticker: "UA",    toBaseRatio: 1 }],
  "UA":    [{ ticker: "UAA",   toBaseRatio: 1 }],
  // Paramount Global — Class A (PARAA, super-voting) and Class B (PARA, limited voting)
  "PARAA": [{ ticker: "PARA",  toBaseRatio: 1 }],
  "PARA":  [{ ticker: "PARAA", toBaseRatio: 1 }],
};

export async function GET(req: NextRequest): Promise<NextResponse<WACCDataResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker");

    if (!ticker || !ticker.trim()) {
      return NextResponse.json(
        {
          ticker: "", companyName: "", marketCap: 0, totalDebt: 0,
          currentPrice: 0, sharesOutstanding: 0, totalCash: 0, interestExpense: 0, riskFreeRate: FALLBACK_RISK_FREE,
          companyDescription: "", error: "Ticker is required.",
        },
        { status: 400 },
      );
    }

    const rawTicker = ticker.trim().toUpperCase();
    const cleanTicker = YAHOO_TICKER_REMAPS[rawTicker] ?? rawTicker;

    // Validate ticker format — alphanumeric plus dot/hyphen, max 10 chars
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(cleanTicker)) {
      return NextResponse.json(
        {
          ticker: "", companyName: "", marketCap: 0, totalDebt: 0,
          currentPrice: 0, sharesOutstanding: 0, totalCash: 0, interestExpense: 0, riskFreeRate: FALLBACK_RISK_FREE,
          companyDescription: "", error: "Invalid ticker format.",
        },
        { status: 400 },
      );
    }

    // ---- Fetch company data ----
    let marketCap = 0;
    let currentPrice = 0;
    let sharesOutstanding = 0;
    let totalCash = 0;
    let totalDebt = 0;
    let interestExpense = 0;
    let companyName = cleanTicker;
    let companyDescription = "";
    let companyDataError: string | undefined;
    let multiClassNote: string | undefined;

    try {
      const summary = await yf.quoteSummary(cleanTicker, {
        modules: [
          "defaultKeyStatistics",
          "financialData",
          "summaryProfile",
          "incomeStatementHistory",
        ],
      });

      currentPrice = summary.financialData?.currentPrice ?? 0;
      sharesOutstanding = summary.defaultKeyStatistics?.sharesOutstanding ?? 0;

      // Market Cap
      marketCap = currentPrice && sharesOutstanding
        ? currentPrice * sharesOutstanding
        : (summary.defaultKeyStatistics?.enterpriseValue ?? 0);

      // Total Debt
      totalDebt = summary.financialData?.totalDebt ?? 0;
      totalCash = summary.financialData?.totalCash ?? 0;

      // Company description (for conglomerate detection)
      companyDescription = summary.summaryProfile?.longBusinessSummary ?? "";
      companyName = summary.summaryProfile?.industry
        ? `${cleanTicker} (${summary.summaryProfile.industry})`
        : cleanTicker;

      // Interest Expense (from most recent annual income statement)
      const statements = summary.incomeStatementHistory?.incomeStatementHistory;
      if (statements && statements.length > 0) {
        const latest = statements[0];
        // interestExpense is typically negative in Yahoo Finance
        interestExpense = Math.abs(latest.interestExpense ?? 0);
      }

      // ---- Multi-class share adjustment ----------------------------------------
      // If this company has companion share classes (e.g. BRK-A alongside BRK-B),
      // add their shares (converted to base-class equivalents) and market cap so
      // that sharesOutstanding and marketCap reflect the whole company, not just
      // the queried class.  Companion fetches run in parallel; individual failures
      // are logged but do not invalidate the primary data.
      const companions = MULTI_CLASS_REGISTRY[cleanTicker];
      if (companions && companions.length > 0 && sharesOutstanding > 0) {
        const companionResults = await Promise.allSettled(
          companions.map((c) =>
            yf
              .quoteSummary(c.ticker, { modules: ["defaultKeyStatistics", "financialData"] })
              .then((s) => ({ c, s })),
          ),
        );

        const includedTickers: string[] = [];
        const missingTickers: string[] = [];

        for (let i = 0; i < companionResults.length; i++) {
          const result = companionResults[i];
          const c = companions[i];
          if (result.status === "fulfilled") {
            const { s } = result.value;
            const cShares = s.defaultKeyStatistics?.sharesOutstanding ?? 0;
            const cPrice  = s.financialData?.currentPrice ?? 0;
            if (cShares > 0 && cPrice > 0) {
              sharesOutstanding += Math.round(cShares * c.toBaseRatio);
              marketCap         += cShares * cPrice;
              includedTickers.push(c.ticker);
            }
          } else {
            console.warn(`[wacc-data] Could not fetch companion class ${c.ticker} for ${cleanTicker}:`, result.reason);
            missingTickers.push(c.ticker);
          }
        }

        if (includedTickers.length > 0) {
          multiClassNote =
            `Share count and market cap combine ${cleanTicker} + ${includedTickers.join(", ")} ` +
            `(multi-class structure). Intrinsic value per share is expressed in ${cleanTicker} equivalents.`;
        }
        if (missingTickers.length > 0) {
          multiClassNote = (multiClassNote ? multiClassNote + " " : "") +
            `Note: ${missingTickers.join(", ")} data unavailable; those shares are excluded.`;
        }
      }
      // --------------------------------------------------------------------------
    } catch (e) {
      console.warn(`[wacc-data] Could not fetch company data for ${cleanTicker}:`, e);
      companyDataError = `No market data found for "${cleanTicker}". Check the ticker symbol — e.g. Berkshire Hathaway is "BRK-B".`;
    }

    // ---- Fetch 10-Year Treasury Yield (^TNX) ----
    let riskFreeRate = FALLBACK_RISK_FREE;

    try {
      const tnx = await yf.quote("^TNX");
      if (tnx && typeof tnx.regularMarketPrice === "number" && tnx.regularMarketPrice > 0) {
        // ^TNX returns yield as a percentage (e.g., 4.28), convert to decimal
        riskFreeRate = tnx.regularMarketPrice / 100;
      }
    } catch {
      // Use fallback
    }

    return NextResponse.json({
      ticker: cleanTicker,
      companyName,
      marketCap,
      currentPrice,
      sharesOutstanding,
      totalCash,
      totalDebt,
      interestExpense,
      riskFreeRate,
      companyDescription,
      multiClassNote,
      error: companyDataError,
    });
  } catch (err: unknown) {
    console.error("[wacc-data] Error:", err);
    return NextResponse.json(
      {
        ticker: "", companyName: "", marketCap: 0, totalDebt: 0,
        currentPrice: 0, sharesOutstanding: 0, totalCash: 0, interestExpense: 0, riskFreeRate: FALLBACK_RISK_FREE,
        companyDescription: "", error: "Market data fetch failed. Check server logs for details.",
      },
      { status: 500 },
    );
  }
}
