import React, { useState } from 'react'
import { Select } from '../../components/CustomSelect/select.js'
import TextInput from '../../components/TextInput.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import {
  getOpenAICompatibleConfigPath,
  getOpenAICompatibleProfiles,
  type OpenAICompatibleProviderProfile,
  type OpenAICompatibleProviderProfiles,
  saveOpenAICompatibleProfiles,
} from '../../utils/openAICompatibleConfig.js'

type View =
  | { type: 'menu' }
  | { type: 'pick-edit' }
  | { type: 'pick-delete' }
  | { type: 'confirm-delete'; profile: OpenAICompatibleProviderProfile }
  | { type: 'form'; profile?: OpenAICompatibleProviderProfile }

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return (
    <ProviderManager
      onDone={onDone}
      onChangeAPIKey={context.onChangeAPIKey}
    />
  )
}

function ProviderManager({
  onDone,
  onChangeAPIKey,
}: {
  onDone: LocalJSXCommandOnDone
  onChangeAPIKey: () => void
}) {
  const initial = getOpenAICompatibleProfiles()
  const [profiles, setProfiles] = useState<OpenAICompatibleProviderProfiles>(
    initial,
  )
  const [view, setView] = useState<View>({ type: 'menu' })
  const [managerError, setManagerError] = useState<string>()

  const cancel = () =>
    onDone('Provider configuration unchanged', { display: 'system' })

  const persist = (
    next: OpenAICompatibleProviderProfiles,
    message: string,
  ) => {
    saveOpenAICompatibleProfiles(next)
    setProfiles(next)
    onChangeAPIKey()
    onDone(message, { display: 'system' })
  }

  const activate = (name: string) => {
    try {
      persist(
        { ...profiles, activeProfile: name },
        `Provider profile "${name}" is now active.`,
      )
    } catch (cause) {
      setManagerError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (view.type === 'form') {
    return (
      <ProviderForm
        existingProfile={view.profile}
        onCancel={() =>
          profiles.profiles.length > 0 ? setView({ type: 'menu' }) : cancel()
        }
        onError={cause => {
          setManagerError(cause instanceof Error ? cause.message : String(cause))
          setView({ type: 'menu' })
        }}
        onSave={profile => {
          const existingName = view.profile?.name
          const nextProfiles = existingName
            ? profiles.profiles.map(current =>
                current.name === existingName ? profile : current,
              )
            : [...profiles.profiles, profile]
          persist(
            {
              version: 1,
              activeProfile:
                profiles.activeProfile === existingName ||
                !profiles.activeProfile
                  ? profile.name
                  : profiles.activeProfile,
              profiles: nextProfiles,
            },
            `Provider profile "${profile.name}" saved.`,
          )
        }}
      />
    )
  }

  if (view.type === 'pick-edit' || view.type === 'pick-delete') {
    const action = view.type === 'pick-edit' ? 'Edit' : 'Delete'
    return (
      <Dialog
        title={`${action} provider profile`}
        onCancel={() => setView({ type: 'menu' })}
      >
        <Select
          options={profiles.profiles.map(profile => ({
            label: `${profile.name} — ${profile.baseURL}`,
            value: profile.name,
          }))}
          onChange={name => {
            const profile = profiles.profiles.find(item => item.name === name)
            if (!profile) return
            setView(
              action === 'Edit'
                ? { type: 'form', profile }
                : { type: 'confirm-delete', profile },
            )
          }}
          onCancel={() => setView({ type: 'menu' })}
        />
      </Dialog>
    )
  }

  if (view.type === 'confirm-delete') {
    const { profile } = view
    return (
      <Dialog
        title="Delete provider profile?"
        subtitle={profile.name}
        onCancel={() => setView({ type: 'menu' })}
        color="warning"
      >
        <Text>This permanently removes the saved URL and API key.</Text>
        <Select
          options={[
            { label: 'Cancel', value: 'cancel' },
            { label: 'Delete profile', value: 'delete' },
          ]}
          onChange={choice => {
            if (choice !== 'delete') {
              setView({ type: 'menu' })
              return
            }
            const remaining = profiles.profiles.filter(
              item => item.name !== profile.name,
            )
            if (remaining.length === 0) {
              setManagerError(
                'The only provider profile cannot be deleted. Add another profile first.',
              )
              setView({ type: 'menu' })
              return
            }
            const activeProfile =
              profiles.activeProfile === profile.name
                ? remaining[0]!.name
                : profiles.activeProfile
            try {
              persist(
                { version: 1, activeProfile, profiles: remaining },
                `Provider profile "${profile.name}" deleted. "${activeProfile}" is active.`,
              )
            } catch (cause) {
              setManagerError(
                cause instanceof Error ? cause.message : String(cause),
              )
              setView({ type: 'menu' })
            }
          }}
          onCancel={() => setView({ type: 'menu' })}
        />
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Provider profiles"
      subtitle={
        profiles.profiles.length > 0
          ? `Active: ${profiles.activeProfile}`
          : 'No profiles saved'
      }
      onCancel={cancel}
    >
      <Select
        options={[
          ...profiles.profiles.map(profile => ({
            label: `${profile.name === profiles.activeProfile ? '✓ ' : '  '}${profile.name} — ${profile.baseURL}`,
            value: `activate:${profile.name}`,
          })),
          { label: 'Add a provider profile', value: 'add' },
          ...(profiles.profiles.length > 0
            ? [
                { label: 'Edit a provider profile', value: 'edit' },
                { label: 'Delete a provider profile', value: 'delete' },
              ]
            : []),
        ]}
        onChange={choice => {
          if (choice.startsWith('activate:'))
            activate(choice.slice('activate:'.length))
          else if (choice === 'add') setView({ type: 'form' })
          else if (choice === 'edit') setView({ type: 'pick-edit' })
          else if (choice === 'delete') setView({ type: 'pick-delete' })
        }}
        onCancel={cancel}
      />
      <Text dimColor>
        Profiles are stored in {getOpenAICompatibleConfigPath()}. Environment
        variables override the active profile.
      </Text>
      {managerError ? <Text color="error">{managerError}</Text> : null}
    </Dialog>
  )
}

function ProviderForm({
  existingProfile,
  onSave,
  onCancel,
  onError,
}: {
  existingProfile?: OpenAICompatibleProviderProfile
  onSave: (profile: OpenAICompatibleProviderProfile) => void
  onCancel: () => void
  onError: (cause: unknown) => void
}) {
  const fields = existingProfile
    ? (['baseURL', 'apiKey'] as const)
    : (['name', 'baseURL', 'apiKey'] as const)
  const [fieldIndex, setFieldIndex] = useState(0)
  const [name, setName] = useState(existingProfile?.name ?? '')
  const [baseURL, setBaseURL] = useState(existingProfile?.baseURL ?? '')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string>()
  const initialValue = fields[0] === 'name' ? name : baseURL
  const [cursorOffset, setCursorOffset] = useState(initialValue.length)
  const { columns } = useTerminalSize()

  useKeybinding('confirm:no', onCancel, { context: 'Settings' })

  const field = fields[fieldIndex]!
  const value = field === 'name' ? name : field === 'baseURL' ? baseURL : apiKey
  const setValue = (next: string) => {
    if (field === 'name') setName(next)
    else if (field === 'baseURL') setBaseURL(next)
    else setApiKey(next)
    setError(undefined)
  }

  const submit = (submittedValue: string) => {
    if (field === 'name') {
      const normalized = submittedValue.trim()
      if (!normalized) return setError('Profile name is required')
      if (normalized.length > 64 || /[\x00-\x1f\x7f]/.test(normalized)) {
        return setError(
          'Profile names must be 64 characters or fewer and cannot contain control characters',
        )
      }
      setName(normalized)
    }
    if (field === 'baseURL' && !submittedValue.trim()) {
      return setError('Base URL is required')
    }
    if (field === 'baseURL') setBaseURL(submittedValue)
    if (field === 'apiKey') setApiKey(submittedValue)

    if (fieldIndex < fields.length - 1) {
      const nextField = fields[fieldIndex + 1]!
      const nextValue = nextField === 'baseURL' ? baseURL : ''
      setFieldIndex(current => current + 1)
      setCursorOffset(nextValue.length)
      setError(undefined)
      return
    }

    try {
      // Empty is a valid submission for providers without authentication. When
      // editing, it intentionally means "keep the existing key".
      const finalAPIKey = submittedValue || existingProfile?.apiKey
      onSave({
        name: name.trim(),
        baseURL: baseURL.trim(),
        ...(finalAPIKey ? { apiKey: finalAPIKey } : {}),
      })
    } catch (cause) {
      onError(cause)
    }
  }

  const title =
    field === 'name'
      ? 'Profile name'
      : field === 'baseURL'
        ? 'Base URL'
        : 'API key'
  const description =
    field === 'name'
      ? 'A short unique name, such as openrouter or local'
      : field === 'baseURL'
        ? 'Include /v1 when required by the provider'
        : existingProfile?.apiKey
          ? 'Leave blank to keep the saved key'
          : 'Optional for providers that do not require authentication'

  return (
    <Dialog
      title={existingProfile ? `Edit ${existingProfile.name}` : 'Add provider profile'}
      subtitle={`Field ${fieldIndex + 1} of ${fields.length}`}
      onCancel={onCancel}
      isCancelActive={false}
    >
      <Box flexDirection="column">
        <Text bold>{title}</Text>
        <Text dimColor>{description}</Text>
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={submit}
            columns={Math.max(20, columns - 6)}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            mask={field === 'apiKey' ? '*' : undefined}
            disableEscapeDoublePress
            focus
            showCursor
          />
        </Box>
        {error ? <Text color="error">{error}</Text> : null}
        <Text dimColor>Enter to continue · Esc to cancel</Text>
      </Box>
    </Dialog>
  )
}
