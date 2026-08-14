import { FieldMapping, PriorityConfig, StatusConfig, TaskInfo } from "../types";
import type { UserMappedField } from "../types/settings";
import { normalizePlanningState } from "./taskPlanning";
import { DEFAULT_FIELD_MAPPING } from "./defaultFieldMapping";
import {
	isRecognizedProperty,
	lookupMappingKey,
	mapTaskFromFrontmatter,
	mapTaskToFrontmatter,
	validateFieldMapping,
} from "./fieldMapping";

/**
 * Service for mapping between internal field names and user-configured property names
 */
export class FieldMapper {
	private mapping: FieldMapping;

	constructor(
		mapping: FieldMapping,
		private userFields: UserMappedField[] = [],
		private statuses: readonly StatusConfig[] = [],
		private priorities: readonly PriorityConfig[] = []
	) {
		this.mapping = { ...DEFAULT_FIELD_MAPPING, ...mapping };
	}

	/**
	 * Update user-defined field definitions (call when settings change)
	 */
	updateUserFields(fields: UserMappedField[]): void {
		this.userFields = fields;
	}

	/**
	 * Update status and priority definitions used to normalize values read
	 * directly from Obsidian properties or Bases.
	 */
	updateConfiguredValues(
		statuses: readonly StatusConfig[],
		priorities: readonly PriorityConfig[]
	): void {
		this.statuses = statuses;
		this.priorities = priorities;
	}

	/**
	 * Get current user-defined field definitions
	 */
	getUserFields(): UserMappedField[] {
		return [...this.userFields];
	}

	/**
	 * Convert internal field name to user's property name
	 */
	toUserField(internalName: keyof FieldMapping): string {
		return this.mapping[internalName];
	}

	/**
	 * Convert frontmatter object using mapping to internal task data.
	 * User-defined fields (settings.userFields) are written as top-level properties
	 * on the returned object, keyed by their frontmatter key (e.g. "start_date").
	 */
	mapFromFrontmatter(
		frontmatter: unknown,
		filePath: string,
		storeTitleInFilename?: boolean
	): Partial<TaskInfo> {
		const frontmatterRecord =
			frontmatter !== null && typeof frontmatter === "object" && !Array.isArray(frontmatter)
				? (frontmatter as Record<string, unknown>)
				: undefined;
		const mapped = mapTaskFromFrontmatter(
			this.mapping,
			frontmatterRecord,
			filePath,
			storeTitleInFilename,
			this.userFields,
			this.statuses,
			this.priorities
		) as Partial<TaskInfo>;

		if (!frontmatterRecord) return mapped;
		if (frontmatterRecord[this.mapping.planningState] !== undefined) {
			mapped.planningState = normalizePlanningState(frontmatterRecord[this.mapping.planningState]);
		}
		mapped.areas = normalizeStringList(frontmatterRecord[this.mapping.areas]);
		mapped.goals = normalizeStringList(frontmatterRecord[this.mapping.goals]);
		mapped.relations = normalizeStringList(frontmatterRecord[this.mapping.relations]);
		mapped.projectSection = normalizeOptionalString(frontmatterRecord[this.mapping.projectSection]);
		mapped.reviewDate = normalizeOptionalString(frontmatterRecord[this.mapping.reviewDate]);
		mapped.recurrence_start_offset = normalizeOptionalNumber(
			frontmatterRecord[this.mapping.recurrenceStartOffset]
		);
		return mapped;
	}

	/**
	 * Convert internal task data to frontmatter using mapping.
	 * User-defined fields are read from top-level task properties and written
	 * back to frontmatter using each field's configured frontmatter key.
	 */
	mapToFrontmatter(
		taskData: Partial<TaskInfo>,
		taskTag?: string,
		storeTitleInFilename?: boolean
	): Record<string, unknown> {
		const frontmatter = mapTaskToFrontmatter(
			this.mapping,
			taskData,
			taskTag,
			storeTitleInFilename,
			this.userFields
		);
		if (taskData.planningState !== undefined) frontmatter[this.mapping.planningState] = taskData.planningState;
		if (taskData.areas?.length) frontmatter[this.mapping.areas] = taskData.areas;
		if (taskData.goals?.length) frontmatter[this.mapping.goals] = taskData.goals;
		if (taskData.relations?.length) frontmatter[this.mapping.relations] = taskData.relations;
		if (taskData.projectSection) frontmatter[this.mapping.projectSection] = taskData.projectSection;
		if (taskData.reviewDate) frontmatter[this.mapping.reviewDate] = taskData.reviewDate;
		if (taskData.recurrence_start_offset !== undefined) {
			frontmatter[this.mapping.recurrenceStartOffset] = taskData.recurrence_start_offset;
		}
		return frontmatter;
	}

	/**
	 * Update mapping configuration
	 */
	updateMapping(newMapping: FieldMapping): void {
		this.mapping = { ...DEFAULT_FIELD_MAPPING, ...newMapping };
	}

	/**
	 * Get current mapping
	 */
	getMapping(): FieldMapping {
		return { ...this.mapping };
	}

	/**
	 * Look up the FieldMapping key for a given frontmatter property name.
	 *
	 * IMPORTANT: This returns the MAPPING KEY (e.g., "completeInstances"),
	 * NOT the frontmatter property name (e.g., "complete_instances").
	 *
	 * Use this to check if a property is recognized/mapped, but DO NOT use
	 * the returned key directly as a property identifier for TaskCard.
	 *
	 * @param frontmatterPropertyName - The property name from YAML (e.g., "complete_instances")
	 * @returns The FieldMapping key (e.g., "completeInstances") or null if not found
	 *
	 * @example
	 * // Given mapping: { completeInstances: "complete_instances" }
	 * lookupMappingKey("complete_instances") // Returns: "completeInstances"
	 * lookupMappingKey("unknown_field")      // Returns: null
	 */
	lookupMappingKey(frontmatterPropertyName: string): keyof FieldMapping | null {
		return lookupMappingKey(this.mapping, frontmatterPropertyName);
	}

	/**
	 * Check if a frontmatter property name is a recognized/configured field.
	 * Returns true if the property has a mapping, false otherwise.
	 *
	 * @param frontmatterPropertyName - The property name from YAML
	 * @returns true if the property is recognized, false otherwise
	 */
	isRecognizedProperty(frontmatterPropertyName: string): boolean {
		return isRecognizedProperty(this.mapping, frontmatterPropertyName);
	}

	/**
	 * Check if a property name matches a specific internal field.
	 * This handles user-configured field names properly.
	 *
	 * @param propertyName - The property name to check (could be user-configured or internal)
	 * @param internalField - The internal field key to check against
	 * @returns true if the propertyName is the user's configured name for this field
	 *
	 * @example
	 * // User has { status: "task-status" }
	 * isPropertyForField("task-status", "status") // true
	 * isPropertyForField("status", "status")      // false
	 *
	 * // User has { status: "status" } (default)
	 * isPropertyForField("status", "status")      // true
	 */
	isPropertyForField(propertyName: string, internalField: keyof FieldMapping): boolean {
		return propertyName === this.mapping[internalField];
	}

	/**
	 * Convert an array of internal field names to their user-configured property names.
	 *
	 * @param internalFields - Array of FieldMapping keys
	 * @returns Array of user-configured property names
	 *
	 * @example
	 * // User has { status: "task-status", due: "deadline" }
	 * toUserFields(["status", "due", "priority"])
	 * // Returns: ["task-status", "deadline", "priority"]
	 */
	toUserFields(internalFields: (keyof FieldMapping)[]): string[] {
		return internalFields.map((field) => this.mapping[field]);
	}

	/**
	 * @deprecated Use lookupMappingKey() instead for clarity about what is returned
	 * Convert user's property name back to internal field name
	 * This is the reverse of toUserField()
	 */
	fromUserField(userPropertyName: string): keyof FieldMapping | null {
		return this.lookupMappingKey(userPropertyName);
	}

	/**
	 * Validate that a mapping has no empty field names
	 */
	static validateMapping(mapping: FieldMapping): { valid: boolean; errors: string[] } {
		return validateFieldMapping(mapping);
	}
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
	const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
	const normalized = values
		.map(normalizeOptionalString)
		.filter((item): item is string => item !== undefined);
	return normalized.length ? normalized : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
		return Number(value);
	}
	return undefined;
}
