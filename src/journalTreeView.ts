import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * View mode for organizing journal entries
 */
export enum JournalViewMode {
  BySession = 'bySession',
  ByFile = 'byFile'
}

/**
 * Simple interfaces for journal data
 */
export interface JournalSession {
  title: string;
  files: JournalFile[];
}

export interface JournalFile {
  filePath: string;
  changes: JournalChange[];
}

export interface JournalChange {
  timestamp: string;
  description: string;
}

/**
 * Tree item for sessions
 */
export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly session: JournalSession,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(session.title, collapsibleState);
    this.contextValue = 'session';
    this.iconPath = new vscode.ThemeIcon('history');
    this.description = `${session.files.length} file${session.files.length !== 1 ? 's' : ''}`;
  }
}

/**
 * Tree item for files
 */
export class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly file: JournalFile,
    public readonly sessionTitle?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    const fileName = file.filePath.split('/').pop() || file.filePath;
    const label = sessionTitle ? sessionTitle : fileName;
    super(label, collapsibleState);
    this.contextValue = 'file';
    this.iconPath = new vscode.ThemeIcon('file');
    this.tooltip = file.filePath;
    this.description = `${file.changes.length} change${file.changes.length !== 1 ? 's' : ''}`;
    
    // Store resource URI for potential file opening
    this.resourceUri = vscode.Uri.file(file.filePath);
    this.command = {
      command: 'codejournal.openFile',
      title: 'Open File',
      arguments: [file.filePath]
    };
  }
}

/**
 * Tree item for changes
 */
export class ChangeTreeItem extends vscode.TreeItem {
  constructor(public readonly change: JournalChange) {
    super(`${change.timestamp} ${change.description}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'change';
    this.iconPath = new vscode.ThemeIcon('edit');
    this.tooltip = change.description;
  }
}

/**
 * Tree data provider for the CodeJournal view
 */
export class JournalTreeDataProvider implements vscode.TreeDataProvider<SessionTreeItem | FileTreeItem | ChangeTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SessionTreeItem | FileTreeItem | ChangeTreeItem | undefined | null | void> = new vscode.EventEmitter<SessionTreeItem | FileTreeItem | ChangeTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SessionTreeItem | FileTreeItem | ChangeTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private sessions: JournalSession[] = [];
  private viewMode: JournalViewMode = JournalViewMode.BySession;

  constructor() {
    this.loadJournalData();
  }

  getTreeItem(element: SessionTreeItem | FileTreeItem | ChangeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem | FileTreeItem | ChangeTreeItem): Thenable<(SessionTreeItem | FileTreeItem | ChangeTreeItem)[]> {
    if (!element) {
      // Root level - return based on view mode
      if (this.viewMode === JournalViewMode.BySession) {
        return Promise.resolve(this.sessions.map(session => 
          new SessionTreeItem(session, vscode.TreeItemCollapsibleState.Collapsed)
        ));
      } else {
        return Promise.resolve(this.getFilesByMode());
      }
    }

    if (element instanceof SessionTreeItem) {
      // Return files for this session
      return Promise.resolve(element.session.files.map(file => 
        new FileTreeItem(file)
      ));
    }

    if (element instanceof FileTreeItem) {
      // In ByFile mode, we need to show sessions under files
      if (this.viewMode === JournalViewMode.ByFile && !element.sessionTitle) {
        // This is a top-level file item, show sessions that modified this file
        return Promise.resolve(this.getSessionsForFile(element.file.filePath));
      } else {
        // Return changes for this file
        return Promise.resolve(element.file.changes.map(change => 
          new ChangeTreeItem(change)
        ));
      }
    }

    return Promise.resolve([]);
  }

  /**
   * Load and parse journal data from the configured file
   */
  private loadJournalData(): void {
    try {
      const journalPath = this.getJournalFilePath();
      
      if (!fs.existsSync(journalPath)) {
        this.sessions = [];
        return;
      }

      const content = fs.readFileSync(journalPath, 'utf8');
      this.sessions = this.parseJournalContent(content);
    } catch (error) {
      console.error('Error loading journal data:', error);
      this.sessions = [];
    }
  }

  /**
   * Get journal file path from configuration
   */
  private getJournalFilePath(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder open');
    }
    
    const rootPath = workspaceFolders[0].uri.fsPath;
    const configuredPath = vscode.workspace.getConfiguration('codejournal').get('journalFilePath') as string;
    
    if (configuredPath && path.isAbsolute(configuredPath)) {
      return configuredPath;
    }
    
    return path.join(rootPath, configuredPath || '.codejournal');
  }

  /**
   * Parse markdown journal content into structured data
   */
  private parseJournalContent(content: string): JournalSession[] {
    const sessions: JournalSession[] = [];
    const lines = content.split('\n');
    
    let currentSession: JournalSession | null = null;
    let currentFile: JournalFile | null = null;
    
    for (const line of lines) {
      // Session header (## Session ...)
      if (line.startsWith('## Session ')) {
        if (currentSession && currentFile) {
          currentSession.files.push(currentFile);
        }
        if (currentSession) {
          sessions.push(currentSession);
        }
        
        currentSession = {
          title: line.substring(3), // Remove "## "
          files: []
        };
        currentFile = null;
      }
      // File header (### filename)
      else if (line.startsWith('### ') && currentSession) {
        if (currentFile) {
          currentSession.files.push(currentFile);
        }
        
        currentFile = {
          filePath: line.substring(4), // Remove "### "
          changes: []
        };
      }
      // Change entry (- **timestamp** description)
      else if (line.startsWith('- **') && currentFile) {
        const match = line.match(/^- \*\*([^*]+)\*\* (.+)$/);
        if (match) {
          currentFile.changes.push({
            timestamp: match[1],
            description: match[2]
          });
        }
      }
    }
    
    // Add the last file and session
    if (currentSession && currentFile) {
      currentSession.files.push(currentFile);
    }
    if (currentSession) {
      sessions.push(currentSession);
    }
    
    return sessions;
  }

  /**
   * Get files organized by file (for ByFile mode)
   */
  private getFilesByMode(): FileTreeItem[] {
    const fileMap = new Map<string, JournalFile>();
    
    // Aggregate all changes for each file across all sessions
    this.sessions.forEach(session => {
      session.files.forEach(file => {
        if (fileMap.has(file.filePath)) {
          const existingFile = fileMap.get(file.filePath)!;
          existingFile.changes.push(...file.changes);
        } else {
          fileMap.set(file.filePath, {
            filePath: file.filePath,
            changes: [...file.changes]
          });
        }
      });
    });

    return Array.from(fileMap.values()).map(file => 
      new FileTreeItem(file)
    );
  }

  /**
   * Get sessions that modified a specific file (for ByFile mode)
   */
  private getSessionsForFile(filePath: string): FileTreeItem[] {
    const sessionFiles: FileTreeItem[] = [];
    
    this.sessions.forEach(session => {
      const fileInSession = session.files.find(f => f.filePath === filePath);
      if (fileInSession) {
        sessionFiles.push(
          new FileTreeItem(fileInSession, session.title, vscode.TreeItemCollapsibleState.Collapsed)
        );
      }
    });

    return sessionFiles;
  }

  /**
   * Set the view mode and refresh
   */
  setViewMode(mode: JournalViewMode): void {
    this.viewMode = mode;
    this.refresh();
  }

  /**
   * Get current view mode
   */
  getViewMode(): JournalViewMode {
    return this.viewMode;
  }

  /**
   * Refresh the tree view by reloading data
   */
  refresh(): void {
    this.loadJournalData();
    this._onDidChangeTreeData.fire();
  }
}