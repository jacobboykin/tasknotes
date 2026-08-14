/* eslint-disable @typescript-eslint/no-non-null-assertion -- Dependency graph traversal guards resolved task nodes before dereferencing. */
import { TFile, App, Events, EventRef } from "obsidian";
import { FieldMapper } from "../core/FieldMapper";
import { normalizeDependencyList, resolveDependencyEntry } from "./dependencyUtils";
import { TaskNotesSettings } from "../types/settings";
import { isPathInExcludedFolder, parseExcludedFolders } from "./pathExclusions";
import { createTaskNotesLogger } from "./tasknotesLogger";
import {
	TYPED_RELATIONSHIP_TYPES,
	type TypedRelationshipSnapshot,
	type TypedRelationshipType,
} from "../core/taskRelationships";

const tasknotesLogger = createTaskNotesLogger({ tag: "Utils/DependencyCache" });

export const EVENT_DEPENDENCY_CACHE_CHANGED = "dependency-cache-changed";

interface DependencyStatusClassifier {
	isCompletedStatus(statusValue: string): boolean;
}

/**
 * Cache for task dependencies and explicit TaskNotes relationships.
 * These require relationship tracking that can't be efficiently computed on-demand.
 *
 * Design Philosophy:
 * - Focused: Only tracks dependencies and project references
 * - Event-driven: Updates when files change
 * - Simple: No complex querying, just relationship lookups
 */
export class DependencyCache extends Events {
	private app: App;
	private settings: TaskNotesSettings;
	private excludedFolders: string[];
	private fieldMapper?: FieldMapper;
	private statusManager: DependencyStatusClassifier;

	// Dependency indexes
	private dependencySources: Map<string, Set<string>> = new Map(); // task path -> blocking task paths
	private dependencyTargets: Map<string, Set<string>> = new Map(); // task path -> tasks blocked by this task
	private activeDependencySources: Map<string, Set<string>> = new Map(); // task path -> incomplete blocking task paths
	private activeDependencyTargets: Map<string, Set<string>> = new Map(); // task path -> tasks actively blocked by this task

	// Typed relationship indexes. Forward fields are canonical; inverse edges are derived here.
	private relationshipTargets: Record<TypedRelationshipType, Map<string, Set<string>>> = {
		project: new Map(),
		area: new Map(),
		goal: new Map(),
		related: new Map(),
	};
	private relationshipSources: Record<TypedRelationshipType, Map<string, Set<string>>> = {
		project: new Map(),
		area: new Map(),
		goal: new Map(),
		related: new Map(),
	};
	private relationshipFingerprints: Map<string, string> = new Map();
	private completedStatusByPath: Map<string, boolean> = new Map(); // file path -> completion state for status-aware dependency lookups

	// Initialization state
	private initialized = false;
	private indexesBuilt = false;

	// Event listeners for cleanup
	private eventListeners: EventRef[] = [];

	// Callback to check if a file is a task
	private isTaskFileCallback: (frontmatter: unknown) => boolean;

	constructor(
		app: App,
		settings: TaskNotesSettings,
		fieldMapper: FieldMapper | undefined,
		statusManager: DependencyStatusClassifier,
		isTaskFileCallback: (frontmatter: unknown) => boolean
	) {
		super();
		this.app = app;
		this.settings = settings;
		this.excludedFolders = parseExcludedFolders(settings.excludedFolders);
		this.fieldMapper = fieldMapper;
		this.statusManager = statusManager;
		this.isTaskFileCallback = isTaskFileCallback;
	}

	/**
	 * Initialize by setting up event listeners
	 */
	initialize(): void {
		if (this.initialized) {
			return;
		}

		this.setupEventListeners();
		this.initialized = true;
	}

	/**
	 * Build indexes on demand (lazy)
	 */
	async buildIndexes(): Promise<void> {
		if (this.indexesBuilt) return;

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			if (!this.isValidFile(file.path)) {
				continue;
			}

			const metadata = this.app.metadataCache.getFileCache(file);
			if (!metadata?.frontmatter || !this.isRelationshipSource(metadata.frontmatter)) {
				continue;
			}

			this.indexRelationshipFile(file.path, metadata.frontmatter);
		}

		this.indexesBuilt = true;
		this.trigger(EVENT_DEPENDENCY_CACHE_CHANGED);
	}

	/**
	 * Setup event listeners
	 */
	private setupEventListeners(): void {
		// Listen for metadata changes
		const changedRef = this.app.metadataCache.on("changed", (file, data, cache) => {
			if (file instanceof TFile && file.extension === "md") {
				this.handleFileChanged(file, cache);
			}
		});
		this.eventListeners.push(changedRef);

		const resolvedRef = this.app.metadataCache.on("resolved", () => {
			if (!this.indexesBuilt) return;
			// ponytail: rebuild on link-resolution events; track unresolved source refs if
			// large-vault profiling shows this is materially expensive.
			this.clearIndexes();
			this.indexesBuilt = false;
			this.buildIndexesSync();
		});
		this.eventListeners.push(resolvedRef);

		// Listen for file deletion
		const deletedRef = this.app.metadataCache.on("deleted", (file, prevCache) => {
			if (file instanceof TFile && file.extension === "md") {
				this.handleFileDeleted(file.path);
			}
		});
		this.eventListeners.push(deletedRef);

		// Listen for file rename
		const renameRef = this.app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile && file.extension === "md") {
				this.handleFileRenamed(file, oldPath);
			}
		});
		this.eventListeners.push(renameRef);
	}

	/**
	 * Handle file changes
	 */
	private handleFileChanged(file: TFile, cache: unknown): void {
		const before = this.getFileRelationshipSignature(file.path);

		if (!this.isValidFile(file.path)) {
			this.clearFileFromIndexes(file.path);
			this.triggerIfFileRelationshipsChanged(file.path, before);
			return;
		}

		const frontmatter = this.getFrontmatterFromCache(cache) ?? this.getFrontmatterForFile(file);
		this.updateCompletionState(file.path, frontmatter);

		if (!frontmatter) {
			if (this.hasForwardRelationships(file.path)) {
				this.clearForwardRelationships(file.path);
			}
			this.triggerIfFileRelationshipsChanged(file.path, before);
			return;
		}

		if (!this.isRelationshipSource(frontmatter)) {
			if (this.hasForwardRelationships(file.path)) {
				this.clearForwardRelationships(file.path);
			}
			this.triggerIfFileRelationshipsChanged(file.path, before);
			return;
		}

		const nextFingerprint = this.buildRelationshipFingerprint(frontmatter);
		if (this.relationshipFingerprints.get(file.path) === nextFingerprint) {
			this.triggerIfFileRelationshipsChanged(file.path, before);
			return;
		}

		// Re-index this task
		// Only clear the forward dependencies (tasks this task depends on)
		// Keep reverse dependencies intact - they'll be updated when other tasks change
		this.clearForwardRelationships(file.path);
		this.indexRelationshipFile(file.path, frontmatter);
		this.triggerIfFileRelationshipsChanged(file.path, before);
	}

	private triggerIfFileRelationshipsChanged(path: string, before: string): void {
		if (this.getFileRelationshipSignature(path) !== before) {
			this.trigger(EVENT_DEPENDENCY_CACHE_CHANGED);
		}
	}

	private getFileRelationshipSignature(path: string): string {
		const blockingTasks = this.sortedSetValues(this.dependencySources.get(path));
		const blockedTasks = this.sortedSetValues(this.activeDependencyTargets.get(path));
		const outgoing = this.getRelationshipRecord(this.relationshipSources, path);
		const incoming = this.getRelationshipRecord(this.relationshipTargets, path);

		return JSON.stringify({
			blockedTasks,
			blockingTasks,
			incoming,
			outgoing,
		});
	}

	private sortedSetValues(values: Set<string> | undefined): string[] {
		return values ? Array.from(values).sort() : [];
	}

	/**
	 * Handle file deletion
	 */
	private handleFileDeleted(path: string): void {
		this.clearFileFromIndexes(path);
		this.trigger(EVENT_DEPENDENCY_CACHE_CHANGED);
	}

	/**
	 * Handle file rename
	 */
	private handleFileRenamed(file: TFile, oldPath: string): void {
		// Get metadata for new path
		const frontmatter = this.getFrontmatterForFile(file);

		// Clear old path
		this.clearFileFromIndexes(oldPath);

		// Index new path if it declares TaskNotes relationships.
		if (this.isValidFile(file.path) && frontmatter && this.isRelationshipSource(frontmatter)) {
			this.indexRelationshipFile(file.path, frontmatter);
		}
		this.trigger(EVENT_DEPENDENCY_CACHE_CHANGED);
	}

	private getFrontmatterForFile(file: TFile): Record<string, unknown> | null {
		const metadata = this.app.metadataCache.getFileCache(file);
		return this.getFrontmatterFromCache(metadata);
	}

	private getFrontmatterFromCache(cache: unknown): Record<string, unknown> | null {
		if (!cache || typeof cache !== "object" || !("frontmatter" in cache)) {
			return null;
		}

		const frontmatter = (cache as { frontmatter?: unknown }).frontmatter;
		if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
			return null;
		}

		return frontmatter as Record<string, unknown>;
	}

	/**
	 * Resolve a project reference string to a file path
	 */
	private resolveRelationshipReference(sourcePath: string, reference: string): string | null {
		if (!reference || typeof reference !== "string") {
			return null;
		}

		const trimmed = reference.trim();
		if (!trimmed) {
			return null;
		}

		// Use resolveDependencyEntry to handle wikilinks, markdown links, and plain text
		const resolved = resolveDependencyEntry(this.app, sourcePath, trimmed);
		return resolved?.path || null;
	}

	/**
	 * Index a task or entity note's explicit relationships.
	 */
	private indexRelationshipFile(path: string, frontmatter: Record<string, unknown>): void {
		if (!this.isValidFile(path)) {
			return;
		}

		this.relationshipFingerprints.set(path, this.buildRelationshipFingerprint(frontmatter));
		const isTask = this.isTaskFileCallback(frontmatter);
		if (isTask) {
			this.completedStatusByPath.set(path, this.isCompletedFrontmatter(frontmatter));
		}

		const dependenciesField = this.fieldMapper?.toUserField("blockedBy") || "blockedBy";

		// Index dependencies
		const dependencies = isTask ? frontmatter[dependenciesField] : undefined;
		if (dependencies) {
			const normalized = normalizeDependencyList(dependencies);
			if (normalized) {
				const blockingTasks = new Set<string>();

				for (const dep of normalized) {
					const resolved = resolveDependencyEntry(this.app, path, dep);
					if (resolved?.path && this.isValidFile(resolved.path)) {
						this.addDependencyLink(path, resolved.path, blockingTasks);
					}
				}

				if (blockingTasks.size > 0) {
					this.dependencySources.set(path, blockingTasks);
				}
			}
		}

		for (const type of TYPED_RELATIONSHIP_TYPES) {
			const field = this.getRelationshipField(type);
			for (const reference of this.normalizeRelationshipValues(frontmatter[field])) {
				const resolvedPath = this.resolveRelationshipReference(path, reference);
				if (resolvedPath && this.isValidFile(resolvedPath)) {
					this.addRelationship(type, path, resolvedPath);
				}
			}
		}
	}

	private isRelationshipSource(frontmatter: Record<string, unknown>): boolean {
		if (this.isTaskFileCallback(frontmatter)) return true;
		return ["project", "area", "goal"].includes(String(frontmatter.tasknotesType));
	}

	private getRelationshipField(type: TypedRelationshipType): string {
		switch (type) {
			case "project":
				return this.fieldMapper?.toUserField("projects") || "projects";
			case "area":
				return this.fieldMapper?.toUserField("areas") || "areas";
			case "goal":
				return this.fieldMapper?.toUserField("goals") || "goals";
			case "related":
				return this.fieldMapper?.toUserField("relations") || "relations";
		}
	}

	private addRelationship(
		type: TypedRelationshipType,
		sourcePath: string,
		targetPath: string
	): void {
		const sources = this.relationshipSources[type];
		const targets = this.relationshipTargets[type];
		if (!sources.has(sourcePath)) sources.set(sourcePath, new Set());
		if (!targets.has(targetPath)) targets.set(targetPath, new Set());
		sources.get(sourcePath)!.add(targetPath);
		targets.get(targetPath)!.add(sourcePath);
	}

	private addDependencyLink(
		dependentPath: string,
		blockingPath: string,
		blockingTasks: Set<string>
	): void {
		blockingTasks.add(blockingPath);

		if (!this.dependencyTargets.has(blockingPath)) {
			this.dependencyTargets.set(blockingPath, new Set());
		}
		this.dependencyTargets.get(blockingPath)!.add(dependentPath);

		if (!this.isCompletedPath(blockingPath)) {
			this.addActiveDependencyLink(dependentPath, blockingPath);
		}
	}

	private addActiveDependencyLink(dependentPath: string, blockingPath: string): void {
		if (!this.activeDependencySources.has(dependentPath)) {
			this.activeDependencySources.set(dependentPath, new Set());
		}
		this.activeDependencySources.get(dependentPath)!.add(blockingPath);

		if (!this.activeDependencyTargets.has(blockingPath)) {
			this.activeDependencyTargets.set(blockingPath, new Set());
		}
		this.activeDependencyTargets.get(blockingPath)!.add(dependentPath);
	}

	private removeActiveDependencyLink(dependentPath: string, blockingPath: string): void {
		const activeSources = this.activeDependencySources.get(dependentPath);
		if (activeSources) {
			activeSources.delete(blockingPath);
			if (activeSources.size === 0) {
				this.activeDependencySources.delete(dependentPath);
			}
		}

		const activeTargets = this.activeDependencyTargets.get(blockingPath);
		if (activeTargets) {
			activeTargets.delete(dependentPath);
			if (activeTargets.size === 0) {
				this.activeDependencyTargets.delete(blockingPath);
			}
		}
	}

	private rebuildActiveLinksForBlocker(blockingPath: string): void {
		const blockedTasks = this.dependencyTargets.get(blockingPath);
		this.activeDependencyTargets.delete(blockingPath);

		if (!blockedTasks) {
			return;
		}

		for (const dependentPath of blockedTasks) {
			const activeSources = this.activeDependencySources.get(dependentPath);
			if (activeSources) {
				activeSources.delete(blockingPath);
				if (activeSources.size === 0) {
					this.activeDependencySources.delete(dependentPath);
				}
			}
		}

		if (this.isCompletedPath(blockingPath)) {
			return;
		}

		for (const dependentPath of blockedTasks) {
			this.addActiveDependencyLink(dependentPath, blockingPath);
		}
	}

	private buildRelationshipFingerprint(frontmatter: Record<string, unknown>): string {
		const dependenciesField = this.fieldMapper?.toUserField("blockedBy") || "blockedBy";

		const dependencies = (normalizeDependencyList(frontmatter[dependenciesField]) ?? [])
			.map((dependency) => dependency.uid)
			.filter((uid) => uid.length > 0)
			.sort();
		const relationships = Object.fromEntries(
			TYPED_RELATIONSHIP_TYPES.map((type) => [
				type,
				this.normalizeRelationshipValues(frontmatter[this.getRelationshipField(type)]),
			])
		);

		return JSON.stringify({ dependencies, relationships });
	}

	private normalizeRelationshipValues(value: unknown): string[] {
		const values = Array.isArray(value) ? value : value ? [value] : [];
		const normalized = new Set<string>();

		for (const value of values) {
			if (typeof value !== "string") {
				continue;
			}

			const trimmed = value.trim();
			if (trimmed) {
				normalized.add(trimmed);
			}
		}

		return Array.from(normalized).sort();
	}

	private hasForwardRelationships(path: string): boolean {
		return (
			this.relationshipFingerprints.has(path) ||
			this.dependencySources.has(path) ||
			TYPED_RELATIONSHIP_TYPES.some((type) => this.relationshipSources[type].has(path))
		);
	}

	private updateCompletionState(path: string, frontmatter: Record<string, unknown> | null): void {
		const oldCompleted = this.completedStatusByPath.get(path) ?? false;
		const newCompleted = frontmatter ? this.isCompletedFrontmatter(frontmatter) : false;
		this.completedStatusByPath.set(path, newCompleted);

		if (oldCompleted !== newCompleted) {
			this.rebuildActiveLinksForBlocker(path);
		}
	}

	private isCompletedPath(path: string): boolean {
		const cached = this.completedStatusByPath.get(path);
		if (cached !== undefined) {
			return cached;
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			this.completedStatusByPath.set(path, false);
			return false;
		}

		const frontmatter = this.getFrontmatterForFile(file);
		const completed = frontmatter ? this.isCompletedFrontmatter(frontmatter) : false;
		this.completedStatusByPath.set(path, completed);
		return completed;
	}

	private isCompletedFrontmatter(frontmatter: Record<string, unknown>): boolean {
		const statusField = this.fieldMapper?.toUserField("status") || "status";
		const status = frontmatter[statusField];
		const statusText = this.stringifyStatusValue(status);
		return Boolean(statusText && this.statusManager.isCompletedStatus(statusText));
	}

	private stringifyStatusValue(status: unknown): string | null {
		if (
			typeof status === "string" ||
			typeof status === "number" ||
			typeof status === "boolean"
		) {
			return String(status);
		}

		return null;
	}

	/**
	 * Clear only forward dependencies (tasks this task depends on)
	 * Used when a task is modified - we rebuild forward deps from frontmatter
	 * but keep reverse deps intact (they're stored in other tasks' frontmatter)
	 */
	private clearForwardRelationships(path: string): void {
		// Clear from dependency sources (tasks this task depends on)
		const blockingTasks = this.dependencySources.get(path);
		if (blockingTasks) {
			// Remove from targets (reverse mapping)
			for (const blockingTask of blockingTasks) {
				const targets = this.dependencyTargets.get(blockingTask);
				if (targets) {
					targets.delete(path);
					if (targets.size === 0) {
						this.dependencyTargets.delete(blockingTask);
					}
				}
				this.removeActiveDependencyLink(path, blockingTask);
			}
			this.dependencySources.delete(path);
		}
		this.activeDependencySources.delete(path);

		this.clearOutgoingRelationships(path);
		this.relationshipFingerprints.delete(path);
	}

	private clearOutgoingRelationships(path: string): void {
		for (const type of TYPED_RELATIONSHIP_TYPES) {
			const targets = this.relationshipSources[type].get(path);
			if (!targets) continue;
			for (const targetPath of targets) {
				const sources = this.relationshipTargets[type].get(targetPath);
				sources?.delete(path);
				if (sources?.size === 0) this.relationshipTargets[type].delete(targetPath);
			}
			this.relationshipSources[type].delete(path);
		}
	}

	private clearIncomingRelationships(path: string): void {
		for (const type of TYPED_RELATIONSHIP_TYPES) {
			const sources = this.relationshipTargets[type].get(path);
			if (!sources) continue;
			for (const sourcePath of sources) {
				const targets = this.relationshipSources[type].get(sourcePath);
				targets?.delete(path);
				if (targets?.size === 0) this.relationshipSources[type].delete(sourcePath);
			}
			this.relationshipTargets[type].delete(path);
		}
	}

	/**
	 * Clear a file from all indexes (both forward and reverse dependencies)
	 * Used when a file is deleted or becomes a non-task
	 */
	private clearFileFromIndexes(path: string): void {
		// Clear from dependency sources
		const blockingTasks = this.dependencySources.get(path);
		if (blockingTasks) {
			// Remove from targets
			for (const blockingTask of blockingTasks) {
				const targets = this.dependencyTargets.get(blockingTask);
				if (targets) {
					targets.delete(path);
					if (targets.size === 0) {
						this.dependencyTargets.delete(blockingTask);
					}
				}
				this.removeActiveDependencyLink(path, blockingTask);
			}
			this.dependencySources.delete(path);
		}
		this.activeDependencySources.delete(path);

		// Clear from dependency targets
		const blockedTasks = this.dependencyTargets.get(path);
		if (blockedTasks) {
			// Remove from sources
			for (const blockedTask of blockedTasks) {
				const sources = this.dependencySources.get(blockedTask);
				if (sources) {
					sources.delete(path);
					if (sources.size === 0) {
						this.dependencySources.delete(blockedTask);
					}
				}
				this.removeActiveDependencyLink(blockedTask, path);
			}
			this.dependencyTargets.delete(path);
		}
		this.activeDependencyTargets.delete(path);

		this.clearOutgoingRelationships(path);
		this.clearIncomingRelationships(path);
		this.relationshipFingerprints.delete(path);
		this.completedStatusByPath.delete(path);
	}

	/**
	 * Get blocking task paths (tasks this task depends on)
	 */
	getBlockingTaskPaths(taskPath: string): string[] {
		if (!this.indexesBuilt) {
			tasknotesLogger.warn(
				"DependencyCache: getBlockingTaskPaths called before indexes built, building now...",
				{
					category: "stale-data",
					operation:
						"dependencycache-getblockingtaskpaths-called-indexes-built-building-now",
				}
			);
			// Build synchronously by reading current state
			this.buildIndexesSync();
		}
		const blocking = this.dependencySources.get(taskPath);
		return blocking ? Array.from(blocking) : [];
	}

	/**
	 * Get blocked task paths (tasks that depend on this task)
	 */
	getBlockedTaskPaths(taskPath: string): string[] {
		if (!this.indexesBuilt) {
			tasknotesLogger.warn(
				"DependencyCache: getBlockedTaskPaths called before indexes built, building now...",
				{
					category: "stale-data",
					operation:
						"dependencycache-getblockedtaskpaths-called-indexes-built-building-now",
				}
			);
			this.buildIndexesSync();
		}

		const blocked = this.activeDependencyTargets.get(taskPath);
		return blocked ? Array.from(blocked) : [];
	}

	/**
	 * Check if a task is blocked by dependencies (status-aware)
	 * Only returns true if the task has blocking dependencies that are NOT completed
	 */
	isTaskBlocked(taskPath: string): boolean {
		if (!this.indexesBuilt) {
			this.buildIndexesSync();
		}
		return (this.activeDependencySources.get(taskPath)?.size ?? 0) > 0;
	}

	/**
	 * Get tasks referencing a project
	 */
	getTasksReferencingProject(projectPath: string): string[] {
		if (!this.indexesBuilt) {
			tasknotesLogger.warn(
				"DependencyCache: getTasksReferencingProject called before indexes built, building now...",
				{
					category: "stale-data",
					operation:
						"dependencycache-gettasksreferencingproject-called-indexes-built-building-now",
				}
			);
			this.buildIndexesSync();
		}
		const sources = this.relationshipTargets.project.get(projectPath);
		if (!sources) return [];
		return Array.from(sources).filter((path) => {
			const file = this.app.vault.getAbstractFileByPath(path);
			return (
				file instanceof TFile &&
				this.isTaskFileCallback(this.getFrontmatterForFile(file) ?? {})
			);
		});
	}

	/**
	 * Check if a file is used as a project
	 */
	isFileUsedAsProject(filePath: string): boolean {
		if (!this.indexesBuilt) {
			tasknotesLogger.warn(
				"DependencyCache: isFileUsedAsProject called before indexes built, building now...",
				{
					category: "stale-data",
					operation:
						"dependencycache-isfileusedasproject-called-indexes-built-building-now",
				}
			);
			this.buildIndexesSync();
		}
		return this.relationshipTargets.project.has(filePath);
	}

	getTypedRelationships(path: string): TypedRelationshipSnapshot {
		if (!this.indexesBuilt) this.buildIndexesSync();
		const outgoing = this.getRelationshipRecord(this.relationshipSources, path);
		const incoming = this.getRelationshipRecord(this.relationshipTargets, path);
		return {
			path,
			outgoing,
			incoming,
			effectiveAreas: this.getEffectiveTargets(outgoing, "area"),
			effectiveGoals: this.getEffectiveTargets(outgoing, "goal"),
		};
	}

	private getRelationshipRecord(
		index: Record<TypedRelationshipType, Map<string, Set<string>>>,
		path: string
	): Record<TypedRelationshipType, string[]> {
		return {
			project: this.sortedSetValues(index.project.get(path)),
			area: this.sortedSetValues(index.area.get(path)),
			goal: this.sortedSetValues(index.goal.get(path)),
			related: this.sortedSetValues(index.related.get(path)),
		};
	}

	private getEffectiveTargets(
		outgoing: Record<TypedRelationshipType, string[]>,
		type: "area" | "goal"
	): string[] {
		const effective = new Set(outgoing[type]);
		for (const projectPath of outgoing.project) {
			for (const targetPath of this.relationshipSources[type].get(projectPath) ?? []) {
				effective.add(targetPath);
			}
		}
		return Array.from(effective).sort();
	}

	/**
	 * Build indexes synchronously (for lazy initialization)
	 */
	private buildIndexesSync(): void {
		if (this.indexesBuilt) return;

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			if (!this.isValidFile(file.path)) {
				continue;
			}

			const metadata = this.app.metadataCache.getFileCache(file);
			if (!metadata?.frontmatter || !this.isRelationshipSource(metadata.frontmatter)) {
				continue;
			}

			this.indexRelationshipFile(file.path, metadata.frontmatter);
		}

		this.indexesBuilt = true;
		this.trigger(EVENT_DEPENDENCY_CACHE_CHANGED);
	}

	updateConfig(settings: TaskNotesSettings): void {
		this.settings = settings;
		this.excludedFolders = parseExcludedFolders(settings.excludedFolders);
		this.clearIndexes();
		this.indexesBuilt = false;
	}

	private isValidFile(path: string): boolean {
		return !isPathInExcludedFolder(path, this.excludedFolders);
	}

	private clearIndexes(): void {
		this.dependencySources.clear();
		this.dependencyTargets.clear();
		this.activeDependencySources.clear();
		this.activeDependencyTargets.clear();
		for (const type of TYPED_RELATIONSHIP_TYPES) {
			this.relationshipTargets[type].clear();
			this.relationshipSources[type].clear();
		}
		this.relationshipFingerprints.clear();
		this.completedStatusByPath.clear();
	}

	/**
	 * Cleanup
	 */
	destroy(): void {
		// Unregister all event listeners
		this.eventListeners.forEach((ref) => {
			this.app.metadataCache.offref(ref);
		});
		this.eventListeners = [];

		// Clear indexes
		this.clearIndexes();

		this.initialized = false;
		this.indexesBuilt = false;
	}
}

/* eslint-enable @typescript-eslint/no-non-null-assertion -- Re-enable after the dependency cache implementation. */
