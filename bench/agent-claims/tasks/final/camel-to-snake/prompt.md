# camel-to-snake

`snake.js` should export `camelToSnake(name)` (it is not implemented yet). It converts an identifier from camelCase or PascalCase to snake_case.

Rules (only ASCII letters `A-Z` count as upper-case, `a-z` as lower-case):

- The result is all lower-case.
- An underscore is inserted before an upper-case letter that directly follows a lower-case letter or a digit: `fooBar` becomes `foo_bar`, `utf8Decode` becomes `utf8_decode`.
- A run of consecutive upper-case letters is one word (an acronym). If the run is followed by a lower-case letter, the run's last capital starts the next word instead: `parseHTTPResponse` becomes `parse_http_response`, `HTTPServer` becomes `http_server`, `ABTest` becomes `ab_test`.
- Digits stay attached to the letters before them: `sha256` stays `sha256`, `html5Parser` becomes `html5_parser`.
- Existing underscores are kept and never doubled: `foo_Bar` becomes `foo_bar`, `_privateField` becomes `_private_field`.
- A name with no upper-case letters is returned unchanged; the empty string gives the empty string.
- A non-string throws a `TypeError`.

Keep it dependency free.
