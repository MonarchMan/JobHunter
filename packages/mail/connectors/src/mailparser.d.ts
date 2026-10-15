declare module 'mailparser' {
  export interface ParsedMail {
    subject?: string;
    from?: { value?: Array<{ name?: string; address?: string }> };
    text?: string;
    html?: string | Buffer;
    attachments: Array<{ contentType: string; content: Buffer }>;
    headers: Map<string, unknown>;
  }
  export function simpleParser(source: Buffer | Uint8Array): Promise<ParsedMail>;
}
