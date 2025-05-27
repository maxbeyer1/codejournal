import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TelemetryReporter } from '@vscode/extension-telemetry';

import { Session } from './types';
import { Summarizer } from './summarizer';
import { JournalManager } from './journalManager';
import { Logger } from './logger';

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
  private isSummarizing: boolean = false;
  private journalTreeDataProvider?: any; // Reference to tree data provider for refreshing
  private reporter?: TelemetryReporter; // Telemetry reporter

  constructor(reporter?: TelemetryReporter) {
    this.reporter = reporter;
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
   * Set the journal tree data provider reference for refreshing
   */
  public setJournalTreeDataProvider(provider: any): void {
    this.journalTreeDataProvider = provider;
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
    
    Logger.info(`Session started with ID: ${this.currentSession.id}`, 'SessionController');
    Logger.info(`Start time: ${this.currentSession.startTime}`, 'SessionController');
    
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
    Logger.info(`Session with ID ${this.currentSession.id} stopped`, 'SessionController');
    Logger.debug(`Start time: ${this.currentSession.startTime}`, 'SessionController');
    Logger.debug(`End time: ${this.currentSession.endTime}`, 'SessionController');
    Logger.debug(`Duration: ${this.calculateDuration(this.currentSession)} minutes`, 'SessionController');
    Logger.debug(`Total changes: ${sessionChanges.length}`, 'SessionController');
    
    if (sessionChanges.length > 0) {
      // Group changes by type
      const changesByType = this.groupChangesByType(sessionChanges);
      
      Logger.debug('Changes by type:', 'SessionController');
      for (const [type, changes] of Object.entries(changesByType)) {
        Logger.debug(`- ${type}: ${changes.length} changes`, 'SessionController');
      }
      
      Logger.debug('Change IDs:', 'SessionController');
      sessionChanges.forEach((change: { id: string; type: string; filePath: string }) => {
        Logger.debug(`- ${change.id} (${change.type}: ${change.filePath})`, 'SessionController');
      });

      // Generate a summary using the LLM if we have changes
      try {
        Logger.info('Generating summary for session changes', 'SessionController');
        
        // Set loading state and update status bar
        this.isSummarizing = true;
        this.updateStatusBar();
        
        const session = this.currentSession; // Capture for async closure
        
        // Generate the summary asynchronously
        const result = await this.summarizer.summarizeSession(session, sessionChanges);
        
        if (result.summary) {
          const formattedSummary = this.summarizer.formatSummaryForConsole(result.summary);
          Logger.debug('\nLLM-GENERATED SUMMARY:', 'SessionController');
          Logger.debug(formattedSummary, 'SessionController');
          
          // Store the summary with the session for later use
          (this.currentSession as any).summary = result.summary;
          
          // Add the summary to the journal file
          try {
            await this.journalManager.addToJournal(result.summary);
            Logger.info('Session summary added to journal file', 'SessionController');
            
            // Send summary generation telemetry
            if (this.reporter) {
              this.reporter.sendTelemetryEvent('summaryGenerated', {
                'sessionId': session.id,
                'changeCount': sessionChanges.length.toString()
              }, {
                'timestamp': Date.now(),
                'sessionDuration': this.calculateDuration(session) * 60000 // Convert to ms
              });
            }
            
            // Refresh the journal tree view to show the new entry
            if (this.journalTreeDataProvider) {
              this.journalTreeDataProvider.refresh();
            }
          } catch (error) {
            Logger.error('Failed to save summary to journal file', 'SessionController', error);
            vscode.window.showErrorMessage('CodeJournal: Failed to save summary to journal file.');
          }
        } else if (result.error) {
          Logger.error('Summary generation failed', 'SessionController', result.error);
          
          // Send error telemetry
          if (this.reporter) {
            this.reporter.sendTelemetryErrorEvent('summaryGenerationFailed', {
              'sessionId': session.id,
              'errorMessage': result.error.message,
              'retryable': result.error.retryable?.toString(),
              'changeCount': sessionChanges.length.toString()
            }, {
              'timestamp': Date.now()
            });
          }
          
          // The specific error handling and user messages are already handled in the summarizer
          // Just log additional context here
          if (result.error.details) {
            Logger.error(`Error details: ${result.error.details}`, 'SessionController');
          }
          
          // Show a retry option for retryable errors
          if (result.error.retryable) {
            const retryMessage = `Summary generation failed: ${result.error.message}`;
            vscode.window.showErrorMessage(retryMessage, 'Retry').then(selection => {
              if (selection === 'Retry') {
                // Recursively retry the summary generation
                this.retryGenerateSummary(session, sessionChanges);
              }
            });
          }
        } else {
          // Fallback case - should not happen with the new error handling
          Logger.error('Failed to generate summary for unknown reason', 'SessionController');
          vscode.window.showErrorMessage('CodeJournal: Failed to generate summary for unknown reason.');
        }
      } catch (error) {
        Logger.error('Error generating summary', 'SessionController', error);
        
        // Send error telemetry for unexpected errors
        if (this.reporter && this.currentSession) {
          this.reporter.sendTelemetryErrorEvent('summaryGenerationError', {
            'sessionId': this.currentSession.id,
            'errorType': 'unexpected',
            'changeCount': sessionChanges.length.toString()
          }, {
            'timestamp': Date.now()
          });
        }
      } finally {
        // Clear loading state and update status bar
        this.isSummarizing = false;
        this.updateStatusBar();
      }
    }
      
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
    if (this.isSummarizing) {
      this.statusBarItem.text = '$(loading~spin) CodeJournal: Generating Summary';
      this.statusBarItem.tooltip = 'CodeJournal is generating a summary of the session';
      this.statusBarItem.command = undefined; // Disable clicking during summarization
    } else if (this.currentSession && !this.currentSession.endTime) {
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
   * Retry summary generation for failed attempts
   */
  private async retryGenerateSummary(session: Session, sessionChanges: any[]): Promise<void> {
    Logger.info('Retrying summary generation for session', 'SessionController');
    
    try {
      // Set loading state again
      this.isSummarizing = true;
      this.updateStatusBar();
      
      const result = await this.summarizer.summarizeSession(session, sessionChanges);
      
      if (result.summary) {
        const formattedSummary = this.summarizer.formatSummaryForConsole(result.summary);

        Logger.debug('\nRETRY - LLM-GENERATED SUMMARY:', 'SessionController');
        Logger.debug(formattedSummary, 'SessionController');
        
        // Store the summary with the session for later use
        (session as any).summary = result.summary;
        
        // Add the summary to the journal file
        try {
          await this.journalManager.addToJournal(result.summary);
          Logger.info('Session summary added to journal file after retry', 'SessionController');
          vscode.window.showInformationMessage('CodeJournal: Summary generated successfully after retry.');
          
          // Refresh the journal tree view to show the new entry
          if (this.journalTreeDataProvider) {
            this.journalTreeDataProvider.refresh();
          }
        } catch (error) {
          Logger.error('Failed to save summary to journal file after retry', 'SessionController', error);
          vscode.window.showErrorMessage('CodeJournal: Failed to save summary to journal file.');
        }
      } else if (result.error) {
        Logger.error('Retry summary generation failed', 'SessionController', result.error);
        // Don't show another retry option to avoid infinite loops
        vscode.window.showErrorMessage(`CodeJournal: Retry failed - ${result.error.message}`);
      }
    } catch (error) {
      Logger.error('Error during retry summary generation', 'SessionController', error);
      vscode.window.showErrorMessage('CodeJournal: Retry attempt failed.');
    } finally {
      // Clear loading state
      this.isSummarizing = false;
      this.updateStatusBar();
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