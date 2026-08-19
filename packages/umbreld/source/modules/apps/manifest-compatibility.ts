import semver from 'semver'

/**
 * Whether an umbrelOS release supports an app manifest version.
 *
 * A manifest version identifies the umbrelOS feature set an app requires. An
 * OS prerelease therefore supports the feature set of its corresponding
 * release (for example, 2.0.0-beta.1 supports manifest version 2.0.0), even
 * though ordinary SemVer ordering places the prerelease before that release.
 */
export function isManifestVersionCompatible(manifestVersion: string, umbrelVersion: string) {
	const requiredVersion = semver.valid(manifestVersion)
	const currentVersion = semver.parse(umbrelVersion)
	if (!requiredVersion || !currentVersion) return false

	const currentRelease = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`
	return semver.gte(currentRelease, requiredVersion)
}

export function assertManifestVersionCompatible(manifestVersion: string, umbrelVersion: string) {
	if (!semver.valid(manifestVersion)) throw new Error('App manifest version is invalid')
	if (!isManifestVersionCompatible(manifestVersion, umbrelVersion)) {
		throw new Error('App manifest version not supported')
	}
}
