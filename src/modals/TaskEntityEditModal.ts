import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import type TaskNotesPlugin from "../main";
import type { TaskEntityType } from "../core/taskEntity";
import { splitListPreservingLinksAndQuotes } from "../utils/stringSplit";
import {
	createTaskModalAreasField,
	createTaskModalGoalsField,
	createTaskModalRelationsField,
	type TaskModalMetadataFieldContext,
} from "./taskModalMetadataFields";
import { createTaskNotesLogger } from "../utils/tasknotesLogger";

const tasknotesLogger = createTaskNotesLogger({ tag: "Modals/TaskEntityEditModal" });

function readList(value: unknown): string[] {
	return (Array.isArray(value) ? value : value ? [value] : [])
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function parseList(value: string): string[] {
	return splitListPreservingLinksAndQuotes(value)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export class TaskEntityEditModal extends Modal {
	private areas = "";
	private goals = "";
	private relations = "";

	constructor(
		app: App,
		private readonly plugin: TaskNotesPlugin,
		private readonly file: TFile,
		private readonly type: TaskEntityType
	) {
		super(app);
		const frontmatter = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<
			string,
			unknown
		>;
		this.areas = readList(frontmatter[plugin.fieldMapper.toUserField("areas")]).join(", ");
		this.goals = readList(frontmatter[plugin.fieldMapper.toUserField("goals")]).join(", ");
		this.relations = readList(frontmatter[plugin.fieldMapper.toUserField("relations")]).join(
			", "
		);
	}

	onOpen(): void {
		this.modalEl.addClass("tasknotes-plugin", "tn-task-modal");
		this.titleEl.setText(this.plugin.i18n.translate("commands.editCurrentEntity"));
		const context: TaskModalMetadataFieldContext = {
			app: this.app,
			plugin: this.plugin,
			translate: (key, params) => this.plugin.i18n.translate(key, params),
			attachMobileKeyboardScrollGuard: () => undefined,
		};

		if (this.type === "project") {
			createTaskModalAreasField(context, {
				container: this.contentEl,
				value: this.areas,
				onChange: (value) => (this.areas = value),
			});
			createTaskModalGoalsField(context, {
				container: this.contentEl,
				value: this.goals,
				onChange: (value) => (this.goals = value),
			});
		}
		createTaskModalRelationsField(context, {
			container: this.contentEl,
			value: this.relations,
			onChange: (value) => (this.relations = value),
		});

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText(this.plugin.i18n.translate("common.save"))
				.setCta()
				.onClick(() => void this.save())
		);
	}

	private async save(): Promise<void> {
		try {
			await this.plugin.taskService.updateTaskEntityRelationships(this.file, this.type, {
				areas: parseList(this.areas),
				goals: parseList(this.goals),
				relations: parseList(this.relations),
			});
			this.close();
			this.app.workspace.trigger("tasknotes:refresh-views");
		} catch (error) {
			tasknotesLogger.error("Failed to update entity relationships", {
				category: "persistence",
				operation: "update-entity-relationships",
				details: { path: this.file.path, type: this.type },
				error,
			});
			new Notice(this.plugin.i18n.translate("commands.editCurrentEntitySaveFailure"));
		}
	}
}
