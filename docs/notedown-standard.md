# The Notedown Standard

**Version 1.0 · Notedown 0.7.0 · November 2026**

Notedown Markdown is a practical Markdown dialect built on CommonMark. It keeps the familiar core — paragraphs, headings, emphasis, links, images, lists, blockquotes, and code — and adds selected GitHub Flavored Markdown (GFM) features (pipe tables, strikethrough, task lists) plus a small set of Notedown extensions for richer notes.

This document describes the syntax and rendering behavior you can rely on in Notedown. It is a practical compatibility target, not a claim of full CommonMark or GFM conformance, and other Markdown renderers will not understand the Notedown-specific extensions.

## Contents

- [1. Scope and conventions](#1-scope-and-conventions)
- [2. Quick reference](#2-quick-reference)
- [3. Block syntax](#3-block-syntax) · [paragraphs](#31-paragraphs-and-line-breaks) · [headings](#32-headings) · [blockquotes](#33-blockquotes) · [lists](#34-lists) · [code](#35-code-blocks) · [rules](#36-horizontal-rules) · [tables](#37-tables) · [HTML](#38-raw-html) · [footnotes](#39-footnotes) · [subtext](#310-subtext)
- [4. Inline syntax](#4-inline-syntax) · [decorations](#41-emphasis-and-decorations) · [spoilers](#42-spoilers) · [code, links, images](#43-code-links-and-images) · [emoji](#44-emoji) · [attributes](#45-attributes) · [nesting](#46-nesting-and-escaping)
- [5. Notedown block extensions](#5-notedown-block-extensions) · [dropdowns](#51-dropdowns) · [graphs](#52-graphs)
- [6. Rendering and editor behavior](#6-rendering-and-editor-behavior)
- [7. Export and import fidelity](#7-export-and-import-fidelity) · [format summary](#71-format-summary) · [import](#72-import) · [portability](#73-portability)
- [8. Complete example](#8-complete-example)
- [9. Versioning and feedback](#9-versioning-and-feedback)

## 1. Scope and conventions

### What is included

- **CommonMark core:** paragraphs, ATX and Setext headings, emphasis, links, images, reference definitions, blockquotes, ordered and unordered lists, fenced and indented code blocks, horizontal rules, raw HTML, and backslash escapes.
- **Selected GFM features:** pipe tables, strikethrough, and task list items.
- **Notedown extensions:** underline, highlight, subscript, superscript, spoilers, collapsible dropdowns, CSS-only graphs, subtext, heading IDs and attribute lists, and extended ordered-list markers (alphabetical and Roman).

### What is not special

- **No front matter.** YAML or TOML front matter is not recognized; those lines are treated as ordinary Markdown.
- **No math or LaTeX.** `$...$` and `$$...$$` stay as text.
- **No Mermaid.** A fence tagged `mermaid` is a code block, not a diagram.
- **No callouts or admonitions.** `> [!NOTE]` is an ordinary blockquote containing that text.
- **No GFM autolink literals.** A bare URL such as `https://example.com` is not automatically linked. Use `<https://example.com>` or `[text](https://example.com)`.
- **No claim of full GFM or CommonMark conformance.** When this document and a third-party renderer disagree, Notedown's behavior is described here.

### Conventions

- Documents are UTF-8 text. Both LF and CRLF line endings are accepted.
- A single newline inside a paragraph is a visible line break. Notedown enables hard breaks on newlines, so the next line starts on a new line instead of collapsing to a space. A blank line starts a new block.
- A trailing backslash or two trailing spaces also forces a line break.
- Use backslash escapes for ordinary Markdown punctuation. To show a Notedown extension marker literally, use a code span for inline markers and a fenced code block for line-leading markers; extension markers are processed before normal Markdown parsing, so a backslash is not always reliable for them.
- Inline code and fenced code are literal: formatting inside them is not interpreted. Indented code is safe for ordinary Markdown but not for every Notedown extension; see [Code blocks](#35-code-blocks).

## 2. Quick reference

| Feature | Syntax | Result or notes |
| --- | --- | --- |
| Bold | `**text**` | Strong emphasis. |
| Italic | `*text*` or `_text_` | Emphasis. |
| Underline | `__text__` | Notedown extension. `**` is bold; this is not CommonMark bold. |
| Strikethrough | `~~text~~` | GFM strikethrough. |
| Highlight | `==text==` | Notedown extension; renders as a highlighted `<mark>`. |
| Subscript | `~text~` | Notedown extension; no unescaped spaces inside. |
| Superscript | `^text^` | Notedown extension; no unescaped spaces inside. |
| Inline code | `` `code` `` | Literal content. |
| Fenced code | 3+ backticks or tildes, then a language | Language is optional; content is literal. |
| Heading | `# Heading` through `###### Heading` | Levels 1–6. |
| Heading ID | `# Title {#custom-id}` | Notedown extension; ID hidden in Live mode. |
| Link | `[text](https://example.com "Title")` | Title is optional; reference links work too. |
| Image | `![alt](image.png "Title")` | Local paths on desktop; remote or `data:` on web. |
| Footnote | `[^1]` plus `[^1]: note` | Inline `^[note]` also works. |
| Emoji | `:joy:` | Full shortcode set; ASCII emoticons are not converted. |
| Unordered list | `- item` | `*` and `+` also work. |
| Decimal ordered list | `1. item` | `1)` also works. |
| Alphabetical ordered list | `a. item` or `A. item` | Start value and case come from the first marker. |
| Roman ordered list | `i. item` or `I. item` | Canonical Roman numerals, such as `iv.` or `XIV.`. |
| Task list | `- [ ] todo` or `- [x] done` | Shorthand `-[]` is accepted; click to toggle in Live mode. |
| Definition list | `Term` then `: Definition` | One or more definitions. |
| Blockquote | `> quote` | Nest with `> >`. |
| GFM table | Header row, delimiter row, then body rows | Pipe table; alignment supported. |
| Horizontal rule | `---` | Also `***` or `___` (three or more). |
| Raw HTML | `<kbd>Ctrl</kbd>` | Sanitized on every render. |
| Subtext | `-# note` | Notedown extension; quiet secondary paragraph. |
| Spoiler | `\|\|text\|\|` | Notedown extension; click to reveal. |
| Dropdown | `>>> Title` … `>>>` | Notedown extension; collapsible block with inner Markdown. |
| Graph | `%% pie "Title" (A, 1) %%` | Notedown extension; pie, bar, or line, pure CSS. |

> **Bold versus underline:** `**text**` is bold and `__text__` is underline. This is deliberate, but it differs from CommonMark and GFM, where `__text__` is bold. A document shared with another renderer will usually show `__text__` as bold. Prefer `**` for bold everywhere.

## 3. Block syntax

### 3.1 Paragraphs and line breaks

A paragraph is a run of text separated from other blocks by blank lines. Because Notedown treats a single newline as a hard break, this:

```text
First line
Second line
```

renders as two lines with a line break between them. A blank line starts a new paragraph:

```text
First paragraph.

Second paragraph.
```

A trailing backslash or two trailing spaces also produce a line break. Documents may use LF or CRLF line endings.

### 3.2 Headings

ATX headings use one to six `#` characters followed by a space:

```markdown
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
```

An optional closing sequence of hashes is allowed: `## Heading ##`.

Setext headings also parse:

```text
Title
=====

Section
-------
```

The first is a level-1 heading and the second is a level-2 heading. ATX headings are the canonical form and are what the editor commands produce. Because `---` directly under text is a Setext underline, put a blank line before a horizontal rule.

#### Heading IDs

Append an attribute list with a space before it:

```markdown
# Release notes {#release-notes}

## Download {#download}
```

The `{#release-notes}` suffix sets the HTML `id` and does not appear in the rendered heading. Use a unique, ordinary slug. In Live mode the suffix is hidden while the caret is elsewhere on the heading; on the heading's active line it is revealed for editing.

Notedown does not generate automatic slug IDs for headings. Only IDs you write with `{#...}` appear in exported HTML. The final HTML is sanitized, so unsafe attribute content is removed. Other renderers, including GitHub, do not understand this suffix and may display it literally.

General attribute lists are covered in [Attributes](#45-attributes).

### 3.3 Blockquotes

Start a line with `>`:

```markdown
> A quote can span
> more than one line.
>
> - It can contain lists.
> - It can contain **formatting**.
```

Nest blockquotes with additional markers:

```markdown
> Outer quote
> > Inner quote
```

CommonMark lazy continuation works: a following line without `>` stays inside the quote while it is a paragraph continuation.

```markdown
> The first line
continues without a marker
```

For clarity and predictable formatting, prefix every quoted line with `>`.

### 3.4 Lists

List markers must appear at the start of a line, after optional indentation. Indent nested items under their parent; two to four spaces works for ordinary markers. Keep the marker style consistent within a list.

#### Unordered lists

```markdown
- First item
- Second item
  - Nested item
  - Another nested item
- Third item
```

`-`, `*`, and `+` are all valid bullets. In rendered HTML, nested bullet glyphs alternate automatically: the first level uses a disc, the next uses a circle, then a disc again.

Continuation text and nested blocks are indented under the list item:

```markdown
- First item

  A second paragraph inside the same item.

- Second item
```

#### Task lists

Use a checkbox after the bullet:

```markdown
- [ ] Draft the announcement
- [x] Review the copy
- [X] Publish
```

Notedown also accepts shorthand spellings:

```markdown
- [] Unchecked shorthand
-[] Also unchecked
-[ ] Still unchecked
- [ ] Standard form
```

All of these render as task items. The shorthand is accepted with `-`, `*`, or `+`, with or without a space between the bullet and the bracket; the bracket must be followed by a space or the end of the line. The renderer normalizes the spelling for display; the source keeps what you typed.

In Live mode, click a task marker to toggle between unchecked and checked. Task markers inside fenced code are literal and are not toggled.

#### Ordered lists

Decimal ordered lists use digits followed by `.` or `)`:

```markdown
1. First
2. Second
3. Third
```

Alphabetical lists use letters:

```markdown
A. First
B. Second
C. Third
```

Roman lists use Roman numerals:

```markdown
i. First
ii. Second
iii. Third
```

Notedown recognizes the following marker rules:

- A marker must be followed by a space or tab.
- Both `.` and `)` delimiters work. Use one delimiter per list; switching delimiters starts a new list.
- A single `i` or `I` is Roman. Every other single letter is alphabetical, including `c`, `d`, `l`, `m`, `v`, and `x`.
- Multi-letter markers must be canonical Roman numerals from 1 to 100. `ii.`, `iv.`, and `XIV.` are lists; `civil.`, `dim.`, `mix.`, and `iiii.` are ordinary text.
- For a top-level ordered list, the first marker sets the start value and case. Later markers advance sequentially; the exact values you type on later items do not override the sequence.
- Alphabetical labels roll over from `z` to `aa`. Roman labels use standard subtractive numerals.
- A nested ordered list restarts at `1`, `a`, or `i`, even if you typed a different first value.

**Nested indicator cycle.** Ordered indicators cycle decimal → alphabetical → Roman by nesting depth. With a decimal top level:

```markdown
1. Prepare
   a. Collect assets
      i. Screenshots
      ii. Copy
   b. Review
2. Publish
```

Depth 1 is decimal, depth 2 is alphabetical, and depth 3 is Roman. Depth 4 would return to decimal. Each nested list restarts its own sequence.

An explicit alphabetical or Roman first marker chooses the style for the top-level list only. Deeper levels continue the cycle from the nearest enclosing ordered list. For example, an `a.` top level makes its first nested level Roman (`i.`, `ii.`), and an `i.` top level makes its first nested level decimal (`1.`, `2.`).

The cycle counts total list nesting depth, including bullet levels. A decimal-marker ordered list directly inside a top-level bullet list is at depth 2, so it starts with alphabetical labels.

Pressing Enter in a list item continues the same style, case, and delimiter: `a.` becomes `b.`, `I)` becomes `II)`, and `iv.` becomes `v.`. Pressing Enter on an empty item removes its marker and exits the list. This is an editor behavior; the source is unchanged by the display cycle.

#### Definition lists

Put a term on one line and one or more definitions on the following lines, each beginning with `:`:

```markdown
Launch
: The moment the page becomes public.
: Also the internal project name.
```

Inline formatting works in both the term and the definition:

```markdown
**Release**
: The build that is published to users.
: *Also* used for the announcement.
```

Keep the first definition adjacent to its term. A blank line between the term and the definition is tolerated but makes the list loose. Continuation blocks inside a definition are indented under the definition marker.

### 3.5 Code blocks

Fenced code uses three or more backticks or tildes. The closing fence must use the same character and must be at least as long as the opening fence:

````markdown
```javascript
const answer = 42
console.log(answer)
```
````

The first word of the info string selects the language. Content inside the fence is literal: task-list shorthand, extended ordered markers, spoilers, dropdown markers, and graph tags are not interpreted. Fenced code also protects these markers when they appear inside a code sample.

To show a code fence inside a code block, use a longer outer fence. For example, wrap a three-backtick sample in a four-backtick fence.

Indented code blocks also work: indent every line by four spaces or a tab. They render as code but are not syntax-highlighted. However, Notedown's spoiler, graph, and dropdown preprocessors run before block parsing and do not skip indented lines. An indented `||...||` or `%%...%%` line is rewritten into escaped markup inside the code block, and an indented `>>>` pair can become a dropdown. Use fenced code for any sample that contains these markers; fenced code is reliably protected.

**Highlighted languages.** The renderer registers these languages, with common aliases:

- `markdown` (`md`, `mkd`)
- `javascript` (`js`)
- `typescript` (`ts`)
- `python` (`py`)
- `bash` (`sh`, `zsh`)
- `json`
- `yaml` (`yml`)
- `html` / `xml`
- `css`
- `rust` (`rs`)
- `sql`
- `plaintext` (`text`, `txt`)

An unknown language, or no language, produces a plain code block with escaped text. In Live mode and in exported HTML, code blocks have a copy button.

### 3.6 Horizontal rules

A horizontal rule is a line containing three or more `-`, `*`, or `_` characters, optionally separated by spaces:

```markdown
---

***

___
```

The line must contain only the rule characters and spaces. Keep a blank line before `---` when the previous block is a paragraph, otherwise it is read as a Setext heading underline. In Live mode, an inactive rule line renders as a horizontal rule widget.

### 3.7 Tables

#### GFM pipe tables

A pipe table has a header row, a delimiter row, and optional body rows:

```markdown
| Item   | Owner | Status      |
| :----- | :---: | ----------: |
| Copy   | Ana   | Done        |
| Design | Ben   | In progress |
```

- The header row is required.
- The delimiter row must have the same number of cells as the header row. Each delimiter cell contains one or more dashes; a leading colon aligns left, a trailing colon aligns right, and both align center.
- Body rows are optional. Rows are normalized to the header's column count: short rows are padded with empty cells, and extra cells are ignored.
- Inline Markdown works inside cells.
- To put a line break inside a cell, use `<br>`.
- Escape a literal pipe as `\|`. In the HTML rendering path, a pipe inside a code span or an HTML tag still splits a GFM cell, so escape it there too. The Live table widget and the RTF/DOCX/PDF table converters additionally protect pipes inside backtick code spans and HTML tag spans, but `\|` is the only portable spelling.

Pipes in table rows have one special interaction with spoilers: a line that begins with a single `|` is treated as table-like and is skipped by spoiler pairing, and the pipe characters collide with cell separators. Do not write `||text||` inside a pipe-table row. Move the spoiler outside the table, or use raw HTML in HTML output:

```html
<span class="md-spoiler" data-revealed="false">hidden text</span>
```

The raw span is an HTML-output fallback; Live mode does not attach the spoiler click behavior to it.

#### Nested tables

Put a single-line HTML `<table>...</table>` inside a GFM cell. The outer table stays GFM and the inner table renders as a real sub-grid:

```markdown
| Region | Quarterly numbers |
| ------ | ----------------- |
| North  | <table><tr><td>Q1</td><td>120</td></tr><tr><td>Q2</td><td>150</td></tr></table> |
```

The inner table must be on one line because a GFM row is one line. This nested form survives HTML export; DOCX, RTF, and PDF export flatten the inner table's content to text.

#### Raw HTML tables

Multi-line HTML tables are also supported:

```html
<table>
  <thead>
    <tr><th>Phase</th><th>Owner</th></tr>
  </thead>
  <tbody>
    <tr><td>Launch</td><td>Ana</td></tr>
    <tr><td>Follow-up</td><td>Ben</td></tr>
  </tbody>
</table>
```

The Table command opens a builder that writes HTML tables. Each row can be marked as a header row, and cells may contain balanced nested tables. When editing, the builder can read either a GFM pipe table or an HTML table, but it always inserts HTML. Inside a raw HTML table, use HTML for formatting; Markdown inside block-level HTML is not parsed.

Raw HTML tables are covered further in [Raw HTML](#38-raw-html).

### 3.8 Raw HTML

Raw HTML is enabled. Inline HTML can sit in a paragraph:

```markdown
Press <kbd>Ctrl</kbd> + <kbd>B</kbd> for **bold**.
```

Block-level HTML also passes through:

```html
<div class="note">
  <p>This is raw HTML. <strong>This formatting is HTML, not Markdown.</strong></p>
</div>
```

Every rendered output is sanitized with DOMPurify before it is displayed or exported. Scripts, event-handler attributes such as `onclick`, and dangerous URLs are removed. Safe structural and formatting tags, `class`, `id`, and `data-*` attributes generally survive. Markdown inside a block-level HTML element is not parsed, so write the inner structure in HTML when you need block formatting.

Use raw HTML for advanced tables, captions, and layout that pipe-table syntax cannot express. Do not rely on scripts; they are removed. Raw HTML tables get an editable table widget in Live mode; other raw HTML remains part of the editable source.

### 3.9 Footnotes

A footnote has an inline reference and a block definition:

```markdown
Notedown supports footnotes.[^1] A named note can be reused.[^design]

[^1]: The first note.
[^design]: A longer note.

    A second paragraph, indented four spaces, is part of the same note.
```

Rules and behavior:

- Footnote labels are short identifiers. They cannot contain spaces.
- Numbering follows the order of first reference, not the order of definitions.
- Repeated references to the same label share one footnote and produce backlinks.
- A reference with no matching definition stays literal.
- Definitions are collected in a footnotes section at the end of the rendered document.
- Continuation paragraphs and other blocks inside a definition are indented four spaces. Separate a continuation paragraph from the first one with a blank line.

An inline footnote needs no definition:

```markdown
This is an inline note.^[Added during review.]
```

Inline footnote text may contain spaces. Footnotes render as linked notes in HTML. PDF, DOCX, and RTF keep the reference markers and definitions as literal text, which preserves them for round-tripping; see [Export and import fidelity](#7-export-and-import-fidelity).

### 3.10 Subtext

Start a paragraph with `-# ` to make it quiet secondary text:

```markdown
-# Draft copy; replace before publishing.
```

Inline formatting works inside it:

```markdown
-# *Optional* wording; remove before the final export.
```

The marker must begin a paragraph. If the previous line is ordinary paragraph text, `-#` is just part of that paragraph; put a blank line before it. In Live mode the marker is hidden on inactive lines and the rest is styled as subtext. `-#` with no content is an empty paragraph, not a subtext paragraph.

Use subtext for caveats under checklist items, fine print, and secondary notes.

## 4. Inline syntax

### 4.1 Emphasis and decorations

| Markup | Result |
| --- | --- |
| `**bold**` | Bold |
| `*italic*` or `_italic_` | Italic |
| `__underline__` | Underline |
| `~~strikethrough~~` | Strikethrough |
| `==highlight==` | Highlight |
| `~subscript~` | Subscript |
| `^superscript^` | Superscript |

Exactly two asterisks make bold. Exactly two underscores make underline; a single asterisk or underscore makes italic. The underline form is a Notedown extension: Notedown takes the CommonMark `__...__` strong form and renders it as `<u>` instead of `<strong>`. `**...**` remains bold.

Subscript and superscript content cannot contain unescaped spaces. Escape a space with a backslash if you need one inside the markup.

Decorations nest where their delimiters allow it:

```markdown
**Bold with *italic* inside**

==Highlight with **bold** inside==

||A spoiler with *italic* and **bold** inside||

H~2~O and x^2^
```

A code span or fenced code block wins over every inline extension. Content inside code stays literal.

### 4.2 Spoilers

Wrap text in `||` to hide it behind a censored cover:

```markdown
The visible text. ||The hidden text.||
```

Click the cover in Live mode or in exported HTML to reveal the text. Pairing follows these rules:

- `||` runs are paired in order on a single line: the first opens, the second closes, the third opens again, and so on. An unpaired run at the end stays literal.
- An empty pair, `||||`, stays literal.
- The content is parsed as Markdown. `||*italic* and **bold**||` keeps its formatting.
- Spoilers are protected inside inline code and fenced code. A code span such as `` `||text||` `` displays the delimiters literally.
- Pairing never crosses a line break or a blank line. The opener and closer must be on the same line.
- A line that begins with a single `|` is treated as a table row and skipped, so `||text||` does not work inside a pipe-table row. A line that begins with `||` at the very start is still processed; only a single leading pipe is skipped.
- Spoilers do not nest.

A spoiler is not a security boundary. The text is present in the document and in every export. Printing, PDF, DOCX, and RTF output reveal it. Use it for casual concealment, not secrets.

In exported HTML, spoilers start hidden and a small script toggles them on click. In PDF, DOCX, and RTF, the text is revealed.

### 4.3 Code, links, and images

#### Inline code

Wrap code in backticks:

```markdown
Use `npm run build` to build the app.
```

If the code contains a backtick, use a longer run of backticks around it. Content inside the backticks is literal: formatting, links, spoilers, and other extensions are not interpreted.

#### Links

Inline links use this form:

```markdown
[Notedown](https://github.com/CodeCody93/Notedown "Notedown on GitHub")
```

The title is optional. Reference links and definitions also work:

```markdown
Read the [guide][docs] and the [README][].

[docs]: https://example.com/docs "Documentation"
[readme]: ../README.md
```

Reference definitions need their own block. If a definition directly follows a paragraph line, put a blank line before it; otherwise both lines stay part of the paragraph.

Angle-bracket autolinks work:

```markdown
<https://example.com>
```

Bare URLs are not automatically linked. Use an angle-bracket autolink or a normal link.

In HTML output, link titles become tooltips. The rendered HTML is sanitized, so dangerous URL schemes are removed.

#### Images

Inline and reference images use the same forms with a leading `!`:

```markdown
![Launch diagram](diagram.png "Launch diagram")

![Launch diagram][diagram]

[diagram]: diagram.png "Launch diagram"
```

The alt text is shown if the image cannot load and is used by screen readers.

Platform notes:

- **Desktop:** Relative and local image paths resolve against the document's folder. Pasting an image writes an image file next to the document.
- **Web and embedded editor:** There is no document folder. Use remote `https:` images or inline `data:` images. Pasted images are embedded as `data:` URLs capped at about 2 MB each.
- **SVG:** Inline SVG `data:` URLs are accepted for rendering. On desktop, HTML export embeds local raster images and sanitized SVGs as `data:` URLs; PDF export embeds only PNG and JPG and falls back to alt text for other image types.
- **Export:** Remote and absolute-path image sources are left as external references and are not embedded in HTML export.

In Live mode, an image is replaced by a rendered image widget when the caret is elsewhere on the line.

### 4.4 Emoji

Use a shortcode:

```markdown
Ship it :rocket: and celebrate :joy:
```

The full emoji shortcode set is available. Unknown shortcodes stay literal.

ASCII emoticons are intentionally not converted. `:D`, `:)`, and `<3` remain exactly as typed, even in contexts where other Markdown tools would turn them into emoji. The emoji picker inserts the Unicode character itself; shortcodes are for typing.

Emoji may not survive PDF export because the embedded fonts have a limited character set. This is documented in [Export and import fidelity](#7-export-and-import-fidelity).

### 4.5 Attributes

A trailing attribute list sets HTML attributes. Heading IDs are the most common form:

```markdown
# Release notes {#release-notes}

## Appendix {.appendix}

A lead paragraph {.lead}

*Important*{.urgent}
```

- `{#name}` sets an `id`.
- `{.name}` adds a class.
- `key=value` sets an attribute.

For a block element such as a heading or paragraph, put a space before the attribute list. For an inline element, attach the list directly after the closing delimiter, as in `*Important*{.urgent}`.

Attribute lists are parsed on headings, paragraphs, list items, links, images, emphasis, code spans, and fenced code blocks. Support varies by construct, so check the result if an attribute is essential. Everything is still sanitized: event handlers and unsafe attributes are removed, and some attributes do not survive. `id` and `class` are the dependable ones.

Heading IDs are hidden on inactive heading lines in Live mode. General attribute lists are not interpreted by most other Markdown renderers; they may appear literally or be stripped.

### 4.6 Nesting and escaping

Inline decorations can be combined where their delimiters do not conflict:

```markdown
**Bold with ==highlight== and ~subscript~**

==Highlight with **bold** and *italic*==

||Spoiler with a [link](https://example.com)||
```

A code span or fenced code block always wins. Use code to demonstrate syntax literally:

```markdown
Type `**text**` for bold and `||text||` for a spoiler.
```

Backslash escapes work for ordinary Markdown punctuation, such as `\*`, `\_`, and `\[`. Because `||` and `%%` are preprocessed before ordinary inline parsing, a backslash is not a reliable way to disable them; use a code span instead. For line-leading markers such as `>>>`, use a fenced code block.

## 5. Notedown block extensions

Subtext is covered in [Subtext](#310-subtext). This section covers the two block-level constructions with their own syntax: dropdowns and graphs.

### 5.1 Dropdowns

A dropdown is a collapsible block. Open it with a line beginning with `>>>`, optionally followed by a title, and close it with a `>>>` line on its own:

```markdown
>>> Release checklist

- Confirm staging
- Notify support
- Publish the announcement

>>>
```

The content between the markers is parsed as normal Markdown, including lists, tables, code blocks, footnotes, spoilers, and graphs. The title is plain text, not inline Markdown.

- The opening line may have leading whitespace, but `>>>` must be the first non-space characters on the line.
- The closing line is `>>>` on its own line.
- Code fences protect `>>>` lines inside code samples.
- Dropdowns do not nest. A second `>>>` line closes the current block.
- An unclosed dropdown is not converted. Its markers fall through to ordinary Markdown, where they usually read as a nested blockquote.

In HTML, a dropdown renders as a `<details>` element with an open `<summary>`:

```html
<details class="md-dropdown" open>
  <summary class="md-dropdown-summary">Release checklist</summary>
  ...
</details>
```

The generated HTML starts expanded; the reader can collapse it. In Live mode, the whole block becomes a collapsible card that starts collapsed, and clicking the body enters source editing. Print, PDF, DOCX, and RTF render the title and body as static content.

### 5.2 Graphs

Graphs are single-line `%% ... %%` tags rendered as pure-CSS figures. Put each tag on its own line. The tag must be complete on one line; an unclosed `%%` stays literal.

General rules:

- The first word is the type: `pie`, `bar`, or `line` (case-insensitive).
- Labels and titles are quoted strings. A quoted string may contain spaces, commas, and parentheses. Inside quotes, `\"` produces a quote and `\\` produces a backslash.
- Bare labels are allowed when they contain no spaces, commas, parentheses, or quotes.
- Values must be finite numbers. Decimals and negative numbers are allowed.
- Commas separate items and parentheses group data points.
- Graph tags inside code spans or fenced code are literal.

#### Pie

```markdown
%% pie "Where time goes" (Writing, 40) (Review, 35) (Polish, 25) %%
```

- Each point is `(label, value)`. At least one point is required.
- Header labels work like this:
  - One label: the title.
  - Two labels: x-axis label and y-axis label, with no title.
  - Three labels: title, x-axis label, y-axis label.
- Negative slice values are clamped to 0 for the slice geometry. The legend still shows the value you wrote.
- The total of the clamped values must be greater than 0. A pie whose values add up to zero or less is an error.
- Pie has no y-axis range, so `min` and `max` do not affect slice geometry.

#### Bar

```markdown
%% bar "Sales 2024" Units min 0 max 500 (Jan, 120) (Feb, 200) %%
```

- Each point is exactly `(label, value)`. At least one point is required.
- The header takes at most two labels: the title, then the y-axis label. There is no x-axis label parameter for bars; point labels form the x-axis.
- Optional `min N` and `max M` bounds may appear in the header, in any order.
- `min` and `max` are case-insensitive bare keywords. Quote them (`"min"`) to use them as ordinary labels.
- When both bounds are given, `min` must be less than `max`.

#### Line

```markdown
%% line "Traffic" (Week, Mon, Tue) (Hits, 0, 200) (SiteA, 120, 200) (SiteB, 150, 180) %%
```

A line graph uses groups rather than bare header labels:

1. **Optional title.** One quoted or bare token before the first group.
2. **X group.** `(Xname, x1, x2, ...)` names the x-axis and its positions. When the group names positions, at least two are required. An axis-only `(Xname)` group auto-labels the slots `1`, `2`, `3`, and so on from the series length.
3. **Y group.** `(Yname[, min][, max])` names the y-axis and optionally sets bounds. A single number is the maximum; the minimum auto-scales. When both bounds are given, `min` must be less than `max`.
4. **Series groups.** One or more `(Name, v1, v2, ...)` groups. Every series supplies exactly one value per x position. Duplicate series names are an error.

Examples of the flexible parts:

```markdown
%% line (Weekday) (Hits) (SiteA, 50, 120) %%

%% line "Signups" (Day, Mon, Tue) (Signups, 100) (Web, 40, 70) (Mobile, 20, 45) %%
```

The first uses an axis-only X group, so the slots are labeled `1` and `2`. The second uses a lone Y number (`100`), which is the maximum; the minimum auto-scales.

The renderer groups points by series and leaves a gap wherever a series has no value for an x position. It never draws a segment across a missing slot. In source syntax every series is complete, so gaps mainly matter for imported or hand-edited graph data.

#### Scale and range

- For bar and line graphs, explicit `min` and `max` win. One explicit bound leaves the other automatic.
- Without explicit bounds, the range is from `min(0, smallest value)` to the largest value. All-positive data therefore starts at 0.
- Bars render as true percentages of the plot height.
- Pie geometry uses the clamped slice values.

#### Errors

An invalid graph tag renders an inline error box that names the problem and shows the original tag. The source is preserved. Common causes include:

- an unknown type or no data points;
- an unterminated string or parenthesis;
- the wrong tuple size (pie and bar need exactly `(label, value)`);
- a non-finite value;
- too many header labels (bar allows at most 2, pie at most 3);
- `min` greater than or equal to `max`;
- a pie total of zero or less;
- a missing line group, a series with the wrong number of values, a duplicate series name, or fewer than two x positions.

An unclosed `%%` or an empty `%% %%` stays literal rather than producing an error box.

#### Rendering and export

Graphs are pure CSS and contain no JavaScript. The figure chrome, axes, and text follow the app theme, including dark mode; data series use a fixed HSL palette.

- **Live mode:** a graph renders as a figure when the caret is elsewhere; the raw tag is shown while editing.
- **HTML export:** the full figure is preserved, including its title, axes, legend, and a hidden data table. The figure carries a `data-graph` attribute with the graph data.
- **TXT export:** the raw tag source is kept.
- **PDF, DOCX, and RTF export:** the graph flattens to text such as `Sales (bar): Jan=120, Feb=200`. Line graphs group by series, for example `Traffic (line): SiteA: Mon=120, Tue=200; SiteB: Mon=150, Tue=180`.
- **HTML import:** the tag is restored from `data-graph`.

The Graph command opens a builder for pie, bar, and line charts and inserts the generated tag at the caret.

## 6. Rendering and editor behavior

Notedown has two editing modes:

- **Live mode** renders the document as you edit. Syntax is hidden when the caret is outside a construct and revealed when the caret enters it for editing.
- **Source mode** shows the raw Markdown with syntax highlighting. Nothing is hidden.

Both modes use the same Markdown parser and dialect. Live mode adds widgets and collapses syntax; source mode shows raw text. Rendering is intended to match HTML export, with a few editor-only conveniences noted below.

In Live mode:

- Block syntax (heading marks, list markers, blockquote markers, table pipes, definition colons) is revealed on the caret's line and hidden on other lines.
- Inline syntax is hidden on inactive lines and revealed inside the construct.
- Images, links, footnote references, task checkboxes, GFM tables, raw HTML tables, code blocks, horizontal rules, spoilers, dropdowns, and graphs become interactive widgets when the caret is elsewhere.
- Task checkboxes toggle when clicked.
- Heading ID suffixes are hidden on inactive heading lines.
- Subscript, superscript, and highlight markers are hidden on inactive lines.
- GFM tables render as a grid; clicking a cell enters source editing. Raw HTML tables get an Edit table control.

Raw HTML is enabled, so every rendered output is sanitized with DOMPurify before it reaches the screen or an export. This is not optional and cannot be disabled. The sanitizer removes scripts, event handlers, and dangerous URLs, and it may remove unsupported attributes.

## 7. Export and import fidelity

### 7.1 Format summary

| Format | What is preserved | What is flattened or lost |
| --- | --- | --- |
| TXT | Verbatim Markdown source. | No rendering; every marker stays as typed. |
| HTML | Full Notedown dialect, sanitized. Self-contained theme and stylesheet, code-copy buttons, spoiler reveal, dropdowns, graphs, and nested tables. Local raster images and sanitized SVGs are embedded as `data:` URLs on desktop. | Remote and absolute-path images are left linked, not embedded. The file follows the system light/dark preference. |
| PDF | Selectable text (not an image). Bordered tables. Local PNG and JPG images. | Tasks become ASCII `- [ ]` and `- [x]` markers. Graphs flatten to text, and footnote references/definitions stay literal. SVG, remote, and unreadable images fall back to alt text. Emoji and CJK may degrade because only Helvetica and Courier (WinAnsi) fonts are used. Layout and pagination are minimal. |
| DOCX / RTF | Headings, bold, italic, lists, code, and basic tables. Underline stays visually underlined. | Tables flatten to pipe-separated text lines with a `---` separator after the header. Images are dropped (alt text kept). Underline reimports as plain text. Spoilers are revealed. Dropdowns expand statically. Tasks become ☐ and ☒ literals. Footnotes, subtext, and definition lists flatten to literal text. Graphs flatten to text. Exact fonts, colors, spacing, and page layout are lost. |

The HTML export is sanitized with the same rules as Live mode. It has no external stylesheet or script dependencies; a small inline script handles code copying and spoiler reveal.

### 7.2 Import

- **Markdown and TXT** import as source text.
- **HTML** import converts back to Notedown Markdown and restores spoilers, dropdowns, subtext, definition lists, task items, footnotes, underline, graph data, and nested tables where the HTML can represent them.
- **DOCX, PDF, and RTF** import is best-effort. Complex layouts, embedded objects, and some formatting may be simplified or dropped.

### 7.3 Portability

Notedown documents are plain UTF-8 text, but the extensions are not portable to arbitrary Markdown tools. When a document leaves Notedown:

- `**bold**`, `*italic*`, links, images, blockquotes, code, GFM tables, strikethrough, and task lists generally work in GFM-aware renderers such as GitHub.
- `__underline__` is the biggest surprise: other renderers treat it as bold. GitHub does too.
- `==highlight==`, `~subscript~`, `^superscript^`, `||spoiler||`, `-# subtext`, `>>>` dropdowns, `%%` graphs, and `{#heading-id}` suffixes may appear literally or be interpreted differently.
- Footnotes work in some renderers but not all.
- A `>>>` dropdown marker can read as a blockquote in another renderer.
- `%%` graph tags are plain text outside Notedown.

If a document will be read widely, keep a CommonMark/GFM-only copy, or avoid the extensions in the shared version.

## 8. Complete example

The following document uses the major features in this standard. The outer four-backtick fence is only there to show the sample as source.

````markdown
# Product launch notes {#launch-notes}

A note with **bold**, *italic*, __underline__, ~~strikethrough~~, ==highlight==, H~2~O, x^2^, :rocket:, and a [link](https://example.com "Example site").

![Launch diagram](diagram.png "Launch diagram")

Footnotes work too[^plan], including inline notes^[Added during review.].

## Checklist

- [ ] Draft the announcement
-[] Add screenshots
- [x] Book the venue

## Plan

1. Prepare
   a. Collect assets
      i. Screenshots
      ii. Copy
   b. Review
2. Publish

## Terms

Launch
: The moment the page becomes public.
: Also the internal project name.

> A short quote
> that spans two lines.

| Item   | Owner | Status      |
| :----- | :---: | ----------: |
| Copy   | Ana   | Done        |
| Design | Ben   | In progress |

<table>
  <caption>Release owners</caption>
  <tr><th>Phase</th><th>Owner</th></tr>
  <tr><td>Launch</td><td>Ana</td></tr>
  <tr><td>Follow-up</td><td>Ben</td></tr>
</table>

-# Use the checklist before every release.

||The hidden line stays covered until clicked.||

>>> Release checklist

- Confirm staging
- Notify support

>>>

%% pie "Where time goes" (Writing, 40) (Review, 35) (Polish, 25) %%

%% bar "Visits by day" Visits min 0 (Mon, 120) (Tue, 200) (Wed, 160) %%

%% line "Signups" (Day, Mon, Tue, Wed) (Signups, 0, 100) (Web, 40, 70, 95) (Mobile, 20, 45, 60) %%

---

```bash
npm run build
```

[^plan]: The plan was reviewed on Monday.

    A second, indented paragraph continues the note.
````

Paste the sample into Notedown and switch to Live mode to see the rendered result.

## 9. Versioning and feedback

This is version 1.0 of the Notedown Standard, describing Notedown 0.7.0 in November 2026.

The syntax is intended to be additive: future versions may add features. Any change that affects how existing syntax renders will be called out in the release notes.

Report bugs, ambiguities, or documentation corrections at the GitHub repository:

<https://github.com/CodeCody93/Notedown/issues>

Notedown is MIT-licensed. See the [README](../README.md) and [LICENSE](../LICENSE) for the project overview and license text. The in-app Help guide lists every formatting command and its keyboard shortcut.
