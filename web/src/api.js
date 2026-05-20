async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.json();
}

export const api = {
  health: () => request('GET', '/api/health'),
  people: {
    list: () => request('GET', '/api/people'),
    create: (data) => request('POST', '/api/people', data),
    update: (id, data) => request('PUT', `/api/people/${id}`, data),
    remove: (id) => request('DELETE', `/api/people/${id}`),
    ping: (id) => request('POST', `/api/people/${id}/ping`),
  },
  tasks: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request('GET', `/api/tasks${q ? '?' + q : ''}`);
    },
    create: (data) => request('POST', '/api/tasks', data),
    update: (id, data) => request('PUT', `/api/tasks/${id}`, data),
    remove: (id) => request('DELETE', `/api/tasks/${id}`),
    notify: (id) => request('POST', `/api/tasks/${id}/notify`),
    events: (id) => request('GET', `/api/tasks/${id}/events`),
  },
};
