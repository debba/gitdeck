## [1.0.5](https://github.com/debba/gh-dashboard/compare/v1.0.4...v1.0.5) (2026-07-27)


### Bug Fixes

* **auth:** resolve active account from external token in token/gh-cli mode ([1a44c21](https://github.com/debba/gh-dashboard/commit/1a44c211642dc1337b012205d5cf14b33a519b23)), closes [token/#cli](https://github.com/debba/gh-dashboard/issues/cli) [#cli](https://github.com/debba/gh-dashboard/issues/cli)
* load bot and GitHub App avatars from the API avatar URL ([2962a37](https://github.com/debba/gh-dashboard/commit/2962a37154bc9c993b7c1b21aeaae09dcba17461))

## [1.0.4](https://github.com/debba/gh-dashboard/compare/v1.0.2...v1.0.4) (2026-05-21)


### Bug Fixes

* **accounts:** reload dashboard data when switching account ([8b0085b](https://github.com/debba/gh-dashboard/commit/8b0085ba4ca9d7ef9da0dfa789cb66129eed7761))
* **auth:** provider choice on the first-time sign-in screen ([5b29b58](https://github.com/debba/gh-dashboard/commit/5b29b58c1b197f1d4ef7e0fdd6c53a9b09c74e86)), closes [#cli](https://github.com/debba/gh-dashboard/issues/cli)
* **sidebar:** keep filter sections open after deselecting the last item ([4375d24](https://github.com/debba/gh-dashboard/commit/4375d242db2d959291824c8cd5954c9e70a721bd))


### Features

* **accounts:** add /api/accounts endpoints and TopBar switcher ([0a3e5e9](https://github.com/debba/gh-dashboard/commit/0a3e5e97d194d1822d1c25b85c35514f18919aa1))
* **accounts:** add and remove GitHub accounts from the switcher ([abe591e](https://github.com/debba/gh-dashboard/commit/abe591e09e34f27461357d2010a7d9ce225b7a3f))
* **accounts:** gate the kanban tab behind provider capabilities ([9a5b1c1](https://github.com/debba/gh-dashboard/commit/9a5b1c199accaad120a89451c5ee6934bd3dd84c))
* **auth:** redesign auth UI and update app title ([57fb259](https://github.com/debba/gh-dashboard/commit/57fb259aab2a6d3d651656cc791381f49d13b9ac))
* **forgejo:** provider skeleton and token-based account onboarding ([0f7157c](https://github.com/debba/gh-dashboard/commit/0f7157c4e8c1358569378a037b72b125daf60ed0))
* **forgejo:** route domain ops through the provider interface ([8557259](https://github.com/debba/gh-dashboard/commit/8557259bb8d57dea81f1d5dffc07110c67facab5))
* **labels:** add Primer-style label CSS vars and usage ([c7e0f3c](https://github.com/debba/gh-dashboard/commit/c7e0f3c82c2771e815217c3982c339fb48b2fce7))
* **sidebar:** clear filter selections by hovering its count badge ([f0a291a](https://github.com/debba/gh-dashboard/commit/f0a291a626f7841524cfdaba211971581a481a49)), closes [#8](https://github.com/debba/gh-dashboard/issues/8)

## [1.0.2](https://github.com/debba/gh-dashboard/compare/v1.0.1...v1.0.2) (2026-05-09)


### Features

* **auth:** support gh-cli and token auth modes ([365622e](https://github.com/debba/gh-dashboard/commit/365622e173cdbe62431fa2c5f54e785c00cda056)), closes [#cli](https://github.com/debba/gh-dashboard/issues/cli)
* **ci:** add CI health dashboard and API ([ebcd4da](https://github.com/debba/gh-dashboard/commit/ebcd4da486a4ec7bef2ba723ca5c199002ac4831))
* **digests:** support weekly and monthly digest periods ([f50ea9a](https://github.com/debba/gh-dashboard/commit/f50ea9aa6573a16127fd0873c2352eebaaf7ad9b))
* **ui:** add command palette with Cmd+K shortcut and search ([bd4097f](https://github.com/debba/gh-dashboard/commit/bd4097f2e2e1c13f725a76bea342c2cbb38ed763))

## 1.0.1 (2026-05-06)


### Features

* add localStorage cache utility for dashboard stats ([b23b82a](https://github.com/debba/gh-dashboard/commit/b23b82a33482f56bfb18fe7bead9a6280e6daf12))
* add localStorage cache utility for sidebar filters ([418f62b](https://github.com/debba/gh-dashboard/commit/418f62b6767a22bc27b6c9fecee77b03b0dd6fda))
* **dashboard:** add initial GitHub dashboard application ([aad922c](https://github.com/debba/gh-dashboard/commit/aad922c2ae7a73e829c1316eb0b955d35159521d))
* **docker:** add Dockerfile, docker-compose and .dockerignore ([53c5c1f](https://github.com/debba/gh-dashboard/commit/53c5c1fee0494a309b201e050f3b6f281e9122fd))
* **inbox:** add inbox view with GitHub notifications support ([2024b21](https://github.com/debba/gh-dashboard/commit/2024b21e2feb11e3eb637819f7cb049609234016))
* integrate localStorage cache in App to prevent flash of zeros ([f5a5589](https://github.com/debba/gh-dashboard/commit/f5a55895833e7a5bdebe2c26289419595e38d0d6))
* persist sidebar filters and sort order across page refreshes ([687f605](https://github.com/debba/gh-dashboard/commit/687f6050d2d90cad8fec97149cb7619ff1a945f9))
* show stale pulse on manual refresh, not just page reload ([260ff70](https://github.com/debba/gh-dashboard/commit/260ff7056a886b9972af9a59de40957e053b6bba))
* show user GitHub avatar in top bar ([20ca6de](https://github.com/debba/gh-dashboard/commit/20ca6ded9e3a0336d7029e9884a378a28fa73102))
* **ui:** add footer, contributors, changelog, and welcome modals ([dbb7bf6](https://github.com/debba/gh-dashboard/commit/dbb7bf6de0ab4a94a0bead7d7991eae058f58174))
