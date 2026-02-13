# Fraud Finder for Citizen Journalists

A web app that uses public CMS Medicare provider data to identify statistical outliers in billing — potential fraud hotspots — and empowers citizen journalists to investigate and document them.

## What It Does

1. **Pulls real Medicare claims data** from the [CMS Open Data API](https://data.cms.gov) (Medicare Physician & Other Practitioners dataset)
2. **Flags statistical outliers** — providers with claim volumes or payments >3 standard deviations above the mean for specific billing codes (e.g., 97153 adaptive behavior treatment)
3. **Identifies geographic anomalies** — states with unusually high per-capita Medicare spending for selected codes
4. **Lets you investigate** — pick a flagged provider, visit the location, upload video/photo evidence
5. **Share findings** — one-click sharing to X, Facebook, Reddit, or TikTok

## Quick Start

```bash
./run.sh
```

Or manually:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed_sample_data.py   # generate demo data
python app.py                # starts at http://localhost:5000
```

## Fraud Detection Methods

- **Provider outliers**: Providers with total services or total Medicare payments >3 standard deviations above the mean for a given HCPCS code
- **Geographic outliers**: States where per-capita Medicare spending for a code is >2 standard deviations above the national mean
- **Focus codes**: Pre-loaded with codes commonly flagged in ABA therapy and office visit billing fraud (97153, 97155, 97156, 97151, 99213–99215)

## Data Sources

- [CMS Medicare Physician & Other Practitioners](https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners) — public claims data
- [HHS Open Data](https://opendata.hhs.gov/) — federal health data portal
- [OIG LEIE](https://oig.hhs.gov/exclusions/) — excluded provider list (reference)

## Disclaimer

This tool flags **statistical outliers**. A flagged provider is **not** proven fraudulent. Always verify facts before making any accusations. This tool is for transparency and civic engagement.
