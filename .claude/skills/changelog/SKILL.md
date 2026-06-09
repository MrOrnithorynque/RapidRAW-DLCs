---
name: changelog
description: Use this skill to record a notable RapidRAW change (new feature, meaningful improvement, or user-visible bug fix) in the release notes. RapidRAW has NO docs/changelog dir and NO CHANGELOG.md — release notes live as AppStream `<release>` entries in data/io.github.CyberTimon.RapidRAW.metainfo.xml (mirrored to GitHub Releases). Trigger after completing a user-facing change, or when the user says "add this to the changelog", "log this change", "write a changelog entry", "release notes", or "changelog".
---

# Changelog / Release Notes

RapidRAW does **not** use per-change changelog files or a `CHANGELOG.md`. The canonical changelog is the AppStream metainfo's `<releases>` list in [data/io.github.CyberTimon.RapidRAW.metainfo.xml](data/io.github.CyberTimon.RapidRAW.metainfo.xml). Each app release (e.g. `v1.5.7`) is one `<release>` block, and the same text is published as the GitHub Release notes. Flathub renders these notes, so the file must stay valid AppStream XML.

## When to record an entry

Record when a change is **user-visible**: a new feature/tool, a meaningful performance or quality improvement, or a fixed bug a user would have noticed. Skip internal-only refactors, comment/typo fixes, and WIP.

## Where it goes

Append a `<li>` to the **top-most `<release>` block** (the in-development version). If the version was just bumped for a new release, add a fresh `<release>` block at the top of `<releases>`. Two groups are used:

- `<p>New Features</p>` — new capabilities.
- `<p>Core Improvements</p>` — optimizations, refinements, and bug fixes (bug fixes are folded in here).

## Format (match the existing entries exactly)

```xml
<release version="v1.5.8" date="2026-06-09">
    <url type="details">https://github.com/CyberTimon/RapidRAW/releases/tag/v1.5.8</url>
    <description translate="no">
        <p>New Features</p>
        <ul>
            <li>One-sentence, user-facing description of the feature. Written in plain prose, the author's first-person voice ("I added…", "RapidRAW now…").</li>
        </ul>
        <p>Core Improvements</p>
        <ul>
            <li>One-sentence description of the improvement or fix.</li>
        </ul>
    </description>
</release>
```

Rules:
- `version` is `vMAJOR.MINOR.PATCH`; `date` is `YYYY-MM-DD` (today's date for a same-day entry).
- Escape XML entities (`&amp;`, `&lt;`, `&gt;`). The `<description>` carries `translate="no"`.
- Write for a photographer/user, not a developer. Name the feature or behavior, not the files or functions. No code, no PR numbers.
- Keep each `<li>` to one or two sentences. Don't duplicate an existing bullet.

## Cutting a new version (release bump)

When the user is actually releasing (not just logging a change), the version lives in several places — keep them in sync:
- `src-tauri/tauri.conf.json` → `"version"`.
- A new `<release>` block in the metainfo.
- The GitHub Release notes (same text).

Confirm with the user before bumping the version; logging a single change does **not** require a version bump — just add the `<li>` to the current top release block.

## What NOT to do

- Don't create a `docs/changelog/` folder or a `CHANGELOG.md` — they don't exist here and shouldn't.
- Don't rewrite or delete past `<release>` blocks; they are the historical record.
- Don't break the XML (Flathub validation will fail on malformed metainfo).
