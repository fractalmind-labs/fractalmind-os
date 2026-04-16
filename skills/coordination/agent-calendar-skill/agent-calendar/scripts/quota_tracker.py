#!/usr/bin/env python3
"""
Quota tracking and estimation module.

Tracks agent API usage patterns and estimates remaining quota.
"""

import json
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, List
from dataclasses import dataclass, asdict
from collections import defaultdict


@dataclass
class QuotaEvent:
    """Single quota usage event."""
    timestamp: str
    event_type: str  # '429', 'request', 'response'
    tokens_used: Optional[int] = None
    reset_time: Optional[str] = None
    error_message: Optional[str] = None


class QuotaTracker:
    """
    Track and estimate agent quota usage.

    Since most APIs don't provide remaining quota queries,
    we estimate based on historical patterns and 429 events.
    """

    def __init__(self, state_dir: Optional[Path] = None):
        """Initialize quota tracker."""
        if state_dir is None:
            # Default: ~/.agent/state/agent-calendar/
            home = Path.home()
            state_dir = home / '.agent' / 'state' / 'agent-calendar' / 'quota'

        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def get_agent_history(self, agent_id: str, days: int = 7) -> List[QuotaEvent]:
        """
        Get quota event history for an agent.

        Args:
            agent_id: Agent employee ID (e.g., 'EMP_0007')
            days: Number of days of history to retrieve

        Returns:
            List of quota events
        """
        history_file = self.state_dir / f'{agent_id}_quota.json'

        if not history_file.exists():
            return []

        try:
            with open(history_file, 'r') as f:
                data = json.load(f)

            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            events = []

            for event_data in data.get('events', []):
                event_time = datetime.fromisoformat(event_data['timestamp'])
                if event_time > cutoff:
                    events.append(QuotaEvent(**event_data))

            return events
        except (json.JSONDecodeError, KeyError, ValueError):
            return []

    def record_429_event(self, agent_id: str, reset_time: datetime, error_message: str):
        """
        Record a 429 quota exhausted event.

        Args:
            agent_id: Agent employee ID
            reset_time: When quota will reset
            error_message: Full error message
        """
        event = QuotaEvent(
            timestamp=datetime.now(timezone.utc).isoformat(),
            event_type='429',
            reset_time=reset_time.isoformat(),
            error_message=error_message
        )

        self._append_event(agent_id, event)

    def estimate_quota_status(self, agent_id: str, provider: str, model: str) -> Dict:
        """
        Estimate current quota status for an agent.

        Args:
            agent_id: Agent employee ID
            provider: API provider name (e.g., 'anthropic', 'openai')
            model: Model name (e.g., 'claude-sonnet-4', 'gpt-4')

        Returns:
            Dict with estimated quota info:
            {
                'agent_id': 'EMP_0007',
                'provider': 'anthropic',
                'model': 'claude-sonnet-4',
                'status': 'ok' | 'warning' | 'exhausted',
                'estimated_remaining': 50000,  # tokens
                'estimated_limit': 100000,  # tokens
                'usage_percentage': 50,  # %
                'confidence': 'high' | 'medium' | 'low',
                'next_reset': datetime,
                'reason': 'Based on 3 historical 429 events'
            }
        """
        events = self.get_agent_history(agent_id, days=30)

        # Get known limits for provider/model
        limits = self._get_known_limits(provider, model)

        # Find most recent 429 event
        last_429 = None
        for event in reversed(events):
            if event.event_type == '429':
                last_429 = event
                break

        if last_429:
            # Agent hit quota recently
            reset_time = datetime.fromisoformat(last_429.reset_time)
            now = datetime.now(timezone.utc)

            if now < reset_time:
                # Still in quota exhausted state
                return {
                    'agent_id': agent_id,
                    'provider': provider,
                    'model': model,
                    'status': 'exhausted',
                    'estimated_remaining': 0,
                    'estimated_limit': limits.get('daily', 0),
                    'usage_percentage': 100,
                    'confidence': 'high',
                    'next_reset': reset_time,
                    'reason': f"Currently exhausted (reset at {reset_time.strftime('%H:%M')})"
                }
            else:
                # Quota has reset since last 429
                time_since_reset = (now - reset_time).total_seconds()
                hours_since_reset = time_since_reset / 3600

                # Estimate usage based on time since reset
                daily_limit = limits.get('daily', 0)
                estimated_used = int(daily_limit * (hours_since_reset / 24))

                return {
                    'agent_id': agent_id,
                    'provider': provider,
                    'model': model,
                    'status': 'ok' if estimated_used < daily_limit * 0.8 else 'warning',
                    'estimated_remaining': max(0, daily_limit - estimated_used),
                    'estimated_limit': daily_limit,
                    'usage_percentage': int((estimated_used / daily_limit) * 100),
                    'confidence': 'medium',
                    'next_reset': self._calculate_next_reset(reset_time),
                    'reason': f"Reset {hours_since_reset:.1f}h ago, estimating {estimated_used}/{daily_limit} used"
                }

        # No 429 events found - agent has never hit quota
        # Use conservative estimate based on provider defaults
        daily_limit = limits.get('daily', 0)

        return {
            'agent_id': agent_id,
            'provider': provider,
            'model': model,
            'status': 'unknown',
            'estimated_remaining': None,
            'estimated_limit': daily_limit,
            'usage_percentage': None,
            'confidence': 'low',
            'next_reset': None,
            'reason': f"No quota events recorded (limit: {daily_limit:,}/day)"
        }

    def _get_known_limits(self, provider: str, model: str) -> Dict:
        """
        Get known quota limits for provider/model.

        Args:
            provider: API provider name
            model: Model name

        Returns:
            Dict with 'daily' and 'monthly' limits
        """
        # Known limits (as of 2025)
        # These should be kept up-to-date
        limits = {
            'anthropic': {
                'claude-sonnet-4': {'daily': 500000, 'monthly': 15000000},
                'claude-opus-4': {'daily': 200000, 'monthly': 6000000},
                'claude-haiku-4': {'daily': 1000000, 'monthly': 30000000},
            },
            'openai': {
                'gpt-4': {'daily': 10000, 'monthly': 300000},
                'gpt-4-turbo': {'daily': 100000, 'monthly': 3000000},
            },
            'google': {
                'gemini-pro': {'daily': 1500, 'monthly': 45000},  # requests, not tokens
            }
        }

        return limits.get(provider, {}).get(model, {'daily': 100000, 'monthly': 3000000})

    def _calculate_next_reset(self, last_reset: datetime) -> datetime:
        """
        Calculate next quota reset time based on last reset.

        Args:
            last_reset: Last known reset time

        Returns:
            Next reset datetime
        """
        # Most providers reset daily
        # Assume 24h cycle from last reset
        next_reset = last_reset + timedelta(days=1)
        return next_reset

    def _append_event(self, agent_id: str, event: QuotaEvent):
        """
        Append an event to agent's quota history.

        Args:
            agent_id: Agent employee ID
            event: Quota event to record
        """
        history_file = self.state_dir / f'{agent_id}_quota.json'

        # Load existing data
        if history_file.exists():
            try:
                with open(history_file, 'r') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, ValueError):
                data = {'events': []}
        else:
            data = {'events': []}

        # Append new event
        data['events'].append(asdict(event))

        # Keep only last 1000 events per agent
        if len(data['events']) > 1000:
            data['events'] = data['events'][-1000:]

        # Save
        with open(history_file, 'w') as f:
            json.dump(data, f, indent=2)


def format_quota_status(status: Dict) -> str:
    """
    Format quota status for display.

    Args:
        status: Quota status dict from estimate_quota_status()

    Returns:
        Formatted string
    """
    if status['status'] == 'exhausted':
        wait_time = status['next_reset'] - datetime.now(timezone.utc)
        hours = int(wait_time.total_seconds() / 3600)
        return f"⚠️ Exhausted (reset in ~{hours}h)"

    elif status['status'] == 'warning':
        remaining = status['estimated_remaining']
        percentage = status['usage_percentage']
        return f"⚠️ {remaining:,} left ({percentage}% used)"

    elif status['status'] == 'ok':
        remaining = status['estimated_remaining']
        percentage = status['usage_percentage']
        return f"✅ ~{remaining:,} left ({percentage}% used)"

    else:  # unknown
        limit = status['estimated_limit']
        return f"❓ Unknown (limit: {limit:,}/day)"


# Example usage
if __name__ == '__main__':
    tracker = QuotaTracker()

    # Simulate recording a 429 event
    reset_time = datetime.now(timezone.utc) + timedelta(hours=5)
    tracker.record_429_event('EMP_0007', reset_time, 'API Error 429')

    # Estimate current status
    status = tracker.estimate_quota_status('EMP_0007', 'anthropic', 'claude-sonnet-4')

    print("Quota Status:")
    for key, value in status.items():
        print(f"  {key}: {value}")

    print(f"\nFormatted: {format_quota_status(status)}")
