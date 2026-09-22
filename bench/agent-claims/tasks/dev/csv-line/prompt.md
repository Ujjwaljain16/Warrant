# csv-line

`csvline.js` should export `parseCsvLine(line)` (it is not implemented yet). It parses one CSV record into an array of strings.

Rules:

- Fields are separated by commas. Nothing is trimmed: spaces belong to the field.
- A field that starts with a double quote is a quoted field. It ends at the next double quote that is not doubled. Inside it, a comma is ordinary text, and `""` stands for one `"`. A quoted field may also contain line breaks.
- A double quote that does not start a field is ordinary text: `5"` and `a"b` stay as they are.
- The empty string is one empty field: `parseCsvLine('')` is `['']`. `a,` is `['a', '']` and `,` is `['', '']`.
- A quoted field with no closing quote, or any text between a closing quote and the next comma (or the end of the line), throws a `SyntaxError`.
- A non-string throws a `TypeError`.

Keep it dependency free.
