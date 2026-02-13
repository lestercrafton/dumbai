#!/bin/bash
# Fraud Finder for Citizen Journalists — quick start
set -e

echo "=== Fraud Finder for Citizen Journalists ==="

# Install dependencies
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt

# Generate sample data if not present
if [ ! -f "sample_data.json" ]; then
    echo "Generating sample data for demo..."
    python seed_sample_data.py
fi

echo ""
echo "Starting server at http://localhost:5000"
echo "Press Ctrl+C to stop."
echo ""

python app.py
