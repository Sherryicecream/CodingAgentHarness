import React, { useState } from 'react';
import { STATIC_SCENARIO } from './scenario.js';

export function StaticDemoApp() {
  const [visible, setVisible] = useState(0);
  const done = visible >= STATIC_SCENARIO.length;
  return <main className="static-demo">
    <header><span className="badge">浏览器内静态演示</span><h1>Harness 安全反馈闭环</h1>
      <p>此页面无服务器、无模型调用、不会接收 API Key。它以确定性事件重放课程项目的核心机制。</p></header>
    <section className="timeline" aria-live="polite">
      {STATIC_SCENARIO.slice(0, visible).map((event, index) => <article key={index} className={`event ${event.kind}`}>
        <span>{index + 1}</span><div><h2>{event.title}</h2><p>{event.detail}</p></div>
      </article>)}
    </section>
    <div className="actions"><button onClick={() => setVisible(done ? 0 : visible + 1)}>{done ? '重新演示' : visible ? '下一步' : '开始演示'}</button>
      <a href="https://github.com/" rel="noreferrer">完整本地版安装说明</a></div>
  </main>;
}
