# YC Todo privacy

YC Todo is designed to work locally on the user's Mac.

## Data collection

YC Todo does not collect or transmit personal data. It does not include user
accounts, analytics, advertising, telemetry, or third-party tracking.

## Local storage

Tasks, tags, focus state, appearance settings, notification settings, and
keyboard shortcut preferences are stored locally in the app's WebView storage
or application container.

If the user selects a custom alarm sound, YC Todo copies that selected audio
file into its application container so it remains available to the app. The
source file is not uploaded.

## User-selected files

YC Todo interacts with files only after an explicit action in a macOS system
file picker:

- importing a YC Todo JSON backup selected by the user;
- exporting a YC Todo JSON backup to a destination selected by the user; or
- selecting a custom audio file for completion sounds.

The app does not scan arbitrary folders or access files without a user action.

## Network access

The application does not make runtime network requests. Development tools may
download npm, Cargo, or Git dependencies while a developer installs or builds
the source code; that build-time activity is separate from the installed app.

## Removing data

Users can remove imported custom audio from within YC Todo. Removing the app and
its macOS application container removes the remaining locally stored app data.
