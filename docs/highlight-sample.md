# Highlight.js language coverage — verification sample

This file exercises every syntax-highlighted language listed in PLAN §17 / `src/app/export.ts` (`hljs` registration). Open it in MarkItDown (Live mode, saved doc) and export to HTML — each fence should be syntax-colored (not plain grey). In exported HTML both light and dark `prefers-color-scheme` styles should appear.

## markdown

```markdown
# Heading
**bold** *italic* ~~strike~~ [link](https://example.com)
- list item
> blockquote
```

## javascript

```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
  return { ok: true, count: 42 };
}
greet("world");
```

## typescript

```typescript
interface User {
  id: number;
  name: string;
}
const add = (a: number, b: number): number => a + b;
type Result = Promise<User | null>;
```

## python

```python
def fibonacci(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print(fibonacci(10))
```

## bash

```bash
#!/usr/bin/env bash
set -euo pipefail
for file in *.md; do
  echo "Processing $file"
  grep -c "^# " "$file"
done
```

## json

```json
{
  "name": "MarkItDown",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}
```

## yaml

```yaml
name: MarkItDown
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
```

## html

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Demo</title></head>
  <body>
    <main class="md-body"><p>Hello</p></main>
  </body>
</html>
```

## css

```css
.md-body {
  color: var(--text);
  background: var(--bg);
  line-height: 1.6;
}
.md-body code {
  font-family: var(--mono);
}
```

## rust

```rust
fn main() -> Result<(), String> {
    let mut vec = vec![1, 2, 3];
    vec.push(4);
    println!("vec: {:?}", vec);
    Ok(())
}
```

## sql

```sql
SELECT u.name, COUNT(p.id) AS posts
FROM users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE u.active = TRUE
GROUP BY u.name
ORDER BY posts DESC
LIMIT 10;
```

## plaintext (no highlighting, fallback)

```plaintext
This is plaintext — no language highlighting, just monospaced.
Fallback should render as plain code without colors.
```

## unknown language (fallback to plaintext)

```foobar
This language is not registered — should fallback to uncolored code.
```

---
Expected: each known language fence is colored (hljs). Unknown `foobar` and `plaintext` render without error, as plain code.
