# Multi-Agent Debate Visualizer

A real-time visualization tool for multi-agent debates powered by AutoGen. Create agent networks, define communication topology, and watch AI agents debate topics with animated message flows.

## Features

- **Visual Graph Editor** - Drag-and-drop agent nodes, draw directed edges
- **Real-time Streaming** - Watch debates unfold with animated message bubbles
- **Position Tracking** - See each agent's evolving stance displayed below their node
- **Timeline Replay** - Scrub through completed debates to review the discussion
- **Customizable Agents** - Set custom system prompts and temperature per agent

## Quick Start

```bash
./start.sh
```

Then open http://localhost:5173 and enter your OpenAI API key.

> First time? Run `./start.sh --install` to install dependencies.

## Usage

1. **Add Agents** - Create debate participants in the sidebar
2. **Connect Edges** - Drag from node dots to establish communication paths
3. **Set Direction** - Click edges to cycle through: A→B, B→A, bidirectional
4. **Configure** - Select agents to customize their prompts and temperature
5. **Run Debate** - Enter a question and click "Run Debate"
