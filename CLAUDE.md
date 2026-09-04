# Regicide Legacy — repo notes

## Always run tests and typechecks from the repo root

```bash
npm test        # builds shared first, then runs shared + server suites
npm run typecheck   # builds shared first, then typechecks server + client
```

Both scripts rebuild `packages/shared` before they run. Do not invoke
`vitest` or `tsc` inside a package directly unless you have just built shared,
or you will be testing stale code. See below for why.

## The stale `dist` trap

`packages/server` and `packages/client` import `@regicide/shared` **by package
name**, which Node resolves to `packages/shared/dist/index.js`. That `dist` is
gitignored and nothing rebuilds it automatically. Two failure modes follow.

**1. Stale build in the main checkout.** Running the server suite against an old
`dist` silently tests old shared code. This has produced phantom failures that
vanish the moment shared is rebuilt.

**2. A worktree resolving up and out.** A git worktree with no `node_modules` of
its own resolves `@regicide/shared` by walking **up** to the main checkout and
reading *that* copy's `dist`. Agents working in worktrees have repeatedly seen
around 20 typecheck errors naming features they never touched
(`chanterCountChoice`, `druidWindow` and friends) and assumed they broke
something. They had not.

**If a failure names code you did not touch, suspect this first.** In a fresh
worktree, run `npm run bootstrap` before anything else so resolution stays
inside the worktree.

## No lint tooling

There is no eslint or prettier config in this repo. Strict TypeScript and the
test suites are the only gate.
