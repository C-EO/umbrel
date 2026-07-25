import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import Umbreld from '../../index.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import * as totp from '../utilities/totp.js'

describe('member lifecycle', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let dataDirectory: string
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		dataDirectory = await directory.create()
		umbreld = new Umbreld({dataDirectory})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
		vi.spyOn(umbreld.files, 'createMemberDirectories').mockResolvedValue()
		vi.spyOn(umbreld.files, 'deleteMemberDirectories').mockResolvedValue()
		vi.spyOn(umbreld.files.memberShares, 'removeUserFromShares').mockResolvedValue()
		vi.spyOn(umbreld.apps, 'removeUserFromMemberShares').mockResolvedValue()
		vi.spyOn(umbreld.auth, 'revokeAllForAccount').mockResolvedValue(0)
		vi.spyOn(umbreld.hardware.raid, 'hasConfigStore').mockResolvedValue(false)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await umbreld.auth.stop()
		await directory.destroyRoot()
	})

	test('permanently reserves a deleted member id and retries interrupted cleanup', async () => {
		const first = await umbreld.user.createUser('Alice', 'passwordpassword')
		expect(first.userId).toBe('Alice')

		vi.mocked(umbreld.auth.revokeAllForAccount).mockRejectedValueOnce(new Error('simulated cleanup failure'))
		await expect(umbreld.user.deleteUser(first.userId)).rejects.toThrow('simulated cleanup failure')

		// The account disappears immediately even though cleanup did not finish.
		expect(await umbreld.user.getMember(first.userId)).toBeUndefined()
		expect(await umbreld.user.listMembers()).toEqual([])
		expect(await umbreld.store.get('members')).toEqual([{id: 'Alice', deleted: true}])

		// Reusing the display name creates a new security identity.
		const replacement = await umbreld.user.createUser('Alice', 'passwordpassword')
		expect(replacement.userId).toBe('Alice-2')

		// Retrying the original deletion resumes its idempotent cleanup.
		await expect(umbreld.user.deleteUser(first.userId)).resolves.toBe(true)
		expect(await umbreld.store.get('members')).toContainEqual({
			id: 'Alice',
			deleted: true,
			cleanupComplete: true,
		})
		expect(umbreld.files.deleteMemberDirectories).toHaveBeenCalledWith('Alice')
		expect(umbreld.files.memberShares.removeUserFromShares).toHaveBeenCalledWith('Alice')
		expect(umbreld.apps.removeUserFromMemberShares).toHaveBeenCalledWith('Alice')
	})

	test('resumes pending member cleanup after restart', async () => {
		const member = await umbreld.user.createUser('Grace', 'passwordpassword')
		vi.mocked(umbreld.auth.revokeAllForAccount).mockRejectedValueOnce(new Error('simulated process interruption'))
		await expect(umbreld.user.deleteUser(member.userId)).rejects.toThrow('simulated process interruption')

		vi.restoreAllMocks()
		const restarted = new Umbreld({dataDirectory})
		vi.spyOn(restarted.files, 'deleteMemberDirectories').mockResolvedValue()
		vi.spyOn(restarted.files.memberShares, 'removeUserFromShares').mockResolvedValue()
		vi.spyOn(restarted.apps, 'removeUserFromMemberShares').mockResolvedValue()
		vi.spyOn(restarted.auth, 'revokeAllForAccount').mockResolvedValue(0)

		await restarted.user.finishPendingDeletions()

		expect(restarted.auth.revokeAllForAccount).toHaveBeenCalledWith('Grace')
		expect(await restarted.store.get('members')).toEqual([{id: 'Grace', deleted: true, cleanupComplete: true}])
	})

	test('serializes display-name uniqueness checks with account renames', async () => {
		const first = await umbreld.user.createUser('Alice', 'passwordpassword')
		const second = await umbreld.user.createUser('Bob', 'passwordpassword')

		const results = await Promise.allSettled([
			umbreld.user.setAccountName(first.userId, 'Shared name'),
			umbreld.user.setAccountName(second.userId, 'Shared name'),
		])

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
		expect((await umbreld.user.listMembers()).filter((member) => member.name === 'Shared name')).toHaveLength(1)
	})

	test('does not issue a session from password and MFA state verified before an account reset', async () => {
		await umbreld.auth.start()
		const member = await umbreld.user.createUser('Satoshi', 'old-password')
		const totpUri = totp.generateUri('Umbrel', 'umbrel.local')
		await umbreld.user.enable2faForAccount(member.userId, totpUri)

		const staleValidation = await umbreld.user.validateAccountLogin(
			member.userId,
			'old-password',
			totp.generateToken(totpUri),
		)
		expect(staleValidation.valid).toBe(true)
		if (!staleValidation.valid) throw new Error('Expected valid login')

		await umbreld.user.resetMemberPassword(member.userId, 'new-password')

		await expect(
			umbreld.auth.createSession({
				accountId: member.userId,
				expectedSessionIssuanceRevision: staleValidation.sessionIssuanceRevision,
			}),
		).rejects.toThrow('Login credentials changed')
		await expect(umbreld.user.validateAccountLogin(member.userId, 'old-password')).resolves.toEqual({
			valid: false,
			reason: 'incorrect-password',
		})

		const currentValidation = await umbreld.user.validateAccountLogin(member.userId, 'new-password')
		expect(currentValidation.valid).toBe(true)
		if (!currentValidation.valid) throw new Error('Expected valid login')
		await expect(
			umbreld.auth.createSession({
				accountId: member.userId,
				expectedSessionIssuanceRevision: currentValidation.sessionIssuanceRevision,
			}),
		).resolves.toBeDefined()
	})
})
