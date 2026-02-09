import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from services.heartbeat_service import parse_heartbeat_recovery_policy  # noqa: E402
from services.heartbeat_state_machine import (  # noqa: E402
    classify_heartbeat_ack,
    failure_reason_code,
    should_retry_heartbeat_attempt,
)


class HeartbeatServiceizationTests(unittest.TestCase):
    def test_parse_recovery_policy_service_defaults(self):
        policy = parse_heartbeat_recovery_policy({'enabled': True}, fallback_modes={'none', 'fresh'})
        self.assertEqual(policy['max_retries'], 1)
        self.assertEqual(policy['retry_backoff_seconds'], 3)
        self.assertEqual(policy['fallback_mode'], 'fresh')

    def test_state_machine_ack_reason_code(self):
        ack, failure, reason = classify_heartbeat_ack(waited_for_ack=True, last_state='busy', timed_out=True)
        self.assertEqual((ack, failure, reason), ('timeout', 'timeout', 'HB_ACK_TIMEOUT'))

    def test_failure_reason_code_mapping(self):
        self.assertEqual(failure_reason_code(failure_type='send_fail'), 'HB_SEND_FAIL')
        self.assertEqual(failure_reason_code(failure_type='blocked'), 'HB_AGENT_BLOCKED')
        self.assertEqual(failure_reason_code(failure_type='timeout'), 'HB_ACK_TIMEOUT')

    def test_should_retry_uses_state_machine_rules(self):
        self.assertTrue(should_retry_heartbeat_attempt(failure_type='no_ack', attempt_index=0, max_retries=1))
        self.assertFalse(should_retry_heartbeat_attempt(failure_type='unknown', attempt_index=0, max_retries=1))


if __name__ == '__main__':
    unittest.main()
