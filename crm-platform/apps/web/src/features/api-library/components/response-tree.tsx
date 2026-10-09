'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, Menu, MenuItem, MenuLabel, MenuSeparator } from '@crm/ui';
import {
  allIndexPath,
  childPath,
  chosenPath,
  hasIndex,
  isUsablePath,
  type PathUse,
} from '../lib/paths';

const MAX_ITEMS = 25;

interface TreeProps {
  json: unknown;
  /** Paths already exposed to flows as `{{Name.path}}`. */
  flowPaths: readonly string[];
  /** Paths already mapped to a contact property. */
  mappingPaths: readonly string[];
  onAdd: (path: string, use: PathUse) => void;
  onRemove: (path: string) => void;
  disabled?: boolean;
}

/**
 * The answer of a test run as a tree. Every value has a "+" that picks its path for the flow variables ("Use in flow"), the contact
 * mapping ("Save as contact property") or both; a value inside a list offers this item (`items[0].name`) or every item
 * (`items[].name`). A value already picked shows what it is used for and a "−" to drop it again.
 */
export function ResponseTree(props: TreeProps) {
  return (
    <div className="font-mono text-xs" dir="ltr" role="tree">
      <Node {...props} name="" path="" value={props.json} depth={0} />
    </div>
  );
}

function Node({
  name,
  path,
  value,
  depth,
  ...rest
}: TreeProps & { name: string; path: string; value: unknown; depth: number }) {
  const isList = Array.isArray(value);
  const isObject = !isList && value !== null && typeof value === 'object';
  if (!isList && !isObject) return <Leaf name={name} path={path} value={value} {...rest} />;

  const entries: Array<[string | number, unknown]> = isList
    ? (value as unknown[]).slice(0, MAX_ITEMS).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const total = isList ? (value as unknown[]).length : entries.length;
  const label = name === '' ? '' : name;
  const summary = isList ? `[${total}]` : `{${total}}`;

  const body: ReactNode = (
    <div className="ms-4 border-s border-border ps-2">
      {entries.map(([k, v]) => (
        <Node
          key={String(k)}
          {...rest}
          name={typeof k === 'number' ? `[${k}]` : k}
          path={childPath(path, k)}
          value={v}
          depth={depth + 1}
        />
      ))}
      {total > entries.length && (
        <p className="py-0.5 text-muted-foreground">… {total - entries.length}</p>
      )}
    </div>
  );
  if (name === '') return <div role="group">{body}</div>;
  return (
    <details open={depth < 3} role="treeitem" aria-expanded>
      <summary className="cursor-pointer py-0.5 text-muted-foreground">
        <span className="text-foreground">{label}</span> {summary}
      </summary>
      {body}
    </details>
  );
}

function Leaf({
  name,
  path,
  value,
  flowPaths,
  mappingPaths,
  onAdd,
  onRemove,
  disabled,
}: Pick<TreeProps, 'flowPaths' | 'mappingPaths' | 'onAdd' | 'onRemove' | 'disabled'> & {
  name: string;
  path: string;
  value: unknown;
}) {
  const t = useTranslations('api-library.test.tree');
  const inFlow = chosenPath(path, flowPaths);
  const inMap = chosenPath(path, mappingPaths);
  const usable = isUsablePath(path);
  const shown = value === null ? 'null' : typeof value === 'string' ? `"${value}"` : String(value);
  const variants: Array<{ path: string; label: string }> = hasIndex(path)
    ? [
        { path, label: t('thisItem', { path }) },
        { path: allIndexPath(path), label: t('allItems', { path: allIndexPath(path) }) },
      ]
    : [{ path, label: path }];

  return (
    <div role="treeitem" className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span className="text-foreground">{name}:</span>
      <span className="break-all text-muted-foreground">{shown}</span>
      {inFlow && <Badge tone="success">{t('flow')}</Badge>}
      {inMap && <Badge tone="success">{t('contact')}</Badge>}
      {inFlow || inMap ? (
        <button
          type="button"
          disabled={disabled}
          aria-label={t('remove', { path })}
          title={t('remove', { path })}
          onClick={() => {
            if (inFlow) onRemove(inFlow);
            if (inMap && inMap !== inFlow) onRemove(inMap);
          }}
          className="rounded border border-border px-1.5 leading-5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          −
        </button>
      ) : usable ? (
        <Menu
          label={t('menu', { path })}
          placement="fixed"
          disabled={disabled}
          triggerClassName="h-5 px-1.5 text-xs"
          triggerProps={{ 'aria-label': t('add', { path }) }}
          trigger="+"
        >
          {variants.map((v, i) => (
            <div key={v.path}>
              {i > 0 && <MenuSeparator />}
              <MenuLabel>{v.label}</MenuLabel>
              <MenuItem onSelect={() => onAdd(v.path, 'flow')}>{t('useInFlow')}</MenuItem>
              <MenuItem onSelect={() => onAdd(v.path, 'contact')}>{t('saveToContact')}</MenuItem>
              <MenuItem onSelect={() => onAdd(v.path, 'both')}>{t('both')}</MenuItem>
            </div>
          ))}
        </Menu>
      ) : (
        <span className="text-[10px] text-muted-foreground">{t('unusable')}</span>
      )}
    </div>
  );
}
