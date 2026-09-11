# Graph sample (manual QA fixture)

Pie with a title:

%% pie "Fruit share" (Apples, 30) (Bananas, 45) (Cherries, 25) (Oranges, 15) (Kiwis, 20) ("Dragon fruit", 25) %%













Bar with quoted labels (space, comma, parens) + min/max:

%% bar "Sales 2024" Month Units min 0 max 500 ("New York", 120) ("San Francisco, CA", 200) ("Q1 (est)", 90) %%






Line with axis labels:

%% line Week Hits (Mon, 120) (Tue, 200) (Wed, 160) %%





Error example (unknown type renders a source-preserving error block):

%% scatter (A, 1) (B, 2) %%

Code-fence counter-example (stays literal text, never a chart):

```md
%% bar (Jan, 120) (Feb, 200) %%
```
