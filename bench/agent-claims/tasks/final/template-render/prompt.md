# template-render

`render.js` should export `render(template, data)` (it is not implemented yet). It fills `{{ ... }}` tags in a template string.

Rules:

- `{{name}}` is replaced by the value found at `name` in `data`. Spaces just inside the braces are allowed: `{{ name }}`.
- A path is names joined by dots, like `user.address.city` or `items.0` (array indexes work the same way). A name consists of letters, digits, `_` and `$`. Only **own** properties are looked up, and only inside objects and arrays: `{{constructor}}`, `{{toString}}`, `{{__proto__}}`, `{{name.length}}` where `name` is a string, and `{{a..b}}` all render as the empty string.
- A missing path, `null` and `undefined` render as `''`. Any other value is converted with `String(value)` (so `0` is `0` and `false` is `false`).
- The converted value is HTML-escaped: `&` `<` `>` `"` `'` become `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`.
- `{{{path}}}` (three braces) inserts the value without escaping.
- A backslash directly before a tag makes it literal: `\{{name}}` renders as `{{name}}`, and `\{{{name}}}` as `{{{name}}}` (the backslash is removed, nothing inside is evaluated).
- Anything that does not form a valid tag stays exactly as written: `{{ name` (no closing braces), `{{ a b }}`, `{{}}`.
- `template` must be a string and `data` a non-null object, otherwise throw a `TypeError`.

Keep it dependency free.
