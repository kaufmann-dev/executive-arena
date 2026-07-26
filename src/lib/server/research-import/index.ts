import type { ResearchDatabase } from './drizzle-repository';
import { createDrizzleResearchRepository } from './drizzle-repository';
import { createResearchImportService } from './service';
import type { ResearchImportService, ResearchImportServiceOptions } from './types';

export { connectResearchDatabase } from './connection';
export { createDrizzleResearchRepository, type ResearchDatabase } from './drizzle-repository';
export {
	createPairingSeed,
	createResearchImportService,
	inspectFreezeReadiness,
	leadershipMembershipMatches,
	MAX_PROFILE_IMPORT_BATCH_SIZE,
	parseExecutiveProfileSet
} from './service';
export type * from './types';

export function createDatabaseResearchImportService(
	database: ResearchDatabase,
	options?: ResearchImportServiceOptions
): ResearchImportService {
	return createResearchImportService(createDrizzleResearchRepository(database), options);
}
