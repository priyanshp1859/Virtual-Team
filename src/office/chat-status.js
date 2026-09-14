export function chatDelivery(messageId, execution, online) {
  if (!execution) return 'Saved · ready to send';
  if (execution.respondedMessageIds?.includes(messageId)) return execution.status === 'waiting_for_user' ? 'Question received' : 'Reply received';
  if (['failed', 'interrupted'].includes(execution.status)) return 'Reply needs attention · retry available';
  if (execution.status === 'cancelled') return 'Stopped · message saved';
  if (!online) return 'Saved · waiting for the worker';
  if (execution.status === 'working' && execution.inputMessageIds?.includes(messageId)) return 'Agent is preparing a reply';
  return 'Queued for a reply';
}
