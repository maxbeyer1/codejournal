import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Session } from './types';
import { Summarizer } from './summarizer';
import { JournalManager } from './journalManager';

/**
 * Manages CodeJournal sessions
 */
export class SessionController {
  private currentSession?: Session;
  private sessions: Session[] = [];
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private changeTracker?: any; // Using any to avoid circular dependency
  private summarizer: Summarizer;
  private journalManager: JournalManager;

  constructor() {
    // Create status bar item to show session status
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.updateStatusBar();
    this.statusBarItem.show();

    // Initialize the summarizer and journal manager
    this.summarizer = new Summarizer();
    this.journalManager = new JournalManager();
    this.disposables.push(this.summarizer, this.journalManager);
  }
  
  /**
   * Set the change tracker reference
   */
  public setChangeTracker(changeTracker: any): void {
    this.changeTracker = changeTracker;
  }

  /**
   * Start a new session
   */
  public startSession(): Session | undefined {
    // If there's already an active session, don't start a new one
    if (this.currentSession && !this.currentSession.endTime) {
      vscode.window.showInformationMessage('A CodeJournal session is already active.');
      return undefined;
    }

    this.currentSession = {
      id: this.generateSessionId(),
      startTime: new Date().toISOString()
    };

    this.sessions.push(this.currentSession);
    
    // Update status bar
    this.updateStatusBar();
    
    console.log(`CodeJournal session started`);
    console.log(`Session ID: ${this.currentSession.id}`);
    console.log(`Start time: ${this.currentSession.startTime}`);
    console.log('---');
    
    vscode.window.showInformationMessage('CodeJournal session started.');
    
    return this.currentSession;
  }

  /**
   * Stop the current session
   */
  public async stopSession(): Promise<Session | undefined> {
    // If there's no active session, can't stop one
    if (!this.currentSession || this.currentSession.endTime) {
      vscode.window.showInformationMessage('No active CodeJournal session to stop.');
      return undefined;
    }

    // Set end time
    this.currentSession.endTime = new Date().toISOString();
    
    // Update status bar
    this.updateStatusBar();
    
    // Get session changes if change tracker is available
    const sessionChanges = this.changeTracker?.getChangesBySession(this.currentSession.id) || [];
    
    // Log session summary for debugging
    console.log(`CodeJournal session stopped`);
    console.log(`Session ID: ${this.currentSession.id}`);
    console.log(`Start time: ${this.currentSession.startTime}`);
    console.log(`End time: ${this.currentSession.endTime}`);
    console.log(`Duration: ${this.calculateDuration(this.currentSession)} minutes`);
    console.log(`Total changes: ${sessionChanges.length}`);
    
    if (sessionChanges.length > 0) {
      // Group changes by type
      const changesByType = this.groupChangesByType(sessionChanges);
      
      console.log('Changes summary:');
      for (const [type, changes] of Object.entries(changesByType)) {
        console.log(`- ${type}: ${changes.length} changes`);
      }
      
      console.log('Change IDs:');
      sessionChanges.forEach((change: { id: string; type: string; filePath: string }) => {
        console.log(`- ${change.id} (${change.type}: ${change.filePath})`);
      });

      // Generate a summary using the LLM if we have changes
      try {
        console.log('Generating LLM summary...');
        const session = this.currentSession; // Capture for async closure
        
        // Generate the summary asynchronously
        const summary = await this.summarizer.summarizeSession(session, sessionChanges);
        
        if (summary) {
          const formattedSummary = this.summarizer.formatSummaryForConsole(summary);
          console.log('\nLLM-GENERATED SUMMARY:');
          console.log(formattedSummary);
          
          // Store the summary with the session for later use
          (this.currentSession as any).summary = summary;
          
          // Add the summary to the journal file
          try {
            await this.journalManager.addToJournal(summary);
            console.log('Session summary added to journal file');
          } catch (error) {
            console.error('Error adding summary to journal:', error);
          }
        } else {
          console.log('Could not generate summary - API key may not be configured.');
        }
      } catch (error) {
        console.error('Error generating summary:', error);
      }
    }
    
    console.log('---');
    
    vscode.window.showInformationMessage(`CodeJournal session stopped. ${sessionChanges.length} changes recorded.`);
    
    return this.currentSession;
  }
  
  /**
   * Group changes by type
   */
  private groupChangesByType(changes: { type: string }[]): Record<string, { type: string }[]> {
    const result: Record<string, { type: string }[]> = {};
    
    changes.forEach(change => {
      if (!result[change.type]) {
        result[change.type] = [];
      }
      result[change.type].push(change);
    });
    
    return result;
  }

  /**
   * Get the current session
   */
  public getCurrentSession(): Session | undefined {
    if (this.currentSession && !this.currentSession.endTime) {
      return this.currentSession;
    }
    return undefined;
  }

  /**
   * Get all sessions
   */
  public getSessions(): Session[] {
    return [...this.sessions];
  }

  /**
   * Check if a session is currently active
   */
  public isSessionActive(): boolean {
    return !!this.currentSession && !this.currentSession.endTime;
  }

  /**
   * Generate a unique ID for a session
   */
  private generateSessionId(): string {
    return crypto.randomUUID();
  }

  /**
   * Calculate duration of a session in minutes
   */
  private calculateDuration(session: Session): number {
    if (!session.endTime) {
      return 0;
    }
    
    const startTime = new Date(session.startTime).getTime();
    const endTime = new Date(session.endTime).getTime();
    const durationMs = endTime - startTime;
    
    return Math.round(durationMs / (1000 * 60));
  }

  /**
   * Update the status bar item based on current session state
   */
  private updateStatusBar(): void {
    if (this.currentSession && !this.currentSession.endTime) {
      this.statusBarItem.text = '$(record) CodeJournal: Recording';
      this.statusBarItem.tooltip = 'CodeJournal is recording changes';
      this.statusBarItem.command = 'codejournal.stopSession';
    } else {
      this.statusBarItem.text = '$(play) CodeJournal: Idle';
      this.statusBarItem.tooltip = 'Start recording changes with CodeJournal';
      this.statusBarItem.command = 'codejournal.startSession';
    }
  }

  /**
   * Open the journal file
   */
  public async openJournal(): Promise<void> {
    await this.journalManager.openJournalFile();
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.statusBarItem.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}