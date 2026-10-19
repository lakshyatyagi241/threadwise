'use client';

import { useMemo } from 'react';
import { MultiSelect, Select } from '@crm/ui';
import type { ContactAssignmentStrategy } from '@crm/contracts';
import { useRa } from './use-ra';

export interface PoolOption {
  value: string;
  label: string;
  onLeave?: boolean;
}

export interface PoolPickerProps {
  strategy: ContactAssignmentStrategy;
  people: readonly PoolOption[];
  teams: readonly PoolOption[];
  userIds: string[];
  teamIds: string[];
  onChange: (next: { userIds: string[]; teamIds: string[] }) => void;
  disabled?: boolean;
  problem?: string;
}

/** Who takes the records: one person (a specific-user rule), or a pool of people and teams to rotate over. */
export function PoolPicker({
  strategy,
  people,
  teams,
  userIds,
  teamIds,
  onChange,
  disabled,
  problem,
}: PoolPickerProps) {
  const { t } = useRa();
  const peopleOptions = useMemo(
    () =>
      people.map((p) => ({
        value: p.value,
        label: p.onLeave ? `${p.label} (${t('editor.assign.onLeave')})` : p.label,
      })),
    [people, t],
  );
  const teamOptions = useMemo(
    () => teams.map((x) => ({ value: x.value, label: x.label })),
    [teams],
  );

  return (
    <div className="space-y-3">
      {strategy === 'fixed' ? (
        <div className="space-y-1.5 text-sm">
          <label htmlFor="ra-person" className="block font-medium">
            {t('editor.assign.person')}
          </label>
          <Select
            id="ra-person"
            value={userIds[0] ?? ''}
            disabled={disabled}
            invalid={Boolean(problem)}
            onChange={(e) =>
              onChange({ userIds: e.target.value ? [e.target.value] : [], teamIds: [] })
            }
          >
            <option value="">{t('editor.assign.personPlaceholder')}</option>
            {peopleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <>
          <div className="space-y-1.5 text-sm">
            <span id="ra-people-label" className="block font-medium">
              {t('editor.assign.people')}
            </span>
            <MultiSelect
              id="ra-people"
              label={t('editor.assign.people')}
              placeholder={t('editor.assign.peoplePlaceholder')}
              emptyLabel={t('editor.assign.noPeople')}
              removeLabel={(name) => t('editor.assign.removePerson', { name })}
              options={peopleOptions}
              value={userIds}
              disabled={disabled}
              onChange={(next) => onChange({ userIds: next, teamIds })}
            />
          </div>
          {teams.length > 0 && (
            <div className="space-y-1.5 text-sm">
              <span className="block font-medium">{t('editor.assign.teams')}</span>
              <MultiSelect
                id="ra-teams"
                label={t('editor.assign.teams')}
                placeholder={t('editor.assign.teamsPlaceholder')}
                emptyLabel={t('editor.assign.noPeople')}
                removeLabel={(name) => t('editor.assign.removePerson', { name })}
                options={teamOptions}
                value={teamIds}
                disabled={disabled}
                onChange={(next) => onChange({ userIds, teamIds: next })}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('editor.assign.teamsNote')}</p>
        </>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
