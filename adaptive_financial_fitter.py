#!/usr/bin/env python3
"""
adaptive_financial_fitter.py
════════════════════════════
Adaptive multi-model trend fitter for financial time-series.

Pipeline:
  [1] Changepoint Detection  — metric-type-aware routing
        Revenue / Cost  → pwlf  (continuous slope shifts, BIC-selected)
        CapEx / Other   → ruptures PELT + L2   (abrupt level shifts)
  [2] Walk-Forward Backtesting Tournament — AIC/BIC + MAPE, recency weighting
  [3] Bayesian Override  — Step 3 (Porter's Five Forces) + Step 4 (synergy)
        JSON constrains optimisation bounds before the final projection
  [4] Projection — winner model + 90% bootstrap confidence interval

Dependencies:
    pip install scipy numpy pandas pwlf ruptures

Usage (standalone demo):
    python3 adaptive_financial_fitter.py
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit, OptimizeWarning

# ── optional deps with graceful fallbacks ──────────────────────────────────
try:
    import pwlf
    HAS_PWLF = True
except ImportError:
    HAS_PWLF = False
    warnings.warn(
        "pwlf not installed — piecewise-linear model unavailable. "
        "pip install pwlf",
        stacklevel=2,
    )

try:
    import ruptures as rpt
    HAS_RUPTURES = True
except ImportError:
    HAS_RUPTURES = False
    warnings.warn(
        "ruptures not installed — PELT changepoint detection unavailable. "
        "pip install ruptures",
        stacklevel=2,
    )

warnings.filterwarnings("ignore", category=OptimizeWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)


# ══════════════════════════════════════════════════════════════════════════════
# 1.  DATA STRUCTURES
# ══════════════════════════════════════════════════════════════════════════════

class MetricType(str, Enum):
    REVENUE = "revenue"
    COST    = "cost"
    CAPEX   = "capex"
    OTHER   = "other"


@dataclass
class SegmentSeries:
    """One historical time-series for a single segment + metric."""
    segment_name: str
    metric_type:  MetricType
    years:        list[int]    # calendar years, ascending
    values:       list[float]  # USD millions, same length


@dataclass
class ChangepointResult:
    breakpoint_years:   list[int]  # calendar years where trend broke
    breakpoint_indices: list[int]  # corresponding 0-based indices
    method:             str


@dataclass
class ModelScore:
    model_name:       str
    params:           np.ndarray
    aic:              float
    bic:              float
    mape:             float         # mean walk-forward MAPE (%)
    tournament_score: float         # composite — lower = better
    n_params:         int


@dataclass
class FitResult:
    segment_name:       str
    metric_type:        MetricType
    winner_model:       str
    winner_params:      np.ndarray
    changepoints:       ChangepointResult
    all_scores:         list[ModelScore]
    projected_values:   dict[int, float]              # year → value
    confidence_interval: dict[int, tuple[float, float]]  # year → (lo, hi)
    override_applied:   bool
    override_description: str = ""


# ══════════════════════════════════════════════════════════════════════════════
# 2.  MODEL ZOO
# ══════════════════════════════════════════════════════════════════════════════

BoundsType = Optional[tuple[list[float], list[float]]]


class _BaseModel:
    name:     str = "base"
    n_params: int = 0

    # --- interface ----------------------------------------------------------

    def fit(
        self,
        t: np.ndarray,
        y: np.ndarray,
        weights: Optional[np.ndarray] = None,
        bounds: BoundsType = None,
    ) -> bool:
        raise NotImplementedError

    def predict(self, t: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    # --- information criteria -----------------------------------------------

    def _log_likelihood(self, t: np.ndarray, y: np.ndarray) -> float:
        n   = len(y)
        rss = float(np.sum((y - self.predict(t)) ** 2))
        if rss <= 0 or n == 0:
            return -1e12
        sigma2 = rss / n
        return -n / 2.0 * (math.log(2 * math.pi * sigma2) + 1.0)

    def aic(self, t: np.ndarray, y: np.ndarray) -> float:
        k = self.n_params + 1  # +1 for the noise parameter σ
        return 2 * k - 2 * self._log_likelihood(t, y)

    def bic(self, t: np.ndarray, y: np.ndarray) -> float:
        k = self.n_params + 1
        return k * math.log(len(y)) - 2 * self._log_likelihood(t, y)

    def mape_in_sample(self, t: np.ndarray, y: np.ndarray) -> float:
        pred = self.predict(t)
        mask = y != 0
        if not mask.any():
            return np.inf
        return float(np.mean(np.abs((y[mask] - pred[mask]) / y[mask])) * 100)

    # --- helpers ------------------------------------------------------------

    @staticmethod
    def _sigma_from_weights(weights: Optional[np.ndarray]) -> Optional[np.ndarray]:
        """curve_fit sigma = 1/weight (lower sigma → higher weight)."""
        if weights is None:
            return None
        w = np.clip(weights, 1e-9, None)
        return 1.0 / w


# ── Linear: y = a·t + b ─────────────────────────────────────────────────────

class LinearModel(_BaseModel):
    name     = "linear"
    n_params = 2

    def __init__(self):
        self._a = self._b = 0.0

    def fit(self, t, y, weights=None, bounds=None):
        sigma = self._sigma_from_weights(weights)
        lb = [-np.inf, -np.inf]
        ub = [ np.inf,  np.inf]
        if bounds:
            lb, ub = bounds[0], bounds[1]
        try:
            popt, _ = curve_fit(
                lambda x, a, b: a * x + b, t, y,
                sigma=sigma, absolute_sigma=True,
                bounds=(lb, ub), maxfev=5000,
            )
            self._a, self._b = popt
        except Exception:
            # fallback: unweighted least-squares
            A = np.column_stack([t, np.ones_like(t)])
            self._a, self._b = np.linalg.lstsq(A, y, rcond=None)[0]
        return True

    def predict(self, t):
        return self._a * np.asarray(t, float) + self._b

    @property
    def params(self):
        return np.array([self._a, self._b])


# ── Exponential: y = a·exp(b·t_norm) where t_norm = t − t[0] + 1 ───────────
# Normalising to t_norm ∈ [1, n] prevents exp(b·2015) numerical overflow
# and keeps the initial value parameter `a` interpretable as y(t[0]).

class ExponentialModel(_BaseModel):
    name     = "exponential"
    n_params = 2

    def __init__(self):
        self._a = self._b = 0.0
        self._t_offset: float = 0.0
        self._fitted = False

    def fit(self, t, y, weights=None, bounds=None):
        if np.any(y <= 0):
            return False
        self._t_offset = float(t[0]) - 1.0
        t_n = np.asarray(t, float) - self._t_offset
        sigma = self._sigma_from_weights(weights)
        lb = [1e-9, -np.inf]
        ub = [np.inf,  np.inf]
        if bounds:
            lb, ub = bounds[0], bounds[1]
        try:
            p0 = [float(y[0]), 0.05]
            popt, _ = curve_fit(
                lambda x, a, b: a * np.exp(b * x), t_n, y, p0=p0,
                sigma=sigma, absolute_sigma=True,
                bounds=(lb, ub), maxfev=8000,
            )
            self._a, self._b = popt
            self._fitted = True
            return True
        except Exception:
            return False

    def predict(self, t):
        if not self._fitted:
            return np.zeros_like(t, float)
        t_n = np.asarray(t, float) - self._t_offset
        return self._a * np.exp(self._b * t_n)

    @property
    def params(self):
        return np.array([self._a, self._b])


# ── Logistic S-curve: y = L / (1 + exp(-k·(t − t₀))) ───────────────────────

def _logistic_fn(t, L, k, t0):
    return L / (1.0 + np.exp(-k * (t - t0)))


class LogisticModel(_BaseModel):
    name     = "logistic"
    n_params = 3

    def __init__(self):
        self._L = self._k = self._t0 = 0.0
        self._fitted = False

    def fit(self, t, y, weights=None, bounds=None):
        if len(t) < 4:
            return False
        sigma = self._sigma_from_weights(weights)
        # sensible defaults
        L_init  = float(y.max() * 1.5)
        k_init  = 0.5
        t0_init = float(t.mean())
        lb = [float(y.max() * 0.5), 0.0,  float(t.min())]
        ub = [float(y.max() * 5.0), 10.0, float(t.max())]
        if bounds:
            lb, ub = list(bounds[0]), list(bounds[1])
        try:
            popt, _ = curve_fit(
                _logistic_fn, t, y, p0=[L_init, k_init, t0_init],
                sigma=sigma, absolute_sigma=True,
                bounds=(lb, ub), maxfev=15000,
            )
            self._L, self._k, self._t0 = popt
            self._fitted = True
            return True
        except Exception:
            return False

    def predict(self, t):
        if not self._fitted:
            return np.zeros_like(t, float)
        return _logistic_fn(np.asarray(t, float), self._L, self._k, self._t0)

    @property
    def params(self):
        return np.array([self._L, self._k, self._t0])


# ── Power law: y = a·t_norm^b where t_norm = t − t[0] + 1 ──────────────────
# Normalising avoids a·2015^b numerical instability; t_norm starts at 1
# so `a` equals the model's predicted value at the first data point.

class PowerModel(_BaseModel):
    name     = "power"
    n_params = 2

    def __init__(self):
        self._a = self._b = 0.0
        self._t_offset: float = 0.0
        self._fitted = False

    def fit(self, t, y, weights=None, bounds=None):
        if np.any(y <= 0):
            return False
        self._t_offset = float(t[0]) - 1.0
        t_n = np.asarray(t, float) - self._t_offset   # t_n[0] = 1
        if np.any(t_n <= 0):
            return False
        sigma = self._sigma_from_weights(weights)
        lb = [1e-9, -np.inf]
        ub = [np.inf,  np.inf]
        if bounds:
            lb, ub = bounds[0], bounds[1]
        try:
            popt, _ = curve_fit(
                lambda x, a, b: a * np.power(x, b), t_n, y,
                sigma=sigma, absolute_sigma=True,
                bounds=(lb, ub), maxfev=5000,
            )
            self._a, self._b = popt
            self._fitted = True
            return True
        except Exception:
            return False

    def predict(self, t):
        if not self._fitted:
            return np.zeros_like(t, float)
        t_n = np.asarray(t, float) - self._t_offset
        return self._a * np.power(np.maximum(t_n, 1e-9), self._b)

    @property
    def params(self):
        return np.array([self._a, self._b])


# ── Piecewise Linear (pwlf) ──────────────────────────────────────────────────

class PiecewiseLinearModel(_BaseModel):
    name = "piecewise_linear"

    def __init__(self, n_segments: int = 2):
        self._n_seg  = n_segments
        self.n_params = n_segments * 2   # slopes + intercepts (simplified)
        self._model: Optional[object] = None

    def fit(self, t, y, weights=None, bounds=None):
        if not HAS_PWLF or len(t) < self._n_seg + 2:
            return False
        try:
            self._model = pwlf.PiecewiseLinFit(t, y)
            self._model.fit(self._n_seg)
            return True
        except Exception:
            return False

    def predict(self, t):
        if self._model is None:
            return np.zeros_like(t, float)
        return self._model.predict(np.asarray(t, float))

    @property
    def params(self):
        if self._model is None:
            return np.array([])
        return np.array(self._model.slopes + self._model.intercepts)


def _make_model_zoo() -> list[_BaseModel]:
    """Return fresh model instances for one tournament run."""
    zoo: list[_BaseModel] = [
        LinearModel(),
        ExponentialModel(),
        LogisticModel(),
        PowerModel(),
    ]
    if HAS_PWLF:
        zoo.append(PiecewiseLinearModel(n_segments=2))
    return zoo


# ══════════════════════════════════════════════════════════════════════════════
# 3.  CHANGEPOINT DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

class ChangepointDetector:
    """
    Routes to the right CPD algorithm based on MetricType:
      REVENUE / COST  → pwlf (continuous slope changes)
      CAPEX / OTHER   → ruptures PELT + L2  (abrupt level shifts)

    Always returns a ChangepointResult even when no break is found.
    """

    def detect(
        self, series: SegmentSeries, max_breakpoints: int = 2
    ) -> ChangepointResult:
        t = np.array(series.years, dtype=float)
        y = np.array(series.values, dtype=float)

        if len(t) < 4:
            return ChangepointResult([], [], method="none (series too short)")

        if series.metric_type in (MetricType.REVENUE, MetricType.COST):
            return self._pwlf_slope_shifts(t, y, series.years, max_breakpoints)
        else:
            return self._ruptures_level_shifts(t, y, series.years, max_breakpoints)

    # ── pwlf: slope-change detection (Revenue / Cost) ────────────────────

    def _pwlf_slope_shifts(
        self, t: np.ndarray, y: np.ndarray, years: list[int], max_bp: int
    ) -> ChangepointResult:
        if not HAS_PWLF:
            return self._cusum_fallback(y, years)

        best_bic  = np.inf
        best_segs = 1
        best_breaks: list[float] = []

        for n_segs in range(1, min(max_bp + 2, len(t) - 1)):
            try:
                m = pwlf.PiecewiseLinFit(t, y)
                breaks = m.fit(n_segs)
                pred   = m.predict(t)
                rss    = float(np.sum((y - pred) ** 2))
                n, k   = len(y), 2 * n_segs + 1
                bic    = k * math.log(n) + n * math.log(max(rss / n, 1e-12))
                if bic < best_bic:
                    best_bic, best_segs = bic, n_segs
                    best_breaks = list(breaks[1:-1])  # interior breaks only
            except Exception:
                continue

        bp_years   = [_nearest_year(b, years) for b in best_breaks]
        bp_indices = [years.index(yr) for yr in bp_years if yr in years]

        return ChangepointResult(
            breakpoint_years=bp_years,
            breakpoint_indices=bp_indices,
            method=f"pwlf ({best_segs} segments, BIC-selected)",
        )

    # ── ruptures PELT + L2: level-shift detection (CapEx / Other) ────────
    # L2 (Gaussian mean-shift) is preferred over RBF for financial step-
    # function data: RBF's kernel scaling makes penalty units incompatible
    # with data-driven calibration on short series, while L2 penalty has
    # a direct BIC interpretation: 2·σ²·log(n).

    def _ruptures_level_shifts(
        self, t: np.ndarray, y: np.ndarray, years: list[int], max_bp: int
    ) -> ChangepointResult:
        if not HAS_RUPTURES:
            return self._cusum_fallback(y, years)
        try:
            signal = y.reshape(-1, 1)
            # Robust σ̂ via MAD of first-differences (insensitive to the
            # step-changes themselves); BIC-motivated penalty: 2·σ²·log(n).
            sigma_hat = float(np.median(np.abs(np.diff(y)))) / 1.1774 + 1e-6
            pen       = 2.0 * sigma_hat ** 2 * math.log(len(y))
            # min_size=3 prevents single/double-point spurious segments
            algo   = rpt.Pelt(model="l2", min_size=3, jump=1).fit(signal)
            result = algo.predict(pen=pen)
            # result[i] is the exclusive end of segment i; the changepoint
            # year is the START of the new segment (first year of new level).
            bp_indices = sorted({r for r in result[:-1] if r < len(years)})[:max_bp]
            bp_years   = [years[i] for i in bp_indices]
            return ChangepointResult(
                breakpoint_years=bp_years,
                breakpoint_indices=bp_indices,
                method="ruptures PELT+L2",
            )
        except Exception:
            return self._cusum_fallback(y, years)

    # ── CUSUM fallback (zero extra deps) ─────────────────────────────────

    @staticmethod
    def _cusum_fallback(y: np.ndarray, years: list[int]) -> ChangepointResult:
        cusum = np.cumsum(y - y.mean())
        idx   = int(np.argmax(np.abs(cusum)))
        if 0 < idx < len(years) - 1:
            return ChangepointResult(
                breakpoint_years=[years[idx]],
                breakpoint_indices=[idx],
                method="CUSUM fallback",
            )
        return ChangepointResult([], [], method="CUSUM (no significant break)")


def _nearest_year(val: float, years: list[int]) -> int:
    return min(years, key=lambda yr: abs(yr - val))


# ══════════════════════════════════════════════════════════════════════════════
# 4.  WALK-FORWARD BACKTESTING TOURNAMENT
# ══════════════════════════════════════════════════════════════════════════════

def _recency_weights(
    n: int, breakpoint_indices: list[int], pre_break_decay: float = 0.6
) -> np.ndarray:
    """
    Assign weight = 1.0 to every point after the last changepoint.
    Points before it decay exponentially with distance from the break.
    This down-weights pre-structural-break data without discarding it.
    """
    w = np.ones(n, dtype=float)
    if not breakpoint_indices:
        return w
    last_cp = max(breakpoint_indices)
    for i in range(last_cp):
        w[i] = max(pre_break_decay ** (last_cp - i), 0.05)
    return w


def _mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    mask = actual != 0
    if not mask.any():
        return np.inf
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100)


class WalkForwardTournament:
    """
    Expanding walk-forward cross-validation.

    For each split in [min_train, n - test_horizon]:
        train = series[0 : split]
        test  = series[split : split + test_horizon]

    Recency weights (derived from changepoints) are applied during training.
    Models are scored by:
        tournament_score = mean_walk_forward_MAPE + 0.01 × AIC_on_full_data

    The 0.01 weighting keeps AIC as a tiebreaker without overwhelming MAPE.
    """

    def __init__(self, min_train: int = 3, test_horizon: int = 2):
        self.min_train    = min_train
        self.test_horizon = test_horizon

    def run(
        self,
        series:          SegmentSeries,
        changepoints:    ChangepointResult,
        override_bounds: Optional[dict[str, BoundsType]] = None,
    ) -> list[ModelScore]:
        t_all = np.array(series.years, dtype=float)
        y_all = np.array(series.values, dtype=float)
        n     = len(t_all)
        obs   = override_bounds or {}

        if n < self.min_train + 1:
            return self._full_data_fallback(t_all, y_all, obs)

        # accumulate MAPE per model across folds
        walk_mapes: dict[str, list[float]] = {}
        w_all = _recency_weights(n, changepoints.breakpoint_indices)

        for split in range(self.min_train - 1, n - 1):
            t_tr = t_all[:split + 1]
            y_tr = y_all[:split + 1]
            w_tr = w_all[:split + 1]
            t_te = t_all[split + 1 : split + 1 + self.test_horizon]
            y_te = y_all[split + 1 : split + 1 + self.test_horizon]
            if len(t_te) == 0:
                continue

            for model in _make_model_zoo():
                bounds  = obs.get(model.name)
                success = model.fit(t_tr, y_tr, weights=w_tr, bounds=bounds)
                if not success:
                    continue
                pred = model.predict(t_te)
                walk_mapes.setdefault(model.name, []).append(_mape(y_te, pred))

        # final AIC/BIC on full data + composite score
        scores: list[ModelScore] = []
        for model in _make_model_zoo():
            bounds  = obs.get(model.name)
            success = model.fit(t_all, y_all, weights=w_all, bounds=bounds)
            if not success:
                continue
            aic_val    = model.aic(t_all, y_all)
            bic_val    = model.bic(t_all, y_all)
            folds      = walk_mapes.get(model.name, [])
            mean_mape  = float(np.mean(folds)) if folds else np.inf
            t_score    = mean_mape + 0.01 * aic_val
            scores.append(ModelScore(
                model_name=model.name,
                params=model.params,
                aic=aic_val,
                bic=bic_val,
                mape=mean_mape,
                tournament_score=t_score,
                n_params=model.n_params,
            ))

        scores.sort(key=lambda s: s.tournament_score)
        return scores

    def _full_data_fallback(
        self, t: np.ndarray, y: np.ndarray, obs: dict
    ) -> list[ModelScore]:
        scores = []
        for model in _make_model_zoo():
            bounds  = obs.get(model.name)
            success = model.fit(t, y, bounds=bounds)
            if not success:
                continue
            aic_val = model.aic(t, y)
            scores.append(ModelScore(
                model_name=model.name,
                params=model.params,
                aic=aic_val,
                bic=model.bic(t, y),
                mape=model.mape_in_sample(t, y),
                tournament_score=aic_val,
                n_params=model.n_params,
            ))
        scores.sort(key=lambda s: s.tournament_score)
        return scores


# ══════════════════════════════════════════════════════════════════════════════
# 5.  BAYESIAN OVERRIDE  (Step 3 / Step 4 JSON → bound adjustments)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class OverrideSignal:
    """Distilled strategic signal from Step 3 (Porter's) + Step 4 (synergy)."""
    negative_growth:       bool  = False
    market_saturation:     bool  = False
    capex_expansion:       bool  = False
    competitive_intensity: float = 0.0   # 0–1  (1 = maximum competition)
    synergy_score:         float = 0.5   # 0–1  (1 = strong synergies)
    description:           str   = ""


_RATING_TO_FLOAT = {"high": 1.0, "medium": 0.5, "low": 0.0, "": 0.0}


class BayesianOverride:
    """
    Converts Step 3/4 JSON into per-model scipy bound adjustments.

    Expected Step 3 schema:
    {
      "segment": "...",
      "ratings": {
        "competitive_rivalry":    "high|medium|low",
        "threat_of_new_entrants": "...",
        "threat_of_substitutes":  "...",
        "buyer_power":            "...",
        "supplier_power":         "..."
      },
      "overall_rating": "..."
    }

    Expected Step 4 schema:
    {
      "segment":            "...",
      "synergy_score":      0.7,
      "market_saturation":  false,
      "capex_expansion":    true,
      "growth_paths":       [...]
    }
    """

    def parse_signal(
        self,
        step3_json: Optional[dict],
        step4_json: Optional[dict],
    ) -> OverrideSignal:
        sig  = OverrideSignal()
        desc = []

        # ── Step 3: Porter's Five Forces ──────────────────────────────────
        if step3_json:
            r = step3_json.get("ratings", {})
            negative_forces = [
                _RATING_TO_FLOAT.get(r.get("competitive_rivalry",    "").lower(), 0.0),
                _RATING_TO_FLOAT.get(r.get("threat_of_substitutes",  "").lower(), 0.0),
                _RATING_TO_FLOAT.get(r.get("buyer_power",            "").lower(), 0.0),
            ]
            sig.competitive_intensity = float(np.mean(negative_forces))
            if sig.competitive_intensity >= 0.67:
                sig.negative_growth = True
                desc.append(
                    f"high competitive intensity ({sig.competitive_intensity:.2f})"
                    " → downward growth pressure"
                )

        # ── Step 4: Synergy / growth analysis ─────────────────────────────
        if step4_json:
            sig.market_saturation = bool(step4_json.get("market_saturation", False))
            sig.capex_expansion   = bool(step4_json.get("capex_expansion",   False))
            sig.synergy_score     = float(step4_json.get("synergy_score",    0.5))

            if sig.market_saturation:
                desc.append(
                    "market saturation → locking logistic asymptote at current revenue"
                )
            if sig.capex_expansion:
                desc.append("CapEx expansion signal → allowing step uplift")
            if sig.synergy_score < 0.3:
                sig.negative_growth = True
                desc.append(
                    f"low synergy score ({sig.synergy_score:.2f})"
                    " → additional downward growth pressure"
                )

        sig.description = "; ".join(desc) if desc else "no override"
        return sig

    def to_bounds(
        self,
        signal:          OverrideSignal,
        current_value:   float,
        years:           list[int],
    ) -> dict[str, BoundsType]:
        """
        Return a dict of  { model_name: (lower_bounds_list, upper_bounds_list) }
        for models where bounds must be constrained.
        """
        bounds: dict[str, BoundsType] = {}
        t_min, t_max = float(min(years)), float(max(years))

        if signal.negative_growth:
            # Linear: force non-positive slope (ceiling on growth)
            bounds["linear"]      = ([-np.inf, -np.inf], [0.0, np.inf])
            # Exponential: cap growth rate b ≤ 1 % per year
            bounds["exponential"] = ([1e-9, -np.inf], [np.inf, 0.01])

        if signal.market_saturation:
            # Logistic: lock asymptote L ≤ current_value × 1.05
            L_cap = current_value * 1.05
            bounds["logistic"] = (
                [current_value * 0.5, 0.0,  t_min],
                [L_cap,              10.0, t_max],
            )

        # capex_expansion: no extra Python bounds — the detected level shift
        # already informs the model choice via the changepoint weighting.

        return bounds


# ══════════════════════════════════════════════════════════════════════════════
# 6.  ADAPTIVE FINANCIAL FITTER  (orchestrator)
# ══════════════════════════════════════════════════════════════════════════════

class AdaptiveFinancialFitter:
    """
    Full pipeline for one segment-metric combination:
      1. Detect changepoints (metric-type-aware)
      2. Parse Bayesian override from Step 3/4 JSON
      3. Run walk-forward tournament with recency weighting + override bounds
      4. Refit winner on full data, project forward with 90% bootstrap CI

    Usage::

        fitter = AdaptiveFinancialFitter()
        result = fitter.fit(series, projection_years=5,
                            step3_json={...}, step4_json={...})
    """

    def __init__(self):
        self._cpd        = ChangepointDetector()
        self._tournament = WalkForwardTournament(min_train=3, test_horizon=2)
        self._override   = BayesianOverride()

    def fit(
        self,
        series:           SegmentSeries,
        projection_years: int = 5,
        step3_json:       Optional[dict] = None,
        step4_json:       Optional[dict] = None,
    ) -> FitResult:
        t = np.array(series.years,  dtype=float)
        y = np.array(series.values, dtype=float)

        # [1] Changepoint detection
        changepoints = self._cpd.detect(series)

        # [2] Bayesian override
        current_val     = float(y[-1]) if len(y) else 1.0
        signal          = self._override.parse_signal(step3_json, step4_json)
        override_bounds = self._override.to_bounds(signal, current_val, series.years)

        # [3] Walk-forward tournament
        scores = self._tournament.run(series, changepoints, override_bounds)

        if not scores:
            return FitResult(
                segment_name=series.segment_name, metric_type=series.metric_type,
                winner_model="none", winner_params=np.array([]),
                changepoints=changepoints, all_scores=[],
                projected_values={}, confidence_interval={},
                override_applied=bool(override_bounds),
                override_description=signal.description,
            )

        winner = scores[0]

        # [4] Refit winner on full data then project
        model   = self._build_model(winner.model_name)
        w_full  = _recency_weights(len(t), changepoints.breakpoint_indices)
        bounds  = override_bounds.get(winner.model_name)
        model.fit(t, y, weights=w_full, bounds=bounds)

        last_year    = int(series.years[-1])
        future_years = list(range(last_year + 1, last_year + projection_years + 1))
        t_future     = np.array(future_years, dtype=float)
        projections  = model.predict(t_future)
        ci           = self._bootstrap_ci(model, t, y, t_future, w_full, bounds)

        return FitResult(
            segment_name=series.segment_name,
            metric_type=series.metric_type,
            winner_model=winner.model_name,
            winner_params=winner.params,
            changepoints=changepoints,
            all_scores=scores,
            projected_values=dict(zip(future_years, projections.tolist())),
            confidence_interval=ci,
            override_applied=bool(override_bounds),
            override_description=signal.description,
        )

    @staticmethod
    def _build_model(name: str) -> _BaseModel:
        mapping: dict[str, type] = {
            "linear":           LinearModel,
            "exponential":      ExponentialModel,
            "logistic":         LogisticModel,
            "power":            PowerModel,
            "piecewise_linear": lambda: PiecewiseLinearModel(2),  # type: ignore[assignment]
        }
        factory = mapping.get(name, LinearModel)
        return factory() if isinstance(factory, type) else factory()

    @staticmethod
    def _bootstrap_ci(
        model:    _BaseModel,
        t_train:  np.ndarray,
        y_train:  np.ndarray,
        t_future: np.ndarray,
        weights:  np.ndarray,
        bounds:   BoundsType,
        n_boot:   int = 300,
    ) -> dict[int, tuple[float, float]]:
        """Residual bootstrap — resample fit residuals, refit, collect percentiles."""
        residuals  = y_train - model.predict(t_train)
        boot_preds = []

        for _ in range(n_boot):
            y_boot  = model.predict(t_train) + np.random.choice(residuals, size=len(t_train))
            m_boot  = AdaptiveFinancialFitter._build_model(model.name)
            success = m_boot.fit(t_train, y_boot, weights=weights, bounds=bounds)
            if success:
                boot_preds.append(m_boot.predict(t_future))

        if len(boot_preds) < 10:
            # too few converged — use ±20% heuristic
            pred = model.predict(t_future)
            return {int(yr): (float(p * 0.80), float(p * 1.20))
                    for yr, p in zip(t_future, pred)}

        arr = np.array(boot_preds)
        lo  = np.percentile(arr, 5,  axis=0)
        hi  = np.percentile(arr, 95, axis=0)
        return {int(yr): (float(l), float(h))
                for yr, l, h in zip(t_future, lo, hi)}


# ══════════════════════════════════════════════════════════════════════════════
# 7.  DEMO SCRIPT
# ══════════════════════════════════════════════════════════════════════════════

def _sep(char="═", width=64):
    return char * width


def _print_result(result: FitResult, title: str):
    print(f"\n{_sep()}")
    print(f"  {title}")
    print(f"  Segment : {result.segment_name}")
    print(f"  Metric  : {result.metric_type.value}")
    print(_sep())

    cp = result.changepoints
    cp_str = f"{cp.breakpoint_years}" if cp.breakpoint_years else "none detected"
    print(f"  Changepoints  : {cp_str}  [{cp.method}]")
    print(f"  Override      : {result.override_description}")

    if result.all_scores:
        print(f"\n  {'Model':<22} {'AIC':>9} {'BIC':>9} {'MAPE %':>8} {'Score':>9}")
        print(f"  {'-'*22} {'-'*9} {'-'*9} {'-'*8} {'-'*9}")
        for s in result.all_scores:
            flag = " ← winner" if s.model_name == result.winner_model else ""
            print(f"  {s.model_name:<22} {s.aic:9.2f} {s.bic:9.2f} "
                  f"{s.mape:8.2f} {s.tournament_score:9.2f}{flag}")

    print(f"\n  Projections (USD M, 90% CI):")
    for yr, val in result.projected_values.items():
        lo, hi = result.confidence_interval.get(yr, (val, val))
        print(f"    {yr}: {val:8.1f}   [{lo:7.1f} – {hi:7.1f}]")


def run_demo():
    """
    Three datasets:
      A. Cloud Services revenue   — S-curve that flattens (logistic)
      B. Operating Costs          — steady linear rise
      C. Capital Expenditure      — step-wise jumps (level shifts)

    Three scenarios for revenue:
      Baseline   → no override
      Bad news   → high competition + market saturation
      Expansion  → positive synergies, no saturation

    CapEx is also run with an expansion signal to show the step-handling.
    """
    rng = np.random.default_rng(42)
    fitter = AdaptiveFinancialFitter()
    years  = list(range(2015, 2025))
    t      = np.array(years, dtype=float)

    # ── Dataset A: logistic S-curve revenue ───────────────────────────────
    L_true, k_true, t0_true = 950.0, 0.65, 2021.0
    rev_true   = _logistic_fn(t, L_true, k_true, t0_true)
    rev_noisy  = (rev_true + rng.normal(0, 18, len(t))).clip(10).tolist()
    revenue_s  = SegmentSeries("Cloud Services", MetricType.REVENUE, years, rev_noisy)

    # ── Dataset B: linear cost ────────────────────────────────────────────
    cost_noisy = (110 + 22 * (t - t[0]) + rng.normal(0, 10, len(t))).tolist()
    cost_s     = SegmentSeries("Operating Costs", MetricType.COST, years, cost_noisy)

    # ── Dataset C: step-wise CapEx ────────────────────────────────────────
    capex_vals = []
    for yr in years:
        base = 55.0
        if yr >= 2019: base = 95.0    # acquisition step
        if yr >= 2022: base = 150.0   # expansion step
        capex_vals.append(base + rng.normal(0, 6))
    capex_s = SegmentSeries("Capital Expenditure", MetricType.CAPEX, years, capex_vals)

    # ══ SCENARIO A: Baseline ══════════════════════════════════════════════
    print(f"\n\n{'#'*64}")
    print("  SCENARIO A — BASELINE  (no news override)")
    print(f"{'#'*64}")
    for s in [revenue_s, cost_s, capex_s]:
        r = fitter.fit(s, projection_years=3)
        _print_result(r, f"Baseline · {s.segment_name}")

    # ══ SCENARIO B: Bad news (saturation + high competition) ══════════════
    print(f"\n\n{'#'*64}")
    print("  SCENARIO B — BAD NEWS  (saturation + high competitive pressure)")
    print(f"{'#'*64}")
    step3_bad = {
        "segment": "Cloud Services",
        "ratings": {
            "competitive_rivalry":    "high",
            "threat_of_new_entrants": "high",
            "threat_of_substitutes":  "high",
            "buyer_power":            "high",
            "supplier_power":         "medium",
        },
        "overall_rating": "high competition",
        "key_insights": ["AWS and Azure price war", "Market near saturation"],
    }
    step4_bad = {
        "segment":           "Cloud Services",
        "synergy_score":     0.2,
        "market_saturation": True,
        "capex_expansion":   False,
        "growth_paths":      [],
    }
    r_bad = fitter.fit(revenue_s, projection_years=3,
                       step3_json=step3_bad, step4_json=step4_bad)
    _print_result(r_bad, "BAD NEWS · Cloud Services Revenue")

    # ══ SCENARIO C: Expansion news ════════════════════════════════════════
    print(f"\n\n{'#'*64}")
    print("  SCENARIO C — EXPANSION NEWS  (strong synergies, CapEx ramp)")
    print(f"{'#'*64}")
    step4_expansion = {
        "segment":           "Capital Expenditure",
        "synergy_score":     0.85,
        "market_saturation": False,
        "capex_expansion":   True,
        "growth_paths":      ["new data-centre build-out", "GPU cluster acquisition"],
    }
    r_exp = fitter.fit(capex_s, projection_years=3, step4_json=step4_expansion)
    _print_result(r_exp, "EXPANSION NEWS · Capital Expenditure")

    # ══ Side-by-side comparison: bad vs baseline revenue ══════════════════
    r_base = fitter.fit(revenue_s, projection_years=3)
    print(f"\n\n{'#'*64}")
    print("  COMPARISON — Revenue projection: Baseline vs. Bad-news override")
    print(f"{'#'*64}")
    print(f"\n  {'Year':<6} {'Baseline':>12} {'Bad-news':>12}  {'Delta':>10}")
    print(f"  {'-'*6} {'-'*12} {'-'*12}  {'-'*10}")
    for yr in r_base.projected_values:
        base_v = r_base.projected_values[yr]
        bad_v  = r_bad.projected_values.get(yr, float("nan"))
        delta  = bad_v - base_v
        print(f"  {yr:<6} {base_v:12.1f} {bad_v:12.1f}  {delta:+10.1f}")

    print(f"\n\n{'─'*64}")
    print("  ✓ Demo complete.")
    print(f"{'─'*64}\n")


if __name__ == "__main__":
    run_demo()
