import RFB from '@novnc/novnc'
import {VolumeX} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {useMachineAudioPreference} from '@/features/machines/hooks/use-machine-audio-preference'
import {createMachineAudioSink, type MachineAudioSink} from '@/features/machines/machine-audio'
import {createBrowserUuid} from '@/features/machines/utils'
import {trpcClient} from '@/trpc/trpc'

const SUPERSEDED_CLOSE_CODE = 4001

type ConnectionState = 'connected' | 'disconnected' | 'superseded'

function machineSocketUrl(path: string, machineId: string, sessionId: string, ticket: string) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const port = window.location.port ? `:${window.location.port}` : ''
	return `${protocol}//${window.location.hostname}${port}${path}?machineId=${encodeURIComponent(machineId)}&sessionId=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(ticket)}`
}

export function MachineConsole({machineId}: {machineId: string}) {
	const root = useRef<HTMLDivElement>(null)
	const screen = useRef<HTMLDivElement>(null)
	const {t} = useTranslation()
	const [connectionState, setConnectionState] = useState<ConnectionState>('connected')
	const [sessionId, setSessionId] = useState(createBrowserUuid)
	const {muted} = useMachineAudioPreference(machineId)
	const [audioContext, setAudioContext] = useState<AudioContext | undefined>()
	const [audioBlocked, setAudioBlocked] = useState(false)

	useEffect(() => {
		if (!screen.current) return
		let disposed = false
		let retry: ReturnType<typeof setTimeout> | undefined
		let rfb: RFB | undefined
		let socket: WebSocket | undefined
		let closeCode: number | undefined

		const connect = async () => {
			if (disposed || !screen.current) return
			try {
				const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
				if (disposed || !screen.current) return
				screen.current.replaceChildren()
				closeCode = undefined
				socket = new WebSocket(machineSocketUrl('/machines/console', machineId, sessionId, ticket), ['binary'])
				socket.addEventListener('close', (event) => {
					closeCode = event.code
				})
				rfb = new RFB(screen.current, socket, {shared: true})
				rfb.scaleViewport = true
				rfb.resizeSession = true
				rfb.showDotCursor = true
				rfb.background = '#000'
				rfb.addEventListener('connect', () => {
					setConnectionState('connected')
					// noVNC only forwards keyboard input while its canvas has DOM focus,
					// and by default nothing focuses it until the first click. Focus on
					// every (re)connect so an opened machine is immediately interactive.
					rfb?.focus()
				})
				rfb.addEventListener('disconnect', (event: CustomEvent<{clean: boolean}>) => {
					if (disposed) return
					if (closeCode === SUPERSEDED_CLOSE_CODE) {
						setConnectionState('superseded')
						return
					}
					if (event.detail.clean) return
					setConnectionState('disconnected')
					retry = setTimeout(() => void connect(), 1_000)
				})
			} catch {
				setConnectionState('disconnected')
				retry = setTimeout(() => void connect(), 1_000)
			}
		}

		void connect()
		return () => {
			disposed = true
			if (retry) clearTimeout(retry)
			rfb?.disconnect()
			socket?.close()
		}
	}, [machineId, sessionId])

	useEffect(() => {
		if (muted) {
			setAudioBlocked(false)
			return
		}
		let context: AudioContext
		try {
			// Construct eagerly so Chromium can reuse document-level sticky user
			// activation from opening the machine window. A cold-loaded console will
			// remain suspended until the genuine gesture handler below resumes it.
			context = new AudioContext({sampleRate: 48_000})
		} catch {
			return
		}
		const syncState = () => setAudioBlocked(context.state !== 'running')
		context.addEventListener('statechange', syncState)
		setAudioContext(context)
		syncState()
		void context.resume().then(syncState).catch(syncState)
		return () => {
			context.removeEventListener('statechange', syncState)
			setAudioContext((current) => (current === context ? undefined : current))
			void context.close()
		}
	}, [muted])

	useEffect(() => {
		const element = root.current
		if (!element || !audioContext || audioContext.state === 'running') return

		// Browsers require user activation before audible Web Audio playback.
		// Chromium usually honors the earlier click that opened this SPA view,
		// while Safari requires resume() inside a real pointer/key handler. Keep
		// this capture listener tied directly to the console gesture; moving the
		// resume into a plain effect would silently break Safari cold loads.
		const resume = () => {
			element.removeEventListener('pointerdown', resume, true)
			element.removeEventListener('keydown', resume, true)
			void audioContext.resume()
		}
		element.addEventListener('pointerdown', resume, {capture: true})
		element.addEventListener('keydown', resume, {capture: true})
		return () => {
			element.removeEventListener('pointerdown', resume, true)
			element.removeEventListener('keydown', resume, true)
		}
	}, [audioContext])

	useEffect(() => {
		const context = audioContext
		if (!context) return
		let disposed = false
		let sink: MachineAudioSink | undefined
		let socket: WebSocket | undefined
		let retry: ReturnType<typeof setTimeout> | undefined

		const connect = async () => {
			if (disposed || !sink) return
			try {
				const ticket = await trpcClient.user.createWebSocketTicket.mutate({target: 'machines'})
				if (disposed || !sink) return
				socket = new WebSocket(machineSocketUrl('/machines/audio', machineId, sessionId, ticket))
				socket.binaryType = 'arraybuffer'
				socket.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
					if (event.data instanceof ArrayBuffer) sink?.enqueue(event.data)
				})
				socket.addEventListener('close', (event) => {
					if (!disposed && event.code !== SUPERSEDED_CLOSE_CODE) {
						retry = setTimeout(() => void connect(), 1_000)
					}
				})
			} catch {
				if (!disposed) retry = setTimeout(() => void connect(), 1_000)
			}
		}

		void createMachineAudioSink(context)
			.then((createdSink) => {
				if (disposed) {
					createdSink.disconnect()
					return
				}
				sink = createdSink
				void connect()
			})
			.catch(() => {
				setAudioContext((current) => (current === context ? undefined : current))
				void context.close()
			})

		return () => {
			disposed = true
			if (retry) clearTimeout(retry)
			socket?.close()
			sink?.disconnect()
		}
	}, [audioContext, machineId, sessionId])

	return (
		<div ref={root} className='absolute inset-0 flex items-center justify-center bg-black'>
			{/* Quantize the size noVNC requests (resizeSession uses this element's
			    box) to whole VGA text cells — 16px rows, 8px columns. A fractional
			    row count makes guest text consoles lay out lines past the visible
			    framebuffer until the tty scrolls; cell-exact sizes remove that
			    class of glitch, and the leftover pixels center out as bezel.
			    Browsers without CSS round() ignore the style and keep size-full. */}
			<div
				ref={screen}
				style={{height: 'round(down, 100%, 16px)', width: 'round(down, 100%, 8px)'}}
				className='size-full overflow-hidden [&_canvas]:mx-auto [&_canvas]:block'
			/>
			{!muted && audioBlocked && (
				<div className='pointer-events-none absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full bg-black/55 text-white/55 backdrop-blur'>
					<VolumeX className='size-3.5' />
				</div>
			)}
			{connectionState === 'disconnected' && (
				<div className='pointer-events-none absolute inset-x-0 bottom-4 flex justify-center'>
					<span className='rounded-full bg-black/70 px-3 py-1.5 text-12 text-white/60 backdrop-blur'>
						{t('machines.console-disconnected')}
					</span>
				</div>
			)}
			{connectionState === 'superseded' && (
				<div className='absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm'>
					<div className='flex max-w-sm flex-col items-center gap-4 px-6 text-center text-white'>
						<p className='text-15 font-medium'>{t('machines.console-controlled-elsewhere')}</p>
						<button
							type='button'
							className='rounded-full bg-white px-4 py-2 text-13 font-medium text-black transition-opacity hover:opacity-80'
							onClick={() => setSessionId(createBrowserUuid())}
						>
							{t('machines.console-take-over')}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
