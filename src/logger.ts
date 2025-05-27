export class Logger {
    private static readonly PREFIX = '[CodeJournal]';
    private static readonly isDebugMode = process.env.DEBUG_MODE === 'true';

    static info(message: string, className?: string) {
        if (!this.isDebugMode) {
            return;
        }
        const prefix = className ? `${this.PREFIX}[${className}]` : this.PREFIX;
        console.log(`${prefix} ${message}`);
    }

    static error(message: string, className?: string, error?: any) {
        const prefix = className ? `${this.PREFIX}[${className}]` : this.PREFIX;
        console.error(`${prefix} ERROR: ${message}`, error || '');
    }

    static startup(message: string) {
        console.log(`${this.PREFIX} ${message}`);
    }

    static debug(message: string, className?: string) {
        if (!this.isDebugMode) {
            return;
        }
        const prefix = className ? `${this.PREFIX}[${className}]` : this.PREFIX;
        console.log(`${prefix} DEBUG: ${message}`);
    }
}