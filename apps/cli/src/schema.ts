/** Stable envelope used by every command rendered with --json. */
/** CLI JSON 输出的公开 Schema，供脚本和其他 Agent 校验。 */
export const cliOutputJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://jobhunter.local/schemas/cli-output.schema.json',
  title: 'JobHunter CLI JSON output',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'data'],
      properties: {
        ok: { const: true },
        data: {},
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'error'],
      properties: {
        ok: { const: false },
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message', 'details'],
          properties: {
            code: { type: 'string', minLength: 1 },
            message: { type: 'string', minLength: 1 },
            details: { type: 'object' },
          },
        },
      },
    },
  ],
} as const;
