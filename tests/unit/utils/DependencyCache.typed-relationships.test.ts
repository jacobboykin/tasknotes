import { TFile, type App } from "obsidian";
import { FieldMapper } from "../../../src/core/FieldMapper";
import { DEFAULT_FIELD_MAPPING } from "../../../src/core/defaultFieldMapping";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { DependencyCache } from "../../../src/utils/DependencyCache";

type MockApp = App & {
	files: Map<string, TFile>;
	metadata: Map<
		string,
		{ frontmatter: Record<string, unknown>; links?: Array<{ link: string }> }
	>;
	metadataChangedHandlers: Array<(file: TFile, data: unknown, cache: unknown) => void>;
	metadataResolvedHandlers: Array<() => void>;
};

function createMockApp(): MockApp {
	const files = new Map<string, TFile>();
	const metadata = new Map<
		string,
		{ frontmatter: Record<string, unknown>; links?: Array<{ link: string }> }
	>();
	const metadataChangedHandlers: Array<(file: TFile, data: unknown, cache: unknown) => void> = [];
	const metadataResolvedHandlers: Array<() => void> = [];
	return {
		files,
		metadata,
		metadataChangedHandlers,
		metadataResolvedHandlers,
		vault: {
			getMarkdownFiles: jest.fn(() => Array.from(files.values())),
			getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
			on: jest.fn(() => ({})),
		},
		metadataCache: {
			resolvedLinks: {},
			getFileCache: jest.fn((file: TFile) => metadata.get(file.path) ?? null),
			getFirstLinkpathDest: jest.fn((linkpath: string) => {
				const suffix = `/${linkpath}.md`;
				return (
					Array.from(files.values()).find((file) => file.path.endsWith(suffix)) ?? null
				);
			}),
			on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
				if (event === "changed") {
					metadataChangedHandlers.push(handler as (file: TFile, data: unknown, cache: unknown) => void);
				}
				if (event === "resolved") metadataResolvedHandlers.push(handler);
				return {};
			}),
			offref: jest.fn(),
		},
	} as unknown as MockApp;
}

function addFile(
	app: MockApp,
	path: string,
	frontmatter: Record<string, unknown>,
	bodyLinks: string[] = []
): TFile {
	const file = new TFile(path);
	app.files.set(path, file);
	app.metadata.set(path, {
		frontmatter,
		links: bodyLinks.map((link) => ({ link })),
	});
	return file;
}

function createCache(app: MockApp): DependencyCache {
	return new DependencyCache(
		app,
		DEFAULT_SETTINGS,
		new FieldMapper(DEFAULT_FIELD_MAPPING),
		{ isCompletedStatus: jest.fn(() => false) },
		(frontmatter) => Array.isArray((frontmatter as { tags?: unknown }).tags)
	);
}

describe("typed TaskNotes relationships", () => {
	it("derives a task's effective Area and Goal through its Project without treating backlinks as relationships", async () => {
		const app = createMockApp();
		addFile(app, "TaskNotes/Areas/Health.md", { tasknotesType: "area" });
		addFile(app, "TaskNotes/Goals/Run a marathon.md", { tasknotesType: "goal" });
		addFile(app, "TaskNotes/Projects/Marathon training.md", {
			tasknotesType: "project",
			areas: ["[[Health]]"],
			goals: ["[[Run a marathon]]"],
		});
		addFile(app, "TaskNotes/Tasks/Run today.md", {
			tags: ["task"],
			projects: ["[[Marathon training]]"],
		}, ["Health"]);

		const cache = createCache(app);
		await cache.buildIndexes();

		expect(cache.getTypedRelationships("TaskNotes/Tasks/Run today.md")).toEqual({
			path: "TaskNotes/Tasks/Run today.md",
			outgoing: {
				project: ["TaskNotes/Projects/Marathon training.md"],
				area: [],
				goal: [],
				related: [],
			},
			incoming: { project: [], area: [], goal: [], related: [] },
			effectiveAreas: ["TaskNotes/Areas/Health.md"],
			effectiveGoals: ["TaskNotes/Goals/Run a marathon.md"],
		});
		expect(cache.getTypedRelationships("TaskNotes/Areas/Health.md").incoming.area).toEqual([
			"TaskNotes/Projects/Marathon training.md",
		]);
	});

	it("refreshes inherited membership when an entity's typed relationships change", async () => {
		const app = createMockApp();
		addFile(app, "TaskNotes/Areas/Health.md", { tasknotesType: "area" });
		addFile(app, "TaskNotes/Areas/Personal.md", { tasknotesType: "area" });
		const project = addFile(app, "TaskNotes/Projects/Training.md", {
			tasknotesType: "project",
			areas: ["[[Health]]"],
		});
		addFile(app, "TaskNotes/Tasks/Run.md", {
			tags: ["task"],
			projects: ["[[Training]]"],
		});
		const cache = createCache(app);
		await cache.buildIndexes();
		cache.initialize();

		const changedFrontmatter = { tasknotesType: "project", areas: ["[[Personal]]"] };
		app.metadata.set(project.path, { frontmatter: changedFrontmatter });
		app.metadataChangedHandlers[0](project, "", { frontmatter: changedFrontmatter });

		expect(cache.getTypedRelationships("TaskNotes/Tasks/Run.md").effectiveAreas).toEqual([
			"TaskNotes/Areas/Personal.md",
		]);
	});

	it("resolves an unchanged relationship source when its target is created later", async () => {
		const app = createMockApp();
		addFile(app, "TaskNotes/Projects/Training.md", {
			tasknotesType: "project",
			areas: ["[[Health]]"],
		});
		addFile(app, "TaskNotes/Tasks/Run.md", {
			tags: ["task"],
			projects: ["[[Training]]"],
		});
		const cache = createCache(app);
		await cache.buildIndexes();
		cache.initialize();

		expect(cache.getTypedRelationships("TaskNotes/Tasks/Run.md").effectiveAreas).toEqual([]);
		addFile(app, "TaskNotes/Areas/Health.md", { tasknotesType: "area" });
		app.metadataResolvedHandlers[0]();

		expect(cache.getTypedRelationships("TaskNotes/Tasks/Run.md").effectiveAreas).toEqual([
			"TaskNotes/Areas/Health.md",
		]);
	});
});
