# Graph samples (manual QA fixture)

Pie with a title:

%% pie "Fruit share" (Apples, 30) (Bananas, 45) (Cherries, 25) (Oranges, 15) (Kiwis, 20) ("Dragon fruit", 25) %%




Bar with quoted labels (space, comma, parens) + min/max:

%% bar "Sales 2024" Units min 0 max 500 ("New York", 120) ("San Francisco, CA", 200) ("Q1 (est)", 90) %%




Line with title + axis labels (two series; pairs take auto x slots 1, 2, …):

%% line "Profits per weekday per site" (Weekday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday) (Income, 0, 1000) (SiteA, 50, 120, 60, 60,800,60,700) (SiteB, 120, 60, 60, 800, 60, 700, 450) %%





Error example (unknown type renders a source-preserving error block):

%% scatter (A, 1) (B, 2) %%

Code-fence counter-example (stays literal text, never a chart):

```md
%% bar (Jan, 120) (Feb, 200) %%
```
