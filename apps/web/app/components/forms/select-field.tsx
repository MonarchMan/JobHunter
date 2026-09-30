'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui-icon.js';
import styles from './select-field.module.css';

const valuePrefix = 'jobhunter-select:';
const encode = (value: string): string => `${valuePrefix}${value}`;
const decode = (value: string): string => value.slice(valuePrefix.length);

/** 一级选项可带一层子选项；只有叶子选择会提交表单值。 */
export interface SelectFieldOption {
  readonly label: string;
  readonly value: string;
  readonly children?: readonly { readonly label: string; readonly value: string }[];
}

/** 统一单选与两级选择的外观及 Radix 键盘、弹层语义。 */
export function SelectField({
  name,
  label,
  options,
  defaultValue = '',
  value,
  onValueChange,
  disabled = false,
}: Readonly<{
  name: string;
  label: string;
  options: readonly SelectFieldOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}>): ReactElement {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const selectedValue = value ?? uncontrolledValue;
  const [branch, setBranch] = useState<SelectFieldOption | null>(null);
  const [open, setOpen] = useState(false);
  const changingLevel = useRef(false);
  const openRef = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cascading = options.some((option) => option.children);
  const selectedParent = options.find((option) =>
    option.children?.some((child) => child.value === selectedValue),
  );
  const selectedChild = selectedParent?.children?.find((child) => child.value === selectedValue);
  const selectedLabel =
    selectedParent && selectedChild
      ? `${selectedParent.label} / ${selectedChild.label}`
      : (options.find((option) => option.value === selectedValue)?.label ?? selectedValue);
  const visibleOptions = branch?.children ?? options;

  useEffect(() => {
    setUncontrolledValue(defaultValue);
  }, [defaultValue]);

  return (
    <>
      <input type="hidden" name={name} value={selectedValue} />
      <SelectPrimitive.Root
        key={branch?.value ?? 'root'}
        disabled={disabled}
        open={open}
        onOpenChange={(nextOpen) => {
          // 1、父项选中后的自动关闭只属于旧层，不得关闭刚打开的子层。
          if (!nextOpen && changingLevel.current) {
            changingLevel.current = false;
            return;
          }
          // 2、重新打开从大类开始；关闭不换 Root，避免 Enter 尾事件再次打开触发框。
          openRef.current = nextOpen;
          setOpen(nextOpen);
          if (nextOpen) setBranch(null);
        }}
        value={cascading && !branch ? '' : encode(selectedValue)}
        onValueChange={(nextValue) => {
          // 1、返回或进入子层不提交值；重建 Root 让原语重新定位选项焦点。
          if (nextValue === 'back') {
            changingLevel.current = true;
            setBranch(null);
            return;
          }
          const decodedValue = decode(nextValue);
          const nextBranch = options.find((option) => option.value === decodedValue);
          if (!branch && nextBranch?.children) {
            changingLevel.current = true;
            setBranch(nextBranch);
            return;
          }
          // 2、只在叶子确认时一次性提交，随后关闭并恢复触发框。
          if (value === undefined) setUncontrolledValue(decodedValue);
          onValueChange?.(decodedValue);
        }}
      >
        <SelectPrimitive.Trigger
          ref={trigger}
          className={styles.trigger}
          aria-label={label}
          data-authored-select-trigger
        >
          <SelectPrimitive.Value placeholder={cascading ? selectedLabel : undefined}>
            {cascading ? selectedLabel : undefined}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon className={styles.icon}>
            <Icon name="chevronDown" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            onCloseAutoFocus={(event) => {
              if (!cascading) return;
              // 1、切层期间旧弹层不得抢走新层焦点；真正关闭才回到当前触发框。
              event.preventDefault();
              if (!openRef.current) trigger.current?.focus();
            }}
            aria-label={branch ? `${label}：${branch.label}` : label}
            className={styles.content}
            position="popper"
            side="bottom"
            sideOffset={6}
            align="start"
            collisionPadding={12}
            data-authored-select-content
          >
            <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
              <Icon name="chevronUp" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className={styles.viewport}>
              {branch && (
                <SelectPrimitive.Item className={styles.item} value="back">
                  <SelectPrimitive.ItemText>返回{label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              )}
              {visibleOptions.map((option) => (
                <SelectPrimitive.Item
                  className={styles.item}
                  key={encode(option.value)}
                  value={encode(option.value)}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className={styles.indicator}>
                    <Icon name="check" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
              <Icon name="chevronDown" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </>
  );
}
