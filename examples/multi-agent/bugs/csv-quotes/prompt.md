# Fix: csv-quotes (bug id: csv-quotes)

`parseLine(line)` in `csv.js` splits on every comma, so `parseLine('a,"b,c",d')` returns four fields. Fix it so it parses one line of CSV.

Rules:

- Fields are separated by commas; the result is an array of strings.
- A field may be wrapped in double quotes; the quotes are not part of the value and commas inside them do not separate fields.
- Inside a quoted field, two double quotes in a row stand for one literal double quote.
- Empty fields are kept: `'a,,b,'` has four fields, the last two empty. The empty line `''` has one empty field.
- A quote that is never closed makes the line invalid: throw a `SyntaxError`.

Only the file `csv.js` is taken from your work. Keep it dependency free.
