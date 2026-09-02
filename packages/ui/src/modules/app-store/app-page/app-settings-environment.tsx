import {PlusCircle, Trash2} from 'lucide-react'
import {useState, type Dispatch, type SetStateAction} from 'react'
import {useTranslation} from 'react-i18next'
import {TbChevronDown} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {Input, Labeled} from '@/components/ui/input'
import {ScrollArea} from '@/components/ui/scroll-area'
import {EmptyCard} from '@/modules/user-sharing'
import type {UserApp} from '@/trpc/trpc'

import {AppServiceSelect, SettingsAddForm, SettingsIconButton, SettingsInputHint} from './shared'

type AppEnvironmentSettings = NonNullable<UserApp['environment']>
type AppExposedEnvironmentVariable = AppEnvironmentSettings['exposed'][number]
export type AppEnvironmentVariable = Pick<AppExposedEnvironmentVariable, 'name'> & {value: string}
export type AppCustomEnvironmentVariable = AppEnvironmentSettings['custom'][number]

const ENVIRONMENT_VARIABLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

function getCustomEnvironmentVariableKey(variable: Pick<AppCustomEnvironmentVariable, 'serviceName' | 'name'>) {
	return `${variable.serviceName}:${variable.name}`
}

export function getEnvironmentVariables(app: UserApp): AppEnvironmentVariable[] {
	return (app.environment?.exposed ?? []).flatMap((variable) =>
		variable.value === null ? [] : [{name: variable.name, value: variable.value}],
	)
}

export function getCustomEnvironmentVariables(app: UserApp): AppCustomEnvironmentVariable[] {
	return app.environment?.custom ?? []
}

// Compared independently of array order so edits that reorder entries don't
// count as changes.
export function areEnvironmentVariablesEqual(a: AppEnvironmentVariable[], b: AppEnvironmentVariable[]) {
	if (a.length !== b.length) return false
	const valuesByName = new Map(b.map((variable) => [variable.name, variable.value]))
	return a.every((variable) => valuesByName.get(variable.name) === variable.value)
}

export function areCustomEnvironmentVariablesEqual(
	a: AppCustomEnvironmentVariable[],
	b: AppCustomEnvironmentVariable[],
) {
	if (a.length !== b.length) return false
	const valuesByKey = new Map(b.map((variable) => [getCustomEnvironmentVariableKey(variable), variable.value]))
	return a.every((variable) => valuesByKey.get(getCustomEnvironmentVariableKey(variable)) === variable.value)
}

export function getEnvironmentVariableCount(
	variables: AppEnvironmentVariable[],
	customVariables: AppCustomEnvironmentVariable[],
) {
	return variables.length + customVariables.length
}

export function EnvironmentVariablesSettings({
	app,
	variables,
	setVariables,
	customVariables,
	setCustomVariables,
}: {
	app: UserApp
	variables: AppEnvironmentVariable[]
	setVariables: Dispatch<SetStateAction<AppEnvironmentVariable[]>>
	customVariables: AppCustomEnvironmentVariable[]
	setCustomVariables: Dispatch<SetStateAction<AppCustomEnvironmentVariable[]>>
}) {
	const {t} = useTranslation()
	const [addFormOpen, setAddFormOpen] = useState(false)
	const [newName, setNewName] = useState('')
	const [newValue, setNewValue] = useState('')

	const exposedVariables = app.environment?.exposed ?? []
	const services = app.environment?.services ?? []
	const serviceImages = app.environment?.serviceImages ?? {}
	const [newServiceName, setNewServiceName] = useState(services[0] ?? '')
	const valuesByName = new Map(variables.map((variable) => [variable.name, variable.value]))
	const customVariablesByKey = new Map(
		customVariables.map((variable) => [getCustomEnvironmentVariableKey(variable), variable]),
	)
	const overridesExposedVariable = ({serviceName, name}: Pick<AppCustomEnvironmentVariable, 'serviceName' | 'name'>) =>
		exposedVariables.some((variable) => variable.name === name && variable.services.includes(serviceName))

	const setExposedVariable = (name: string, value: string | undefined) => {
		setVariables((currentVariables) => [
			...currentVariables.filter((variable) => variable.name !== name),
			...(value === undefined || value === '' ? [] : [{name, value}]),
		])
	}

	const setCustomVariable = (variableToUpdate: AppCustomEnvironmentVariable, value: string) => {
		const key = getCustomEnvironmentVariableKey(variableToUpdate)
		setCustomVariables((currentVariables) =>
			currentVariables.map((variable) =>
				getCustomEnvironmentVariableKey(variable) === key ? {...variable, value} : variable,
			),
		)
	}

	const removeCustomVariable = (variableToRemove: AppCustomEnvironmentVariable) => {
		const key = getCustomEnvironmentVariableKey(variableToRemove)
		setCustomVariables((currentVariables) =>
			currentVariables.filter((variable) => getCustomEnvironmentVariableKey(variable) !== key),
		)
	}

	const newNameTrimmed = newName.trim()
	const hasNewName = newNameTrimmed.length > 0
	const newNameIsValid = ENVIRONMENT_VARIABLE_NAME_REGEX.test(newNameTrimmed)
	const newVariableKey = getCustomEnvironmentVariableKey({serviceName: newServiceName, name: newNameTrimmed})
	const newNameIsDuplicate = customVariablesByKey.has(newVariableKey)
	const newVariableOverridesExposed = overridesExposedVariable({
		serviceName: newServiceName,
		name: newNameTrimmed,
	})
	const canAddVariable = services.includes(newServiceName) && newNameIsValid && !newNameIsDuplicate

	const closeAddForm = () => {
		setAddFormOpen(false)
		setNewName('')
		setNewValue('')
		setNewServiceName(services[0] ?? '')
	}

	const addVariable = () => {
		if (!canAddVariable) return
		setCustomVariables((currentVariables) => [
			...currentVariables,
			{serviceName: newServiceName, name: newNameTrimmed, value: newValue},
		])
		closeAddForm()
	}

	return (
		<div className='flex flex-col gap-y-5'>
			{exposedVariables.length > 0 && (
				<section className='space-y-2'>
					<div className='space-y-1'>
						<h3 className='text-13 font-medium text-white/90'>{t('app-settings.environment.exposed-title')}</h3>
						<p className='text-12 leading-tight text-white/40'>{t('app-settings.environment.exposed-description')}</p>
					</div>
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{exposedVariables.map((variable) => {
							const value = valuesByName.get(variable.name)

							return (
								<div key={variable.name} className='flex items-center justify-between gap-3 p-3'>
									<div className='min-w-0 flex-1'>
										<div className='flex min-w-0 items-center gap-1.5'>
											<span className='min-w-0 truncate text-13 font-medium text-white/90' dir='ltr'>
												{variable.name}
											</span>
											{/* The same modified marker the navigation rows use */}
											{value !== undefined && (
												<span className='shrink-0'>
													<span aria-hidden='true' className='block size-1.5 rounded-full bg-brand' />
													<span className='sr-only'>{t('app-settings.environment.modified')}</span>
												</span>
											)}
										</div>
										{variable.note ? (
											<div className='mt-0.5 text-12 leading-tight text-white/40'>{variable.note}</div>
										) : null}
									</div>
									<div className='w-44 shrink-0'>
										{variable.options ? (
											<EnvironmentOptionSelect
												value={value}
												defaultValue={variable.default ?? undefined}
												options={variable.options}
												onChange={(value) => setExposedVariable(variable.name, value)}
											/>
										) : (
											<Input
												sizeVariant='short-square'
												value={value ?? ''}
												placeholder={variable.default ?? ''}
												// The placeholder shows the app's default, so an empty input
												// reads as unset and clears the override.
												onValueChange={(value) => setExposedVariable(variable.name, value)}
											/>
										)}
									</div>
								</div>
							)
						})}
					</div>
				</section>
			)}

			<section className='space-y-2'>
				<div className='flex items-end justify-between gap-3'>
					<div className='space-y-1'>
						<h3 className='text-13 font-medium text-white/90'>{t('app-settings.environment.custom-title')}</h3>
						<p className='text-12 leading-tight text-white/40'>{t('app-settings.environment.custom-description')}</p>
					</div>
					{/* Add lives in the section header, like the user sharing and
					    backup location sections */}
					{!addFormOpen && (
						<Button
							size='sm'
							className='shrink-0'
							aria-label={t('app-settings.environment.add-custom-variable')}
							onClick={() => setAddFormOpen(true)}
						>
							{t('app-settings.add')}
							<PlusCircle className='size-3' />
						</Button>
					)}
				</div>

				{addFormOpen && (
					<div className='overflow-hidden rounded-12 bg-white/5'>
						<SettingsAddForm
							title={t('app-settings.environment.new-custom-variable')}
							onCancel={closeAddForm}
							submit={
								<Button variant='primary' size='sm' disabled={!canAddVariable} onClick={addVariable}>
									{t('app-settings.environment.add-variable')}
								</Button>
							}
						>
							{services.length > 1 ? (
								<div>
									<div className='mb-1.5 px-[5px] text-12 -tracking-2 text-white/50'>
										{t('app-settings.storage.app-service')}
									</div>
									<AppServiceSelect
										services={services}
										serviceImages={serviceImages}
										value={newServiceName}
										onChange={setNewServiceName}
									/>
								</div>
							) : null}

							<Labeled label={t('app-settings.environment.name-label')}>
								<Input
									sizeVariant='short-square'
									value={newName}
									onValueChange={setNewName}
									placeholder={t('app-settings.environment.name-placeholder')}
								/>
								{hasNewName && !newNameIsValid ? (
									<SettingsInputHint tone='warning'>{t('app-settings.environment.invalid-name')}</SettingsInputHint>
								) : newNameIsDuplicate ? (
									<SettingsInputHint tone='warning'>{t('app-settings.environment.duplicate-name')}</SettingsInputHint>
								) : newVariableOverridesExposed ? (
									<SettingsInputHint>
										{t('app-settings.environment.overrides-app-setting', {service: newServiceName})}
									</SettingsInputHint>
								) : null}
							</Labeled>

							<Labeled label={t('app-settings.environment.value-label')}>
								<Input sizeVariant='short-square' value={newValue} onValueChange={setNewValue} />
							</Labeled>
						</SettingsAddForm>
					</div>
				)}

				{customVariables.length > 0 ? (
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{customVariables.map((variable) => (
							<div
								key={getCustomEnvironmentVariableKey(variable)}
								className='flex items-center justify-between gap-3 p-3'
							>
								<div className='min-w-0 flex-1'>
									<div className='truncate text-13 font-medium text-white/90' dir='ltr'>
										{variable.name}
									</div>
									<div className='mt-0.5 truncate text-11 text-white/35'>
										{overridesExposedVariable(variable)
											? t('app-settings.environment.overrides-app-setting', {service: variable.serviceName})
											: `${t('app-settings.storage.app-service')}: ${variable.serviceName}`}
									</div>
								</div>
								<div className='flex shrink-0 items-center gap-1.5'>
									<Input
										className='w-36'
										sizeVariant='short-square'
										value={variable.value}
										onValueChange={(value) => setCustomVariable(variable, value)}
									/>
									<SettingsIconButton
										label={t('app-settings.environment.remove')}
										onClick={() => removeCustomVariable(variable)}
									>
										<Trash2 className='size-3.5' />
									</SettingsIconButton>
								</div>
							</div>
						))}
					</div>
				) : !addFormOpen ? (
					<EmptyCard>{t('app-settings.environment.no-custom-variables')}</EmptyCard>
				) : null}
			</section>
		</div>
	)
}

function EnvironmentOptionSelect({
	value,
	defaultValue,
	options,
	onChange,
}: {
	value: string | undefined
	defaultValue: string | undefined
	options: string[]
	onChange: (value: string | undefined) => void
}) {
	const {t} = useTranslation()
	const defaultLabel = defaultValue
		? `${t('app-settings.environment.app-default')} (${defaultValue})`
		: t('app-settings.environment.app-default')
	const defaultIsOption = defaultValue !== undefined && options.includes(defaultValue)
	const displayValue = value ?? (defaultIsOption ? defaultValue : defaultLabel)

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='input-short' className='w-full justify-between px-3'>
					<span className='truncate' dir='ltr'>
						{displayValue}
					</span>
					<TbChevronDown className='size-3.5 shrink-0 text-white/45' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='flex max-h-72 min-w-44 flex-col'>
				<ScrollArea className='relative flex h-full flex-col'>
					{!defaultIsOption && (
						<DropdownMenuCheckboxItem checked={value === undefined} onSelect={() => onChange(undefined)}>
							<span className='max-w-72 truncate' dir='ltr'>
								{defaultLabel}
							</span>
						</DropdownMenuCheckboxItem>
					)}
					{options.map((option) => (
						<DropdownMenuCheckboxItem
							key={option}
							checked={value === option || (value === undefined && option === defaultValue)}
							onSelect={() => onChange(option === defaultValue ? undefined : option)}
						>
							<div className='flex min-w-0 items-center gap-2'>
								<span className='max-w-72 truncate' dir='ltr'>
									{option}
								</span>
								{option === defaultValue && (
									<span className='shrink-0 rounded-full bg-white/8 px-1.5 py-px text-11 font-medium text-white/40'>
										{t('app-settings.environment.default')}
									</span>
								)}
							</div>
						</DropdownMenuCheckboxItem>
					))}
				</ScrollArea>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
