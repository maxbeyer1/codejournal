import * as vscode from "vscode";
import { TelemetryReporter } from "@vscode/extension-telemetry";

import { ChangeTracker } from "./changeTracker";
import { SessionController } from "./sessions";
import { JournalTreeDataProvider, JournalViewMode } from "./journalTreeView";
import { Logger } from "./logger";

// CONSTANTS
const connectionString =
  "InstrumentationKey=67f40232-3bd8-4cc4-b7b4-11c936cc6590;IngestionEndpoint=https://centralus-2.in.applicationinsights.azure.com/;LiveEndpoint=https://centralus.livediagnostics.monitor.azure.com/;ApplicationId=afbe2820-b5c1-4ca6-b304-3523a581110d";

// Telemetry reporter
let reporter: TelemetryReporter;

// Called when extension is activated
export function activate(context: vscode.ExtensionContext) {
  Logger.startup("Extension is now active");

  // Initialize telemetry
  reporter = new TelemetryReporter(connectionString);

  // Send extension activation telemetry
  reporter.sendTelemetryEvent(
    "extensionActivated",
    {
      platform: process.platform,
      nodeVersion: process.version,
    },
    {
      activationTime: Date.now(),
    }
  );

  // Create initial instances
  const sessionController = new SessionController(reporter);

  const changeTracker = new ChangeTracker(sessionController);
  const changeTrackerDisposable = changeTracker.start();

  // Set up bidirectional reference
  sessionController.setChangeTracker(changeTracker);

  // Create and register journal tree view
  const journalTreeDataProvider = new JournalTreeDataProvider();
  vscode.window.registerTreeDataProvider(
    "codejournal",
    journalTreeDataProvider
  );

  // Set journal tree data provider reference for auto-refresh
  sessionController.setJournalTreeDataProvider(journalTreeDataProvider);

  // Register session commands
  const startSessionCommand = vscode.commands.registerCommand(
    "codejournal.startSession",
    () => {
      const session = sessionController.startSession();
      if (session) {
        Logger.info(`Started new session with ID: ${session.id}`, "Extension");

        // Send session start telemetry
        reporter.sendTelemetryEvent(
          "sessionStarted",
          {
            sessionId: session.id,
          },
          {
            timestamp: Date.now(),
          }
        );
      }
    }
  );

  const stopSessionCommand = vscode.commands.registerCommand(
    "codejournal.stopSession",
    async () => {
      const session = await sessionController.stopSession();
      if (session) {
        Logger.info(`Stopped session with ID: ${session.id}`, "Extension");
        Logger.info(
          `Session duration: ${
            new Date(session.endTime!).getTime() -
            new Date(session.startTime).getTime()
          } ms`,
          "Extension"
        );

        // Send session stop telemetry
        const duration =
          new Date(session.endTime!).getTime() -
          new Date(session.startTime).getTime();
        reporter.sendTelemetryEvent(
          "sessionStopped",
          {
            sessionId: session.id,
          },
          {
            duration: duration,
            timestamp: Date.now(),
          }
        );
      }
    }
  );

  // Register changes commands
  const showChangesCommand = vscode.commands.registerCommand(
    "codejournal.showChanges",
    () => {
      const changes = changeTracker.getChanges();
      if (changes.length === 0) {
        vscode.window.showInformationMessage(
          "No changes have been tracked yet."
        );
        return;
      }

      // Create an output channel for showing changes
      const outputChannel = vscode.window.createOutputChannel(
        "CodeJournal Changes",
        { log: true }
      );
      outputChannel.clear();

      // Show session status
      const currentSession = sessionController.getCurrentSession();
      if (currentSession) {
        outputChannel.appendLine(
          `Active session: ${currentSession.id} (started at ${currentSession.startTime})`
        );

        // Show changes for current session
        const sessionChanges = changeTracker.getChangesBySession(
          currentSession.id
        );
        outputChannel.appendLine(
          `Changes in current session: ${sessionChanges.length}`
        );
      } else {
        outputChannel.appendLine("No active session");
      }
      outputChannel.appendLine("---");

      // Output each change
      changes.forEach((change, index) => {
        outputChannel.appendLine(`Change #${index + 1} (${change.timestamp})`);
        outputChannel.appendLine(`Type: ${change.type}`);
        outputChannel.appendLine(`File: ${change.filePath}`);

        // Show session ID if available
        if (change.sessionId) {
          outputChannel.appendLine(`Session: ${change.sessionId}`);
        }

        // Display type-specific information
        switch (change.type) {
          case "save":
            // No additional info needed for basic display
            break;
          case "create":
            // Show content length instead of full content
            outputChannel.appendLine(
              `Content length: ${change.content.length} characters`
            );
            break;
          case "delete":
            // Show that the file was deleted
            outputChannel.appendLine(
              `Last content length: ${change.lastContent.length} characters`
            );
            break;
          case "rename":
            // Show new file path
            outputChannel.appendLine(`New path: ${change.newFilePath}`);
            break;
        }

        outputChannel.appendLine(`ID: ${change.id}`);
        outputChannel.appendLine("---");
      });

      outputChannel.show();
    }
  );

  const clearChangesCommand = vscode.commands.registerCommand(
    "codejournal.clearChanges",
    () => {
      changeTracker.clearChanges();
      vscode.window.showInformationMessage(
        "All tracked changes have been cleared."
      );
    }
  );

  // Register command to open journal file
  const openJournalCommand = vscode.commands.registerCommand(
    "codejournal.openJournal",
    async () => {
      try {
        await sessionController.openJournal();
        vscode.window.showInformationMessage("CodeJournal file opened.");
      } catch (error) {
        Logger.error("Error opening journal file:", "Extension", error);
        vscode.window.showErrorMessage(
          "Failed to open journal file. See console for details."
        );
      }
    }
  );

  // Register journal refresh command
  const refreshJournalCommand = vscode.commands.registerCommand(
    "codejournal.refreshJournal",
    () => {
      journalTreeDataProvider.refresh();
      vscode.window.showInformationMessage("Journal refreshed.");
    }
  );

  // Register toggle view mode command
  const toggleViewModeCommand = vscode.commands.registerCommand(
    "codejournal.toggleViewMode",
    () => {
      const currentMode = journalTreeDataProvider.getViewMode();
      const newMode =
        currentMode === JournalViewMode.BySession
          ? JournalViewMode.ByFile
          : JournalViewMode.BySession;
      journalTreeDataProvider.setViewMode(newMode);

      const modeText =
        newMode === JournalViewMode.BySession ? "by session" : "by file";
      vscode.window.showInformationMessage(`Journal view mode: ${modeText}`);
    }
  );

  // Register open file command
  const openFileCommand = vscode.commands.registerCommand(
    "codejournal.openFile",
    async (filePath: string) => {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showErrorMessage("No workspace folder open");
          return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const fullPath = filePath.startsWith("/")
          ? filePath
          : `${rootPath}/${filePath}`;

        const document = await vscode.workspace.openTextDocument(fullPath);
        await vscode.window.showTextDocument(document);
      } catch (error) {
        Logger.error("Error opening file:", "Extension", error);
        vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
      }
    }
  );

  // Register navigate to edit command
  const navigateToEditCommand = vscode.commands.registerCommand(
    "codejournal.navigateToEdit",
    async (change: any, sessionTitle?: string, filePath?: string) => {
      try {
        // Validate input parameters
        if (!change || !change.timestamp || !change.description) {
          vscode.window.showErrorMessage("Invalid edit information");
          return;
        }

        // Calculate the line number of the edit
        const lineNumber = journalTreeDataProvider.calculateEditLineNumber(
          change,
          sessionTitle,
          filePath
        );

        if (lineNumber === null) {
          vscode.window.showWarningMessage(
            "Could not locate edit in journal file. The journal may have been modified or the edit may no longer exist."
          );
          return;
        }

        // Open the journal file
        await sessionController.openJournal();

        // Get the active editor (should be the journal file)
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          vscode.window.showErrorMessage("Failed to open journal file");
          return;
        }

        // Validate that the target line exists in the document
        const totalLines = activeEditor.document.lineCount;
        if (lineNumber > totalLines) {
          vscode.window.showWarningMessage(
            "Edit location is beyond the end of the journal file"
          );
          return;
        }

        // Navigate to the specific line (VS Code uses 0-based line numbers)
        const targetLine = lineNumber - 1;
        const range = new vscode.Range(targetLine, 0, targetLine, 0);
        const selection = new vscode.Selection(targetLine, 0, targetLine, 0);

        activeEditor.selection = selection;
        activeEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);

        // Optionally highlight the line briefly
        const decoration = vscode.window.createTextEditorDecorationType({
          backgroundColor: new vscode.ThemeColor(
            "editor.findMatchHighlightBackground"
          ),
          isWholeLine: true,
        });

        activeEditor.setDecorations(decoration, [range]);

        // Remove highlight after 2 seconds
        setTimeout(() => {
          decoration.dispose();
        }, 2000);
      } catch (error) {
        Logger.error("Error navigating to edit:", "Extension", error);
        vscode.window.showErrorMessage(
          `Failed to navigate to edit: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  );

  // Add to subscriptions
  context.subscriptions.push(
    changeTrackerDisposable,
    sessionController,
    startSessionCommand,
    stopSessionCommand,
    showChangesCommand,
    clearChangesCommand,
    openJournalCommand,
    refreshJournalCommand,
    toggleViewModeCommand,
    openFileCommand,
    navigateToEditCommand,
    reporter
  );
}

// Called when extension is deactivated
export function deactivate() {
  // Clean up resources if needed
}
