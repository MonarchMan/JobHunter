'use client';

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';

const Review = lazy(() =>
  import('./extraction-review.js').then(({ ExtractionReview }) => ({ default: ExtractionReview })),
);

/** 只有服务端确认存在候选时才渲染入口；审核脚本等到用户打开再请求。 */
export function ExtractionReviewEntry(props: ComponentProps<typeof Review>): ReactElement {
  const details = useRef<HTMLDetailsElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (details.current?.open) setOpened(true);
  }, []);
  return (
    <details
      ref={details}
      className="panel-block"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>查看待确认的提取结果</summary>
      {opened ? (
        <Suspense fallback={<p role="status">正在加载提取结果…</p>}>
          <Review {...props} />
        </Suspense>
      ) : null}
    </details>
  );
}
