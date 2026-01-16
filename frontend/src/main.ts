import "./styles.css";
import { bindInteractions, renderAgentList, renderGraph, renderMessages } from "./render";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE, createInitialState, createStore } from "./state";
import { GraphConfig } from "./types";
import { computePlaybackState, positionToRound } from "./playback";

const WS_URL = "ws://localhost:8000/ws";

document.addEventListener("DOMContentLoaded", () => {
  const store = createStore(createInitialState());
  let ws: WebSocket | null = null;
  let lastSelectedAgentId: string | null = null;
  let latestRound = 0;

  // DOM elements
  const graph = document.getElementById("graph-canvas") as unknown as SVGSVGElement;
  const messageLog = document.getElementById("message-log") as HTMLDivElement;
  const agentList = document.getElementById("agent-list") as HTMLUListElement;
  const messageCount = document.getElementById("message-count") as HTMLSpanElement;
  const sidebar = document.querySelector(".sidebar") as HTMLDivElement;
  const messagesPanel = document.querySelector(".messages-panel") as HTMLDivElement;
  const sidebarSplitter = document.getElementById("sidebar-splitter") as HTMLDivElement;
  const messagesSplitter = document.getElementById("messages-splitter") as HTMLDivElement;
  const toastContainer = document.getElementById("toast-container") as HTMLDivElement;
  const detailsPanel = document.querySelector(".details-panel") as HTMLDivElement;
  const agentDetailsForm = document.getElementById("agent-details-form") as HTMLDivElement;
  const agentDetailsEmpty = document.getElementById("agent-details-empty") as HTMLDivElement;
  const agentNameInput = document.getElementById("agent-name-input") as HTMLInputElement;
  const agentPromptInput = document.getElementById("agent-prompt-input") as HTMLTextAreaElement;
  const agentTemperatureInput = document.getElementById("agent-temperature-input") as HTMLInputElement;
  const agentTemperatureValue = document.getElementById("agent-temperature-value") as HTMLSpanElement;

  const controls = {
    roundsSlider: document.getElementById("rounds-slider") as HTMLInputElement,
    roundsValue: document.getElementById("rounds-value") as HTMLSpanElement,
    apiKey: document.getElementById("api-key") as HTMLInputElement,
    question: document.getElementById("question-input") as HTMLTextAreaElement,
    runButton: document.getElementById("run-debate-btn") as HTMLButtonElement,
    themeToggle: document.getElementById("theme-toggle") as HTMLButtonElement,
    addAgentBtn: document.getElementById("add-agent-btn") as HTMLButtonElement,
    newAgentName: document.getElementById("new-agent-name") as HTMLInputElement
  };

  // Timeline slider elements
  const timelineSliderContainer = document.getElementById("timeline-slider-container") as HTMLDivElement;
  const timelineSlider = document.getElementById("timeline-slider") as HTMLInputElement;
  const timelinePosition = document.getElementById("timeline-position") as HTMLSpanElement;
  const timelineMarkers = document.getElementById("timeline-markers") as HTMLDivElement;

  // Re-render function
  const rerender = () => {
    const state = store.getState();
    renderGraph(graph, state);
    renderMessages(messageLog, state.messages, state.agents);
    renderAgentList(agentList, state, {
      selectedId: state.selectedAgentId,
      onSelect: (id) => store.setSelectedAgent(id),
      onDelete: (id) => store.deleteAgent(id)
    });

    // Update message count
    messageCount.textContent = `${state.messages.length} messages`;

    // Update run button state
    if (state.isRunning) {
      controls.runButton.textContent = "Stop";
      controls.runButton.classList.add("running");
    } else {
      controls.runButton.textContent = "Run Debate";
      controls.runButton.classList.remove("running");
    }

    const selectedAgent = state.agents.find((agent) => agent.id === state.selectedAgentId) || null;
    const showDetails = Boolean(selectedAgent);
    agentDetailsForm.classList.toggle("is-hidden", !showDetails);
    agentDetailsEmpty.classList.toggle("is-hidden", showDetails);
    if (selectedAgent) {
      const selectionChanged = lastSelectedAgentId !== selectedAgent.id;
      if (
        selectionChanged ||
        (document.activeElement !== agentNameInput && agentNameInput.value !== selectedAgent.label)
      ) {
        agentNameInput.value = selectedAgent.label;
      }
      const promptValue = selectedAgent.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      if (
        selectionChanged ||
        (document.activeElement !== agentPromptInput && agentPromptInput.value !== promptValue)
      ) {
        agentPromptInput.value = promptValue;
      }
      const temperatureValue = Number.isFinite(selectedAgent.temperature)
        ? selectedAgent.temperature
        : DEFAULT_TEMPERATURE;
      if (
        selectionChanged ||
        (document.activeElement !== agentTemperatureInput &&
          Number(agentTemperatureInput.value) !== temperatureValue)
      ) {
        agentTemperatureInput.value = temperatureValue.toString();
        agentTemperatureValue.textContent = formatTemperature(temperatureValue);
      }
      detailsPanel.dataset.selectedAgent = selectedAgent.id;
    } else {
      detailsPanel.dataset.selectedAgent = "";
      agentNameInput.value = "";
      agentPromptInput.value = "";
      agentTemperatureInput.value = DEFAULT_TEMPERATURE.toString();
      agentTemperatureValue.textContent = formatTemperature(DEFAULT_TEMPERATURE);
    }
    lastSelectedAgentId = state.selectedAgentId;
  };

  // Subscribe to store changes
  store.subscribe(rerender);

  const showWarning = (message: string) => {
    const toast = document.createElement("div");
    toast.className = "toast toast-error";
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 200);
    }, 2200);
  };

  // Bind graph interactions
  bindInteractions(graph, store, showWarning);

  // Theme toggle
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.add(prefersDark ? "dark" : "light");

  controls.themeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.remove(isDark ? "dark" : "light");
    document.documentElement.classList.add(isDark ? "light" : "dark");
  });

  // Rounds slider
  controls.roundsSlider.addEventListener("input", () => {
    const rounds = Number(controls.roundsSlider.value);
    controls.roundsValue.textContent = String(rounds);
    store.setRounds(rounds);
  });

  // API key
  controls.apiKey.addEventListener("change", () => {
    store.setApiKey(controls.apiKey.value);
  });

  // Question input
  controls.question.value = store.getState().question;
  controls.question.addEventListener("input", () => {
    store.setQuestion(controls.question.value.trim());
  });

  // Add agent
  const addAgent = () => {
    const name = controls.newAgentName.value.trim();
    const finalName = name || getNextAgentName(store.getState().agents.map((a) => a.label));
    const newId = store.addAgent(finalName);
    store.setSelectedAgent(newId);
    controls.newAgentName.value = "";
  };

  controls.addAgentBtn.addEventListener("click", addAgent);
  controls.newAgentName.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addAgent();
    }
  });

  // Run debate
  const runDebate = () => {
    const state = store.getState();

    if (state.isRunning) {
      // Stop the debate
      ws?.close();
      ws = null;
      store.setRunning(false);
      return;
    }

    // Validate
    if (state.agents.length < 2) {
      alert("Please add at least 2 agents to start a debate.");
      return;
    }

    if (!state.apiKey) {
      alert("Please enter your OpenAI API key.");
      return;
    }

    if (!state.question) {
      alert("Please enter a debate question.");
      return;
    }

    // Clear previous messages
    store.clearMessages();
    store.clearBubbles();
    latestRound = 0;

    // Hide timeline slider (will show when debate completes)
    timelineSliderContainer.classList.add("is-hidden");
    store.clearPlaybackState();

    // Initialize timeline
    store.initializeTimeline(performance.now());

    // Build graph config
    const config: GraphConfig = {
      nodes: state.agents.map((a) => ({
        id: a.id,
        label: a.label,
        systemPrompt: a.systemPrompt,
        temperature: a.temperature
      })),
      edges: state.edges.map((e) => ({ from: e.from, to: e.to, direction: e.direction })),
      rounds: state.rounds,
      apiKey: state.apiKey,
      question: state.question
    };

    // Connect to WebSocket
    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        store.setRunning(true);
        ws?.send(JSON.stringify(config));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const now = performance.now();

        if (msg.type === "position") {
          if (typeof msg.round === "number" && msg.round > latestRound) {
            latestRound = msg.round;
            store.addRoundBoundary(now);
            store.clearBubbles();
          }

          // Record timeline event
          store.addTimelineEvent({
            timestamp: now,
            round: msg.round,
            type: 'position',
            agentId: msg.from,
            position: msg.position
          });

          // Update agent's displayed conclusion (only if not in playback mode)
          if (!store.getState().playback) {
            store.setConclusion(msg.from, msg.position);
          }

        } else if (msg.type === "message") {
          if (typeof msg.data?.round === "number" && msg.data.round > latestRound) {
            latestRound = msg.data.round;
            store.addRoundBoundary(now);
            store.clearBubbles();
          }
          store.addMessage({
            from: msg.data.from,
            to: msg.data.to,
            text: msg.data.text,
            summary: msg.data.summary,
            round: msg.data.round
          });

          if (msg.data.from !== "aggregator" && msg.data.summary && msg.data.summary.trim()) {
            // Generate bubble ID
            const bubbleId = crypto.randomUUID();

            // Record timeline event
            store.addTimelineEvent({
              timestamp: now,
              round: msg.data.round,
              type: 'bubble_start',
              id: bubbleId,
              fromNode: msg.data.from,
              toNode: msg.data.to,
              summary: msg.data.summary,
              fullText: msg.data.text
            });

            // Add animated bubble only if not in playback mode
            if (!store.getState().playback) {
              store.addBubble({
                id: bubbleId,
                fromNode: msg.data.from,
                toNode: msg.data.to,
                summary: msg.data.summary,
                fullText: msg.data.text,
                progress: 0,
                expanded: false
              });

              // Animate bubble with completion callback
              animateBubble(bubbleId, store, () => {
                // Record bubble completion
                store.addTimelineEvent({
                  timestamp: performance.now(),
                  round: msg.data.round,
                  type: 'bubble_complete',
                  id: bubbleId
                });
              });
            }
          }
        } else if (msg.type === "complete") {
          store.finalizeTimeline(performance.now());
          store.setRunning(false);

          // Show timeline slider
          timelineSliderContainer.classList.remove("is-hidden");

          // Render timeline markers
          const timeline = store.getState().timeline;
          if (timeline) {
            renderTimelineMarkers(timeline);
          }

          ws?.close();
          ws = null;
        } else if (msg.type === "error") {
          alert(`Error: ${msg.error}`);
          store.setRunning(false);
          ws?.close();
          ws = null;
        }
      };

      ws.onerror = () => {
        alert("Failed to connect to the backend. Make sure the server is running.");
        store.setRunning(false);
      };

      ws.onclose = () => {
        store.setRunning(false);
      };
    } catch (err) {
      alert("Failed to connect to the backend.");
      store.setRunning(false);
    }
  };

  controls.runButton.addEventListener("click", runDebate);

  // Timeline slider event handlers
  timelineSlider.addEventListener("input", () => {
    const state = store.getState();
    if (!state.timeline) return;

    const normalizedPosition = Number(timelineSlider.value) / 1000;
    const playbackState = computePlaybackState(
      state.timeline,
      normalizedPosition,
      state.bubbleExpansionState
    );

    // Update store with playback state
    store.setPlaybackState(playbackState);

    // Update label
    const { round, progress } = positionToRound(state.timeline, normalizedPosition);
    timelinePosition.textContent = `Round ${round} (${Math.round(progress * 100)}%)`;
  });

  // Render timeline markers
  function renderTimelineMarkers(timeline: NonNullable<ReturnType<typeof store.getState>["timeline"]>) {
    if (!timeline) return;

    timelineMarkers.innerHTML = "";

    const duration = (timeline.endTime ?? performance.now()) - timeline.startTime;

    timeline.roundBoundaries.forEach((timestamp: number, index: number) => {
      const position = ((timestamp - timeline.startTime) / duration) * 100;

      const marker = document.createElement("div");
      marker.className = "timeline-marker";
      marker.style.left = `${position}%`;

      const label = document.createElement("span");
      label.className = "timeline-marker-label";
      label.textContent = `R${index + 1}`;
      marker.appendChild(label);

      timelineMarkers.appendChild(marker);
    });
  }

  const updateSelectedAgent = (updates: {
    label?: string;
    systemPrompt?: string;
    temperature?: number;
  }) => {
    const state = store.getState();
    const selectedId = state.selectedAgentId;
    if (!selectedId) return;
    store.updateAgent(selectedId, updates);
  };

  agentNameInput.addEventListener("input", () => {
    updateSelectedAgent({ label: agentNameInput.value });
  });

  agentPromptInput.addEventListener("input", () => {
    const nextPrompt = agentPromptInput.value || DEFAULT_SYSTEM_PROMPT;
    updateSelectedAgent({ systemPrompt: nextPrompt });
  });

  agentTemperatureInput.addEventListener("input", () => {
    const nextTemp = Number(agentTemperatureInput.value);
    agentTemperatureValue.textContent = formatTemperature(nextTemp);
    updateSelectedAgent({ temperature: nextTemp });
  });

  // Splitter interactions
  bindSplitters(sidebar, messagesPanel, sidebarSplitter, messagesSplitter);

  // Initial render
  rerender();
});

// Animate a bubble along an edge
function animateBubble(
  bubbleId: string,
  store: ReturnType<typeof createStore>,
  onComplete?: () => void
) {
  const duration = 2400; // ms
  const startTime = performance.now();

  const animate = (currentTime: number) => {
    const state = store.getState();

    // Stop animation if in replay mode
    if (state.playback) {
      return;
    }

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const bubble = state.bubbles.find((b) => b.id === bubbleId);

    if (bubble) {
      store.updateBubble(bubbleId, progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Remove bubble after animation
        setTimeout(() => {
          store.removeBubble(bubbleId);
          onComplete?.();
        }, 500);
      }
    }
  };

  requestAnimationFrame(animate);
}

function getNextAgentName(existing: string[]) {
  const used = new Set(existing.map((label) => label.toUpperCase()));
  let index = 0;

  while (index < 1000) {
    let n = index;
    let name = "";
    do {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);

    if (!used.has(name)) {
      return name;
    }
    index += 1;
  }

  return `Agent${existing.length + 1}`;
}

function formatTemperature(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function bindSplitters(
  sidebar: HTMLDivElement,
  messagesPanel: HTMLDivElement,
  sidebarSplitter: HTMLDivElement,
  messagesSplitter: HTMLDivElement
) {
  const minSidebar = 220;
  const maxSidebar = 420;
  const minMessages = 160;
  const minCanvas = 220;

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  sidebarSplitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = clamp(startWidth + delta, minSidebar, maxSidebar);
      sidebar.style.width = `${nextWidth}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  messagesSplitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = messagesPanel.getBoundingClientRect().height;
    const headerHeight = document.querySelector(".app-header")?.getBoundingClientRect().height ?? 0;
    const available = window.innerHeight - headerHeight - messagesSplitter.offsetHeight;
    const maxMessages = Math.max(minMessages, available - minCanvas);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextHeight = clamp(startHeight - delta, minMessages, maxMessages);
      messagesPanel.style.height = `${nextHeight}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}
