# Add an action in under 10 lines

1. Make a folder `actions/<name>/` (the folder name = the action name).
2. `action.json`: `{ "name": "<name>", "description": "one line the AI router reads", "triggers": ["words","that","hint"], "params": { "who": { "type": "string" } }, "destructive": false, "template": "template.ps1" }`
   - param types: `string`, `int` (add `min`/`max`), `path` (full path, add `"restrictPaths": true` at the top level to limit it to the allowed folders), `url`, `enum` (add `values`). `"required": false` makes one optional.
   - `"destructive": true` = the user is always asked first, showing exactly what will run.
3. `template.ps1`: PowerShell with `{{WHO}}` placeholders (upper-case param name, **no quotes around it**: text is quoted and escaped for you, ints go in bare). Or use `"native": "<function>"` for a function in `src/fast/actions.js`.
4. `prompt.md`: how to use it, one example, common mistakes (this is also shown to the AI script fallback as the "similar example").
5. Restart the app. Nothing else to edit: `actions/` is loaded at startup in dev and packaged (`extraResource` in `forge.config.js`).

Check it: `npm test` (the registry test loads every folder and fails on a broken `action.json`).
Look at `actions/set_volume/` for a complete template action.

## Promote an AI-written script
Settings > Speed lists AI scripts that worked 2+ times. Copy one into `template.ps1`, replace the changing parts with `{{PLACEHOLDERS}}`, add `action.json` + `prompt.md`, done.

## Allowed folders
File actions and AI scripts may only touch Desktop, Documents, Downloads, Pictures, Videos, Music and OneDrive, plus anything in `my_paths.json` (`roots` / `allowedFolders`). Pinned names in `my_paths.json` always win lookups: `{ "pins": [{ "name": "movies", "path": "D:\\Movies" }] }`.
