import Foundation
@testable import UmbrelKit
import XCTest

final class PhotoBackupRecoveryStateTests: XCTestCase {
	private let sourceId = "source"

	func testConnectivityRecoverySurvivesAFreshExtensionInvocation() {
		var state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .uploading),
			sourceId: sourceId,
			storageRetryRequested: false
		)

		state.observeTerminalBatch(
			foundStorageFailure: false,
			foundConnectivityFailure: true,
			hasTerminalJobs: true
		)

		XCTAssertEqual(state.phase, .waitingForUmbrel)
		XCTAssertNil(state.issue)

		let restored = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: state.phase, issue: state.issue),
			sourceId: sourceId,
			storageRetryRequested: false
		)
		XCTAssertTrue(restored.connectivityRecovering)
		XCTAssertEqual(restored.phase, .waitingForUmbrel)
	}

	func testConnectivityFailureKeepsMixedTerminalBatchThrottled() {
		var state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .uploading),
			sourceId: sourceId,
			storageRetryRequested: false
		)

		state.observeTerminalBatch(
			foundStorageFailure: false,
			foundConnectivityFailure: true,
			hasTerminalJobs: true
		)

		XCTAssertTrue(state.connectivityRecovering)
		XCTAssertEqual(state.phase, .waitingForUmbrel)
	}

	func testPermanentResultEndsConnectivityRecovery() {
		var state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .waitingForUmbrel),
			sourceId: sourceId,
			storageRetryRequested: false
		)

		state.observeTerminalBatch(
			foundStorageFailure: false,
			foundConnectivityFailure: false,
			hasTerminalJobs: true
		)

		XCTAssertFalse(state.connectivityRecovering)
		XCTAssertEqual(state.phase, .waiting)
	}

	func testConnectivityFailureDoesNotConsumeAStorageRetry() {
		var state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .needsAttention, issue: .insufficientStorage),
			sourceId: sourceId,
			storageRetryRequested: true
		)
		XCTAssertTrue(state.storagePaused)
		XCTAssertTrue(state.storageRetryRequested)

		state.beginStorageProbe()
		state.observeTerminalBatch(
			foundStorageFailure: false,
			foundConnectivityFailure: true,
			hasTerminalJobs: true
		)
		state.finishStorageProbe(.connectivityFailure)

		XCTAssertTrue(state.storageProbing)
		XCTAssertTrue(state.storageRetryRequested)
		XCTAssertTrue(state.connectivityRecovering)
		XCTAssertEqual(state.phase, .waitingForUmbrel)
		XCTAssertNil(state.issue)

		let restored = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: state.phase, issue: state.issue),
			sourceId: sourceId,
			storageRetryRequested: true
		)
		XCTAssertTrue(restored.storageProbing)
		XCTAssertTrue(restored.connectivityRecovering)

		var resumed = restored
		resumed.observeTerminalBatch(
			foundStorageFailure: false,
			foundConnectivityFailure: false,
			hasTerminalJobs: true
		)
		resumed.finishStorageProbe(.succeeded)
		XCTAssertFalse(resumed.storageRetryRequested)
		XCTAssertFalse(resumed.storageProbing)
		XCTAssertFalse(resumed.connectivityRecovering)
		XCTAssertEqual(resumed.phase, .waiting)
		XCTAssertNil(resumed.issue)
	}

	func testConfirmedStorageFailureReturnsTheProbeToStoragePause() {
		var state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .checkingStorage, issue: .insufficientStorage),
			sourceId: sourceId,
			storageRetryRequested: true
		)

		state.observeTerminalBatch(
			foundStorageFailure: true,
			foundConnectivityFailure: false,
			hasTerminalJobs: true
		)
		state.finishStorageProbe(.insufficientStorage)

		XCTAssertTrue(state.storagePaused)
		XCTAssertFalse(state.storageRetryRequested)
		XCTAssertEqual(state.phase, .needsAttention)
		XCTAssertEqual(state.issue, .insufficientStorage)
	}

	func testPermanentFailureDoesNotMasqueradeAsInsufficientStorage() {
		var state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .checkingStorage, issue: .insufficientStorage),
			sourceId: sourceId,
			storageRetryRequested: true
		)

		state.observeTerminalBatch(
			foundStorageFailure: false,
			foundConnectivityFailure: false,
			hasTerminalJobs: true
		)
		state.finishStorageProbe(.permanentFailure)

		XCTAssertFalse(state.storagePaused)
		XCTAssertFalse(state.storageRetryRequested)
		XCTAssertFalse(state.storageProbing)
		XCTAssertEqual(state.phase, .waiting)
		XCTAssertNil(state.issue)
	}

	func testUnrelatedStaleStorageRetryRequestIsIgnored() {
		let state = PhotoBackupRecoveryState(
			snapshot: snapshot(phase: .upToDate),
			sourceId: sourceId,
			storageRetryRequested: true
		)

		XCTAssertFalse(state.storageRetryRequested)
		XCTAssertFalse(state.storageProbing)
		XCTAssertFalse(state.storagePaused)
	}

	private func snapshot(
		phase: PhotoBackupPhase,
		issue: PhotoBackupIssue? = nil
	) -> PhotoBackupSnapshot {
		PhotoBackupSnapshot(phase: phase, issue: issue, sourceId: sourceId)
	}
}
