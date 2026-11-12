# Project constraints

- Use Yarn 1 (classic) for all package operations (`yarn install`, `yarn serve`, `yarn build`, `yarn lint`, `yarn typecheck`); never npm. `yarn.lock` is the only lockfile, so never create or commit `package-lock.json`.
- Use the Node version in `.nvmrc` (`nvm use`); yarn enforces dependency `engines` (e.g. jsdom needs Node ≥24.15).
