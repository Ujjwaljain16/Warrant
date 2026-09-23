# ini-parse

`ini.js` should export `parseIni(text)` (it is not implemented yet). It parses INI-style text into a nested object.

Rules:

- Lines end with `\n` or `\r\n`. Each line is trimmed of leading and trailing whitespace first.
- Blank lines are ignored. A line starting with `;` or `#` is a comment and is ignored. There are no inline comments: in `a = 1 ; not a comment` the value is `1 ; not a comment`.
- `[name]` starts a section; `name` is trimmed (`[ db ]` is the section `db`). Keys after it belong to that section until the next section header. Keys before any section header belong to the top level. A section that appears twice is the same section (its keys are merged).
- `key = value` splits at the **first** `=`. Key and value are trimmed. `a =` gives the value `''`. A value is always a string (no number or boolean conversion). If a value starts and ends with a double quote (and has at least two characters), the quotes are removed and everything between them is kept exactly, spaces included. There are no escape sequences.
- A repeated key in the same place replaces the earlier value.
- The result and every section are objects created with `Object.create(null)`.
- Any other non-blank, non-comment line (no `=` and not a section header), an empty key (`= x`), an empty section name (`[]`), or a header without `]` throws a `SyntaxError` whose `line` property is the 1-based line number.
- A non-string throws a `TypeError`.

Keep it dependency free.
