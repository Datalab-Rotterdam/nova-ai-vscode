---
name: nova-review
description: Review the current changes or selection for bugs, risks and simplifications.
---
Review the code I point to (the selection, the attached files, or otherwise the uncommitted changes in the workspace).

Focus on, in order:
1. Correctness bugs: wrong logic, unhandled edge cases, broken error handling, race conditions.
2. Security issues: injection, secrets, unsafe input handling.
3. Simplifications and reuse of existing helpers.

For each finding give the file and line, what is wrong, a concrete failure scenario, and a suggested fix. Skip style nits. If nothing is wrong, say so.
