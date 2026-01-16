"""
Graph to AutoGen Conversion

Converts the frontend graph configuration into AutoGen agents and runs a debate.
"""

import json
import logging
import re
from typing import AsyncGenerator, Any, Dict, List, Tuple

from autogen_core.models import AssistantMessage, LLMMessage, SystemMessage, UserMessage
from autogen_ext.models.openai import OpenAIChatCompletionClient

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = "You are a participant in a multi-agent debate. Keep your response concise."
DEFAULT_TEMPERATURE = 0.8

AGGREGATOR_SYSTEM_PROMPT = """You are the aggregator for a multi-agent debate.
Summarize all agent responses across all rounds into a concise final summary (3-5 sentences).
Focus on key points and disagreements without adding new arguments.
"""


def build_system_prompt(
    custom_prompt: str,
    outgoing_neighbors: List[str],
    labels: Dict[str, str],
    round_num: int
) -> str:
    """Build system prompt with round-aware instructions.

    Args:
        custom_prompt: User's custom system prompt (can be empty)
        outgoing_neighbors: List of neighbor node IDs
        labels: Mapping of node IDs to display labels
        round_num: Current round number

    Returns:
        Complete system prompt with standard instructions appended
    """
    # Start with user's custom prompt or default base
    if custom_prompt:
        base = custom_prompt
    else:
        base = "You are a participant in a multi-agent debate."

    # Always append standard debate instruction
    base += "\n\nKeep your response concise."

    if round_num == 1:
        # Round 1: Only position
        instructions = """

After your full response, output your position/conclusion in JSON format:

SUMMARY_JSON:
{"position": "Your brief conclusion in 3-8 words"}

Example:
SUMMARY_JSON:
{"position": "AI is beneficial for humanity"}
"""
        return base + instructions

    # Round 2+: Position + Comments
    if not outgoing_neighbors:
        return base

    neighbor_names = [labels.get(nid, nid) for nid in outgoing_neighbors]
    neighbor_list = '", "'.join(neighbor_names)
    comments_example = ', '.join([f'"{name}": "Brief comment"' for name in neighbor_names[:2]])

    instructions = f"""

After your full response, output your position and comments in JSON format:

SUMMARY_JSON:
{{"position": "Your brief conclusion in 3-8 words", "comments": {{{comments_example}}}}}

Example:
SUMMARY_JSON:
{{"position": "AI needs regulation", "comments": {{"{neighbor_names[0]}": "I agree with your risk analysis", "{neighbor_names[1] if len(neighbor_names) > 1 else neighbor_names[0]}": "However, your timeline is too pessimistic"}}}}

Your neighbors are: {neighbor_list}. Provide exactly one comment per neighbor."""

    return base + instructions


def extract_summary(text: str, max_length: int = 50) -> str:
    """Extract a short summary from the message text."""
    # Take first sentence or first N characters
    if "." in text[:max_length]:
        return text.split(".")[0] + "."
    return text[:max_length] + "..." if len(text) > max_length else text


def parse_summary_json(
    text: str,
    expected_neighbors: List[str],
    labels: Dict[str, str],
    round_num: int
) -> Tuple[str, str, Dict[str, str]]:
    """
    Parse SUMMARY_JSON with position and comments.

    Args:
        text: Full agent response text
        expected_neighbors: List of neighbor node IDs
        labels: Mapping of node IDs to display labels
        round_num: Current round number

    Returns:
        (main_text, position, {neighbor_id: comment_text})
    """
    # Find SUMMARY_JSON: marker
    match = re.search(r'(?i)\n*SUMMARY_JSON:\s*\n*', text)

    if not match:
        # No SUMMARY_JSON section - return empty
        return text, "", {nid: "" for nid in expected_neighbors}

    main_text = text[:match.start()].strip()
    json_section = text[match.end():].strip()

    # Build reverse lookup: label -> node_id (case-insensitive)
    label_to_id = {label.lower(): nid for nid, label in labels.items()}

    position = ""
    comments: Dict[str, str] = {}

    try:
        # Extract JSON object (handle potential extra text after JSON)
        json_start = json_section.find('{')
        if json_start == -1:
            return text, "", {nid: "" for nid in expected_neighbors}

        # Find matching closing brace
        brace_count = 0
        json_end = -1
        for i in range(json_start, len(json_section)):
            if json_section[i] == '{':
                brace_count += 1
            elif json_section[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    json_end = i + 1
                    break

        if json_end == -1:
            return text, "", {nid: "" for nid in expected_neighbors}

        json_str = json_section[json_start:json_end]
        data = json.loads(json_str)

        # Extract position
        position = str(data.get("position", "")).strip()

        # Extract comments (round 2+)
        if round_num > 1 and "comments" in data:
            comments_dict = data["comments"]
            for neighbor_name, comment_text in comments_dict.items():
                name_lower = neighbor_name.strip().lower()
                if name_lower in label_to_id:
                    nid = label_to_id[name_lower]
                    if nid in expected_neighbors:
                        comments[nid] = str(comment_text).strip()

    except (json.JSONDecodeError, ValueError) as e:
        # JSON parsing failed - return empty
        logger.warning(f"Failed to parse SUMMARY_JSON: {e}")
        return text, "", {nid: "" for nid in expected_neighbors}

    # Fill missing comments with empty string
    for nid in expected_neighbors:
        if nid not in comments:
            comments[nid] = ""

    return main_text, position, comments


def build_neighbor_maps(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]):
    outgoing = {node["id"]: [] for node in nodes}
    incoming = {node["id"]: [] for node in nodes}

    def add_edge(sender: str, receiver: str) -> None:
        if sender not in outgoing or receiver not in outgoing:
            return
        if receiver not in outgoing[sender]:
            outgoing[sender].append(receiver)
        if sender not in incoming[receiver]:
            incoming[receiver].append(sender)

    for edge in edges:
        direction = edge.get("direction", "bidirectional")
        from_id = edge.get("from")
        to_id = edge.get("to")
        if not from_id or not to_id:
            continue
        if direction == "a_to_b":
            add_edge(from_id, to_id)
        elif direction == "b_to_a":
            add_edge(to_id, from_id)
        elif direction == "bidirectional":
            add_edge(from_id, to_id)
            add_edge(to_id, from_id)

    return outgoing, incoming


def build_initial_prompt(question: str) -> str:
    return (
        "Let's have a thoughtful debate about the following topic:\n\n"
        f"\"{question}\"\n\n"
        "Share your perspective concisely."
    )


def build_followup_prompt(
    question: str,
    neighbor_responses: List[str],
    round_num: int,
    max_round: int,
) -> str:
    if neighbor_responses:
        neighbor_block = "\n".join(f"One agent solution: {resp}" for resp in neighbor_responses)
        return (
            "These are the solutions to the problem from other agents:\n"
            f"{neighbor_block}\n\n"
            "Using the solutions from other agents as additional information,\n"
            "can you provide your answer to the problem?\n"
            f"The original problem is {question}\n"
        )
    return (
        "There are no solutions from other agents yet.\n"
        "Can you provide your answer to the problem?\n"
        f"The original problem is {question}\n"
    )


def build_aggregator_prompt(
    question: str,
    responses_by_round: Dict[int, Dict[str, str]],
    labels: Dict[str, str],
) -> str:
    lines: List[str] = []
    for round_num in sorted(responses_by_round.keys()):
        for node_id, text in responses_by_round[round_num].items():
            label = labels.get(node_id, node_id)
            lines.append(f"Round {round_num} - {label}: {text}")
    transcript = "\n".join(lines) if lines else "No responses."
    return (
        "Debate topic:\n"
        f"{question}\n\n"
        "Agent responses by round:\n"
        f"{transcript}\n\n"
        "Provide a concise final summary."
    )


async def run_debate(config: dict) -> AsyncGenerator[dict, None]:
    """
    Convert graph configuration to AutoGen agents and run the debate.

    Args:
        config: Graph configuration with nodes, edges, rounds, and apiKey

    Yields:
        Message dictionaries with from, to, text, summary, and round
    """
    nodes = config.get("nodes", [])
    edges = config.get("edges", [])
    rounds = max(1, int(config.get("rounds", 3)))
    api_key = config.get("apiKey")
    question = (config.get("question") or "").strip()
    if not question:
        question = "The impact of artificial intelligence on society: Is AI ultimately beneficial or harmful?"

    logger.info(f"Starting debate with {len(nodes)} agents for {rounds} rounds")

    if not nodes:
        logger.error("No agents created")
        return

    model_clients: Dict[str, OpenAIChatCompletionClient] = {}
    for node in nodes:
        raw_temp = node.get("temperature", DEFAULT_TEMPERATURE)
        try:
            temperature = float(raw_temp)
        except (TypeError, ValueError):
            temperature = DEFAULT_TEMPERATURE
        model_clients[node["id"]] = OpenAIChatCompletionClient(
            model="gpt-4o-mini",
            api_key=api_key,
            temperature=temperature,
        )
    aggregator_client = OpenAIChatCompletionClient(
        model="gpt-4o-mini",
        api_key=api_key,
        temperature=DEFAULT_TEMPERATURE,
    )

    outgoing, incoming = build_neighbor_maps(nodes, edges)
    labels = {node["id"]: node["label"] for node in nodes}
    histories: Dict[str, List[LLMMessage]] = {}
    # Initialize with round 1 system prompt (will be updated each round)
    for node in nodes:
        custom_prompt = (node.get("systemPrompt") or "").strip()
        prompt = build_system_prompt(custom_prompt, outgoing.get(node["id"], []), labels, round_num=1)
        histories[node["id"]] = [SystemMessage(content=prompt)]
    responses_by_round: Dict[int, Dict[str, str]] = {}

    logger.info("Starting debate stream...")
    try:
        for round_num in range(1, rounds + 1):
            responses_by_round[round_num] = {}
            for node in nodes:
                node_id = node["id"]
                history = histories[node_id]

                # Update system prompt for current round
                custom_prompt = (node.get("systemPrompt") or "").strip()
                new_system_prompt = build_system_prompt(
                    custom_prompt,
                    outgoing.get(node_id, []),
                    labels,
                    round_num
                )
                # Replace system message (always first in history)
                history[0] = SystemMessage(content=new_system_prompt)

                # Build user prompt based on round
                if round_num == 1:
                    prompt = build_initial_prompt(question)
                else:
                    prev_round = responses_by_round.get(round_num - 1, {})
                    neighbor_ids = incoming.get(node_id, [])
                    neighbor_responses = []
                    for neighbor_id in neighbor_ids:
                        prev_text = prev_round.get(neighbor_id)
                        if prev_text:
                            neighbor_label = labels.get(neighbor_id, neighbor_id)
                            neighbor_responses.append(f"{neighbor_label}: {prev_text}")
                    prompt = build_followup_prompt(question, neighbor_responses, round_num, rounds)

                history.append(UserMessage(content=prompt, source="user"))
                model_result = await model_clients[node_id].create(history)
                content = model_result.content if isinstance(model_result.content, str) else str(model_result.content)
                history.append(AssistantMessage(content=content, source=labels.get(node_id, node_id)))

                # Parse position and comments
                recipients = outgoing.get(node_id, [])
                main_text, position, comments = parse_summary_json(content, recipients, labels, round_num)
                responses_by_round[round_num][node_id] = main_text  # Store without SUMMARY

                # Yield position update (for frontend to display next to node)
                yield {
                    "type": "position",
                    "from": node_id,
                    "position": position,
                    "round": round_num,
                }

                # Yield messages (for message log and bubbles)
                if not recipients:
                    # Agent has no outgoing neighbors
                    yield {
                        "type": "message",
                        "from": node_id,
                        "to": "none",
                        "text": main_text,
                        "summary": "",
                        "round": round_num,
                    }
                else:
                    # Send one message per recipient (always, even if comment is empty)
                    for to_id in recipients:
                        comment = comments.get(to_id, "")
                        yield {
                            "type": "message",
                            "from": node_id,
                            "to": to_id,
                            "text": main_text,
                            "summary": comment,  # Can be empty
                            "round": round_num,
                        }

        if responses_by_round:
            aggregator_prompt = build_aggregator_prompt(question, responses_by_round, labels)
            aggregator_messages = [
                SystemMessage(content=AGGREGATOR_SYSTEM_PROMPT),
                UserMessage(content=aggregator_prompt, source="user"),
            ]
            aggregator_result = await aggregator_client.create(aggregator_messages)
            aggregator_content = (
                aggregator_result.content
                if isinstance(aggregator_result.content, str)
                else str(aggregator_result.content)
            )
            yield {
                "type": "message",
                "from": "aggregator",
                "to": "all",
                "text": "",
                "summary": aggregator_content,
                "round": rounds,
            }
    except Exception as e:
        logger.error(f"Error during debate: {e}")
        raise
    finally:
        for client in model_clients.values():
            await client.close()
        await aggregator_client.close()

    logger.info("Debate completed")
