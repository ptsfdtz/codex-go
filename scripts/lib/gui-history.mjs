// Inspect only a GUI-requested response for the exact seeded thread and turn.
// Return booleans, never content or identifiers for persistence.
export function inspectGuiHistory(request, result, seed) {
  const found = { user: false, assistant: false };
  if (!seed.threadId || !seed.turnId || request?.threadId !== seed.threadId) return found;
  let items = [];
  if (['thread/read', 'thread/resume'].includes(request.method)) {
    if (result?.thread?.id !== seed.threadId) return found;
    items = (result.thread.turns ?? [])
      .filter((turn) => turn.id === seed.turnId)
      .flatMap((turn) => turn.items ?? []);
  } else if (request.method === 'thread/turns/list') {
    items = (result?.data ?? [])
      .filter((turn) => turn.id === seed.turnId)
      .flatMap((turn) => turn.items ?? []);
  } else if (request.method === 'thread/items/list') {
    items = (result?.data ?? [])
      .filter((entry) => entry.turnId === seed.turnId)
      .map((entry) => entry.item);
  }
  for (const item of items) {
    if (item?.type === 'userMessage')
      found.user ||=
        item.content?.some((part) => part.type === 'text' && part.text === seed.input) === true;
    if (item?.type === 'agentMessage') found.assistant ||= item.text === seed.answer;
  }
  return found;
}
