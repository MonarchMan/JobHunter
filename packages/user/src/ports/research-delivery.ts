/** 面经结果的本地交付位置；调用方不能指定任意读取路径。 */
export interface ResearchDelivery {
  location(taskId: string): string;
  prepare(taskId: string): Promise<void>;
  read(taskId: string): Promise<Uint8Array>;
  write(taskId: string, content: Uint8Array): Promise<void>;
}
