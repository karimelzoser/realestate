# Active Source Modules

The current application still exposes legacy globals such as `app`, `P`, `go`, `render`, and `rtEnterRole`.

The first safe extraction moves the features we are actively changing most often into dedicated source modules:

- `features/live-allocation/`
- `core/flow-navigation.*`
- `features/how-it-works/`

The Buyer experience / My Property / bilingual AI Advisor remain in the stable shell for the moment and are the next extraction target.

New How It Works, routing, and live-allocation changes should be made in these source modules instead of appending more inline revisions to `app/index.html`.
