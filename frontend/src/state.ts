import { AgentEdge, AgentNode, AppState, DebateMessage, Direction, MessageBubble, TimelineEventUnion, PlaybackState } from "./types";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a participant in a multi-agent debate. Keep your response concise.";
export const DEFAULT_TEMPERATURE = 0.8;

type Listener = () => void;

export interface Store {
  getState: () => AppState;
  subscribe: (listener: Listener) => () => void;

  // Agent operations
  addAgent: (label: string) => string;
  deleteAgent: (id: string) => void;
  setPosition: (id: string, x: number, y: number) => void;
  setSelectedAgent: (id: string | null) => void;
  updateAgent: (
    id: string,
    updates: Partial<Pick<AgentNode, "label" | "systemPrompt" | "temperature">>
  ) => void;
  setConclusion: (id: string, conclusion: string) => void;

  // Edge operations
  upsertEdge: (from: string, to: string, direction: Direction) => boolean;
  deleteEdge: (edgeId: string) => void;
  toggleEdgeDirection: (edgeId: string) => void;

  // Message operations
  addMessage: (message: Omit<DebateMessage, "id">) => void;
  clearMessages: () => void;

  // Bubble operations
  addBubble: (bubble: Omit<MessageBubble, "id"> & { id?: string }) => string;
  updateBubble: (id: string, progress: number) => void;
  removeBubble: (id: string) => void;
  clearBubbles: () => void;
  toggleBubbleExpansion: (id: string) => void;

  // Run state
  setRunning: (running: boolean) => void;
  setRounds: (rounds: number) => void;
  setApiKey: (key: string) => void;
  setQuestion: (question: string) => void;

  // Timeline operations
  initializeTimeline: (startTime: number) => void;
  addTimelineEvent: (event: TimelineEventUnion) => void;
  addRoundBoundary: (timestamp: number) => void;
  finalizeTimeline: (endTime: number) => void;

  // Playback operations
  setPlaybackState: (playback: PlaybackState) => void;
  clearPlaybackState: () => void;
}

export function createInitialState(): AppState {
  return {
    agents: [],
    edges: [],
    messages: [],
    bubbles: [],
    isRunning: false,
    rounds: 3,
    apiKey: "",
    question: "The impact of artificial intelligence on society: Is AI ultimately beneficial or harmful?",
    selectedAgentId: null,
    timeline: null,
    playback: null,
    bubbleExpansionState: new Map()
  };
}

export function createStore(initial: AppState): Store {
  let state = initial;
  const listeners: Listener[] = [];

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const setState = (next: AppState) => {
    state = next;
    notify();
  };

  const subscribe = (listener: Listener) => {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  };

  const addAgent = (label: string) => {
    const id = crypto.randomUUID();
    const newAgent: AgentNode = {
      id,
      label,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      temperature: DEFAULT_TEMPERATURE
    };
    setState({ ...state, agents: [...state.agents, newAgent] });
    return id;
  };

  const deleteAgent = (id: string) => {
    const nextAgents = state.agents.filter((agent) => agent.id !== id);
    const nextEdges = state.edges.filter((edge) => edge.from !== id && edge.to !== id);
    const selectedAgentId = state.selectedAgentId === id ? null : state.selectedAgentId;
    setState({ ...state, agents: nextAgents, edges: nextEdges, selectedAgentId });
  };

  const setPosition = (id: string, x: number, y: number) => {
    setState({
      ...state,
      agents: state.agents.map((agent) =>
        agent.id === id ? { ...agent, position: { x, y } } : agent
      )
    });
  };

  const setSelectedAgent = (id: string | null) => {
    const exists = id ? state.agents.some((agent) => agent.id === id) : false;
    setState({ ...state, selectedAgentId: exists ? id : null });
  };

  const updateAgent = (
    id: string,
    updates: Partial<Pick<AgentNode, "label" | "systemPrompt" | "temperature">>
  ) => {
    setState({
      ...state,
      agents: state.agents.map((agent) => (agent.id === id ? { ...agent, ...updates } : agent))
    });
  };

  const setConclusion = (id: string, conclusion: string) => {
    setState({
      ...state,
      agents: state.agents.map((agent) => (agent.id === id ? { ...agent, conclusion } : agent))
    });
  };

  const upsertEdge = (from: string, to: string, direction: Direction) => {
    if (from === to) return false;

    const id1 = `${from}->${to}`;
    const id2 = `${to}->${from}`;
    const existingEdge = state.edges.find((edge) => edge.id === id1);

    if (existingEdge) {
      return false;
    }

    const reverseEdge = state.edges.find((edge) => edge.id === id2);
    if (reverseEdge) {
      if (reverseEdge.direction === "bidirectional") {
        return false;
      }
      const nextEdges = state.edges.map((edge) =>
        edge.id === id2 ? { ...edge, direction: "bidirectional" as Direction } : edge
      );
      setState({ ...state, edges: nextEdges });
      return true;
    }

    const updated: AgentEdge = { id: id1, from, to, direction };
    setState({ ...state, edges: [...state.edges, updated] });
    return true;
  };

  const deleteEdge = (edgeId: string) => {
    const nextEdges = state.edges.filter((edge) => edge.id !== edgeId);
    setState({ ...state, edges: nextEdges });
  };

  const toggleEdgeDirection = (edgeId: string) => {
    const nextEdges = state.edges.map((edge) => {
      if (edge.id !== edgeId) return edge;
      const directionCycle: Direction[] = ["a_to_b", "b_to_a", "bidirectional"];
      const currentIndex = directionCycle.indexOf(edge.direction);
      const nextDirection = directionCycle[(currentIndex + 1) % directionCycle.length];
      return { ...edge, direction: nextDirection };
    });
    setState({ ...state, edges: nextEdges });
  };

  const addMessage = (message: Omit<DebateMessage, "id">) => {
    const newMessage = { ...message, id: crypto.randomUUID() };
    setState({ ...state, messages: [...state.messages, newMessage] });
  };

  const clearMessages = () => {
    setState({ ...state, messages: [], bubbleExpansionState: new Map() });
  };

  const addBubble = (bubble: Omit<MessageBubble, "id"> & { id?: string }) => {
    const id = bubble.id ?? crypto.randomUUID();
    const newBubble = { ...bubble, id };
    setState({ ...state, bubbles: [...state.bubbles, newBubble] });
    return id;
  };

  const updateBubble = (id: string, progress: number) => {
    setState({
      ...state,
      bubbles: state.bubbles.map((b) => (b.id === id ? { ...b, progress } : b))
    });
  };

  const removeBubble = (id: string) => {
    setState({ ...state, bubbles: state.bubbles.filter((b) => b.id !== id) });
  };

  const clearBubbles = () => {
    setState({ ...state, bubbles: [] });
  };

  const toggleBubbleExpansion = (id: string) => {
    const newExpansionState = new Map(state.bubbleExpansionState);
    const currentState = newExpansionState.get(id) ?? false;
    newExpansionState.set(id, !currentState);

    // Also update live bubbles if in live mode
    const updatedBubbles = state.playback
      ? state.bubbles
      : state.bubbles.map((b) => (b.id === id ? { ...b, expanded: !b.expanded } : b));

    setState({
      ...state,
      bubbles: updatedBubbles,
      bubbleExpansionState: newExpansionState
    });
  };

  const setRunning = (running: boolean) => {
    setState({ ...state, isRunning: running });
  };

  const setRounds = (rounds: number) => {
    setState({ ...state, rounds });
  };

  const setApiKey = (key: string) => {
    setState({ ...state, apiKey: key });
  };

  const setQuestion = (question: string) => {
    setState({ ...state, question });
  };

  // Timeline operations
  const initializeTimeline = (startTime: number) => {
    setState({
      ...state,
      timeline: {
        events: [],
        startTime,
        endTime: null,
        roundBoundaries: [startTime]
      },
      playback: null
    });
  };

  const addTimelineEvent = (event: TimelineEventUnion) => {
    if (!state.timeline) return;

    setState({
      ...state,
      timeline: {
        ...state.timeline,
        events: [...state.timeline.events, event]
      }
    });
  };

  const addRoundBoundary = (timestamp: number) => {
    if (!state.timeline) return;

    setState({
      ...state,
      timeline: {
        ...state.timeline,
        roundBoundaries: [...state.timeline.roundBoundaries, timestamp]
      }
    });
  };

  const finalizeTimeline = (endTime: number) => {
    if (!state.timeline) return;

    setState({
      ...state,
      timeline: {
        ...state.timeline,
        endTime
      }
    });
  };

  // Playback operations
  const setPlaybackState = (playback: PlaybackState) => {
    setState({ ...state, playback });
  };

  const clearPlaybackState = () => {
    setState({ ...state, playback: null });
  };

  return {
    getState: () => state,
    subscribe,
    addAgent,
    deleteAgent,
    setPosition,
    setSelectedAgent,
    updateAgent,
    setConclusion,
    upsertEdge,
    deleteEdge,
    toggleEdgeDirection,
    addMessage,
    clearMessages,
    addBubble,
    updateBubble,
    removeBubble,
    clearBubbles,
    toggleBubbleExpansion,
    setRunning,
    setRounds,
    setApiKey,
    setQuestion,
    initializeTimeline,
    addTimelineEvent,
    addRoundBoundary,
    finalizeTimeline,
    setPlaybackState,
    clearPlaybackState
  };
}
