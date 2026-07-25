# Umbrel Monorepo Agent Guide

## Skills

- Before starting work, check `.agents/skills/` for any skill relevant to the task. If a skill matches the work, read its `SKILL.md` and follow it.

## Worktrees

- Start every new piece of work in its own git worktree under `worktrees/`, named after the branch it holds:

  ```sh
  git worktree add worktrees/<branch> -b <branch> origin/staging
  ```

- Don't work directly in the root checkout, and don't create worktrees anywhere else. One branch, one worktree, matching names, all in `worktrees/`.
- There's nothing to set up: `git worktree add` creates `worktrees/` if it's missing, and the directory is gitignored, so nothing inside it is ever committed.
- Remove the worktree once its branch is merged:

  ```sh
  git worktree remove worktrees/<branch>
  ```
