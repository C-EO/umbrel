const ATTENTION_ICON_ATTRIBUTE = 'data-toast-tab-attention'
export const TAB_ATTENTION_ICON_HREF = '/favicon/favicon-notification.png'

export type TabAttentionNotification = {
	title?: string
}

/**
 * Shows the latest toast that arrived while the window was unfocused. Focus is
 * the acknowledgement: toast dismissal and duration deliberately do not
 * affect this lifecycle.
 */
export class TabAttentionController {
	private notification: TabAttentionNotification | null = null
	private originalTitle: string | null = null
	private originalIconHref: string | null = null
	private attentionIcon: HTMLLinkElement | null = null

	private handleFocus = () => this.stop()

	notify(notification: TabAttentionNotification) {
		if (typeof window === 'undefined' || typeof document === 'undefined') return
		if (document.hasFocus()) return
		if (!notification.title) return

		if (!this.notification) {
			this.originalTitle = document.title
			const originalIcon =
				document.querySelector<HTMLLinkElement>("link[rel~='icon'][sizes='32x32']") ??
				document.querySelector<HTMLLinkElement>(`link[rel~='icon']:not([${ATTENTION_ICON_ATTRIBUTE}])`)
			this.originalIconHref = originalIcon?.href ?? null
			window.addEventListener('focus', this.handleFocus)
		}

		this.notification = notification
		this.showNotification()
	}

	stop() {
		window.removeEventListener('focus', this.handleFocus)

		if (this.originalTitle !== null) document.title = this.originalTitle
		if (this.attentionIcon && this.originalIconHref) this.attentionIcon.href = this.originalIconHref
		else {
			this.attentionIcon?.remove()
			this.attentionIcon = null
		}

		this.notification = null
		this.originalTitle = null
		this.originalIconHref = null
	}

	private showNotification() {
		if (!this.notification || this.originalTitle === null) return
		document.title = `Umbrel: ${this.notification.title}`

		if (!this.attentionIcon) {
			this.attentionIcon = document.createElement('link')
			this.attentionIcon.rel = 'icon'
			this.attentionIcon.type = 'image/png'
			this.attentionIcon.sizes = '32x32'
			this.attentionIcon.setAttribute(ATTENTION_ICON_ATTRIBUTE, '')
			document.head.appendChild(this.attentionIcon)
		}
		this.attentionIcon.href = TAB_ATTENTION_ICON_HREF
	}
}

export const tabAttention = new TabAttentionController()
