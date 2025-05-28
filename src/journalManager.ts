import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SessionSummary } from "./summarizer";
import { Logger } from "./logger";

/**
 * Manages the CodeJournal log file
 */
export class JournalManager {
  private disposed = false;

  constructor() {
    // Init
  }

  /**
   * Add a session summary to the journal file
   */
  public async addToJournal(summary: SessionSummary): Promise<boolean> {
    if (this.disposed) {
      Logger.debug("Cannot add to journal: manager disposed", "JournalManager");
      return false;
    }

    try {
      // Get the configured journal path or use default
      const journalPath = this.getJournalFilePath();

      // Format the summary
      const formattedSummary = this.formatSummaryForJournal(summary);

      // Append to journal
      await this.updateJournalFile(journalPath, formattedSummary);

      Logger.info(
        `Session summary added to journal at ${journalPath}`,
        "JournalManager"
      );
      return true;
    } catch (error) {
      Logger.error(`Error adding to journal`, "JournalManager", error);
      return false;
    }
  }

  /**
   * Get the journal file path from settings or use default
   */
  private getJournalFilePath(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder open");
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Get configured path or use default
    const configuredPath = vscode.workspace
      .getConfiguration("codejournal")
      .get("journalFilePath");

    if (configuredPath && typeof configuredPath === "string") {
      // If path is absolute, use it directly
      if (path.isAbsolute(configuredPath)) {
        return configuredPath;
      }
      // Otherwise, resolve relative to workspace root
      return path.join(rootPath, configuredPath);
    }

    // Default path is .codejournal in the workspace root
    return path.join(rootPath, ".codejournal");
  }

  /**
   * Update the journal file with a new summary entry in reverse chronological order
   */
  private async updateJournalFile(
    filePath: string,
    summaryEntry: string
  ): Promise<void> {
    try {
      let existingContent = "";
      let header = "# CodeJournal\n\n";

      // Check if file exists
      if (fs.existsSync(filePath)) {
        existingContent = fs.readFileSync(filePath, "utf8");

        // If the file already has content
        if (existingContent.startsWith("# CodeJournal")) {
          // Remove the header from existing content for proper insertion
          header = "";
          existingContent = existingContent.replace("# CodeJournal\n\n", "");
        }
      }

      // Combine new entry with existing content
      // Add header + new entry + existing content for reverse chronological order
      const updatedContent = header + summaryEntry + existingContent;

      // Write the updated content back to the file
      fs.writeFileSync(filePath, updatedContent);
    } catch (error) {
      Logger.error(
        `Error updating journal file at ${filePath}`,
        "JournalManager",
        error
      );
      throw error;
    }
  }

  /**
   * Format a session summary for the journal file
   */
  private formatSummaryForJournal(summary: SessionSummary): string {
    // Format the ISO timestamp to a more readable format
    const date = new Date(summary.startTime);
    const formattedDate = date
      .toISOString()
      .replace("T", " at ")
      .replace(/\.\d+Z$/, "");

    let output = `## Session ${formattedDate} UTC\n\n`;

    summary.files.forEach((file) => {
      output += `### ${file.filePath}\n`;

      file.changes.forEach((change) => {
        output += `- **${change.timestamp}** ${change.description}\n`;
      });

      output += "\n";
    });

    return output;
  }

  /**
   * Open the journal file in the editor
   */
  public async openJournalFile(): Promise<void> {
    try {
      const journalPath = this.getJournalFilePath();

      // Create the file if it doesn't exist
      if (!fs.existsSync(journalPath)) {
        fs.writeFileSync(journalPath, "# CodeJournal\n\n");
      }

      // Open the file in the editor
      const document = await vscode.workspace.openTextDocument(journalPath);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      Logger.error("Error opening journal file", "JournalManager", error);
      throw error;
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposed = true;
  }
}
