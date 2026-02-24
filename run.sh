#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/backend"

# Install dependencies if not already installed
if ! python -c "import fastapi" 2>/dev/null; then
  echo "Installing dependencies…"
  pip install -r requirements.txt
fi

# Create .env from example if missing
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  Created backend/.env from the example file."
  echo "   Open it and fill in your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
  echo "   before logging in.  The app will still start for testing."
  echo ""
fi

echo "Starting CalSync on http://localhost:8000"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
