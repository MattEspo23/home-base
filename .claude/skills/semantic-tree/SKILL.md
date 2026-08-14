---
name: semantic-tree
description: Turn a broad or tangled topic into a structured decision map that connects questions, evidence, assumptions, and next actions. Use when an idea feels larger than the first answer, several concerns are mixed together, or the user needs to see what actually changes the decision before choosing a direction.
---

# Semantic Tree

Build a navigable tree before collapsing a complex subject into an answer.

## Workflow

1. Restate the central question in one sentence. If several questions are
   hiding inside it, name them and ask which one owns the tree.
2. Create only branches that can change the answer. Prefer a few meaningful
   dimensions over an exhaustive taxonomy.
3. Attach evidence, constraints, assumptions, and unresolved questions to the
   branch they affect. Mark which claims are observed, inferred, or unknown.
4. Show important relationships between branches. Call out dependencies,
   conflicts, and decisions that unlock several downstream choices.
5. Collapse the tree into the next three decisions or actions. Explain why
   those three have the highest leverage.

## Output

Return:

- the central question;
- a compact tree in Markdown or Mermaid when a visual materially helps;
- the evidence and uncertainty attached to each decision-changing branch;
- the three highest-leverage next decisions or actions;
- what should be verified before acting.

Keep the tree editable. Do not turn every note into a permanent branch and do
not hide uncertainty behind a polished diagram.
