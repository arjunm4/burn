export async function api(path, {body, ...options} = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    ...(body !== undefined ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function streamRun(id, signal, onEvent) {
  const response = await fetch(`/api/requests/${encodeURIComponent(id)}/run`, {method: 'POST', signal});
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Agent backend unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', completed = false;
  const dispatch = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'run.failed') throw new Error(event.error || 'Agent tools failed');
    if (event.type === 'run.completed') completed = true;
    onEvent(event);
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
      }
    }
    buffer += decoder.decode();
    dispatch(buffer);
    if (!completed) throw new Error('Agent connection ended before the tools completed. Retry to continue.');
  } finally { reader.releaseLock(); }
}
