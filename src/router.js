// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Minimal router: exact segments and ":param" segments, nothing else.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const body = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return escapeRe(seg);
      })
      .join('/');
    const re = new RegExp(pattern === '/' ? '^/$' : `^${body}/?$`);
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  get(pattern, handler) {
    return this.add('GET', pattern, handler);
  }

  post(pattern, handler) {
    return this.add('POST', pattern, handler);
  }

  /** → { handler, params } · { methodNotAllowed: true } · null */
  match(method, path) {
    let pathKnown = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathKnown = true;
      if (r.method !== method) continue;
      const params = {};
      for (let i = 0; i < r.keys.length; i++) {
        try {
          params[r.keys[i]] = decodeURIComponent(m[i + 1]);
        } catch {
          return null;
        }
      }
      return { handler: r.handler, params };
    }
    return pathKnown ? { methodNotAllowed: true } : null;
  }
}
