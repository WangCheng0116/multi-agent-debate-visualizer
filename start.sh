#!/bin/bash

cd "$(dirname "$0")"

# Install dependencies if --install flag is passed
if [ "$1" = "--install" ]; then
    echo "Installing dependencies..."
    echo ""
    echo "[Backend]"
    pip install -r backend/requirements.txt
    echo ""
    echo "[Frontend]"
    cd frontend && npm install && cd ..
    echo ""
    echo "Done! Run ./start.sh to start the app."
    exit 0
fi

# Check if dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
    echo "Frontend dependencies not installed. Run: ./start.sh --install"
    exit 1
fi

echo "Starting Multi-Agent Debate Visualizer..."
echo ""

# Start backend
echo "[Backend] http://localhost:8000"
cd backend && uvicorn main:app --reload &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Start frontend
echo "[Frontend] http://localhost:5173"
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

# Handle Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT

echo ""
echo "Press Ctrl+C to stop"

wait
