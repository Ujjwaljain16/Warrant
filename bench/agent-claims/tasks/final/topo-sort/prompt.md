# topo-sort

`toposort.js` should export `topoSort(graph)` (it is not implemented yet). `graph` is a plain object that maps each node name to an array of the names it depends on, for example `{ app: ['lib', 'util'], lib: ['util'], util: [] }`.

- The result is an array of every node, each appearing after all of its dependencies. A name that only appears inside a dependency list is a node too (with no dependencies of its own).
- The order is fully determined: repeatedly output the node that is **smallest by `<` string comparison among all nodes whose dependencies have already been output**. Example: `{ b: ['d'], a: ['d'], d: [], c: [] }` gives `['c', 'd', 'a', 'b']`.
- If the dependencies contain a cycle (including a node that depends on itself), throw an `Error` whose `code` property is `'CYCLE'`.
- Repeated names in one dependency list are harmless. The empty graph gives `[]`.
- `graph` must be a plain object and each dependency list an array of strings, otherwise throw a `TypeError`.
- The input is never modified.

Keep it dependency free.
