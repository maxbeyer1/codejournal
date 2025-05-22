// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { ChangeTracker } from './changeTracker';
import { SessionController } from './sessions';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  console.log('CodeJournal extension is now active');

  // Create the session controller first
  const sessionController = new SessionController();
  
  // Create the change tracker and pass the session controller
  const changeTracker = new ChangeTracker(sessionController);
  const changeTrackerDisposable = changeTracker.start();
  
  // Set up bidirectional reference
  sessionController.setChangeTracker(changeTracker);
  
  // Register session commands
  const startSessionCommand = vscode.commands.registerCommand('codejournal.startSession', () => {
    const session = sessionController.startSession();
    if (session) {
      console.log(`Started new session with ID: ${session.id}`);
    }
  });
  
  const stopSessionCommand = vscode.commands.registerCommand('codejournal.stopSession', async () => {
    const session = await sessionController.stopSession();
    if (session) {
      console.log(`Stopped session with ID: ${session.id}`);
      console.log(`Session duration: ${new Date(session.endTime!).getTime() - new Date(session.startTime).getTime()} ms`);
    }
  });
  
  // Register changes commands
  const showChangesCommand = vscode.commands.registerCommand('codejournal.showChanges', () => {
    const changes = changeTracker.getChanges();
    if (changes.length === 0) {
      vscode.window.showInformationMessage('No changes have been tracked yet.');
      return;
    }
    
    // Create an output channel for showing changes
    const outputChannel = vscode.window.createOutputChannel('CodeJournal Changes', {log: true});
    outputChannel.clear();
    
    // Show session status
    const currentSession = sessionController.getCurrentSession();
    if (currentSession) {
      outputChannel.appendLine(`Active session: ${currentSession.id} (started at ${currentSession.startTime})`);
      
      // Show changes for current session
      const sessionChanges = changeTracker.getChangesBySession(currentSession.id);
      outputChannel.appendLine(`Changes in current session: ${sessionChanges.length}`);
    } else {
      outputChannel.appendLine('No active session');
    }
    outputChannel.appendLine('---');
    
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
        case 'save':
          // No additional info needed for basic display
          break;
        case 'create':
          // Show content length instead of full content
          outputChannel.appendLine(`Content length: ${change.content.length} characters`);
          break;
        case 'delete':
          // Show that the file was deleted
          outputChannel.appendLine(`Last content length: ${change.lastContent.length} characters`);
          break;
        case 'rename':
          // Show new file path
          outputChannel.appendLine(`New path: ${change.newFilePath}`);
          break;
      }
      
      outputChannel.appendLine(`ID: ${change.id}`);
      outputChannel.appendLine('---');
    });
    
    outputChannel.show();
  });
  
  const clearChangesCommand = vscode.commands.registerCommand('codejournal.clearChanges', () => {
    changeTracker.clearChanges();
    vscode.window.showInformationMessage('All tracked changes have been cleared.');
  });

  // Register command to open journal file
  const openJournalCommand = vscode.commands.registerCommand('codejournal.openJournal', async () => {
    try {
      await sessionController.openJournal();
      vscode.window.showInformationMessage('CodeJournal file opened.');
    } catch (error) {
      console.error('Error opening journal file:', error);
      vscode.window.showErrorMessage('Failed to open journal file. See console for details.');
    }
  });

  // Add to subscriptions
  context.subscriptions.push(
    changeTrackerDisposable,
    sessionController,
    startSessionCommand,
    stopSessionCommand,
    showChangesCommand,
    clearChangesCommand,
    openJournalCommand,
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  // Clean up resources if needed
}