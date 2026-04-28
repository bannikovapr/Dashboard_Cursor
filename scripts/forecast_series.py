#!/usr/bin/env python3
import json
import math
import sys
from typing import Dict, List, Tuple


def _to_float(v):
    try:
        return float(v)
    except Exception:
        return 0.0


def _safe_div(a, b):
    if b == 0:
        return None
    return a / b


def _metrics(y_true: List[float], y_pred: List[float]) -> Dict[str, float]:
    if not y_true or len(y_true) != len(y_pred):
        return {"mae": None, "rmse": None, "mape": None}
    errs = [yt - yp for yt, yp in zip(y_true, y_pred)]
    abs_err = [abs(e) for e in errs]
    sq_err = [e * e for e in errs]
    mae = sum(abs_err) / len(abs_err)
    rmse = math.sqrt(sum(sq_err) / len(sq_err))
    mape_vals = []
    for yt, yp in zip(y_true, y_pred):
        if yt != 0:
            mape_vals.append(abs((yt - yp) / yt))
    mape = (sum(mape_vals) / len(mape_vals) * 100.0) if mape_vals else None
    return {"mae": mae, "rmse": rmse, "mape": mape}


def _linear_fallback_forecast(series: List[float], horizon: int) -> Tuple[List[float], List[float], List[float], Dict[str, str]]:
    n = len(series)
    if n == 0:
        fc = [0.0] * horizon
        return fc, fc[:], fc[:], {"name": "linear_fallback_empty", "reason": "empty_series"}
    if n == 1:
        fc = [series[0]] * horizon
        return fc, fc[:], fc[:], {"name": "linear_fallback_single", "reason": "single_point"}

    x_mean = (n - 1) / 2.0
    y_mean = sum(series) / n
    num = 0.0
    den = 0.0
    for i, y in enumerate(series):
        dx = i - x_mean
        num += dx * (y - y_mean)
        den += dx * dx
    slope = _safe_div(num, den) if den != 0 else 0.0
    slope = slope if slope is not None else 0.0
    intercept = y_mean - slope * x_mean

    fc = [max(0.0, intercept + slope * (n + i)) for i in range(horizon)]
    resid = [series[i] - (intercept + slope * i) for i in range(n)]
    sigma = math.sqrt(sum(r * r for r in resid) / max(1, len(resid)))
    lower = [max(0.0, v - 1.96 * sigma) for v in fc]
    upper = [max(0.0, v + 1.96 * sigma) for v in fc]
    return fc, lower, upper, {"name": "linear_fallback", "reason": "statsmodels_unavailable_or_failed"}


def _try_ets(series: List[float], horizon: int):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing  # type: ignore

    model = ExponentialSmoothing(series, trend="add", damped_trend=True, seasonal=None)
    fit = model.fit(optimized=True, use_brute=True)
    fc = [max(0.0, float(x)) for x in fit.forecast(horizon)]
    sigma = math.sqrt(float(getattr(fit, "sse", 0.0)) / max(1, len(series)))
    lower = [max(0.0, v - 1.96 * sigma) for v in fc]
    upper = [max(0.0, v + 1.96 * sigma) for v in fc]
    pred_in = [max(0.0, float(x)) for x in fit.fittedvalues]
    m = _metrics(series[-len(pred_in):], pred_in)
    return {"ok": True, "forecast": fc, "lower": lower, "upper": upper, "metrics": m, "model": {"name": "ets_damped", "aic": _to_float(getattr(fit, "aic", 0.0))}}


def _try_arima(series: List[float], horizon: int):
    from statsmodels.tsa.statespace.sarimax import SARIMAX  # type: ignore

    best = None
    best_score = None
    grid = [(1, 1, 1), (1, 1, 0), (0, 1, 1), (2, 1, 1), (2, 1, 0), (0, 1, 2)]
    for order in grid:
        try:
            model = SARIMAX(series, order=order, enforce_stationarity=False, enforce_invertibility=False)
            fit = model.fit(disp=False)
            score = _to_float(getattr(fit, "aic", 1e18))
            if best is None or score < best_score:
                best = fit
                best_score = score
        except Exception:
            continue
    if best is None:
        return {"ok": False, "error": "arima_fit_failed"}

    pred = best.get_forecast(steps=horizon)
    mean = [max(0.0, float(x)) for x in pred.predicted_mean]
    ci = pred.conf_int(alpha=0.05)
    lower = []
    upper = []
    for i in range(horizon):
        l = _to_float(ci[i][0]) if hasattr(ci, "__getitem__") else mean[i]
        u = _to_float(ci[i][1]) if hasattr(ci, "__getitem__") else mean[i]
        lower.append(max(0.0, l))
        upper.append(max(0.0, u))

    pred_in = [max(0.0, _to_float(x)) for x in best.fittedvalues]
    m = _metrics(series[-len(pred_in):], pred_in)
    order = tuple(best.model_orders.get(k, 0) for k in ("ar", "diff", "ma")) if hasattr(best, "model_orders") else (1, 1, 1)
    return {
        "ok": True,
        "forecast": mean,
        "lower": lower,
        "upper": upper,
        "metrics": m,
        "model": {"name": "sarimax_arima", "aic": _to_float(getattr(best, "aic", 0.0)), "order": list(order)},
    }


def _build_output(inp: Dict) -> Dict:
    series_rows = inp.get("series") or []
    horizon = int(inp.get("horizon") or 3)
    method = str(inp.get("method") or "auto").lower()
    with_conf = bool(inp.get("with_confidence", True))

    values = [_to_float(r.get("value", 0.0)) for r in series_rows]
    if horizon < 1:
        horizon = 1
    if horizon > 12:
        horizon = 12

    chosen = None
    if method in ("auto", "ets"):
        try:
            chosen = _try_ets(values, horizon)
            if chosen.get("ok") and method == "ets":
                pass
        except Exception as e:
            chosen = {"ok": False, "error": f"ets_error:{e}"}
    if (chosen is None or not chosen.get("ok")) and method in ("auto", "arima"):
        try:
            ar = _try_arima(values, horizon)
            if ar.get("ok"):
                chosen = ar
        except Exception as e:
            chosen = {"ok": False, "error": f"arima_error:{e}"}

    if chosen is None or not chosen.get("ok"):
        fc, lo, up, mi = _linear_fallback_forecast(values, horizon)
        chosen = {"ok": True, "forecast": fc, "lower": lo, "upper": up, "metrics": _metrics(values, values), "model": mi}

    last_ts = series_rows[-1].get("ts", "2025-12") if series_rows else "2025-12"
    last_year = int(str(last_ts).split("-")[0]) if "-" in str(last_ts) else 2025
    last_month = int(str(last_ts).split("-")[1]) if "-" in str(last_ts) else 12

    forecast_points = []
    for i, val in enumerate(chosen["forecast"], start=1):
        m = last_month + i
        y = last_year + (m - 1) // 12
        mm = ((m - 1) % 12) + 1
        ts = f"{y}-{mm:02d}"
        row = {"ts": ts, "step": i, "value": float(val)}
        if with_conf:
            row["lower"] = float(chosen["lower"][i - 1])
            row["upper"] = float(chosen["upper"][i - 1])
        forecast_points.append(row)

    return {
        "ok": True,
        "model_info": chosen["model"],
        "quality": chosen["metrics"],
        "series_history": [{"ts": r.get("ts"), "value": _to_float(r.get("value", 0.0))} for r in series_rows],
        "series_forecast": forecast_points,
    }


def main():
    try:
        raw = sys.stdin.read()
        inp = json.loads(raw or "{}")
        out = _build_output(inp)
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
