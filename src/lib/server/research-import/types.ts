import type { ExecutiveProfile } from '../../research/schemas';
import type {
	NormalizedIssuer,
	NormalizedListing,
	NormalizedUniverseSnapshot
} from '../../research/universe';
import type {
	PortraitAddressResolver,
	PortraitFailureDiagnostic,
	PortraitFetcher,
	PortraitValidationCode,
	TransformedPortrait
} from '../../research/portrait';

export interface PreparedLeaderPortrait {
	leaderIndex: number;
	portraitIndex: number;
	portrait: TransformedPortrait;
}

export interface PreparedExecutiveProfile {
	profile: ExecutiveProfile;
	portraits: PreparedLeaderPortrait[];
}

export interface UniverseImportResult {
	issuerCount: number;
	includedCount: number;
	excludedCount: number;
	listingCount: number;
	importedAt: Date;
}

export type ProfileImportAction = 'created' | 'updated' | 'replaced';

export interface ImportedProfileResult {
	issuerKey: string;
	companyId: string;
	slateId: string;
	slateVersion: number;
	action: ProfileImportAction;
	cohortRevision: number | null;
}

export interface ProfileBatchImportResult {
	profiles: ImportedProfileResult[];
	importedAt: Date;
}

export interface FreezeResult {
	includedCount: number;
	revision: number;
	pairingSeed: string;
	frozenAt: Date;
	alreadyFrozen: boolean;
}

export interface UniverseWriteContext {
	importedAt: Date;
	asOf: Date;
	snapshot: NormalizedUniverseSnapshot;
	submittedByApiKeyId: string | null;
}

export interface ProfileWriteContext {
	importedAt: Date;
	pairingSeed: string;
	submittedByApiKeyId: string | null;
}

export interface FreezeContext {
	frozenAt: Date;
	pairingSeed: string;
}

export interface ResearchImportRepository {
	writeUniverse(
		universe: NormalizedIssuer[],
		context: UniverseWriteContext
	): Promise<UniverseImportResult>;
	writeProfiles(
		profiles: PreparedExecutiveProfile[],
		context: ProfileWriteContext
	): Promise<ProfileBatchImportResult>;
	freeze(context: FreezeContext): Promise<FreezeResult>;
}

export interface ResearchImportServiceOptions {
	fetchPortrait?: PortraitFetcher;
	resolvePortraitAddresses?: PortraitAddressResolver;
	now?: () => Date;
	pairingSeed?: () => string;
	portraitConcurrency?: number;
	portraitDiagnostic?: PortraitDiagnosticReporter;
	submittedByApiKeyId?: string;
}

export interface PortraitRejectionDiagnostic extends PortraitFailureDiagnostic {
	event: 'portrait_rejected';
	code: PortraitValidationCode;
	issuerKey: string | null;
	leaderName: string | null;
	leaderIndex: number | null;
	portraitIndex: number | null;
	imageLocation: string | null;
}

export type PortraitDiagnosticReporter = (diagnostic: PortraitRejectionDiagnostic) => void;

export interface ResearchImportService {
	importUniverse(value: unknown): Promise<UniverseImportResult>;
	importProfiles(values: readonly unknown[]): Promise<ProfileBatchImportResult>;
	freeze(): Promise<FreezeResult>;
}

export interface FreezeReadinessRow {
	issuerKey: string;
	companyName: string;
	slateId: string | null;
	personId: string | null;
	portraitCount: number;
	summarySourceCount: number;
	roleSourceCount: number;
	factCount: number;
	citedFactCount: number;
}

export interface FreezeReadinessIssue {
	issuerKey: string;
	message: string;
}

export type { NormalizedIssuer, NormalizedListing };
