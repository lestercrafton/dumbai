"""
Generate sample CMS-style data for local development and demo purposes.
Run this to populate the app with realistic-looking test data so you can
see the fraud detection in action without waiting for the CMS API.

Usage:  python seed_sample_data.py
"""

import json
import os
import random
import string

import numpy as np

OUTPUT = os.path.join(os.path.dirname(__file__), "sample_data.json")

STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]

CITIES = {
    "FL": ["Miami", "Orlando", "Tampa", "Jacksonville", "Fort Lauderdale"],
    "TX": ["Houston", "Dallas", "Austin", "San Antonio", "El Paso"],
    "CA": ["Los Angeles", "San Diego", "San Francisco", "Sacramento", "Fresno"],
    "NY": ["New York", "Buffalo", "Albany", "Rochester", "Syracuse"],
    "IL": ["Chicago", "Springfield", "Peoria", "Rockford", "Naperville"],
}

LAST_NAMES = [
    "SMITH", "JOHNSON", "WILLIAMS", "BROWN", "JONES", "GARCIA", "MILLER",
    "DAVIS", "RODRIGUEZ", "MARTINEZ", "HERNANDEZ", "LOPEZ", "GONZALEZ",
    "WILSON", "ANDERSON", "THOMAS", "TAYLOR", "MOORE", "JACKSON", "MARTIN",
    "LEE", "PEREZ", "THOMPSON", "WHITE", "HARRIS", "SANCHEZ", "CLARK",
    "RAMIREZ", "LEWIS", "ROBINSON",
]

FIRST_NAMES = [
    "JAMES", "MARY", "ROBERT", "PATRICIA", "JOHN", "JENNIFER", "MICHAEL",
    "LINDA", "DAVID", "ELIZABETH", "WILLIAM", "BARBARA", "RICHARD", "SUSAN",
    "JOSEPH", "JESSICA", "THOMAS", "SARAH", "CHARLES", "KAREN",
]

HCPCS_CODES = {
    "97153": "Adaptive behavior treatment by protocol",
    "97155": "Adaptive behavior treatment w/ modification",
    "97156": "Family adaptive behavior treatment guidance",
    "97151": "Behavior identification assessment",
    "99213": "Office/outpatient visit est patient low",
    "99214": "Office/outpatient visit est patient mod",
}


def make_npi():
    return "".join(random.choices(string.digits, k=10))


def make_zip(state):
    # Rough zip prefixes by state
    prefixes = {"FL": "33", "TX": "75", "CA": "90", "NY": "10", "IL": "60"}
    p = prefixes.get(state, str(random.randint(10, 99)))
    return p + "".join(random.choices(string.digits, k=3))


def generate():
    records = []
    rng = np.random.default_rng(42)

    for hcpcs, desc in HCPCS_CODES.items():
        # Generate ~800 normal providers
        n_normal = 800
        # Generate ~5 extreme outliers (fraud-like)
        n_outliers = 5

        for i in range(n_normal + n_outliers):
            state = random.choice(STATES)
            city = random.choice(CITIES.get(state, ["Springfield"]))
            is_outlier = i >= n_normal

            if is_outlier:
                # These are the suspicious ones — extremely high volumes
                tot_srvcs = int(rng.normal(50000, 10000))
                avg_pymt = round(rng.normal(120, 20), 2)
                # Place outliers in specific states for geographic signal
                state = random.choice(["FL", "TX", "CA", "LA", "MS"])
                city = random.choice(CITIES.get(state, ["Springfield"]))
            else:
                tot_srvcs = max(11, int(rng.lognormal(4, 1.5)))
                avg_pymt = round(max(5, rng.normal(45, 15)), 2)

            tot_benes = max(1, int(tot_srvcs * rng.uniform(0.1, 0.6)))
            avg_chrg = round(avg_pymt * rng.uniform(1.5, 4.0), 2)

            records.append({
                "Rndrng_NPI": make_npi(),
                "Rndrng_Prvdr_Last_Org_Name": random.choice(LAST_NAMES),
                "Rndrng_Prvdr_First_Name": random.choice(FIRST_NAMES),
                "Rndrng_Prvdr_City": city,
                "Rndrng_Prvdr_State_Abrvtn": state,
                "Rndrng_Prvdr_Zip5": make_zip(state),
                "HCPCS_Cd": hcpcs,
                "HCPCS_Desc": desc,
                "Tot_Srvcs": tot_srvcs,
                "Tot_Benes": tot_benes,
                "Avg_Mdcr_Pymt_Amt": avg_pymt,
                "Avg_Sbmtd_Chrg": avg_chrg,
                "Tot_Mdcr_Pymt_Amt": round(avg_pymt * tot_srvcs, 2),
                "Tot_Sbmtd_Chrgs": round(avg_chrg * tot_srvcs, 2),
            })

    random.shuffle(records)
    with open(OUTPUT, "w") as f:
        json.dump(records, f)

    print(f"Generated {len(records)} sample records -> {OUTPUT}")
    print(f"  {len(HCPCS_CODES)} HCPCS codes, ~{n_outliers} outliers per code")


if __name__ == "__main__":
    generate()
