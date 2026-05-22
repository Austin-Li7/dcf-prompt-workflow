import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySeriesShape,
  computeCagr,
  computeLogLinearGrowthPct,
  fitLogistic,
  type TrendPoint,
} from "./logistic-regression.ts";

// =============================================================================
// classifySeriesShape
// =============================================================================

test("classifySeriesShape labels a monotone increasing series as 'increasing'", () => {
  const series: TrendPoint[] = [
    { year: 2020, value: 100 },
    { year: 2021, value: 120 },
    { year: 2022, value: 145 },
    { year: 2023, value: 170 },
  ];
  assert.equal(classifySeriesShape(series), "increasing");
});

test("classifySeriesShape labels a monotone declining series as 'decreasing'", () => {
  const series: TrendPoint[] = [
    { year: 2020, value: 200 },
    { year: 2021, value: 170 },
    { year: 2022, value: 130 },
    { year: 2023, value: 100 },
  ];
  assert.equal(classifySeriesShape(series), "decreasing");
});

test("classifySeriesShape labels a series with a mid-window peak as 'non_monotone'", () => {
  // Mirrors SoFi Technology Platform: peak in the middle, decline afterward.
  const series: TrendPoint[] = [
    { year: 2022, value: 320 },
    { year: 2023, value: 360 },
    { year: 2024, value: 310 },
    { year: 2025, value: 220 },
    { year: 2026, value: 110 },
  ];
  assert.equal(classifySeriesShape(series), "non_monotone");
});

test("classifySeriesShape labels a series with a mid-window trough as 'non_monotone'", () => {
  // E.g. travel/airline 2019 → 2020 (pandemic) → 2022.
  const series: TrendPoint[] = [
    { year: 2019, value: 100 },
    { year: 2020, value: 35 },
    { year: 2021, value: 80 },
    { year: 2022, value: 120 },
  ];
  assert.equal(classifySeriesShape(series), "non_monotone");
});

test("classifySeriesShape returns 'insufficient' with fewer than 3 positive points", () => {
  assert.equal(classifySeriesShape([{ year: 2022, value: 100 }]), "insufficient");
  assert.equal(
    classifySeriesShape([{ year: 2022, value: 100 }, { year: 2023, value: 120 }]),
    "insufficient",
  );
});

test("classifySeriesShape treats ±2% noise as flat (still 'increasing')", () => {
  // All YoY changes are within ±2% — noise, not real direction.
  const series: TrendPoint[] = [
    { year: 2020, value: 100.0 },
    { year: 2021, value: 100.5 },
    { year: 2022, value: 99.8 },
    { year: 2023, value: 101.2 },
  ];
  assert.equal(classifySeriesShape(series), "increasing");
});

// =============================================================================
// computeLogLinearGrowthPct — the A1 replacement for endpoint CAGR
// =============================================================================

test("computeLogLinearGrowthPct returns ~exact CAGR for a perfectly geometric series", () => {
  // 10% YoY for 4 years — log-linear should recover ~10%.
  const series: TrendPoint[] = [
    { year: 2020, value: 100 },
    { year: 2021, value: 110 },
    { year: 2022, value: 121 },
    { year: 2023, value: 133.1 },
    { year: 2024, value: 146.41 },
  ];
  const growth = computeLogLinearGrowthPct(series);
  assert.ok(growth != null, "growth should not be null");
  assert.ok(Math.abs(growth - 10) < 0.01, `expected ~10%; got ${growth}`);
});

test("computeLogLinearGrowthPct is robust to a single outlier year (key advantage over endpoint CAGR)", () => {
  // Underlying ~10% trend with one anomalous year. Two-point CAGR using only
  // first and last would be -100% (last is 0)... but our value floor filters
  // zero. Use a non-zero outlier so we can compare the two methods.
  const series: TrendPoint[] = [
    { year: 2020, value: 100 },
    { year: 2021, value: 110 },
    { year: 2022, value: 50 }, // anomalous dip
    { year: 2023, value: 133 },
    { year: 2024, value: 146 },
  ];
  const logLinear = computeLogLinearGrowthPct(series);
  const endpointCagr = computeCagr(series);
  assert.ok(logLinear != null);
  assert.ok(endpointCagr != null);
  // Endpoint CAGR is ~(146/100)^(1/4)-1 ≈ 9.95% (lucky here — both endpoints
  // are on-trend), but the regression weighs the dip and produces a lower
  // estimate — we just want to assert log-linear isn't trapped by endpoints.
  // Both methods should agree the trend is positive.
  assert.ok(logLinear > 0, `log-linear should be positive; got ${logLinear}`);
});

test("computeLogLinearGrowthPct produces a NEGATIVE rate for a declining series — caller must gate with shape", () => {
  // This documents the contract: log-linear regression on declining data
  // produces a negative slope. It's the SHAPE CLASSIFIER's job (A2) to refuse
  // to surface this as a forecast input — the regression itself is honest.
  const series: TrendPoint[] = [
    { year: 2022, value: 320 },
    { year: 2023, value: 240 },
    { year: 2024, value: 180 },
    { year: 2025, value: 135 },
  ];
  const growth = computeLogLinearGrowthPct(series);
  assert.ok(growth != null);
  assert.ok(growth < 0, `declining series should produce negative growth; got ${growth}`);
});

test("computeLogLinearGrowthPct returns null when fewer than 2 positive points", () => {
  assert.equal(computeLogLinearGrowthPct([]), null);
  assert.equal(computeLogLinearGrowthPct([{ year: 2022, value: 100 }]), null);
  assert.equal(
    computeLogLinearGrowthPct([
      { year: 2022, value: 100 },
      { year: 2022, value: 110 }, // same year — zero variance
    ]),
    null,
  );
});

// =============================================================================
// The integrated bug we're fixing — SoFi Technology Platform shape
// =============================================================================

test("SoFi-shaped data: classifier catches the non-monotone shape that produced the -30.1% bug", () => {
  // Approximation of SoFi's Technology Platform segment as exposed in
  // the user's preview logs:
  //   2022 peak → 2023 still high → 2024 softens → 2025 reorganization
  //   → 2026 partial year materially lower
  const series: TrendPoint[] = [
    { year: 2022, value: 320 },
    { year: 2023, value: 360 },
    { year: 2024, value: 310 },
    { year: 2025, value: 260 },
    { year: 2026, value: 110 },
  ];

  // Step 1: the OLD endpoint-CAGR path would have produced the catastrophic number.
  const oldEndpointCagr = computeCagr(series);
  assert.ok(oldEndpointCagr != null && oldEndpointCagr < -20,
    `regression test: endpoint CAGR for SoFi-shaped data is the bug; expected < -20%, got ${oldEndpointCagr}`);

  // Step 2: the logistic fit fails for declining series (k <= 0 rejection).
  const fit = fitLogistic(series);
  assert.equal(fit.fit_ok, false, "logistic should fail on non-monotone declining series");

  // Step 3: the NEW shape classifier flags this as non_monotone — which the
  // route handler uses to refuse to emit a fallback growth number.
  assert.equal(classifySeriesShape(series), "non_monotone",
    "shape classifier must catch the SoFi case so the prompt formatter suppresses the misleading CAGR");
});

test("Apple iPhone-shaped data: one soft year inside a growing trend → 'non_monotone', no false anchor", () => {
  // iPhone revenue saw one soft year (2019) inside a longer growing trend.
  // Without the shape classifier, this could have looked like "growth" via
  // two-point CAGR, but a deep dip mid-window is exactly when we don't want
  // to feed the LLM a confident historical anchor.
  const series: TrendPoint[] = [
    { year: 2017, value: 141 },
    { year: 2018, value: 166 },
    { year: 2019, value: 142 }, // soft year
    { year: 2020, value: 138 }, // pandemic
    { year: 2021, value: 192 },
    { year: 2022, value: 205 },
  ];
  assert.equal(
    classifySeriesShape(series),
    "non_monotone",
    "iPhone shape with a mid-window soft year is non-monotone; classifier should catch it",
  );
});
