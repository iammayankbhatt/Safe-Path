#!/bin/bash
# SafePath — Quick Start Script
# Run this from the project root: bash start.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "🛡️  SafePath — Women's Safety Navigation Platform"
echo "   Watch The Code 2026 · Team HAWKS · GEHU Haldwani"
echo ""

# Check dependencies
command -v node >/dev/null 2>&1 || { echo -e "${RED}❌ Node.js not found. Install from https://nodejs.org${NC}"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo -e "${RED}❌ Python 3 not found.${NC}"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo -e "${YELLOW}⚠️  psql not found — skipping DB auto-setup${NC}"; }

echo -e "${GREEN}✅ Dependencies found${NC}"
echo ""

# Install backend
if [ ! -d "backend/node_modules" ]; then
  echo "📦 Installing backend dependencies..."
  cd backend && npm install && cd ..
fi

# Install frontend
if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

# Install ML deps
echo "🐍 Installing Python dependencies..."
cd ml-service && pip install -r requirements.txt -q && cd ..

# Copy env files if they don't exist
[ ! -f "backend/.env" ] && cp backend/.env.example backend/.env && echo -e "${YELLOW}📝 Created backend/.env — please add your DB/Twilio credentials${NC}"
[ ! -f "ml-service/.env" ] && cp ml-service/.env.example ml-service/.env && echo -e "${YELLOW}📝 Created ml-service/.env — please add your DB credentials${NC}"
[ ! -f "frontend/.env" ] && cp frontend/.env.example frontend/.env

# Database setup
if command -v psql >/dev/null 2>&1; then
  echo ""
  echo "🗄️  Setting up database..."
  echo "   (If this fails, run manually: psql -d safepath -f database/setup.sql)"
  
  # Try to create DB
  createdb safepath 2>/dev/null && echo "✅ Database 'safepath' created" || echo "ℹ️  Database 'safepath' already exists"
  
  # Run setup
  psql -d safepath -f database/setup.sql -q && echo "✅ Schema + seed data loaded" || echo -e "${YELLOW}⚠️  DB setup failed — check your PostgreSQL config${NC}"
fi

echo ""
echo "🚀 Starting all services..."
echo ""
echo "   Backend:  http://localhost:5000"
echo "   ML:       http://localhost:5001"
echo "   Frontend: http://localhost:3000"
echo ""
echo "   Press Ctrl+C to stop all services"
echo ""

# Start services in background
cd backend && npm run dev &
BACKEND_PID=$!

cd ml-service && python app.py &
ML_PID=$!

sleep 2

# Trigger initial clustering
curl -s -X POST http://localhost:5001/ml/cluster > /dev/null 2>&1 && echo "✅ Initial DBSCAN clustering triggered" || true

cd frontend && npm start &
FRONTEND_PID=$!

# Trap Ctrl+C
trap "kill $BACKEND_PID $ML_PID $FRONTEND_PID 2>/dev/null; echo ''; echo '👋 SafePath stopped.'; exit 0" INT

wait
