import * as vscode from 'vscode';
import * as path from 'path';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

import { Session } from './types';
import { Change } from './changeTracker';

/**
 * Schema for a change summary entry
 */
const ChangeSummarySchema = z.object({
  timestamp: z.string().describe("The timestamp of the change in HH:MM:SS format"),
  description: z.string().describe("A concise description of what was changed")
});

/**
 * Schema for a file with its summarized changes
 */
const FileSummarySchema = z.object({
  filePath: z.string().describe("The path to the file"),
  changes: z.array(ChangeSummarySchema).describe("List of changes to this file")
});

/**
 * Schema for the complete summary structure
 */
const SummarySchema = z.object({
  files: z.array(FileSummarySchema).describe("List of files with their changes")
});

/**
 * Type for a change summary entry
 */
export type ChangeSummary = z.infer<typeof ChangeSummarySchema>;

/**
 * Type for a file with its summarized changes
 */
export type FileSummary = z.infer<typeof FileSummarySchema>;

/**
 * Type for a complete session summary
 */
export interface SessionSummary {
  sessionId: string;
  startTime: string;
  endTime: string;
  files: FileSummary[];
}

/**
 * Handles generating summaries of code changes
 */
export class Summarizer {
  private disposed = false;
  
  constructor() {
    // Init
  }
  
  /**
   * Generate a summary for a completed session
   */
  public async summarizeSession(session: Session, changes: Change[]): Promise<SessionSummary | undefined> {
    if (this.disposed) {
      console.log('Cannot generate summary: summarizer disposed');
      return undefined;
    }
    
    if (!session.endTime) {
      console.log('Cannot generate summary: session is still active');
      return undefined;
    }
    
    if (changes.length === 0) {
      console.log('Cannot generate summary: no changes in session');
      return undefined;
    }
    
    try {
      // Check if API key and model are configured
      const apiKey = vscode.workspace.getConfiguration('codejournal').get('anthropicApiKey');
      if (!apiKey) {
        console.log('Cannot generate summary: no Anthropic API key configured');
        return undefined;
      }

      const anthropicModel = vscode.workspace.getConfiguration('codejournal').get('anthropicModel') || 'claude-3-7-sonnet-latest';
      if (typeof anthropicModel !== 'string') {
        console.log('Cannot generate summary: invalid Anthropic model configured');
        return undefined;
      }

      // Initialize the Vercel AI SDK with the API key
      const anthropic = createAnthropic({
        apiKey: apiKey as string,
      });
      
      // Group changes by file
      const changesByFile = this.groupChangesByFile(changes);
      
      // Prepare the prompt with the changes
      const prompt = this.preparePrompt(changesByFile);
      
      // Generate the summary using Vercel AI SDK
      const result = await generateObject({
        model: anthropic(anthropicModel),
        schema: SummarySchema,
        schemaName: "CodeChangeSummary",
        schemaDescription: "A structured summary of code changes organized by file",
        mode: "tool", // Force tool mode for better structure
        prompt: prompt
      });
      
      // Create the session summary
      const sessionSummary: SessionSummary = {
        sessionId: session.id,
        startTime: session.startTime,
        endTime: session.endTime,
        files: result.object.files
      };
      
      return sessionSummary;
    } catch (error) {
      console.error('Error generating summary:', error);
      return undefined;
    }
  }
  
  /**
   * Group changes by file
   */
  private groupChangesByFile(changes: Change[]): Record<string, Change[]> {
    const changesByFile: Record<string, Change[]> = {};
    
    changes.forEach(change => {
      // For rename changes, use the new file path
      const filePath = change.type === 'rename' ? 
        (change as any).newFilePath : change.filePath;
      
      if (!changesByFile[filePath]) {
        changesByFile[filePath] = [];
      }
      
      changesByFile[filePath].push(change);
    });
    
    return changesByFile;
  }
  
  /**
   * Prepare prompt for the LLM
   */
  private preparePrompt(changesByFile: Record<string, Change[]>): string {
    let prompt = `You are a specialized code analyzer that generates structured summaries of code changes.

YOUR TASK:
- Analyze the code changes below
- Generate a structured summary following the schema exactly
- For each file, create a list of changes with timestamps and descriptions
- Each description should be concise (1-2 sentences) and focus on the purpose of the change

IMPORTANT: Your response MUST be valid structured data that matches this exact schema:
{
  "files": [
    {
      "filePath": "path/to/file.ts",
      "changes": [
        {
          "timestamp": "HH:MM:SS",
          "description": "Added new function to handle error cases"
        },
        ...more changes
      ]
    },
    ...more files
  ]
}

Do NOT include any explanatory text or markdown formatting outside this structure.

Changes by file:
`;
    
    for (const [filePath, changes] of Object.entries(changesByFile)) {
      const filename = path.basename(filePath);
      prompt += `\n## ${filename} (${filePath})\n`;
      
      // Sort changes by timestamp
      changes.sort((a, b) => {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
      
      changes.forEach(change => {
        const timestamp = new Date(change.timestamp);
        const timeString = timestamp.toISOString().substring(11, 19); // HH:MM:SS format
        
        prompt += `\n### Change at ${timeString} (${change.type})\n`;
        
        switch (change.type) {
          case 'save':
            const saveChange = change as any;
            prompt += `Old content length: ${saveChange.oldContent.length} characters\n`;
            prompt += `New content length: ${saveChange.newContent.length} characters\n`;
            
            // Include a diff-like representation for context
            const oldLines = saveChange.oldContent.split('\n');
            const newLines = saveChange.newContent.split('\n');
            const maxLines = 10000;
            
            if (oldLines.length <= maxLines && newLines.length <= maxLines) {
              prompt += "Old content:\n```\n" + saveChange.oldContent + "\n```\n";
              prompt += "New content:\n```\n" + saveChange.newContent + "\n```\n";
            } else {
              // Show a sample of the diff instead
              prompt += "Changes too large to include in full.\n";
              prompt += `Old content: ${oldLines.slice(0, 5).join('\n')}\n...\n`;
              prompt += `New content: ${newLines.slice(0, 5).join('\n')}\n...\n`;
            }
            break;
            
          case 'create':
            const createChange = change as any;
            prompt += `New file created with ${createChange.content.length} characters\n`;
            break;
            
          case 'delete':
            prompt += `File deleted\n`;
            break;
            
          case 'rename':
            const renameChange = change as any;
            prompt += `File renamed from ${change.filePath} to ${renameChange.newFilePath}\n`;
            break;
        }
      });
    }
    
    prompt += `\nREMEMBER: You MUST respond with a valid JSON object that matches the schema. Do not include any markdown, text explanations, or anything outside the JSON structure.

Example of expected response format:
{
  "files": [
    {
      "filePath": "/src/components/Button.tsx",
      "changes": [
        {
          "timestamp": "14:35:22",
          "description": "Added hover state styling to improve user feedback"
        },
        {
          "timestamp": "14:38:45",
          "description": "Fixed accessibility issues by adding ARIA attributes"
        }
      ]
    }
  ]
}`;
    
    return prompt;
  }
  
  /**
   * Format a session summary for console output
   */
  public formatSummaryForConsole(summary: SessionSummary): string {
    let output = `## Session Summary (${summary.sessionId})\n`;
    output += `Start time: ${summary.startTime}\n`;
    output += `End time: ${summary.endTime}\n\n`;
    
    summary.files.forEach(file => {
      output += `### ${file.filePath}\n`;
      
      file.changes.forEach(change => {
        output += `- **${change.timestamp}** ${change.description}\n`;
      });
      
      output += '\n';
    });
    
    return output;
  }
  
  /**
   * Format a session summary for journal file
   */
  public formatSummaryForJournal(summary: SessionSummary): string {
    let output = `## Session ${summary.startTime}\n\n`;
    
    summary.files.forEach(file => {
      output += `### ${file.filePath}\n`;
      
      file.changes.forEach(change => {
        output += `- **${change.timestamp}** ${change.description}\n`;
      });
      
      output += '\n';
    });
    
    return output;
  }
  
  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposed = true;
  }
}