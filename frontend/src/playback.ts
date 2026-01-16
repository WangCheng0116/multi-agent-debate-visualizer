import { Timeline, PlaybackState, BubbleStartEvent, BubbleCompleteEvent } from "./types";

/**
 * Compute visualization state at a given timeline position.
 *
 * @param timeline - Complete event log
 * @param position - Normalized position (0-1)
 * @param expansionState - Map of bubble IDs to expansion states
 * @returns State to display
 */
export function computePlaybackState(
  timeline: Timeline,
  position: number,
  expansionState: Map<string, boolean> = new Map()
): PlaybackState {
  if (!timeline.endTime) {
    // Debate still running - clamp to current time
    timeline.endTime = performance.now();
  }

  const duration = timeline.endTime - timeline.startTime;
  const targetTime = timeline.startTime + position * duration;

  const conclusions = new Map<string, string>();
  const bubbleStarts = new Map<string, BubbleStartEvent>();
  const completedBubbles = new Set<string>();

  // Replay events up to target time
  for (const event of timeline.events) {
    if (event.timestamp > targetTime) break;  // Events are chronologically ordered

    switch (event.type) {
      case 'position':
        conclusions.set(event.agentId, event.position);
        break;

      case 'bubble_start':
        bubbleStarts.set(event.id, event);
        break;

      case 'bubble_complete':
        completedBubbles.add(event.id);
        break;
    }
  }

  // Compute active bubbles with interpolated progress
  const activeBubbles = Array.from(bubbleStarts.values())
    .filter(start => !completedBubbles.has(start.id))
    .map(start => {
      // Find completion event (or use end of timeline)
      const completeEvent = timeline.events.find(
        e => e.type === 'bubble_complete' && (e as BubbleCompleteEvent).id === start.id
      ) as BubbleCompleteEvent | undefined;

      const endTime = completeEvent?.timestamp ?? timeline.endTime!;
      const duration = endTime - start.timestamp;
      const elapsed = targetTime - start.timestamp;
      const progress = Math.max(0, Math.min(1, elapsed / duration));

      return {
        id: start.id,
        fromNode: start.fromNode,
        toNode: start.toNode,
        summary: start.summary,
        fullText: start.fullText,
        progress,
        expanded: expansionState.get(start.id) ?? false  // Apply stored expansion state
      };
    })
    .filter(b => b.progress < 1);  // Don't show completed bubbles

  return {
    mode: 'replay',
    position,
    conclusions,
    activeBubbles
  };
}

/**
 * Convert normalized position to round number and intra-round progress.
 * Used for slider UI to show which round we're in.
 *
 * @param timeline - Complete event log
 * @param position - Normalized position (0-1)
 * @returns Current round and progress within that round
 */
export function positionToRound(
  timeline: Timeline,
  position: number
): { round: number; progress: number } {
  const duration = (timeline.endTime ?? performance.now()) - timeline.startTime;
  const targetTime = timeline.startTime + position * duration;

  // Find which round we're in
  for (let i = timeline.roundBoundaries.length - 1; i >= 0; i--) {
    if (targetTime >= timeline.roundBoundaries[i]) {
      const roundStart = timeline.roundBoundaries[i];
      const roundEnd = i < timeline.roundBoundaries.length - 1
        ? timeline.roundBoundaries[i + 1]
        : timeline.endTime ?? performance.now();

      const roundDuration = roundEnd - roundStart;
      const roundElapsed = targetTime - roundStart;
      const progress = roundDuration > 0 ? roundElapsed / roundDuration : 0;

      return { round: i + 1, progress: Math.max(0, Math.min(1, progress)) };
    }
  }

  return { round: 1, progress: 0 };
}
