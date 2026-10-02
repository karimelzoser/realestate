# Active Source Modules

The current application still exposes legacy globals such as `app`, `P`, `go`, `render`, and `rtEnterRole`.

For safety, the first modularization step keeps ordinary browser scripts and the existing public interfaces. New changes should be made in these source modules instead of being appended inline to `app/index.html`.

Once a domain is fully extracted and parity-tested, it can be converted to explicit ES-module imports.
