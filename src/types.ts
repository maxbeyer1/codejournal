/**
 * Shared type definitions for CodeJournal
 */

/**
 * Represents a coding session
 */
export interface Session {
  id: string;
  startTime: string; // ISO format
  endTime?: string; // ISO format (undefined if session is still active)
}

/**
 * Types of changes that can be tracked
 */
export type ChangeType = 'save' | 'create' | 'delete' | 'rename';

/**
 * Represents a base change to a file
 */
export interface BaseChange {
  id: string;
  timestamp: string; // ISO format
  filePath: string;
  type: ChangeType;
  sessionId?: string; // ID of the session this change belongs to
}