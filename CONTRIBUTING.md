# Contributing

Thank you for helping. Looku is a small project, so please open an issue before a large change.

- Node.js 22 or newer. `npm install` and `npm test` in the repository root run every package's tests.
- Plain JavaScript (ES modules), no build step. The dashboard is static files; build the DOM with the `h()` helper
  and never insert HTML strings.
- Privacy rules that changes must keep: nothing is stored in the browser for page views; IP addresses and user agents
  are never written to disk or logs; data from the browser collector and orders are never linked to visitors; the
  receiver has no read routes.
- Add a test for each change in behaviour.

By contributing you agree that your contribution is licensed under the license of the package you change: the MIT
License for `packages/next`, `packages/node` and `packages/browser`, the GNU AGPL 3.0 for everything else.
