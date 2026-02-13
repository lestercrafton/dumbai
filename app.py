"""
Fraud Finder for Citizen Journalists
=====================================
A web app that uses public CMS Medicare provider data to flag potential fraud
hotspots, then lets citizen journalists upload video evidence and share findings.
"""

import os
import json
import sqlite3
import uuid
from datetime import datetime

import numpy as np
import pandas as pd
import requests
from flask import (
    Flask, render_template, request, jsonify, send_from_directory, redirect,
    url_for,
)

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(__file__), "uploads")
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB max upload
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

DATABASE = os.path.join(os.path.dirname(__file__), "fraudfinder.db")

# ---------------------------------------------------------------------------
# CMS Data API helpers
# ---------------------------------------------------------------------------

CMS_BASE = "https://data.cms.gov/data-api/v1/dataset"
# Medicare Physician & Other Practitioners — by Provider and Service
CMS_PROVIDER_SERVICE_UUID = "4de9a735-eca8-4438-8e5a-1bd0a42d92e3"
# Fallback: Socrata endpoint
SOCRATA_ENDPOINT = "https://data.cms.gov/resource/cng4-92f3.json"

# States FIPS / abbreviation lookup for geographic analysis
US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

# Approximate state populations (2023 Census est.) for per-capita analysis
STATE_POP = {
    "AL": 5108468, "AK": 733406, "AZ": 7431344, "AR": 3067732,
    "CA": 38965193, "CO": 5877610, "CT": 3617176, "DE": 1031890,
    "FL": 22610726, "GA": 11029227, "HI": 1435138, "ID": 1964726,
    "IL": 12549689, "IN": 6862199, "IA": 3207004, "KS": 2940546,
    "KY": 4526154, "LA": 4573749, "ME": 1395722, "MD": 6180253,
    "MA": 7001399, "MI": 10037261, "MN": 5737915, "MS": 2939690,
    "MO": 6196156, "MT": 1132812, "NE": 1978379, "NV": 3194176,
    "NH": 1402054, "NJ": 9290841, "NM": 2114371, "NY": 19571216,
    "NC": 10835491, "ND": 783926, "OH": 11785935, "OK": 4053824,
    "OR": 4233358, "PA": 12961683, "RI": 1095962, "SC": 5373555,
    "SD": 919318, "TN": 7126489, "TX": 30503301, "UT": 3417734,
    "VT": 647464, "VA": 8642274, "WA": 7812880, "WV": 1770071,
    "WI": 5910955, "WY": 584057, "DC": 678972,
}

# HCPCS codes commonly associated with ABA / behavioral health billing fraud
FRAUD_FOCUS_CODES = {
    "97153": "Adaptive behavior treatment by protocol",
    "97155": "Adaptive behavior treatment with modification",
    "97156": "Family adaptive behavior treatment guidance",
    "97151": "Behavior identification assessment",
    "97154": "Group adaptive behavior treatment",
    "99213": "Office/outpatient visit, est. patient (low complexity)",
    "99214": "Office/outpatient visit, est. patient (moderate)",
    "99215": "Office/outpatient visit, est. patient (high)",
}


SAMPLE_DATA_PATH = os.path.join(os.path.dirname(__file__), "sample_data.json")


def fetch_cms_data(hcpcs_code=None, state=None, limit=5000, offset=0):
    """Fetch provider-level claims data from the CMS Socrata API.
    Falls back to local sample_data.json if the API is unreachable."""
    params = {
        "$limit": limit,
        "$offset": offset,
        "$order": "Tot_Srvcs DESC",
    }
    if hcpcs_code:
        params["HCPCS_Cd"] = hcpcs_code
    if state:
        params["Rndrng_Prvdr_State_Abrvtn"] = state

    try:
        resp = requests.get(SOCRATA_ENDPOINT, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if data:
            return data
    except requests.RequestException:
        pass

    # Fallback: use local sample data
    return _load_sample_data(hcpcs_code, state, limit)


def _load_sample_data(hcpcs_code=None, state=None, limit=5000):
    """Load from sample_data.json and filter like the API would."""
    if not os.path.exists(SAMPLE_DATA_PATH):
        return []
    with open(SAMPLE_DATA_PATH) as f:
        records = json.load(f)
    if hcpcs_code:
        records = [r for r in records if r.get("HCPCS_Cd") == hcpcs_code]
    if state:
        records = [r for r in records if r.get("Rndrng_Prvdr_State_Abrvtn") == state]
    records.sort(key=lambda r: r.get("Tot_Srvcs", 0), reverse=True)
    return records[:limit]


def analyze_outliers(records):
    """
    Given a list of CMS provider-service records, compute statistical outliers.
    Returns a dict with analysis results.
    """
    if not records:
        return {"providers": [], "state_summary": [], "geographic_outliers": []}

    df = pd.DataFrame(records)

    # Normalize column names (CMS API returns mixed-case)
    col_map = {}
    for c in df.columns:
        col_map[c] = c.strip()
    df.rename(columns=col_map, inplace=True)

    # Key numeric columns
    num_cols = {
        "Tot_Srvcs": "total_services",
        "Tot_Benes": "total_beneficiaries",
        "Avg_Mdcr_Pymt_Amt": "avg_medicare_payment",
        "Avg_Sbmtd_Chrg": "avg_submitted_charge",
        "Tot_Sbmtd_Chrgs": "total_submitted_charges",
        "Tot_Mdcr_Pymt_Amt": "total_medicare_payment",
    }

    for raw, nice in num_cols.items():
        if raw in df.columns:
            df[nice] = pd.to_numeric(df[raw], errors="coerce").fillna(0)

    # Compute estimated total paid if not directly available
    if "total_medicare_payment" not in df.columns and "avg_medicare_payment" in df.columns:
        df["total_medicare_payment"] = df["avg_medicare_payment"] * df.get("total_services", 1)

    # --- 1. Providers >3 std devs above mean ---
    outlier_providers = []
    for metric in ["total_services", "total_medicare_payment"]:
        if metric not in df.columns:
            continue
        mean = df[metric].mean()
        std = df[metric].std()
        if std == 0:
            continue
        threshold = mean + 3 * std
        mask = df[metric] > threshold
        for _, row in df[mask].iterrows():
            outlier_providers.append({
                "npi": str(row.get("Rndrng_NPI", "")),
                "name": f"{row.get('Rndrng_Prvdr_Last_Org_Name', '')}",
                "first_name": str(row.get("Rndrng_Prvdr_First_Name", "")),
                "state": str(row.get("Rndrng_Prvdr_State_Abrvtn", "")),
                "city": str(row.get("Rndrng_Prvdr_City", "")),
                "zip": str(row.get("Rndrng_Prvdr_Zip5", "")),
                "hcpcs": str(row.get("HCPCS_Cd", "")),
                "hcpcs_desc": str(row.get("HCPCS_Desc", "")),
                "metric": metric,
                "value": float(row[metric]),
                "mean": float(mean),
                "std_devs_above": float((row[metric] - mean) / std) if std else 0,
                "threshold": float(threshold),
            })

    # --- 2. State-level aggregation ---
    state_col = "Rndrng_Prvdr_State_Abrvtn"
    state_summary = []
    if state_col in df.columns and "total_medicare_payment" in df.columns:
        state_agg = df.groupby(state_col).agg(
            total_paid=("total_medicare_payment", "sum"),
            total_claims=("total_services", "sum"),
            provider_count=("Rndrng_NPI", "nunique"),
        ).reset_index()

        for _, row in state_agg.iterrows():
            st = row[state_col]
            pop = STATE_POP.get(st, None)
            per_capita = (row["total_paid"] / pop) if pop else None
            state_summary.append({
                "state": st,
                "state_name": US_STATES.get(st, st),
                "total_paid": float(row["total_paid"]),
                "total_claims": int(row["total_claims"]),
                "provider_count": int(row["provider_count"]),
                "population": pop,
                "paid_per_capita": round(per_capita, 4) if per_capita else None,
            })

    # --- 3. Geographic outliers: high per-capita in low-pop states ---
    geographic_outliers = []
    if state_summary:
        ss_df = pd.DataFrame(state_summary)
        ss_df = ss_df.dropna(subset=["paid_per_capita"])
        if len(ss_df) > 2:
            mean_pc = ss_df["paid_per_capita"].mean()
            std_pc = ss_df["paid_per_capita"].std()
            if std_pc > 0:
                for _, row in ss_df.iterrows():
                    z = (row["paid_per_capita"] - mean_pc) / std_pc
                    if z > 2:  # >2 std devs for geographic
                        geographic_outliers.append({
                            "state": row["state"],
                            "state_name": row["state_name"],
                            "paid_per_capita": row["paid_per_capita"],
                            "z_score": round(z, 2),
                            "population": row["population"],
                            "total_paid": row["total_paid"],
                        })

    # Sort outlier providers by std_devs_above descending
    outlier_providers.sort(key=lambda x: x["std_devs_above"], reverse=True)

    return {
        "providers": outlier_providers[:100],  # top 100
        "state_summary": sorted(state_summary, key=lambda x: x["total_paid"], reverse=True),
        "geographic_outliers": sorted(geographic_outliers, key=lambda x: x["z_score"], reverse=True),
        "record_count": len(df),
    }


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS investigations (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            npi TEXT,
            provider_name TEXT,
            city TEXT,
            state TEXT,
            zip TEXT,
            hcpcs TEXT,
            hcpcs_desc TEXT,
            metric TEXT,
            value REAL,
            std_devs_above REAL,
            notes TEXT,
            lat REAL,
            lon REAL
        );

        CREATE TABLE IF NOT EXISTS evidence (
            id TEXT PRIMARY KEY,
            investigation_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            media_type TEXT NOT NULL,
            caption TEXT,
            FOREIGN KEY (investigation_id) REFERENCES investigations(id)
        );
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html", fraud_focus_codes=FRAUD_FOCUS_CODES)


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    """Fetch CMS data and run fraud detection analysis."""
    body = request.get_json(silent=True) or {}
    hcpcs = body.get("hcpcs_code", "97153")
    state = body.get("state", None)
    limit = min(int(body.get("limit", 5000)), 10000)

    records = fetch_cms_data(hcpcs_code=hcpcs, state=state if state else None, limit=limit)
    analysis = analyze_outliers(records)
    analysis["query"] = {"hcpcs_code": hcpcs, "state": state, "limit": limit}

    return jsonify(analysis)


@app.route("/api/investigate", methods=["POST"])
def api_create_investigation():
    """Create an investigation record for a flagged provider."""
    body = request.get_json(silent=True) or {}
    inv_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        """INSERT INTO investigations
        (id, created_at, npi, provider_name, city, state, zip, hcpcs,
         hcpcs_desc, metric, value, std_devs_above, notes, lat, lon)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            inv_id, datetime.utcnow().isoformat(),
            body.get("npi"), body.get("provider_name"),
            body.get("city"), body.get("state"), body.get("zip"),
            body.get("hcpcs"), body.get("hcpcs_desc"),
            body.get("metric"), body.get("value"),
            body.get("std_devs_above"), body.get("notes"),
            body.get("lat"), body.get("lon"),
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"id": inv_id, "status": "created"})


@app.route("/api/investigate/<inv_id>/upload", methods=["POST"])
def api_upload_evidence(inv_id):
    """Upload a video/photo as evidence for an investigation."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if f.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    allowed = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".jpg", ".jpeg", ".png", ".heic"}
    if ext not in allowed:
        return jsonify({"error": f"File type {ext} not allowed"}), 400

    ev_id = str(uuid.uuid4())
    safe_name = f"{ev_id}{ext}"
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], safe_name)
    f.save(save_path)

    media_type = "video" if ext in {".mp4", ".mov", ".avi", ".webm", ".mkv"} else "image"

    conn = get_db()
    conn.execute(
        """INSERT INTO evidence (id, investigation_id, created_at, filename,
           original_filename, media_type, caption)
           VALUES (?,?,?,?,?,?,?)""",
        (ev_id, inv_id, datetime.utcnow().isoformat(), safe_name,
         f.filename, media_type, request.form.get("caption", "")),
    )
    conn.commit()
    conn.close()

    return jsonify({"id": ev_id, "filename": safe_name, "media_type": media_type})


@app.route("/api/investigations", methods=["GET"])
def api_list_investigations():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM investigations ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    investigations = []
    for r in rows:
        inv = dict(r)
        evidence = conn.execute(
            "SELECT * FROM evidence WHERE investigation_id = ? ORDER BY created_at",
            (inv["id"],),
        ).fetchall()
        inv["evidence"] = [dict(e) for e in evidence]
        investigations.append(inv)
    conn.close()
    return jsonify(investigations)


@app.route("/api/investigations/<inv_id>", methods=["GET"])
def api_get_investigation(inv_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM investigations WHERE id = ?", (inv_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    inv = dict(row)
    evidence = conn.execute(
        "SELECT * FROM evidence WHERE investigation_id = ? ORDER BY created_at",
        (inv_id,),
    ).fetchall()
    inv["evidence"] = [dict(e) for e in evidence]
    conn.close()
    return jsonify(inv)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/investigation/<inv_id>")
def investigation_page(inv_id):
    return render_template("investigation.html", investigation_id=inv_id)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

init_db()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
