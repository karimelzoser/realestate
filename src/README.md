# Active Source Modules

The current application still exposes legacy globals such as `app`, `P`, `go`, `render`, and `rtEnterRole`.

The safe extraction now moves the active product layers we change most often into dedicated source modules:

- `features/live-allocation/` — shared queue and Live Allocation Day
- `core/flow-navigation.*` — OPEN preview vs ROLE restricted navigation
- `features/buyer-experience/` — bilingual AI Allocation Advisor, My Property, buyer examples and post-sale experience
- `features/how-it-works/` — Metro overview and route audit

The stable `app/index.html` still contains the older core application, shared state, page registry and role implementations. We keep those in place while extracting one domain at a time behind the same public page IDs and globals.

New work for an extracted area should be made in its `src/` module instead of appending another inline revision block to `app/index.html`.
