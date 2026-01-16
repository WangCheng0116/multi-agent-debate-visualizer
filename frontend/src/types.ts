export type Direction = "a_to_b" | "b_to_a" | "bidirectional";

export interface AgentNode {
  id: string;
  label: string;
  systemPrompt: string;
  temperature: number;
  position?: { x: number; y: number };
  conclusion?: string;  // Persistent position/conclusion text displayed next to node
}

export interface AgentEdge {
  id: string;
  from: string;
  to: string;
  direction: Direction;
}

export interface DebateMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  summary?: string;
  round: number;
}

export interface MessageBubble {
  id: string;
  fromNode: string;
  toNode: string;
  summary: string;
  fullText: string; // Full agent reasoning (excluding SUMMARY_JSON)
  progress: number; // 0-1 animation progress
  expanded: boolean; // Whether bubble is expanded to show fullText
}

// Timeline event types for replay functionality
export interface TimelineEvent {
  timestamp: number;  // ms since debate start (performance.now())
  round: number;
  type: 'position' | 'bubble_start' | 'bubble_complete';
}

export interface PositionEvent extends TimelineEvent {
  type: 'position';
  agentId: string;
  position: string;
}

export interface BubbleStartEvent extends TimelineEvent {
  type: 'bubble_start';
  id: string;
  fromNode: string;
  toNode: string;
  summary: string;
  fullText: string;
}

export interface BubbleCompleteEvent extends TimelineEvent {
  type: 'bubble_complete';
  id: string;
}

export type TimelineEventUnion = PositionEvent | BubbleStartEvent | BubbleCompleteEvent;

// Complete debate recording
export interface Timeline {
  events: TimelineEventUnion[];
  startTime: number;        // performance.now() at debate start
  endTime: number | null;   // performance.now() at completion
  roundBoundaries: number[]; // timestamp of each round start (for markers)
}

// Playback state computed from timeline
export interface PlaybackState {
  mode: 'replay';
  position: number;  // 0-1 normalized slider position
  conclusions: Map<string, string>;  // agentId -> current conclusion
  activeBubbles: Array<{
    id: string;
    fromNode: string;
    toNode: string;
    summary: string;
    progress: number;  // 0-1 interpolated
  }>;
}

export interface AppState {
  agents: AgentNode[];
  edges: AgentEdge[];
  messages: DebateMessage[];
  bubbles: MessageBubble[];
  isRunning: boolean;
  rounds: number;
  apiKey: string;
  question: string;
  selectedAgentId: string | null;
  timeline: Timeline | null;      // null until debate starts
  playback: PlaybackState | null; // null in live mode
  bubbleExpansionState: Map<string, boolean>; // Tracks expansion state by bubble ID (persists across playback)
}

// WebSocket message types
export interface WSMessage {
  type: "message" | "position" | "complete" | "error";
  data?: {
    from: string;
    to: string;
    text: string;
    summary?: string;
    round: number;
  };
  from?: string;  // For position messages
  position?: string;  // For position messages
  round?: number;  // For position messages
  error?: string;
}

// Graph config sent to backend
export interface GraphConfig {
  nodes: { id: string; label: string; systemPrompt: string; temperature: number }[];
  edges: { from: string; to: string; direction: Direction }[];
  rounds: number;
  apiKey: string;
  question: string;
}
