export interface DemoEvent { readonly kind: string; readonly title: string; readonly detail: string }
export const STATIC_SCENARIO: readonly DemoEvent[] = Object.freeze([
  { kind: 'decision', title: 'Agent 决策', detail: '分析任务并选择受控工具。' },
  { kind: 'tool', title: '安全工具', detail: '读取隔离工作区中的文件。' },
  { kind: 'guardrail', title: '危险操作被阻止', detail: '护栏要求人工确认，演示中不会真正执行。' },
  { kind: 'feedback', title: '测试失败', detail: '反馈闭环识别出一个可修复问题。' },
  { kind: 'revision', title: '调整行动', detail: 'Agent 根据结构化反馈修改方案。' },
  { kind: 'complete', title: '验证通过', detail: '第二轮测试通过，流程结束。' },
]);
