// The one way pages talk to the Worker's JSON API (/api/…), used by the presets hub and the
// landing page's invite dialog. Writes are same-origin application/json, which the API requires.

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
