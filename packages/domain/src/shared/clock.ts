import type { UtcInstant } from './instant.js';

export interface Clock {
  now(): UtcInstant;
}
