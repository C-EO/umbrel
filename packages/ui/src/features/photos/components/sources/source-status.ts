import {formatDistanceToNowStrict} from 'date-fns'
import type {TFunction} from 'i18next'

import type {SourceType} from '@/features/photos/hooks/use-photo-sources'
import {languageCodeToDateLocale} from '@/utils/date-time'

// Source states, import progress and per-state status lines return with the
// post-v1 source types (android, drives, shares)

export function sourceTypeLabel(type: SourceType, t: TFunction): string {
	switch (type) {
		case 'umbrel':
			return t('photos-source.type-umbrel')
		case 'iphone':
			return t('photos-source.type-iphone')
	}
}

export function timeAgo(timestamp: number, language: string) {
	return formatDistanceToNowStrict(new Date(timestamp), {
		addSuffix: true,
		locale: languageCodeToDateLocale[language as keyof typeof languageCodeToDateLocale],
	})
}
