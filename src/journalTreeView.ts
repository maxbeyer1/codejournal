import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

import { Logger } from "./logger";

/**
 * View mode for organizing journal entries
 */
export enum JournalViewMode {
  BySession = "bySession",
  ByFile = "byFile",
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
    this.contextValue = "session";
    this.iconPath = new vscode.ThemeIcon("history");
    this.description = `${session.files.length} file${
      session.files.length !== 1 ? "s" : ""
    }`;
  }
}

/**
 * Tree item for files
 */
export class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly file: JournalFile,
    public readonly sessionTitle?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode
      .TreeItemCollapsibleState.Collapsed,
    public readonly parentSessionTitle?: string
  ) {
    const fileName = file.filePath.split("/").pop() || file.filePath;
    const label = sessionTitle ? sessionTitle : fileName;
    super(label, collapsibleState);
    this.contextValue = "file";

    // Use session icon when this represents a session under a file, otherwise use file icon
    this.iconPath = new vscode.ThemeIcon(sessionTitle ? "history" : "file");

    this.tooltip = sessionTitle
      ? `${sessionTitle} - ${file.filePath}`
      : file.filePath;
    this.description = `${file.changes.length} change${
      file.changes.length !== 1 ? "s" : ""
    }`;

    // Only add file opening functionality for actual files (not sessions)
    if (!sessionTitle) {
      // Store resource URI for potential file opening
      // Handle both absolute and relative paths
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let fullPath = file.filePath;
      if (
        workspaceFolders &&
        workspaceFolders.length > 0 &&
        !file.filePath.startsWith("/")
      ) {
        fullPath = `${workspaceFolders[0].uri.fsPath}/${file.filePath}`;
      }

      this.resourceUri = vscode.Uri.file(fullPath);
      this.command = {
        command: "codejournal.openFile",
        title: "Open File",
        arguments: [file.filePath],
      };
    }
  }
}

/**
 * Tree item for changes
 */
export class ChangeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly change: JournalChange,
    public readonly sessionTitle?: string,
    public readonly filePath?: string
  ) {
    super(
      `${change.timestamp} ${change.description}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.contextValue = "change";
    this.iconPath = new vscode.ThemeIcon("edit");
    this.tooltip = change.description;

    // Add command to navigate to this edit in the journal file
    this.command = {
      command: "codejournal.navigateToEdit",
      title: "Navigate to Edit",
      arguments: [change, sessionTitle, filePath],
    };
  }
}

/**
 * Tree data provider for the CodeJournal view
 */
export class JournalTreeDataProvider
  implements
    vscode.TreeDataProvider<SessionTreeItem | FileTreeItem | ChangeTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    SessionTreeItem | FileTreeItem | ChangeTreeItem | undefined | null | void
  > = new vscode.EventEmitter<
    SessionTreeItem | FileTreeItem | ChangeTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    SessionTreeItem | FileTreeItem | ChangeTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private sessions: JournalSession[] = [];
  private viewMode: JournalViewMode = JournalViewMode.BySession;

  constructor() {
    this.loadJournalData();
  }

  getTreeItem(
    element: SessionTreeItem | FileTreeItem | ChangeTreeItem
  ): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: SessionTreeItem | FileTreeItem | ChangeTreeItem
  ): Thenable<(SessionTreeItem | FileTreeItem | ChangeTreeItem)[]> {
    if (!element) {
      // Root level - return based on view mode
      if (this.sessions.length === 0) {
        return Promise.resolve([]);
      }

      if (this.viewMode === JournalViewMode.BySession) {
        return Promise.resolve(
          this.sessions.map(
            (session) =>
              new SessionTreeItem(
                session,
                vscode.TreeItemCollapsibleState.Collapsed
              )
          )
        );
      } else {
        return Promise.resolve(this.getFilesByMode());
      }
    }

    if (element instanceof SessionTreeItem) {
      // Return files for this session
      return Promise.resolve(
        element.session.files.map(
          (file) =>
            new FileTreeItem(
              file,
              undefined,
              vscode.TreeItemCollapsibleState.Collapsed,
              element.session.title
            )
        )
      );
    }

    if (element instanceof FileTreeItem) {
      // In ByFile mode, we need to show sessions under files
      if (this.viewMode === JournalViewMode.ByFile && !element.sessionTitle) {
        // This is a top-level file item, show sessions that modified this file
        return Promise.resolve(this.getSessionsForFile(element.file.filePath));
      } else {
        // Return changes for this file
        const sessionTitle = element.sessionTitle || element.parentSessionTitle;
        return Promise.resolve(
          element.file.changes.map(
            (change) =>
              new ChangeTreeItem(change, sessionTitle, element.file.filePath)
          )
        );
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

      const content = fs.readFileSync(journalPath, "utf8");
      this.sessions = this.parseJournalContent(content);
    } catch (error) {
      Logger.error(
        "Error loading journal data",
        "JournalTreeDataProvider",
        error
      );
      vscode.window.showErrorMessage(
        "Failed to load journal data. See console for details."
      );

      // Reset sessions on error
      this.sessions = [];
    }
  }

  /**
   * Get journal file path from configuration
   */
  private getJournalFilePath(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder open");
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const configuredPath = vscode.workspace
      .getConfiguration("codejournal")
      .get("journalFilePath") as string;

    if (configuredPath && path.isAbsolute(configuredPath)) {
      return configuredPath;
    }

    return path.join(rootPath, configuredPath || ".codejournal");
  }

  /**
   * Parse markdown journal content into structured data
   */
  private parseJournalContent(content: string): JournalSession[] {
    const sessions: JournalSession[] = [];
    const lines = content.split("\n");

    let currentSession: JournalSession | null = null;
    let currentFile: JournalFile | null = null;

    for (const line of lines) {
      // Session header (## Session ...)
      if (line.startsWith("## Session ")) {
        if (currentSession && currentFile) {
          currentSession.files.push(currentFile);
        }
        if (currentSession) {
          sessions.push(currentSession);
        }

        currentSession = {
          title: line.substring(3), // Remove "## "
          files: [],
        };
        currentFile = null;
      }
      // File header (### filename)
      else if (line.startsWith("### ") && currentSession) {
        if (currentFile) {
          currentSession.files.push(currentFile);
        }

        currentFile = {
          filePath: line.substring(4), // Remove "### "
          changes: [],
        };
      }
      // Change entry (- **timestamp** description)
      else if (line.startsWith("- **") && currentFile) {
        const match = line.match(/^- \*\*([^*]+)\*\* (.+)$/);
        if (match) {
          currentFile.changes.push({
            timestamp: match[1],
            description: match[2],
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
   * Normalize file path to relative path for consistent comparison
   */
  private normalizeFilePath(filePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return filePath.trim();
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const cleanPath = filePath.trim();

    // If it's an absolute path within the workspace, make it relative
    if (cleanPath.startsWith(rootPath)) {
      return cleanPath.substring(rootPath.length + 1); // +1 to remove the leading slash
    }

    return cleanPath;
  }

  /**
   * Get files organized by file (for ByFile mode)
   */
  private getFilesByMode(): FileTreeItem[] {
    const filePathsMap = new Map<string, string>(); // normalized path -> original path

    // Collect unique file paths across all sessions
    this.sessions.forEach((session) => {
      session.files.forEach((file) => {
        const normalizedPath = this.normalizeFilePath(file.filePath);
        // Store the first occurrence of the path (could be relative or absolute)
        if (!filePathsMap.has(normalizedPath)) {
          filePathsMap.set(normalizedPath, file.filePath.trim());
        }
      });
    });

    // Create file items with total change count across all sessions
    return Array.from(filePathsMap.entries()).map(([normalizedPath]) => {
      let totalChanges = 0;
      this.sessions.forEach((session) => {
        const fileInSession = session.files.find(
          (f) => this.normalizeFilePath(f.filePath) === normalizedPath
        );
        if (fileInSession) {
          totalChanges += fileInSession.changes.length;
        }
      });

      return new FileTreeItem({
        filePath: normalizedPath, // Use normalized path for consistency
        changes: new Array(totalChanges).fill(null), // Placeholder for count display
      });
    });
  }

  /**
   * Get sessions that modified a specific file (for ByFile mode)
   */
  private getSessionsForFile(filePath: string): FileTreeItem[] {
    const sessionFiles: FileTreeItem[] = [];
    const normalizedTargetPath = this.normalizeFilePath(filePath);

    this.sessions.forEach((session) => {
      const fileInSession = session.files.find(
        (f) => this.normalizeFilePath(f.filePath) === normalizedTargetPath
      );
      if (fileInSession) {
        sessionFiles.push(
          new FileTreeItem(
            fileInSession,
            session.title,
            vscode.TreeItemCollapsibleState.Collapsed
          )
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
   * Calculate the line number of a specific edit in the journal file
   */
  public calculateEditLineNumber(
    change: JournalChange,
    sessionTitle?: string,
    filePath?: string
  ): number | null {
    try {
      const journalPath = this.getJournalFilePath();

      if (!fs.existsSync(journalPath)) {
        return null;
      }

      const content = fs.readFileSync(journalPath, "utf8");
      const lines = content.split("\n");

      let currentLineNumber = 1;
      let foundSession = false;
      let foundFile = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        currentLineNumber = i + 1;

        // Look for session header
        if (line.startsWith("## Session ") && sessionTitle) {
          const lineSessionTitle = line.substring(3); // Remove "## "
          if (lineSessionTitle === sessionTitle) {
            foundSession = true;
            continue;
          } else if (foundSession) {
            // We've moved to a different session, stop looking
            break;
          }
        }

        // Look for file header within the correct session
        if (line.startsWith("### ") && foundSession && filePath) {
          const lineFilePath = line.substring(4); // Remove "### "
          const normalizedLineFilePath = this.normalizeFilePath(lineFilePath);
          const normalizedTargetFilePath = this.normalizeFilePath(filePath);

          if (normalizedLineFilePath === normalizedTargetFilePath) {
            foundFile = true;
            continue;
          } else if (foundFile) {
            // We've moved to a different file within the same session
            foundFile = false;
          }
        }

        // Look for the specific edit within the correct file
        if (line.startsWith("- **") && foundSession && foundFile) {
          const match = line.match(/^- \*\*([^*]+)\*\* (.+)$/);
          if (match) {
            const lineTimestamp = match[1];
            const lineDescription = match[2];

            // Match by timestamp and description
            if (
              lineTimestamp === change.timestamp &&
              lineDescription === change.description
            ) {
              return currentLineNumber;
            }
          }
        }

        // If we're looking without session context, try to match any edit
        if (!sessionTitle && line.startsWith("- **")) {
          const match = line.match(/^- \*\*([^*]+)\*\* (.+)$/);
          if (match) {
            const lineTimestamp = match[1];
            const lineDescription = match[2];

            if (
              lineTimestamp === change.timestamp &&
              lineDescription === change.description
            ) {
              return currentLineNumber;
            }
          }
        }
      }

      return null;
    } catch (error) {
      Logger.error(
        "Error calculating edit line number",
        "JournalTreeDataProvider",
        error
      );
      return null;
    }
  }

  /**
   * Refresh the tree view by reloading data
   */
  refresh(): void {
    this.loadJournalData();
    this._onDidChangeTreeData.fire();
  }
}
