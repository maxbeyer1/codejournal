import * as vscode from "vscode";
import * as path from "path";
import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  APICallError,
  InvalidArgumentError,
  NoContentGeneratedError,
  NoSuchModelError,
  RetryError,
  InvalidResponseDataError,
  JSONParseError,
  LoadAPIKeyError,
} from "ai";

import { Session } from "./types";
import { Change } from "./changeTracker";

/**
 * Schema for a change summary entry
 */
const ChangeSummarySchema = z.object({
  timestamp: z
    .string()
    .describe("The timestamp of the change in HH:MM:SS format"),
  description: z.string().describe("A concise description of what was changed"),
});

/**
 * Schema for a file with its summarized changes
 */
const FileSummarySchema = z.object({
  filePath: z.string().describe("The path to the file"),
  changes: z
    .array(ChangeSummarySchema)
    .describe("List of changes to this file"),
});

/**
 * Schema for the complete summary structure
 */
const SummarySchema = z.object({
  files: z
    .array(FileSummarySchema)
    .describe("List of files with their changes"),
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
 * Error types for summarization failures
 */
export interface SummarizationError {
  type:
    | "api_error"
    | "network_error"
    | "token_limit"
    | "config_error"
    | "unknown_error";
  message: string;
  details?: string;
  retryable?: boolean;
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
  public async summarizeSession(
    session: Session,
    changes: Change[]
  ): Promise<{ summary?: SessionSummary; error?: SummarizationError }> {
    if (this.disposed) {
      console.log("Cannot generate summary: summarizer disposed");
      return {
        error: {
          type: "config_error",
          message: "Summarizer has been disposed",
          retryable: false,
        },
      };
    }

    if (!session.endTime) {
      console.log("Cannot generate summary: session is still active");
      return {
        error: {
          type: "config_error",
          message: "Cannot summarize an active session",
          retryable: false,
        },
      };
    }

    if (changes.length === 0) {
      console.log("Cannot generate summary: no changes in session");
      return {
        error: {
          type: "config_error",
          message: "No changes found in session",
          retryable: false,
        },
      };
    }

    try {
      // Check if API key and model are configured
      const apiKey = vscode.workspace
        .getConfiguration("codejournal")
        .get("anthropicApiKey");
      if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
        console.log("Cannot generate summary: no Anthropic API key configured");
        vscode.window
          .showErrorMessage(
            "CodeJournal: API key required for summary generation. Please configure your Anthropic API key in settings.",
            "Open Settings"
          )
          .then((selection) => {
            if (selection === "Open Settings") {
              vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "codejournal.anthropicApiKey"
              );
            }
          });
        return {
          error: {
            type: "config_error",
            message: "No Anthropic API key configured",
            details: "Please configure your API key in CodeJournal settings",
            retryable: false,
          },
        };
      }

      const anthropicModel =
        vscode.workspace
          .getConfiguration("codejournal")
          .get("anthropicModel") || "claude-3-7-sonnet-latest";
      if (typeof anthropicModel !== "string") {
        console.log(
          "Cannot generate summary: invalid Anthropic model configured"
        );
        vscode.window
          .showErrorMessage(
            "CodeJournal: Invalid model configuration. Please check your model setting.",
            "Open Settings"
          )
          .then((selection) => {
            if (selection === "Open Settings") {
              vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "codejournal.anthropicModel"
              );
            }
          });
        return {
          error: {
            type: "config_error",
            message: "Invalid Anthropic model configured",
            details: "Model must be a valid string",
            retryable: false,
          },
        };
      }

      // Group changes by file
      const changesByFile = this.groupChangesByFile(changes);

      // Check for potentially large content that might exceed token limits
      const contentSizeEstimate = this.estimateContentSize(changesByFile);
      const maxTokenEstimate = 500000; // Estimate for Claude's 200k context window

      if (contentSizeEstimate > maxTokenEstimate) {
        console.log(
          `Content size estimate (${contentSizeEstimate}) may exceed token limits`
        );
        vscode.window
          .showWarningMessage(
            "CodeJournal: Large amount of changes detected. Summary may be truncated or fail.",
            "Continue Anyway",
            "Cancel"
          )
          .then((selection) => {
            if (selection === "Cancel") {
              return;
            }
          });
      }

      // Prepare the prompt with the changes
      const prompt = this.preparePrompt(changesByFile);

      // Initialize the Vercel AI SDK with the API key
      let anthropic;
      try {
        anthropic = createAnthropic({
          apiKey: apiKey as string,
        });
      } catch (error) {
        console.error("Error creating Anthropic client:", error);
        vscode.window.showErrorMessage(
          "CodeJournal: Failed to initialize AI client. Please check your API key."
        );
        return {
          error: {
            type: "config_error",
            message: "Failed to initialize Anthropic client",
            details: error instanceof Error ? error.message : "Unknown error",
            retryable: false,
          },
        };
      }

      // Generate the summary using Vercel AI SDK with timeout
      let result;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Request timeout after 60 seconds")),
            60000
          );
        });

        const generatePromise = generateObject({
          model: anthropic(anthropicModel),
          schema: SummarySchema,
          schemaName: "CodeChangeSummary",
          schemaDescription:
            "A structured summary of code changes organized by file",
          mode: "tool", // Force tool mode for better structure
          prompt: prompt,
          maxRetries: 2,
        });

        result = (await Promise.race([generatePromise, timeoutPromise])) as any;
      } catch (error) {
        return this.handleAIError(error);
      }

      // Validate the result
      if (!result || !result.object || !result.object.files) {
        console.error("Invalid response from AI service");
        vscode.window.showErrorMessage(
          "CodeJournal: Received invalid response from AI service."
        );
        return {
          error: {
            type: "api_error",
            message: "Invalid response format from AI service",
            retryable: true,
          },
        };
      }

      // Create the session summary
      const sessionSummary: SessionSummary = {
        sessionId: session.id,
        startTime: session.startTime,
        endTime: session.endTime,
        files: result.object.files,
      };

      return { summary: sessionSummary };
    } catch (error) {
      console.error("Unexpected error generating summary:", error);
      return this.handleAIError(error);
    }
  }

  /**
   * Group changes by file
   */
  private groupChangesByFile(changes: Change[]): Record<string, Change[]> {
    const changesByFile: Record<string, Change[]> = {};

    changes.forEach((change) => {
      // For rename changes, use the new file path
      const filePath =
        change.type === "rename"
          ? (change as any).newFilePath
          : change.filePath;

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
        return (
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      });

      changes.forEach((change) => {
        const timestamp = new Date(change.timestamp);
        const timeString = timestamp.toISOString().substring(11, 19); // HH:MM:SS format

        prompt += `\n### Change at ${timeString} (${change.type})\n`;

        switch (change.type) {
          case "save":
            const saveChange = change as any;
            prompt += `Old content length: ${saveChange.oldContent.length} characters\n`;
            prompt += `New content length: ${saveChange.newContent.length} characters\n`;

            // Include a diff-like representation for context
            const oldLines = saveChange.oldContent.split("\n");
            const newLines = saveChange.newContent.split("\n");
            const maxLines = 10000;

            if (oldLines.length <= maxLines && newLines.length <= maxLines) {
              prompt +=
                "Old content:\n```\n" + saveChange.oldContent + "\n```\n";
              prompt +=
                "New content:\n```\n" + saveChange.newContent + "\n```\n";
            } else {
              // Show a sample of the diff instead
              prompt += "Changes too large to include in full.\n";
              prompt += `Old content: ${oldLines
                .slice(0, 5)
                .join("\n")}\n...\n`;
              prompt += `New content: ${newLines
                .slice(0, 5)
                .join("\n")}\n...\n`;
            }
            break;

          case "create":
            const createChange = change as any;
            prompt += `New file created with ${createChange.content.length} characters\n`;
            break;

          case "delete":
            prompt += `File deleted\n`;
            break;

          case "rename":
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
   * Format a session summary for journal file
   */
  public formatSummaryForJournal(summary: SessionSummary): string {
    let output = `## Session ${summary.startTime}\n\n`;

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
   * Handle AI-specific errors with appropriate user feedback
   */
  private handleAIError(error: unknown): { error: SummarizationError } {
    console.error("AI Error details:", error);

    // Handle specific Vercel AI SDK errors
    if (error instanceof APICallError) {
      const statusCode = (error as any).statusCode;
      let message = "API request failed";
      let details = error.message;
      let retryable = true;

      if (statusCode === 401) {
        message = "Invalid API key";
        details = "Please check your Anthropic API key configuration";
        retryable = false;
        vscode.window
          .showErrorMessage(
            "CodeJournal: Invalid API key. Please check your Anthropic API key configuration.",
            "Open Settings"
          )
          .then((selection) => {
            if (selection === "Open Settings") {
              vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "codejournal.anthropicApiKey"
              );
            }
          });
      } else if (statusCode === 429) {
        message = "Rate limit exceeded";
        details = "Please wait before trying again";
        vscode.window.showWarningMessage(
          "CodeJournal: Rate limit exceeded. Please wait before generating another summary."
        );
      } else if (statusCode === 404) {
        message = "Model not found";
        details = "The specified model does not exist or is not available";
        vscode.window
          .showErrorMessage(
            "CodeJournal: The specified AI model is not available. Please check your model configuration.",
            "Open Settings"
          )
          .then((selection) => {
            if (selection === "Open Settings") {
              vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "codejournal.anthropicModel"
              );
            }
          });
      } else if (statusCode >= 500) {
        message = "Server error";
        details = "Anthropic service is experiencing issues";
        vscode.window.showErrorMessage(
          "CodeJournal: AI service is experiencing issues. Please try again later."
        );
      } else {
        vscode.window.showErrorMessage(
          `CodeJournal: API error (${statusCode}). Please try again.`
        );
      }

      return {
        error: {
          type: "api_error",
          message,
          details,
          retryable,
        },
      };
    }

    if (error instanceof NoSuchModelError) {
      vscode.window
        .showErrorMessage(
          "CodeJournal: Invalid model specified. Please check your model configuration.",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "codejournal.anthropicModel"
            );
          }
        });
      return {
        error: {
          type: "config_error",
          message: "Invalid model specified",
          details: (error as any).message,
          retryable: false,
        },
      };
    }

    if (error instanceof InvalidArgumentError) {
      vscode.window.showErrorMessage(
        "CodeJournal: Invalid request configuration. Please check your settings."
      );
      return {
        error: {
          type: "config_error",
          message: "Invalid request configuration",
          details: error.message,
          retryable: false,
        },
      };
    }

    if (error instanceof NoContentGeneratedError) {
      vscode.window.showWarningMessage(
        "CodeJournal: No summary could be generated for this session."
      );
      return {
        error: {
          type: "api_error",
          message: "No content generated",
          details: error.message,
          retryable: true,
        },
      };
    }

    if (
      error instanceof JSONParseError ||
      error instanceof InvalidResponseDataError
    ) {
      vscode.window.showErrorMessage(
        "CodeJournal: Invalid response from AI service. Please try again."
      );
      return {
        error: {
          type: "api_error",
          message: "Invalid response format",
          details: error.message,
          retryable: true,
        },
      };
    }

    if (error instanceof RetryError) {
      vscode.window.showErrorMessage(
        "CodeJournal: Request failed after multiple retries. Please check your connection."
      );
      return {
        error: {
          type: "network_error",
          message: "Request failed after retries",
          details: error.message,
          retryable: true,
        },
      };
    }

    if (error instanceof LoadAPIKeyError) {
      vscode.window
        .showErrorMessage(
          "CodeJournal: API key loading error. Please check your configuration.",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "codejournal.anthropicApiKey"
            );
          }
        });
      return {
        error: {
          type: "config_error",
          message: "API key loading error",
          details: error.message,
          retryable: false,
        },
      };
    }

    // Handle network errors
    if (error instanceof Error) {
      if (
        error.message.includes("timeout") ||
        error.message.includes("Request timeout")
      ) {
        vscode.window.showErrorMessage(
          "CodeJournal: Request timed out. The AI service may be overloaded."
        );
        return {
          error: {
            type: "network_error",
            message: "Request timeout",
            details: "AI service request timed out after 60 seconds",
            retryable: true,
          },
        };
      }

      if (
        error.message.includes("network") ||
        error.message.includes("ENOTFOUND") ||
        error.message.includes("ECONNREFUSED")
      ) {
        vscode.window.showErrorMessage(
          "CodeJournal: Network error. Please check your internet connection."
        );
        return {
          error: {
            type: "network_error",
            message: "Network connectivity error",
            details: error.message,
            retryable: true,
          },
        };
      }
    }

    // Fallback for unknown errors
    vscode.window.showErrorMessage(
      "CodeJournal: An unexpected error occurred while generating the summary."
    );
    return {
      error: {
        type: "unknown_error",
        message: "Unexpected error occurred",
        details: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    };
  }

  /**
   * Estimate content size to detect potential token limit issues
   */
  private estimateContentSize(changesByFile: Record<string, Change[]>): number {
    let totalSize = 0;

    for (const [filePath, changes] of Object.entries(changesByFile)) {
      totalSize += filePath.length;

      changes.forEach((change) => {
        switch (change.type) {
          case "save":
            const saveChange = change as any;
            totalSize +=
              (saveChange.oldContent?.length || 0) +
              (saveChange.newContent?.length || 0);
            break;
          case "create":
            const createChange = change as any;
            totalSize += createChange.content?.length || 0;
            break;
          case "rename":
            const renameChange = change as any;
            totalSize += renameChange.newFilePath?.length || 0;
            break;
        }
      });
    }

    // Add base prompt overhead
    totalSize += 2000;

    return totalSize;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposed = true;
  }
}
