// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { ChangeTracker, Change } from './changeTracker';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  console.log('CodeJournal extension is now active');

  // Create and start the change tracker
  const changeTracker = new ChangeTracker();
  const changeTrackerDisposable = changeTracker.start();
  
  // Register commands
  const showChangesCommand = vscode.commands.registerCommand('codejournal.showChanges', () => {
    const changes = changeTracker.getChanges();
    if (changes.length === 0) {
      vscode.window.showInformationMessage('No changes have been tracked yet.');
      return;
    }
    
    // Create an output channel for showing changes
    const outputChannel = vscode.window.createOutputChannel('CodeJournal Changes', {log: true});
    outputChannel.clear();
    
    // Output each change
    changes.forEach((change, index) => {
      outputChannel.appendLine(`Change #${index + 1} (${change.timestamp})`);
      outputChannel.appendLine(`Type: ${change.type}`);
      outputChannel.appendLine(`File: ${change.filePath}`);
      
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

  // Legacy Hello World command
  const helloWorldCommand = vscode.commands.registerCommand('codejournal.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from CodeJournal!');
  });

  // Add to subscriptions
  context.subscriptions.push(
    changeTrackerDisposable,
    showChangesCommand,
    clearChangesCommand,
    helloWorldCommand
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  // Clean up resources if needed
}