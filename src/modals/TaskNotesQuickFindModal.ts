import { FuzzySuggestModal, TFile, type App } from "obsidian";
import type TaskNotesPlugin from "../main";

interface QuickFindItem {
	label: string;
	detail: string;
	file?: TFile;
	commandId?: "open-tasks-view" | "open-entities-view";
}

export class TaskNotesQuickFindModal extends FuzzySuggestModal<QuickFindItem> {
	private constructor(
		app: App,
		private readonly plugin: TaskNotesPlugin,
		private readonly items: QuickFindItem[]
	) {
		super(app);
		this.setPlaceholder(plugin.i18n.translate("commands.quickFind"));
	}

	static async open(plugin: TaskNotesPlugin): Promise<void> {
		const tasks = await plugin.cacheManager.getAllTasks();
		const items: QuickFindItem[] = [{
			label: plugin.i18n.translate("commands.openPlanningView"),
			detail: plugin.i18n.translate("commands.openPlanningView"),
			commandId: "open-tasks-view",
		}];
		items.push({
			label: plugin.i18n.translate("commands.openEntitiesView"),
			detail: plugin.i18n.translate("commands.openEntitiesView"),
			commandId: "open-entities-view",
		});
		for (const task of tasks) {
			const file = plugin.app.vault.getAbstractFileByPath(task.path);
			if (file instanceof TFile) items.push({ label: task.title, detail: task.path, file });
		}
		for (const file of plugin.app.vault.getMarkdownFiles()) {
			const type = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.tasknotesType;
			if (type === "project" || type === "area" || type === "goal") {
				items.push({ label: file.basename, detail: type, file });
			}
		}
		new TaskNotesQuickFindModal(plugin.app, plugin, items).open();
	}

	getItems(): QuickFindItem[] {
		return this.items;
	}

	getItemText(item: QuickFindItem): string {
		return `${item.label} ${item.detail}`;
	}

	renderSuggestion(value: { item: QuickFindItem }, el: HTMLElement): void {
		el.createDiv({ text: value.item.label });
		el.createEl("small", { text: value.item.detail });
	}

	onChooseItem(item: QuickFindItem): void {
		if (item.file) {
			void this.app.workspace.getLeaf(false).openFile(item.file);
		} else if (item.commandId) {
			void this.plugin.openBasesFileForCommand(item.commandId);
		}
	}
}
