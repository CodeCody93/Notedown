# Graph cheat-sheet

Single-line tags delimited by `%% ... %%`. Never render inside fenced code.

## Pie

    %% pie "Title" (Apples, 30) (Bananas, 45) %%

- Points are `(label, value)` 2-tuples, 1 or more.
- Leading labels: 1 is the title; 2 are x-label, y-label; 3 are title, x, y.
- `min`/`max` keywords are silently ignored.
- Negative values clamp to 0 for slices; legend cells keep raw values.

## Bar

    %% bar "Sales 2024" Units min 0 max 500 (Jan, 120) (Feb, 200) %%

- Points are `(label, value)` 2-tuples, 1 or more.
- Header takes at most 2 labels: 1 is the title, 2 are title + y-label.
  There is no x-axis parameter.
- Optional `min N` / `max M` (bare words, case-insensitive, header only).
  A quoted `"min"` is a plain label.

## Line

    %% line "Traffic" (Week, Mon, Tue) (Hits, 0, 200) (SiteA, 120, 200) (SiteB, 150, 180) %%

- Group form only: optional title, then X group, Y group, 1+ series groups.
- X group `(Xname, x1, x2, ...)`: axis name + point names. Axis-only
  `(Xname)` auto-labels slots 1..N from the series lengths.
- Y group `(Yname[, min][, max])`: axis name with optional bounds.
  A lone number is the max (min auto-scales).
- Series `(Name, v1, v2, ...)`: one value per x position.
- Title may be omitted: `%% line (Weekday) (Hits) (SiteA, 50, 120) %%`.
- Lone-max Y: `%% line "T" (X, A, B) (Y, 100) (S, 10, 20) %%`.
- Points group by series (first-seen order); missing combos leave gaps
  and segments never bridge a gap.

## Scale behavior

- Bar/line Y range: explicit `min`/`max` win when present.
- Auto range is `[min(0, min(values)), max(values)]`, so all-positive
  data starts at 0.
- Bars render heights as true percentages of the plot row (`--v`).
- Pie renders slice angles as percentages of the (clamped) total.

## Error catalog (renders an error box, source preserved)

- Unknown type: `%% scatter (A, 1) %%`.
- Empty tag or no data points.
- Unterminated string or `(`; unexpected token before/inside points.
- Wrong tuple arity: pie/bar need exactly `(label, value)`.
- Non-finite values (`ok`, `NaN`, `Infinity`).
- Too many leading labels (bar > 2, pie > 3).
- `min >= max`, or missing/bad number after `min`/`max`.
- Pie values summing to 0 or less.
- Line: missing X/Y/series groups, ragged series lengths, duplicate
  series, fewer than 2 x positions, bad Y bounds, old tuple syntax.

## Import / export fidelity

- HTML export keeps the full figure (chart + fallback table).
- TXT export writes the raw tag source.
- PDF / DOCX / RTF fall back to plain text, e.g.
  `Sales (bar): Jan=120, Feb=200`; line groups by series,
  `Traffic (line): SiteA: Mon=120, Tue=200; SiteB: Mon=150`.
- HTML import restores the tag via the `data-graph` attribute on
  the figure (title, labels, bounds, points round-trip).

## Builder

Press Mod-Shift-G (Ctrl-Shift-G on Windows/Linux, Cmd-Shift-G on macOS) or
choose the Graph menu to open the graph builder modal.

- Tabs for Pie, Bar, and Line. Switching tabs resets that tab's grid to its
  starter rows but keeps the shared title.
- Grid editing: edit labels/values in place; add or remove rows (pie/bar),
  X columns and series (line) with the Add/× buttons.
- Validation: the Insert button stays disabled until every cell holds a
  finite number, bounds satisfy min < max, and the generated tag re-parses.
  Problems are listed above the preview and the offending cells are
  highlighted; fixing them re-enables Insert.
- A live preview (rendered figure plus the generated tag source) updates as
  you type.
- Insert closes the modal and inserts the generated `%% … %%` tag at the
  caret. Cancel, Esc, or clicking the backdrop closes without inserting.
