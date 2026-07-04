import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import { Box, Text, useInput } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import { getFetchedModelOptions } from '../utils/model/fetchedModelOptions.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { type ModelOption, getModelOptions } from '../utils/model/modelOptions.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  headerText?: string
  skipSettingsWrite?: boolean
}

const NO_PREFERENCE = '__NO_PREFERENCE__'

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
}: Props) {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const initialValue = initial === null ? NO_PREFERENCE : initial
  const [focusedValue, setFocusedValue] = useState(initialValue)
  const [filterText, setFilterText] = useState('')
  const [fetchedOptions, setFetchedOptions] = useState<ModelOption[] | null>(
    null,
  )
  const isFastMode = useAppState(s => (isFastModeEnabled() ? s.fastMode : false))
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const effortValue = useAppState(s => s.effortValue)
  const [effort, setEffort] = useState(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )
  const useFetchedModels = isStandaloneCommand === true

  useEffect(() => {
    if (!useFetchedModels) return
    let cancelled = false
    getFetchedModelOptions().then(options => {
      if (!cancelled) setFetchedOptions(options)
    })
    return () => {
      cancelled = true
    }
  }, [useFetchedModels])

  const baseOptions = useMemo(() => {
    if (useFetchedModels) return fetchedOptions ?? []
    return getModelOptions(isFastMode ?? false)
  }, [fetchedOptions, isFastMode, useFetchedModels])

  const optionsWithInitial = useMemo(() => {
    if (initial === null || baseOptions.some(opt => opt.value === initial)) {
      return baseOptions
    }
    return [
      ...baseOptions,
      {
        value: initial,
        label: useFetchedModels ? initial : modelDisplayString(initial),
        description: useFetchedModels ? '' : 'Current model',
      },
    ]
  }, [baseOptions, initial, useFetchedModels])

  const selectOptions = useMemo(
    () => optionsWithInitial.map(opt => ({ ...opt, value: opt.value === null ? NO_PREFERENCE : opt.value })),
    [optionsWithInitial],
  )
  const filteredOptions = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return selectOptions
    return selectOptions.filter(opt =>
      `${String(opt.value)} ${String(opt.label)} ${opt.description ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [filterText, selectOptions])

  const initialFocusValue = filteredOptions.some(_ => _.value === initialValue)
    ? initialValue
    : filteredOptions[0]?.value
  const visibleCount = Math.min(10, filteredOptions.length)
  const hiddenCount = Math.max(0, filteredOptions.length - visibleCount)
  const focusedModelName = filteredOptions.find(opt => opt.value === focusedValue)?.label
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue)
  const displayEffort = effort

  const handleFocus = (value: string) => {
    setFocusedValue(value)
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(value))
    }
  }
  const handleCycleEffort = (direction: 'left' | 'right') => {
    if (!focusedSupportsEffort) return
    setEffort(prev => cycleEffortLevel(prev ?? focusedDefaultEffort, direction))
    setHasToggledEffort(true)
  }
  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
    },
    { context: 'ModelPicker' },
  )

  const handleSelect = (value: string) => {
    logEvent('tengu_model_command_menu_effort', {
      effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(
        effort,
        getDefaultEffortLevelForOption(value),
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort,
      )
      const persistable = toPersistableEffort(effortLevel)
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', { effortLevel: persistable })
      }
      setAppState(prev => ({ ...prev, effortValue: effortLevel }))
    }
    const selectedModel = resolveOptionModel(value)
    const selectedEffort = hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel) ? effort : undefined
    onSelect(value === NO_PREFERENCE ? null : value, selectedEffort)
  }

  const title = <Text color="remember" bold>Select model</Text>
  const subtitle =
    headerText ??
    (useFetchedModels
      ? 'Select a model. Type to filter.'
      : 'Switch between models. Applies to this session and future sessions. For other/previous model names, specify with --model.')
  const sessionLine = sessionModel && (
    <Text dimColor>
      Currently using {modelDisplayString(sessionModel)} for this session (set by
      plan mode). Selecting a model will undo this.
    </Text>
  )
  const filterLine = useFetchedModels && filterText && (
    <Text dimColor>Filter: {filterText}</Text>
  )
  const loadingLine = useFetchedModels && fetchedOptions === null && (
    <Text dimColor>Fetching available models…</Text>
  )

  const list = filteredOptions.length > 0 ? (
    <Box flexDirection="column">
      <Select
        defaultValue={initialValue}
        defaultFocusValue={initialFocusValue}
        options={filteredOptions}
        onChange={handleSelect}
        onFocus={handleFocus}
        onCancel={onCancel ?? (() => {})}
        visibleOptionCount={visibleCount}
        highlightText={filterText}
        disableSelection={useFetchedModels ? 'numeric' : false}
      />
    </Box>
  ) : (
    <Text dimColor>No models match the current filter.</Text>
  )
  const hiddenLine = hiddenCount > 0 && (
    <Box paddingLeft={3}>
      <Text dimColor>and {hiddenCount} more…</Text>
    </Box>
  )
  const effortLine = (
    <Box marginBottom={1} flexDirection="column">
      {focusedSupportsEffort ? (
        <Text dimColor>
          <EffortLevelIndicator effort={displayEffort} /> {capitalize(displayEffort)}
          effort{displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
          <Text color="subtle">← → to adjust</Text>
        </Text>
      ) : (
        <Text color="subtle">
          <EffortLevelIndicator effort={undefined} /> Effort not supported
          {focusedModelName ? ` for ${focusedModelName}` : ''}
        </Text>
      )}
    </Box>
  )
  const fastModeLine = isFastModeEnabled()
    ? showFastModeNotice
      ? <Box marginBottom={1}><Text dimColor>Fast mode is <Text bold>ON</Text> and available with {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching to other models turn off fast mode.</Text></Box>
      : isFastModeAvailable() && !isFastModeCooldown()
        ? <Box marginBottom={1}><Text dimColor>Use <Text bold>/fast</Text> to turn on Fast mode ({FAST_MODE_MODEL_DISPLAY} only).</Text></Box>
        : null
    : null
  const footer = isStandaloneCommand && (
    <Text dimColor italic>
      {exitState.pending ? (
        <>Press {exitState.keyName} again to exit</>
      ) : (
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="confirm" />
          <ConfigurableShortcutHint action="select:cancel" context="Select" fallback="Esc" description="exit" />
        </Byline>
      )}
    </Text>
  )

  const content = (
    <Box flexDirection="column">
      <FilterKeyInterceptor
        active={useFetchedModels}
        onFilterChar={setFilterText}
        onCancel={onCancel}
      />
      <Box marginBottom={1} flexDirection="column">{title}<Text dimColor>{subtitle}</Text>{sessionLine}{filterLine}{loadingLine}</Box>
      <Box flexDirection="column" marginBottom={1}>{list}{hiddenLine}</Box>
      {effortLine}
      {fastModeLine}
      {footer}
    </Box>
  )

  return isStandaloneCommand ? <Pane color="permission">{content}</Pane> : content
}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE ? getDefaultMainLoopModel() : parseUserSpecifiedModel(value)
}

function EffortLevelIndicator({ effort }: { effort: EffortLevel | undefined }) {
  return <Text color={effort ? 'claude' : 'subtle'}>{effortLevelToSymbol(effort ?? 'low')}</Text>
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
): EffortLevel {
  const levels: EffortLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const idx = levels.indexOf(current)
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high')
  return direction === 'right'
    ? levels[(currentIndex + 1) % levels.length]!
    : levels[(currentIndex - 1 + levels.length) % levels.length]!
}

function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel()
  const defaultValue = getDefaultEffortForModel(resolved)
  return defaultValue !== undefined ? convertEffortValueToLevel(defaultValue) : 'high'
}

function FilterKeyInterceptor({
  active,
  onFilterChar,
  onCancel,
}: {
  active: boolean
  onFilterChar: (setter: (prev: string) => string) => void
  onCancel?: () => void
}) {
  useInput(
    (input, key, event) => {
      if (!active) return
      if (key.backspace || key.delete) {
        event.stopImmediatePropagation()
        onFilterChar(prev => prev.slice(0, -1))
        return
      }
      if (key.escape) {
        event.stopImmediatePropagation()
        onCancel?.()
        return
      }
      if (key.return || key.tab || key.upArrow || key.downArrow) {
        return
      }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
        event.stopImmediatePropagation()
        onFilterChar(prev => prev + input)
      }
    },
    { isActive: active },
  )
  return null
}
