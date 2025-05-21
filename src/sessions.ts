import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Represents a coding session
 */
export interface Session {
  id: string;
  startTime: string; // ISO format
  endTime?: string; // ISO format (undefined if session is still active)
}

/**
 * Manages CodeJournal sessions
 */
export class SessionController {
  private currentSession?: Session;
  private sessions: Session[] = [];
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    // Create status bar item to show session status
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.updateStatusBar();
    this.statusBarItem.show();
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
    
    // Log for debugging
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
  public stopSession(): Session | undefined {
    // If there's no active session, can't stop one
    if (!this.currentSession || this.currentSession.endTime) {
      vscode.window.showInformationMessage('No active CodeJournal session to stop.');
      return undefined;
    }

    // Set end time
    this.currentSession.endTime = new Date().toISOString();
    
    // Update status bar
    this.updateStatusBar();
    
    // Log for debugging
    console.log(`CodeJournal session stopped`);
    console.log(`Session ID: ${this.currentSession.id}`);
    console.log(`Start time: ${this.currentSession.startTime}`);
    console.log(`End time: ${this.currentSession.endTime}`);
    console.log(`Duration: ${this.calculateDuration(this.currentSession)} minutes`);
    console.log('---');
    
    vscode.window.showInformationMessage('CodeJournal session stopped.');
    
    return this.currentSession;
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
   * Dispose of resources
   */
  public dispose(): void {
    this.statusBarItem.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}