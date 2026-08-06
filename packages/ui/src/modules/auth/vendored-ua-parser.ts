/////////////////////////////////////////////////////////////////////////////////
/* Vendored from ua-parser-modern (https://github.com/antfu-collective/ua-parser-modern)
   Copyright © 2026 Anthony Fu <anthonyfu117@hotmail.com>
   Copyright © 2024 Matteo Collina <hello@matteocollina.com>
   Copyright © 2012-2023 Faisal Salman <f@faisalman.com>
   MIT License

   Permission is hereby granted, free of charge, to any person obtaining a copy of
   this software and associated documentation files (the "Software"), to deal in
   the Software without restriction, including without limitation the rights to
   use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
   of the Software, and to permit persons to whom the Software is furnished to do
   so, subject to the following conditions: The above copyright notice and this
   permission notice shall be included in all copies or substantial portions of
   the Software.

   Trimmed for Umbrel's session list: only the `browser` and `os` regex tables and
   the mapper they need are kept (the `cpu`/`device`/`engine` tables are dropped),
   and only names are extracted — versions are intentionally ignored because
   User-Agent reduction froze OS versions into fiction. Local deviations from
   upstream are marked with `PATCH:` comments. */
/////////////////////////////////////////////////////////////////////////////////

const NAME = 'name'
const VERSION = 'version'
const UA_MAX_LENGTH = 500

const BROWSER_LABEL = 'Browser'
const CHROME = 'Chrome'
const FIREFOX = 'Firefox'
const OPERA = 'Opera'
const SAMSUNG = 'Samsung'
const FACEBOOK = 'Facebook'
const BLACKBERRY = 'BlackBerry'
const CHROMIUM_OS = 'Chromium OS'
const MAC_OS = 'Mac OS'

type StringMap = Record<string, string | string[]>
type MapperProperty = string | unknown[]
type MapperArray = unknown[]

function lowerize(str: string): string {
	return str.toLowerCase()
}

function has(str1: unknown, str2: string): boolean {
	return typeof str1 === 'string' ? lowerize(str2).includes(lowerize(str1)) : false
}

function strMapper(str: string, map: StringMap): string | undefined {
	for (const i in map) {
		const value = map[i]
		if (Array.isArray(value) && value.length > 0) {
			for (let j = 0; j < value.length; j++) {
				if (has(value[j], str)) return i === '?' ? undefined : i
			}
		} else if (has(value, str)) {
			return i === '?' ? undefined : i
		}
	}
	return str
}

// Loops the [regexes, props] pairs in order and returns on the first regex hit —
// the ordering of the tables below is what disambiguates every Chromium fork.
function rgxMapper(ua: string, arrays: MapperArray): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = {}
	for (let i = 0; i < arrays.length; i += 2) {
		const regex = arrays[i] as RegExp[]
		const props = arrays[i + 1] as MapperProperty[]
		for (let j = 0; j < regex.length; j++) {
			const matches = regex[j].exec(ua)
			if (!matches) continue
			for (let p = 0; p < props.length; p++) {
				const match = matches[p + 1]
				const q = props[p]
				if (Array.isArray(q)) {
					const key = q[0] as string
					if (q.length === 2) {
						// assign given value, ignore regex match
						result[key] = q[1] as string
					} else if (q.length === 3) {
						const arg1 = q[1]
						if (typeof arg1 === 'function') {
							// call string mapper
							result[key] = match ? (arg1 as typeof strMapper)(match, q[2] as StringMap) : undefined
						} else {
							// sanitize match using given regex
							result[key] = match ? match.replace(arg1 as RegExp, q[2] as string) : undefined
						}
					}
				} else {
					result[q] = match || undefined
				}
			}
			return result
		}
	}
	return result
}

// Safari < 3.0
const oldSafariMap: StringMap = {
	'1.0': '/8',
	'1.2': '/1',
	'1.3': '/3',
	'2.0': '/412',
	'2.0.2': '/416',
	'2.0.3': '/417',
	'2.0.4': '/419',
	'?': '/',
}
const windowsVersionMap: StringMap = {
	ME: '4.90',
	'NT 3.11': 'NT3.51',
	'NT 4.0': 'NT4.0',
	'2000': 'NT 5.0',
	XP: ['NT 5.1', 'NT 5.2'],
	Vista: 'NT 6.0',
	'7': 'NT 6.1',
	'8': 'NT 6.2',
	'8.1': 'NT 6.3',
	'10': ['NT 6.4', 'NT 10.0'],
	RT: 'ARM',
}

// prettier-ignore
const browserRegexes: MapperArray = [[
	// PATCH: not in upstream — browsers added after the vendored table was frozen.
	/(ladybird)\/([\w.]+)/i, // Ladybird
	/(librewolf)\/([\w.]+)/i, // LibreWolf (only leaks its token when fingerprinting resistance is off)
], [NAME, VERSION], [

	/\b(?:crmo|crios)\/([\w.]+)/i, // Chrome for Android/iOS
], [VERSION, [NAME, 'Chrome']], [
	/edg(?:e|ios|a)?\/([\w.]+)/i, // Microsoft Edge
], [VERSION, [NAME, 'Edge']], [

	// Presto based
	/(opera mini)\/([-\w.]+)/i, // Opera Mini
	/(opera [mobileta]{3,6})\b.+version\/([-\w.]+)/i, // Opera Mobi/Tablet
	/(opera)(?:.+version\/|[/ ]+)([\w.]+)/i, // Opera
], [NAME, VERSION], [
	/opios[/ ]+([\w.]+)/i, // Opera for iOS
], [VERSION, [NAME, OPERA]], [ // PATCH: upstream labels OPiOS "Opera Mini"; the modern Opera iOS app is not Mini
	/\bop(?:rg)?x\/([\w.]+)/i, // Opera GX
], [VERSION, [NAME, `${OPERA} GX`]], [
	/\bopr\/([\w.]+)/i, // Opera Webkit
], [VERSION, [NAME, OPERA]], [

	// Mixed
	/\bb[ai]*d(?:uhd|[ub]*[aekoprswx]{5,6})[/ ]?([\w.]+)/i, // Baidu
], [VERSION, [NAME, 'Baidu']], [
	/(kindle)\/([\w.]+)/i, // Kindle
	/(lunascape|maxthon|netfront|jasmine|blazer)[/ ]?([\w.]*)/i, // Lunascape/Maxthon/Netfront/Jasmine/Blazer
	// Trident based
	/(avant|iemobile|slim)\s?(?:browser)?[/ ]?([\w.]*)/i, // Avant/IEMobile/SlimBrowser
	/(?:ms|\()(ie) ([\w.]+)/i, // Internet Explorer

	// Webkit/KHTML based                                               // Flock/RockMelt/Midori/Epiphany/Silk/Skyfire/Bolt/Iron/Iridium/PhantomJS/Bowser/QupZilla/Falkon
	/(flock|rockmelt|midori|epiphany|silk|skyfire|bolt|iron|vivaldi|iridium|phantomjs|bowser|quark|qupzilla|falkon|rekonq|puffin|brave|whale(?!.+naver)|qqbrowserlite|qq|duckduckgo)\/([-\w.]+)/i,
	// Rekonq/Puffin/Brave/Whale/QQBrowserLite/QQ, aka ShouQ
	/(heytap|ovi)browser\/([\d.]+)/i, // Heytap/Ovi
	/(weibo)__([\d.]+)/i, // Weibo
], [NAME, VERSION], [
	/\bddg\/([\w.]+)/i, // DuckDuckGo
], [VERSION, [NAME, 'DuckDuckGo']], [
	/(?:\buc? ?browser|juc.+ucweb)[/ ]?([\w.]+)/i, // UCBrowser
], [VERSION, [NAME, `UC${BROWSER_LABEL}`]], [
	/microm.+\bqbcore\/([\w.]+)/i, // WeChat Desktop for Windows Built-in Browser
	/\bqbcore\/([\w.]+).+microm/i,
	/micromessenger\/([\w.]+)/i, // WeChat
], [VERSION, [NAME, 'WeChat']], [
	/konqueror\/([\w.]+)/i, // Konqueror
], [VERSION, [NAME, 'Konqueror']], [
	/trident.+rv[: ]([\w.]{1,9})\b.+like gecko/i, // IE11
], [VERSION, [NAME, 'IE']], [
	/ya(?:search)?browser\/([\w.]+)/i, // Yandex
], [VERSION, [NAME, 'Yandex']], [
	/slbrowser\/([\w.]+)/i, // Smart Lenovo Browser
], [VERSION, [NAME, `Smart Lenovo ${BROWSER_LABEL}`]], [
	/(avast|avg)\/([\w.]+)/i, // Avast/AVG Secure Browser
], [[NAME, /(.+)/, `$1 Secure ${BROWSER_LABEL}`], VERSION], [
	/\bfocus\/([\w.]+)/i, // Firefox Focus
], [VERSION, [NAME, `${FIREFOX} Focus`]], [
	/\bopt\/([\w.]+)/i, // Opera Touch
], [VERSION, [NAME, `${OPERA} Touch`]], [
	/coc_coc\w+\/([\w.]+)/i, // Coc Coc Browser
], [VERSION, [NAME, 'Coc Coc']], [
	/dolfin\/([\w.]+)/i, // Dolphin
], [VERSION, [NAME, 'Dolphin']], [
	/coast\/([\w.]+)/i, // Opera Coast
], [VERSION, [NAME, `${OPERA} Coast`]], [
	/miuibrowser\/([\w.]+)/i, // MIUI Browser
], [VERSION, [NAME, `MIUI ${BROWSER_LABEL}`]], [
	/fxios\/([-\w.]+)/i, // Firefox for iOS
], [VERSION, [NAME, FIREFOX]], [
	/\bqihu|(qi?ho{0,2}|360)browser/i, // 360
], [[NAME, `360 ${BROWSER_LABEL}`]], [
	/(oculus|sailfish|huawei|vivo)browser\/([\w.]+)/i,
], [[NAME, /(.+)/, `$1 ${BROWSER_LABEL}`], VERSION], [ // Oculus/Sailfish/HuaweiBrowser/VivoBrowser
	/samsungbrowser\/([\w.]+)/i, // Samsung Internet
], [VERSION, [NAME, `${SAMSUNG} Internet`]], [
	/(comodo_dragon)\/([\w.]+)/i, // Comodo Dragon
], [[NAME, /_/g, ' '], VERSION], [
	/metasr[/ ]?([\d.]+)/i, // Sogou Explorer
], [VERSION, [NAME, 'Sogou Explorer']], [
	/(sogou)mo\w+\/([\d.]+)/i, // Sogou Mobile
], [[NAME, 'Sogou Mobile'], VERSION], [
	/(electron)\/([\w.]+) safari/i, // Electron-based App
	/(tesla)(?: qtcarbrowser|\/(20\d\d\.[-\w.]+))/i, // Tesla
	/m?(qqbrowser|2345Explorer)[/ ]?([\w.]+)/i, // QQBrowser/2345 Browser
], [NAME, VERSION], [
	/(lbbrowser)/i, // LieBao Browser
	/\[(linkedin)app\]/i, // LinkedIn App for iOS & Android
], [NAME], [

	// WebView
	/((?:fban\/fbios|fb_iab\/fb4a)(?!.+fbav)|;fbav\/([\w.]+);)/i, // Facebook App for iOS & Android
], [[NAME, FACEBOOK], VERSION], [
	/(Klarna)\/([\w.]+)/i, // Klarna Shopping Browser for iOS & Android
	/(kakao(?:talk|story))[/ ]([\w.]+)/i, // Kakao App
	/(naver)\(.*?(\d+\.[\w.]+).*\)/i, // Naver InApp
	/safari (line)\/([\w.]+)/i, // Line App for iOS
	/\b(line)\/([\w.]+)\/iab/i, // Line App for Android
	/(alipay)client\/([\w.]+)/i, // Alipay
	/(twitter)(?:and| f.+e\/([\w.]+))/i, // Twitter
	/(chromium|instagram|snapchat)[/ ]([-\w.]+)/i, // Chromium/Instagram/Snapchat
], [NAME, VERSION], [
	/\bgsa\/([\w.]+) .*safari\//i, // Google Search Appliance on iOS
], [VERSION, [NAME, 'GSA']], [
	/musical_ly(?:.+app_?version\/|_)([\w.]+)/i, // TikTok
], [VERSION, [NAME, 'TikTok']], [

	/headlesschrome(?:\/([\w.]+)| )/i, // Chrome Headless
], [VERSION, [NAME, `${CHROME} Headless`]], [

	/ wv\).+(chrome)\/([\w.]+)/i, // Chrome WebView
], [[NAME, `${CHROME} WebView`], VERSION], [

	/droid.+ version\/([\w.]+)\b.+(?:mobile safari|safari)/i, // Android Browser
], [VERSION, [NAME, `Android ${BROWSER_LABEL}`]], [

	/(chrome|omniweb|arora|[tizenoka]{5} ?browser)\/v?([\w.]+)/i, // Chrome/OmniWeb/Arora/Tizen/Nokia
], [NAME, VERSION], [

	/version\/([\w.,]+) .*mobile\/\w+ (safari)/i, // Mobile Safari
], [VERSION, [NAME, 'Mobile Safari']], [
	/version\/([\w(.|,)]+) .*(mobile ?safari|safari)/i, // Safari & Safari Mobile
], [VERSION, NAME], [
	/webkit.+?(mobile ?safari|safari)(\/[\w.]+)/i, // Safari < 3.0
], [NAME, [VERSION, strMapper, oldSafariMap]], [

	/(webkit|khtml)\/([\w.]+)/i,
], [NAME, VERSION], [

	// Gecko based
	/(navigator|netscape\d?)\/([-\w.]+)/i, // Netscape
], [[NAME, 'Netscape'], VERSION], [
	/mobile vr; rv:([\w.]+)\).+firefox/i, // Firefox Reality
], [VERSION, [NAME, `${FIREFOX} Reality`]], [
	/ekiohf.+(flow)\/([\w.]+)/i, // Flow
	/(swiftfox)/i, // Swiftfox
	/(icedragon|iceweasel|camino|chimera|fennec|maemo browser|minimo|conkeror|klar)[/ ]?([\w.+]+)/i,
	// IceDragon/Iceweasel/Camino/Chimera/Fennec/Maemo/Minimo/Conkeror/Klar
	/(seamonkey|k-meleon|icecat|iceape|firebird|phoenix|palemoon|basilisk|waterfox)\/([-\w.]+)$/i,
	// Firefox/SeaMonkey/K-Meleon/IceCat/IceApe/Firebird/Phoenix
	/(firefox)\/([\w.]+)/i, // Other Firefox-based
	/(mozilla)\/([\w.]+) .+rv:.+gecko\/\d+/i, // Mozilla

	// Other
	/(polaris|lynx|dillo|icab|doris|amaya|w3m|netsurf|sleipnir|obigo|mosaic|(?:go|ice|up)[. ]?browser)[-/ ]?v?([\w.]+)/i,
	// Polaris/Lynx/Dillo/iCab/Doris/Amaya/w3m/NetSurf/Sleipnir/Obigo/Mosaic/Go/ICE/UP.Browser
	/(links) \(([\w.]+)/i, // Links
	/panasonic;(viera)/i, // Panasonic Viera
], [NAME, VERSION], [

	/(cobalt)\/([\w.]+)/i, // Cobalt
], [NAME, [VERSION, /master.|lts./, '']]]

// prettier-ignore
const osRegexes: MapperArray = [[

	// Windows
	/microsoft (windows) (vista|xp)/i, // Windows (iTunes)
], [NAME, VERSION], [
	/(windows (?:phone(?: os)?|mobile))[/ ]?([.\w ]*)/i, // Windows Phone
], [NAME, [VERSION, strMapper, windowsVersionMap]], [
	/windows nt 6\.2; (arm)/i, // Windows RT
	/windows[/ ]?([ntce\d. ]+\w)(?!.+xbox)/i,
	/(?:win(?=[39n])|win 9x )([nt\d.]+)/i,
], [[VERSION, strMapper, windowsVersionMap], [NAME, 'Windows']], [

	// iOS/macOS
	/ip[honead]{2,4}\b(?:.*os (\w+) like mac|; opera)/i, // iOS
	/(?:ios;fbsv\/|iphone.+ios[/ ])([\d.]+)/i,
	/cfnetwork\/.+darwin/i,
], [[VERSION, /_/g, '.'], [NAME, 'iOS']], [
	/(mac os x) ?([\w. ]*)/i,
	/(macintosh|mac_powerpc\b)(?!.+haiku)/i, // Mac OS
], [[NAME, MAC_OS], [VERSION, /_/g, '.']], [

	// Mobile OSes
	/droid ([\w.]+)\b.+(android[- ]x86|harmonyos)/i, // Android-x86/HarmonyOS
], [VERSION, NAME], [ // Android/WebOS/QNX/Bada/RIM/Maemo/MeeGo/Sailfish OS
	/(android|webos|qnx|bada|rim tablet os|maemo|meego|sailfish)[-/ ]?([\w.]*)/i,
	/(blackberry)\w*\/([\w.]*)/i, // Blackberry
	/(tizen|kaios)[/ ]([\w.]+)/i, // Tizen/KaiOS
	/\((series40);/i, // Series 40
], [NAME, VERSION], [
	/\(bb(10);/i, // BlackBerry 10
], [VERSION, [NAME, BLACKBERRY]], [
	/(?:symbian ?os|symbos|s60(?=;)|series60)[-/ ]?([\w.]*)/i, // Symbian
], [VERSION, [NAME, 'Symbian']], [
	/mozilla\/[\d.]+ \((?:mobile|tablet|tv|mobile; [\w ]+); rv:.+ gecko\/([\w.]+)/i, // Firefox OS
], [VERSION, [NAME, `${FIREFOX} OS`]], [
	/web0s;.+rt(tv)/i,
	/\b(?:hp)?wos(?:browser)?\/([\w.]+)/i, // WebOS
], [VERSION, [NAME, 'webOS']], [
	/watch(?: ?os[,/]|\d,\d\/)([\d.]+)/i, // watchOS
], [VERSION, [NAME, 'watchOS']], [

	// Google Chromecast
	/crkey\/([\d.]+)/i, // Google Chromecast
], [VERSION, [NAME, `${CHROME}cast`]], [
	/(cros) \w+(?:\)| ([\w.]+)\b)/i, // Chromium OS
], [[NAME, CHROMIUM_OS], VERSION], [

	// Smart TVs
	/panasonic;(viera)/i, // Panasonic Viera
	/(netrange)mmh/i, // Netrange
	/(nettv)\/(\d+\.[\w.]+)/i, // NetTV

	// Console
	/(nintendo|playstation) ([wids345portablevuch]+)/i, // Nintendo/Playstation
	/(xbox); +xbox ([^);]+)/i, // Microsoft Xbox (360, One, X, S, Series X, Series S)

	// Other
	/\b(joli|palm)\b ?(?:os)?\/?([\w.]*)/i, // Joli/Palm
	/(mint)[/() ]?(\w*)/i, // Mint
	/(mageia|vectorlinux)[; ]/i, // Mageia/VectorLinux
	/([kxln]?ubuntu|debian|suse|opensuse|gentoo|arch(?= linux)|slackware|fedora|mandriva|centos|pclinuxos|red ?hat|zenwalk|linpus|raspbian|plan 9|minix|risc os|contiki|deepin|manjaro|elementary os|sabayon|linspire)(?: gnu\/linux)?(?: enterprise)?(?:[- ]linux)?(?:-gnu)?[-/ ]?(?!chrom|package)([-\w.]*)/i,
	// Ubuntu/Debian/SUSE/Gentoo/Arch/Slackware/Fedora/Mandriva/CentOS/PCLinuxOS/RedHat/Zenwalk/Linpus/Raspbian/Plan9/Minix/RISCOS/Contiki/Deepin/Manjaro/elementary/Sabayon/Linspire
	/(hurd|linux) ?([\w.]*)/i, // Hurd/Linux
	/(gnu) ?([\w.]*)/i, // GNU
	/\b([-e-hrntopcs]{0,5}bsd|dragonfly)[/ ]?(?!amd|[ix346]{1,2}86)([\w.]*)/i, // FreeBSD/NetBSD/OpenBSD/PC-BSD/GhostBSD/DragonFly
	/(haiku) (\w+)/i, // Haiku
], [NAME, VERSION], [
	/(sunos) ?([\w.]*)/i, // Solaris
], [[NAME, 'Solaris'], VERSION], [
	/((?:open)?solaris)[-/ ]?([\w.]*)/i, // Solaris
	/(aix) ((\d)(?=[.) ])[\w.])*/i, // AIX
	/\b(beos|os\/2|amigaos|morphos|openvms|fuchsia|hp-ux|serenityos)/i, // BeOS/OS2/AmigaOS/MorphOS/OpenVMS/Fuchsia/HP-UX/SerenityOS
	/(unix) ?([\w.]*)/i, // UNIX
], [NAME, VERSION]]

export type ParsedUserAgent = {
	browser?: string
	os?: string
}

/** Extracts raw browser and OS names from a User-Agent string (no versions). */
export function parseUserAgent(userAgent: string): ParsedUserAgent {
	const ua = userAgent.trim().substring(0, UA_MAX_LENGTH)
	if (!ua) return {}
	return {
		browser: rgxMapper(ua, browserRegexes)[NAME],
		os: rgxMapper(ua, osRegexes)[NAME],
	}
}
