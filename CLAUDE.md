# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-Agent Debate Visualizer - a full-stack application for visualizing AutoGen multi-agent debates with **Position + Comments** architecture. Users create agent graphs in the frontend, which are converted to actual AutoGen agents that debate via the Python backend.

**Key Features:**
- **Position/Conclusion**: Each agent outputs a brief position (3-8 words) displayed persistently below their node
- **Comments**: Agents provide directed comments to each neighbor, displayed as animated bubbles traveling along edges
- **Round-Aware Prompts**: Round 1 asks for position only; Round 2+ asks for position + comments
- **Real-time Streaming**: Messages and positions stream back via WebSocket

## Commands

### Frontend (TypeScript/Vite)
```bash
cd frontend
npm install           # Install dependencies
npm run dev           # Start dev server (http://localhost:5173)
npm run typecheck     # TypeScript type checking
npm run build         # Production build
```

### Backend (Python/FastAPI)
```bash
cd backend
pip install -r requirements.txt    # Install dependencies
uvicorn main:app --reload          # Start server (http://localhost:8000)
```

## Architecture

### Frontend (`frontend/`)
- **Reactive Store Pattern**: `state.ts` holds all app state with subscriber notifications on change
- **SVG Graph Rendering**: `render.ts` draws nodes/edges directly to SVG, no framework
  - Nodes display label + conclusion text below (if present)
  - Bubbles animate along edges with comment text
- **WebSocket Client**: `main.ts` connects to backend, receives streamed messages
  - Handles `position` messages to update node conclusions
  - Handles `message` messages to display in log and create bubbles
- **Types**: `types.ts` defines `AgentNode` (with `conclusion?` field), `AgentEdge`, `DebateMessage`, `MessageBubble`, `AppState`

Key data flow: User actions → Store mutations → Subscribers notified → Re-render graph/messages

### Backend (`backend/`)
- **WebSocket Server**: `main.py` accepts graph configs, runs debates, streams messages
- **Graph-to-AutoGen Conversion**: `graph_converter.py` creates AutoGen agents per node
  - `build_system_prompt()`: Generates round-aware prompts (position-only for R1, position+comments for R2+)
  - `parse_summary_json()`: Extracts position and per-neighbor comments from JSON output
  - `run_debate()`: Updates system prompt each round, yields position and message events
- Uses `autogen-agentchat` with OpenAI models (default: gpt-4o-mini)

### Agent Output Format

**Round 1** (Position only):
```json
SUMMARY_JSON:
{"position": "AI is beneficial for humanity"}
```

**Round 2+** (Position + Comments):
```json
SUMMARY_JSON:
{
  "position": "AI needs careful regulation",
  "comments": {
    "AgentB": "I agree with your economic analysis",
    "AgentC": "Your safety concerns need more data"
  }
}
```

### Communication Protocol

**Frontend → Backend:**
```json
{
  "nodes": [{"id": "...", "label": "...", "systemPrompt": "..."}],
  "edges": [{"from": "...", "to": "...", "direction": "bidirectional"}],
  "rounds": 3,
  "apiKey": "sk-...",
  "question": "Is AI beneficial?"
}
```

**Backend → Frontend** (streamed via WebSocket):

1. **Position Update** (updates conclusion text below node):
```json
{
  "type": "position",
  "from": "agent_id",
  "position": "AI is beneficial",
  "round": 1
}
```

2. **Message** (adds to log, creates bubble if summary non-empty):
```json
{
  "type": "message",
  "from": "agent_id",
  "to": "target_id",
  "text": "Full response text...",
  "summary": "I agree with your point",
  "round": 2
}
```

3. **Completion**:
```json
{"type": "complete"}
```

4. **Error**:
```json
{"type": "error", "error": "Error message"}
```

## Data Flow

### Round 1
1. Agent receives prompt asking for position only
2. Agent outputs: `SUMMARY_JSON: {"position": "..."}`
3. Backend parses position, yields `{type: "position", ...}`
4. Frontend updates `agent.conclusion` → text appears below node
5. Backend yields `{type: "message", summary: ""}` for message log
6. **No bubbles** (summary is empty in round 1)

### Round 2+
1. Agent receives prompt asking for position + comments for each neighbor
2. Agent outputs: `SUMMARY_JSON: {"position": "...", "comments": {"B": "...", "C": "..."}}`
3. Backend parses and yields:
   - `{type: "position", position: "..."}` → updates conclusion text
   - `{type: "message", to: "B", summary: "..."}` → creates bubble A→B
   - `{type: "message", to: "C", summary: "..."}` → creates bubble A→C
4. Frontend creates bubbles only if summary is non-empty
5. Bubbles animate along edges (1.5s duration), then disappear

## Key Files

| File | Purpose |
|------|---------|
| `backend/graph_converter.py` | Core debate logic: round-aware prompts, JSON parsing, message streaming |
| `frontend/src/types.ts` | Type definitions including `AgentNode.conclusion` |
| `frontend/src/state.ts` | Store with `setConclusion()` method |
| `frontend/src/render.ts` | SVG rendering: nodes with conclusion text, animated bubbles |
| `frontend/src/main.ts` | WebSocket handling for `position` and `message` types |
| `frontend/src/styles.css` | Styling including `.node-conclusion` |

## Edge Direction Semantics
- `a_to_b`: A sends to B only
- `b_to_a`: B sends to A only
- `bidirectional`: Both directions

Click edge to cycle direction, double-click to delete.

## Important Implementation Details

1. **System Prompts are Round-Aware**: Backend updates the system message at the start of each round to request appropriate JSON format
2. **Positions Update Every Round**: Agent conclusions can change each round
3. **Comments Only in Round 2+**: First round has no comments (agents haven't seen others' positions yet)
4. **Bubbles for Non-Empty Comments**: Frontend only creates bubbles when `summary` field is non-empty and trimmed
5. **Message Log Shows All**: Message log displays all messages with full text, even when summary/comment is empty
