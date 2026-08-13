import { Modal, Notice, Setting, type App } from "obsidian";
import type TaskNotesPlugin from "../main";
import type { TaskEntityType } from "../core/taskEntity";

export class TaskEntityCreationModal extends Modal {
	private title = "";

	constructor(
		app: App,
		private readonly plugin: TaskNotesPlugin,
		private readonly type: TaskEntityType
	) {
		super(app);
	}

	onOpen(): void {
		const typeName = `${this.type[0].toUpperCase()}${this.type.slice(1)}`;
		this.titleEl.setText(this.plugin.i18n.translate(`commands.create${typeName}`));
		new Setting(this.contentEl).setName(this.plugin.i18n.translate("modals.task.titleLabel")).addText((text) => {
			text.setPlaceholder(`${this.type[0].toUpperCase()}${this.type.slice(1)} name`);
			text.onChange((value) => (this.title = value));
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") void this.save();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText(this.plugin.i18n.translate("common.save")).setCta().onClick(() => void this.save())
		);
	}

	private async save(): Promise<void> {
		try {
			const file = await this.plugin.taskService.createTaskEntity(this.type, this.title);
			this.close();
			await this.plugin.app.workspace.getLeaf(false).openFile(file);
			new Notice(`${this.type[0].toUpperCase()}${this.type.slice(1)} created`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : `Failed to create ${this.type}`);
		}
	}
}
