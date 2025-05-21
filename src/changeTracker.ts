import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Represents a raw change to a file
 */
export interface RawChange {
  id: string;
  timestamp: string; // ISO format
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Manages tracking changes to files in the workspace
 */
export class ChangeTracker {
  private changes: RawChange[] = [];
  private fileContentCache: Map<string, string> = new Map();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Initialize file content cache with currently open documents
    this.initializeContentCache();
  }

  /**
   * Start tracking changes in the workspace
   */
  public start(): vscode.Disposable {
    // Track file saves
    const saveListener = vscode.workspace.onDidSaveTextDocument(
      this.handleDocumentSave.bind(this)
    );

    this.disposables.push(saveListener);
    
    // Return a composite disposable that can clean up all listeners
    return vscode.Disposable.from(...this.disposables);
  }

  /**
   * Get all tracked changes
   */
  public getChanges(): RawChange[] {
    return [...this.changes];
  }

  /**
   * Clear all tracked changes
   */
  public clearChanges(): void {
    this.changes = [];
  }

  /**
   * Handle document save events
   */
  private handleDocumentSave(document: vscode.TextDocument): void {
    const filePath = document.uri.fsPath;
    const newContent = document.getText();
    const oldContent = this.fileContentCache.get(filePath) || '';

    // Only track if content actually changed
    if (oldContent !== newContent) {
      const change: RawChange = {
        id: this.generateChangeId(),
        timestamp: new Date().toISOString(),
        filePath,
        oldContent,
        newContent
      };

      this.changes.push(change);
      
      // Log the change for debugging purposes
      console.log(`Change tracked in ${filePath}`);
      console.log(`Old Content: ${oldContent}`);
      console.log(`New Content: ${newContent}`);
      console.log(`Change ID: ${change.id}`);
      console.log(`Timestamp: ${change.timestamp}`);
      console.log('---');
    }

    // Update the cache with the new content
    this.fileContentCache.set(filePath, newContent);
  }

  /**
   * Initialize the content cache with currently open documents
   */
  private initializeContentCache(): void {
    vscode.workspace.textDocuments.forEach(document => {
      this.fileContentCache.set(document.uri.fsPath, document.getText());
    });

    // Add listener for newly opened documents
    const openListener = vscode.workspace.onDidOpenTextDocument(document => {
      this.fileContentCache.set(document.uri.fsPath, document.getText());
    });

    // Add listener for closed documents
    const closeListener = vscode.workspace.onDidCloseTextDocument(document => {
      // Optionally, we can free up memory by removing closed files from cache
      // Only do this if you don't need to track changes across editor sessions
      // this.fileContentCache.delete(document.uri.fsPath);
    });

    this.disposables.push(openListener, closeListener);
  }

  /**
   * Generate a unique ID for a change
   */
  private generateChangeId(): string {
    return crypto.randomUUID();
  }

  /**
   * Dispose of all event listeners
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}