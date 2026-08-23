'use strict';

/** http.cjs — tiny fetch wrapper shared by every acceptance test file. */

function client(baseUrl, token) {
  async function req(method, urlPath, { body, auth = false, headers = {} } = {}) {
    const finalHeaders = { ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    if (auth === true) finalHeaders['Authorization'] = `Bearer ${token}`;
    else if (typeof auth === 'string') finalHeaders['Authorization'] = `Bearer ${auth}`;

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  return {
    get: (p, opts) => req('GET', p, opts),
    post: (p, opts) => req('POST', p, { ...opts, auth: opts && 'auth' in opts ? opts.auth : true }),
    put: (p, opts) => req('PUT', p, { ...opts, auth: opts && 'auth' in opts ? opts.auth : true }),
    patch: (p, opts) => req('PATCH', p, { ...opts, auth: opts && 'auth' in opts ? opts.auth : true }),
    delete: (p, opts) => req('DELETE', p, { ...opts, auth: opts && 'auth' in opts ? opts.auth : true }),
    raw: req,
  };
}

module.exports = { client };
