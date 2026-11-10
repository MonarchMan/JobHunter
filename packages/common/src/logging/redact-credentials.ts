/** 脱敏错误文本中的凭据赋值，完整消费带引号及转义的值，避免残留 JSON 密钥片段。 */
export function redactCredentials(value: string, replacement = '[REDACTED]'): string {
  return value
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${replacement}`)
    .replaceAll(
      /\b(api[-_ ]?key|(?:access[-_ ]?|refresh[-_ ]?)?token|password|cookie|authorization|secret)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
      `$1=${replacement}`,
    );
}
