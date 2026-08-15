# README screenshot capture guide

The public README intentionally does not embed the older screenshots in this
folder. Capture the refreshed UI with neutral demo data, then add these files:

| File | What to show |
| --- | --- |
| `01-task-list.png` | Main popover with 4–5 neutral tasks, varied tags, and only Start visible on each row |
| `02-action-rail.png` | One hovered task with Edit and Delete revealed beside Start |
| `03-title-preview.png` | A truncated task with the row-anchored title preview open |
| `04-focus-timer.png` | An active focus session with Pause and Finish controls |
| `05-settings.png` | Notification, theme, shortcut, or tag customization panel |
| `06-dark-mode.png` | The same main popover in macOS dark appearance |

## Capture rules

- Use demo content only—no personal tasks, names, file paths, or notification text.
- Capture the real `/Applications/YC Todo.app` release build at its native
  386×546-point popover size.
- Keep the menu-bar arrow and the complete rounded popover edge visible.
- Use the same accent color and task set across the light/dark pair.
- Save lossless PNGs at 2× scale when possible; do not upscale screenshots.
- Crop consistently and remove unrelated desktop or menu-bar content.

After adding the files, uncomment the screenshot block in the root `README.md`.
