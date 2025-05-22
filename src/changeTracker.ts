import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BaseChange, ChangeType } from './types';
import { SessionController } from './sessions';

/**
 * Represents a save change to a file
 */
export interface SaveChange extends BaseChange {
  type: 'save';
  oldContent: string;
  newContent: string;
}

/**
 * Represents a file creation change
 */
export interface CreateChange extends BaseChange {
  type: 'create';
  content: string;
}

/**
 * Represents a file deletion change
 */
export interface DeleteChange extends BaseChange {
  type: 'delete';
  lastContent: string;
}

/**
 * Represents a file rename change
 */
export interface RenameChange extends BaseChange {
  type: 'rename';
  newFilePath: string;
}

/**
 * Union type of all possible changes
 */
export type Change = SaveChange | CreateChange | DeleteChange | RenameChange;

/**
 * Manages tracking changes to files in the workspace
 */
export class ChangeTracker {
  private changes: Change[] = [];
  private fileContentCache: Map<string, string> = new Map();
  private disposables: vscode.Disposable[] = [];
  private sessionController?: SessionController;

  constructor(sessionController?: SessionController) {
    this.sessionController = sessionController;
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

    // Track file creations
    const createListener = vscode.workspace.onDidCreateFiles(
      this.handleFileCreate.bind(this)
    );

    // Track file deletions
    const deleteListener = vscode.workspace.onDidDeleteFiles(
      this.handleFileDelete.bind(this)
    );

    // Track file renames
    const renameListener = vscode.workspace.onDidRenameFiles(
      this.handleFileRename.bind(this)
    );

    this.disposables.push(
      saveListener,
      createListener,
      deleteListener,
      renameListener
    );
    
    // Return a composite disposable that can clean up all listeners
    return vscode.Disposable.from(...this.disposables);
  }

  /**
   * Get all tracked changes
   */
  public getChanges(): Change[] {
    return [...this.changes];
  }

  /**
   * Get changes for a specific session
   */
  public getChangesBySession(sessionId: string): Change[] {
    return this.changes.filter(change => change.sessionId === sessionId);
  }

  /**
   * Get changes for the current session
   */
  public getCurrentSessionChanges(): Change[] {
    const currentSession = this.sessionController?.getCurrentSession();
    if (!currentSession) {
      return [];
    }
    return this.getChangesBySession(currentSession.id);
  }

  /**
   * Clear all tracked changes
   */
  public clearChanges(): void {
    this.changes = [];
  }
  
  /**
   * Clear changes for a specific session
   */
  public clearSessionChanges(sessionId: string): void {
    this.changes = this.changes.filter(change => change.sessionId !== sessionId);
  }

  /**
   * Handle document save events
   */
  private handleDocumentSave(document: vscode.TextDocument): void {
    // Check if a session is active
    const currentSession = this.sessionController?.getCurrentSession();
    const isSessionActive = !!currentSession;
    
    const filePath = document.uri.fsPath;
    const newContent = document.getText();
    const oldContent = this.fileContentCache.get(filePath) || '';

    // Only track if content actually changed and there's an active session
    if (oldContent !== newContent && isSessionActive) {
      const change: SaveChange = {
        id: this.generateChangeId(),
        timestamp: new Date().toISOString(),
        filePath,
        type: 'save',
        oldContent,
        newContent,
        sessionId: currentSession?.id
      };

      this.changes.push(change);
      
      // Log the change for debugging purposes
      console.log(`Change tracked in ${filePath}`);
      console.log(`Type: save`);
      console.log(`Change ID: ${change.id}`);
      console.log(`Session ID: ${change.sessionId}`);
      console.log(`Timestamp: ${change.timestamp}`);
      console.log('---');
    } else if (oldContent !== newContent && !isSessionActive) {
      // Log why we're not tracking this change (debugging purposes)
      console.log(`Change not tracked in ${filePath} (no active session)`);
    }

    // Always update the cache with the new content
    this.fileContentCache.set(filePath, newContent);
  }

  /**
   * Handle file creation events
   */
  private async handleFileCreate(event: vscode.FileCreateEvent): Promise<void> {
    // Check if a session is active
    const currentSession = this.sessionController?.getCurrentSession();
    const isSessionActive = !!currentSession;
    
    if (!isSessionActive) {
      console.log('File creation event ignored (no active session)');
      // Still update cache, but don't record changes
      for (const uri of event.files) {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          this.fileContentCache.set(uri.fsPath, document.getText());
        } catch (error) {
          console.error(`Error updating cache for ${uri.fsPath}:`, error);
        }
      }
      return;
    }
    
    for (const uri of event.files) {
      try {
        const filePath = uri.fsPath;
        // Read the content of the created file
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        const change: CreateChange = {
          id: this.generateChangeId(),
          timestamp: new Date().toISOString(),
          filePath,
          type: 'create',
          content,
          sessionId: currentSession?.id
        };

        this.changes.push(change);
        
        // Add to content cache
        this.fileContentCache.set(filePath, content);
        
        // Log the change for debugging purposes
        console.log(`File created: ${filePath}`);
        console.log(`Type: create`);
        console.log(`Change ID: ${change.id}`);
        console.log(`Session ID: ${change.sessionId}`);
        console.log(`Timestamp: ${change.timestamp}`);
        console.log('---');
      } catch (error) {
        console.error(`Error tracking file creation for ${uri.fsPath}:`, error);
      }
    }
  }

  /**
   * Handle file deletion events
   */
  private handleFileDelete(event: vscode.FileDeleteEvent): void {
    // Check if a session is active
    const currentSession = this.sessionController?.getCurrentSession();
    const isSessionActive = !!currentSession;
    
    for (const uri of event.files) {
      const filePath = uri.fsPath;
      // Get the last content from cache before the file was deleted
      const lastContent = this.fileContentCache.get(filePath) || '';

      if (isSessionActive) {
        const change: DeleteChange = {
          id: this.generateChangeId(),
          timestamp: new Date().toISOString(),
          filePath,
          type: 'delete',
          lastContent,
          sessionId: currentSession?.id
        };

        this.changes.push(change);
        
        // Log the change for debugging purposes
        console.log(`File deleted: ${filePath}`);
        console.log(`Type: delete`);
        console.log(`Change ID: ${change.id}`);
        console.log(`Session ID: ${change.sessionId}`);
        console.log(`Timestamp: ${change.timestamp}`);
        console.log('---');
      } else {
        console.log(`File deletion not tracked for ${filePath} (no active session)`);
      }
      
      // Always remove from content cache
      this.fileContentCache.delete(filePath);
    }
  }

  /**
   * Handle file rename events
   */
  private async handleFileRename(event: vscode.FileRenameEvent): Promise<void> {
    // Check if a session is active
    const currentSession = this.sessionController?.getCurrentSession();
    const isSessionActive = !!currentSession;
    
    for (const { oldUri, newUri } of event.files) {
      try {
        const oldFilePath = oldUri.fsPath;
        const newFilePath = newUri.fsPath;
        
        // Update content cache with the new file path
        const oldContent = this.fileContentCache.get(oldFilePath) || '';
        this.fileContentCache.delete(oldFilePath);
        
        // Try to read the new file content 
        try {
          const document = await vscode.workspace.openTextDocument(newUri);
          this.fileContentCache.set(newFilePath, document.getText());
        } catch {
          // If we can't open the new document, at least preserve the old content
          this.fileContentCache.set(newFilePath, oldContent);
        }
        
        if (isSessionActive) {
          // Create a rename change
          const change: RenameChange = {
            id: this.generateChangeId(),
            timestamp: new Date().toISOString(),
            filePath: oldFilePath, // Original file path
            type: 'rename',
            newFilePath, // New file path
            sessionId: currentSession?.id
          };
  
          this.changes.push(change);
          
          // Log the change for debugging purposes
          console.log(`File renamed: ${oldFilePath} -> ${newFilePath}`);
          console.log(`Type: rename`);
          console.log(`Change ID: ${change.id}`);
          console.log(`Session ID: ${change.sessionId}`);
          console.log(`Timestamp: ${change.timestamp}`);
          console.log('---');
        } else {
          console.log(`File rename not tracked: ${oldFilePath} -> ${newFilePath} (no active session)`);
        }
      } catch (error) {
        console.error(`Error handling file rename for ${oldUri.fsPath}:`, error);
      }
    }
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