'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Icon } from './ui-icon.js';
import styles from './select-field.module.css';

const valuePrefix = 'jobhunter-select:';
const encode = (value: string): string => `${valuePrefix}${value}`;
const decode = (value: string): string => value.slice(valuePrefix.length);

export interface SelectFieldOption {
  readonly label: string;
  readonly value: string;
}

export function SelectField({
  name,
  label,
  options,
  defaultValue = '',
  value,
  onValueChange,
}: Readonly<{
  name: string;
  label: string;
  options: readonly SelectFieldOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}>): ReactElement {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const selectedValue = value ?? uncontrolledValue;

  useEffect(() => {
    setUncontrolledValue(defaultValue);
  }, [defaultValue]);

  return (
    <>
      <input type="hidden" name={name} value={selectedValue} />
      <SelectPrimitive.Root
        value={encode(selectedValue)}
        onValueChange={(nextValue) => {
          const decodedValue = decode(nextValue);
          if (value === undefined) setUncontrolledValue(decodedValue);
          onValueChange?.(decodedValue);
        }}
      >
        <SelectPrimitive.Trigger
          className={styles.trigger}
          aria-label={label}
          data-authored-select-trigger
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon className={styles.icon}>
            <Icon name="chevronDown" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
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
              {options.map((option) => (
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
