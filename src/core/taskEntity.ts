import { stringifyYaml } from "obsidian";

export const TASK_ENTITY_TYPES = ["project", "area", "goal"] as const;
export type TaskEntityType = (typeof TASK_ENTITY_TYPES)[number];

export interface TaskEntityRelationships {
	areas: string[];
	goals: string[];
	relations: string[];
}

export function getTaskEntityType(value: unknown): TaskEntityType | null {
	return TASK_ENTITY_TYPES.includes(value as TaskEntityType) ? (value as TaskEntityType) : null;
}

export const TASK_ENTITY_FOLDERS: Record<TaskEntityType, string> = {
	project: "TaskNotes/Projects",
	area: "TaskNotes/Areas",
	goal: "TaskNotes/Goals",
};

const ENTITY_SECTIONS: Record<TaskEntityType, string[]> = {
	project: ["Next actions", "Notes"],
	area: ["Projects", "Notes"],
	goal: ["Milestones", "Projects", "Notes"],
};

export function buildTaskEntityContent(type: TaskEntityType, title: string): string {
	const frontmatter = stringifyYaml({
		tasknotesType: type,
		title: title.trim(),
		status: "active",
		planning: "anytime",
	});
	const sections = ENTITY_SECTIONS[type].map((section) => `## ${section}`).join("\n\n");
	return `---\n${frontmatter}---\n\n# ${title.trim()}\n\n${sections}\n`;
}
