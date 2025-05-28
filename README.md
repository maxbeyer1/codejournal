# CodeJournal

**Alpha Version 0.1.0-alpha.1**

CodeJournal automatically tracks your development work in more detail than git commits. Instead of just seeing your final working solution, CodeJournal captures your entire development journey—including failed attempts, iterations, and the reasoning behind changes.

## The Problem

Traditional git history only shows you the final working solution. But what if you tried 3 different approaches before finding one that worked? When you encounter a similar problem months later, you can only see the final commit—not what didn't work or why you chose that particular solution.

CodeJournal solves this by automatically capturing your complete development process during work sessions, creating a running `.codejournal` file with AI-generated summaries of your changes.

## Features

- **Session-based tracking**: Start/stop recording sessions to capture focused work periods
- **Automatic change detection**: Monitors file saves, creates, deletes, and renames
- **AI-powered summaries**: Uses Anthropic Claude to generate human-readable summaries
- **Journal tree view**: Browse your development history organized by session or file
- **Zero-friction workflow**: Minimal interruption to your normal development process

## Installation

### Option 1: Install from .vsix file (Recommended for testers)

1. Download the latest `.vsix` file from the [releases page](https://github.com/beyerlabs/codejournal/releases)
2. Open VS Code
3. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
4. Click the "..." menu in the Extensions view
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file

### Option 2: Build from source

```bash
git clone https://github.com/beyerlabs/codejournal.git
cd codejournal
pnpm install
pnpm run compile
```

Then press `F5` to run in Extension Development Host, or package with `vsce package` to create a `.vsix` file.

## Requirements

- VS Code 1.100.0 or higher
- Anthropic API key (required for AI summaries)

## Extension Settings

This extension contributes the following settings:

- `codejournal.anthropicApiKey`: API key for Anthropic Claude services (required)
- `codejournal.anthropicModel`: Claude model to use for summarization (default: "claude-3-7-sonnet-latest")
- `codejournal.journalFilePath`: Path to the journal file (default: ".codejournal")

### Setting up your API key

1. Get an API key from [Anthropic Console](https://console.anthropic.com/)
2. Open VS Code Settings (`Ctrl+,` / `Cmd+,`)
3. Search for "codejournal"
4. Set your API key in `CodeJournal: Anthropic Api Key`

## Usage

### Basic Workflow

1. **Start a session**:
   - Click the CodeJournal icon in the Status Bar OR
   - Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Run `CodeJournal: Start Recording Session`

2. **Work normally**: Make changes to your files as usual

3. **Stop the session**: 
   - Click the CodeJournal icon again or run the command `CodeJournal: Stop Recording Session`
   - AI summary is automatically generated and added to `.codejournal` (or your configured journal file)

### Available Commands

- `CodeJournal: Start Recording Session` - Begin tracking changes
- `CodeJournal: Stop Recording Session` - End session and generate summary
- `CodeJournal: Show Tracked Changes` - View current session changes
- `CodeJournal: Clear Tracked Changes` - Clear change cache
- `CodeJournal: Open Journal File` - Open the `.codejournal` file (or configured path)

### Journal Tree View

The CodeJournal panel appears in the Explorer sidebar, showing your journal entries. You can:
- Toggle between "by session" and "by file" views
- Click entries to navigate to specific changes
- Refresh the view with new entries

## Journal File Format

Your `.codejournal` file contains entries like:

```
## Session: 2024-01-15 14:30:22 - 14:45:18

### Summary
Implemented user authentication flow with JWT tokens and added validation middleware.

### Files Changed
- src/auth.ts: Added JWT token generation and validation
- src/middleware.ts: Created auth middleware for route protection

### Details
- Created login endpoint that generates JWT tokens
- Added middleware to verify tokens on protected routes
- Implemented user session management
```

## Known Issues

Will be updated as we progress through alpha testing. Please report any issues you encounter!

## Alpha Testing Feedback

This is an alpha release. Help us improve by reporting:

### Issues & Bugs
Please report issues at: https://github.com/beyerlabs/codejournal/issues

Include:
- VS Code version
- Extension version
- Steps to reproduce
- Expected vs actual behavior

### What to Test
- Session start/stop workflow
- AI summary quality and accuracy
- Journal file readability
- Performance with your typical projects
- Any crashes or unexpected behavior

### Privacy Note
- File changes are tracked locally
- Change summaries are sent to Anthropic Claude API for processing
- No source code is permanently stored by external services

## Release Notes

### 0.1.0-alpha.1

Initial alpha release with core functionality:
- Session-based change tracking
- AI-powered change summarization
- Journal tree view
- Basic configuration options

---

**Thanks for testing CodeJournal!** Your feedback helps us build a better tool for capturing development work.