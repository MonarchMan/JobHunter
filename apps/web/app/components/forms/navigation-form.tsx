import NextForm from 'next/form.js';
import type { ComponentProps, ReactElement } from 'react';

const Form = NextForm as unknown as typeof NextForm.default;
type NavigationFormProps = Omit<ComponentProps<typeof Form>, 'action' | 'prefetch'> & {
  readonly action: string;
};

/** 将 GET 筛选条件写入目标 URL，以客户端路由提交且不预取。 */
export function NavigationForm(props: NavigationFormProps): ReactElement {
  return <Form {...props} prefetch={false} />;
}
