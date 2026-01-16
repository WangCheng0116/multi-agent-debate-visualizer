# Multi-Agent Debate Visualizer

🤯 Tired of scrolling through endless log files from your Multi-Agent System?

🔍 Wondering how each agent's position evolves throughout the debate?

💬 Curious what messages are actually being exchanged between agents?

---

**Multi-Agent Debate Visualizer** makes it all visible. Watch agent networks, opinion shifts, and message flows in real-time — no more digging through logs.

https://github.com/user-attachments/assets/3f96f016-bda6-472f-982d-4efeb9a7f60d

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
