import type { ReactElement } from 'react';
import panelStyles from '../dashboard-panel.module.css';
import styles from './dashboard-resources.module.css';

/** 首批精选资源只维护公开首页和介绍，不加载第三方资源或传递个人数据。 */
const resources = [
  {
    name: '小林 coding',
    logo: 'xiaolin.webp',
    href: 'https://xiaolincoding.com/',
    topic: '计算机基础 · 后端',
    description: '图解网络、操作系统、MySQL 与 Redis，把高频原理串起来。',
  },
  {
    name: 'JavaGuide',
    logo: 'javaguide.png',
    href: 'https://javaguide.cn/',
    topic: 'Java · 后端',
    description: '从 Java 基础、并发与 JVM，到框架、分布式和系统设计。',
  },
  {
    name: '阿秀的学习笔记',
    logo: 'axiu.png',
    href: 'https://www.interviewguide.cn/',
    topic: '校招 · 学习路线',
    description: '计算机基础、算法笔记与实习校招经验，梳理求职准备路线。',
  },
  {
    name: '面试鸭',
    logo: 'mianshiya.jpg',
    href: 'https://www.mianshiya.com/',
    topic: '多技术栈 · 面试题',
    description: '覆盖多种语言与开发岗位，按技术方向练习面试问答。',
  },
  {
    name: '代码随想录',
    logo: 'carl.png',
    href: 'https://programmercarl.com/',
    topic: '算法 · 刷题路线',
    description: '按专题循序渐进刷题，配合图文与视频建立解题思路。',
  },
  {
    name: 'Hello 算法',
    logo: 'hello-algo.png',
    href: 'https://www.hello-algo.com/',
    topic: '数据结构 · 算法入门',
    description: '通过动画图解和多语言代码，理解数据结构与基础算法。',
  },
  {
    name: '力扣',
    logo: 'leetcode.ico',
    href: 'https://leetcode.cn/',
    topic: '算法 · 编程练习',
    description: '用热题 100、面试经典 150 等题单，练习编码与解题。',
  },
  {
    name: '牛客',
    logo: 'nowcoder.ico',
    href: 'https://www.nowcoder.com/',
    topic: '面经 · 笔试',
    description: '查阅公司面经与笔试资源，结合岗位和发布时间参考。',
  },
] as const;

/** 首页静态面试资源导航；原生链接保留键盘和浏览器新标签行为。 */
export function DashboardResources(): ReactElement {
  return (
    <section
      className={[panelStyles.panel, styles.panel].filter(Boolean).join(' ')}
      aria-labelledby="resources-title"
    >
      <div className={styles.heading}>
        <h2 id="resources-title">面试充电站</h2>
        <p id="resources-hint">精选外部资源 · 在新标签页打开</p>
      </div>
      <ul className={styles.grid}>
        {resources.map((resource) => (
          <li key={resource.href}>
            <a
              className={styles.card}
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby="resources-hint"
            >
              <span className={styles.title}>
                <span className={styles.identity}>
                  <img
                    className={styles.logo}
                    src={`/assets/interview-resources/${resource.logo}`}
                    alt=""
                    width={32}
                    height={32}
                  />
                  <strong>{resource.name}</strong>
                </span>
                <span aria-hidden="true">↗</span>
              </span>
              <span className={styles.topic}>{resource.topic}</span>
              <span className={styles.description}>{resource.description}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className={styles.note}>部分网站包含付费内容，请按需选择。</p>
    </section>
  );
}
